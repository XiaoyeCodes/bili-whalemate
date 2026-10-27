/** Per-install paths and an owned, health-checked Python subprocess. */
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const root = dirname(fileURLToPath(import.meta.url));

/** Read private setup output. No credentials are stored in the distributable bundle. */
export function readRuntime(home = process.env.DSH_HOME || join(homedir(), '.dsh')) {
  const config = JSON.parse(readFileSync(join(home, 'whalemate', 'runtime.json'), 'utf8'));
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535
      || !Number.isInteger(config.startupTimeoutMs) || config.startupTimeoutMs < 1000
      || !['python', 'node', 'profile'].every(key => typeof config[key] === 'string' && config[key])) {
    throw new Error('Invalid Whalemate runtime settings; run install.ps1 again.');
  }
  return { ...config, home, endpoint: `http://127.0.0.1:${config.port}`,
    dataDir: join(home, 'remembers-data'), memeDir: join(home, 'media', 'whalemate') };
}

/** Launch only this installation's service; a different listener never counts as healthy. */
export async function launchService(config) {
  const instance = randomUUID();
  const logs = join(config.home, 'whalemate');
  mkdirSync(logs, { recursive: true });
  const logPath = join(logs, 'service.log');
  const fd = openSync(logPath, 'a', 0o600);
  let child;
  try {
    child = spawn(config.python, [join(root, 'service', 'runner.py')], {
      cwd: join(root, 'service'), windowsHide: true,
      stdio: ['pipe', fd, fd],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1',
        DSH_HOME: config.home, CMEM_DSH_PROFILE: config.profile,
        CMEM_HOST: '127.0.0.1', CMEM_PORT: String(config.port),
        CMEM_DATA_DIR: config.dataDir, CMEM_MEME_DIR: config.memeDir,
        CMEM_BILI_DIR: join(root, 'vendor', 'bili-whale'), CMEM_NODE_BIN: config.node,
        CMEM_WHALEMATE_INSTANCE: instance },
    });
  } finally { closeSync(fd); }
  let failure;
  child.on('error', error => { failure = error; });
  child.stdin.on('error', error => { if (error.code !== 'EPIPE') failure = error; });
  let closed = false;
  const exited = new Promise(resolve => child.once('exit', resolve));
  async function close() {
    if (closed) return;
    closed = true;
    child.stdin.end();
    if (child.exitCode !== null || child.pid === undefined) return;
    const graceful = await Promise.race([exited.then(() => true), delay(8000, undefined, { ref: false }).then(() => false)]);
    if (!graceful) {
      if (process.platform === 'win32') {
        await new Promise(resolve => {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          killer.once('exit', resolve); killer.once('error', resolve);
        });
      } else child.kill('SIGKILL');
      await Promise.race([exited, delay(2000, undefined, { ref: false })]);
    }
  }
  try {
    const deadline = Date.now() + config.startupTimeoutMs;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error(`Whalemate service exited (${child.exitCode}); see ${logPath}`);
      try {
        const response = await fetch(config.endpoint + '/health', { signal: AbortSignal.timeout(1000), headers: { 'X-Auth-Token': process.env.CMEM_AUTH_TOKEN || '' } });
        const data = await response.json();
        if (data.whalemate_instance === instance && data.ok) return { close, pid: child.pid };
      } catch (error) { /* Startup can precede the HTTP listener; the deadline owns failure reporting. */ }
      await delay(150);
    }
    throw new Error(`Whalemate service did not become healthy; check port ${config.port} and ${logPath}`);
  } catch (error) { await close(); throw error; }
}
