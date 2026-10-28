/** Verify the portable QQ adapter without modifying an installed gateway. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, linkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const installer = fileURLToPath(new URL('../install-official-qq-bridge.mjs', import.meta.url));
const original = [
  'import { registerSendFileTool } from "../media/send-file-tool.js";',
  '    // ── 中间件链 ──',
  '        cacheMsgId(mCtx.replyTarget.scope, mCtx.replyTarget.targetId, mCtx.replyTarget.msgId);',
  "        .on('session/event', outboundHandler);",
  "        bot.on('disconnected', (event) => {",
  "    bot.on('ready', () => {",
  '    ctx\n        .effect(() => {',
  '            await manager.disposeAll();\n            bot.stop();',
].join('\n') + '\n';

function fixture(t, version = '0.5.2') {
  const home = mkdtempSync(join(tmpdir(), 'whalemate-qq-adapter-'));
  t.after(() => {
    assert.equal(dirname(home), resolve(tmpdir()));
    assert.ok(home.startsWith(join(tmpdir(), 'whalemate-qq-adapter-')));
    rmSync(home, { recursive: true, force: true });
  });
  const pkg = join(home, 'profiles', 'custom', 'node_modules', '@tencent-connect', 'dsh-qqbot');
  const gateway = join(pkg, 'dist', 'gateway');
  mkdirSync(gateway, { recursive: true });
  mkdirSync(join(home, 'remembers-service'));
  writeFileSync(join(home, 'remembers-service', 'official-qq-bridge.json'), '{}');
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ version }));
  const shared = join(home, 'shared-bootstrap.js');
  const entry = join(gateway, 'bootstrap.js');
  writeFileSync(shared, original);
  linkSync(shared, entry);
  const install = () => execFileSync(process.execPath, [installer], {
    env: { ...process.env, DSH_HOME: home, CMEM_DSH_PROFILE: 'custom' },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { gateway, shared, entry, install };
}

test('QQ adapter honors a custom profile, detaches shared files and installs repeatably', t => {
  const f = fixture(t);
  f.install();
  const installed = readFileSync(f.entry, 'utf8');
  assert.equal(readFileSync(f.shared, 'utf8'), original);
  assert.match(installed, /automation\.replyStyle\.route/);
  assert.match(installed, /chunkText: text => chunkMarkdownText\(text, config\.textChunkLimit\)/);
  for (const name of ['local-automation-bridge.mjs', 'qq-meme-auto.mjs', 'qq-reply-style.mjs', 'expression-style.mjs', 'expression-style.json']) {
    assert.ok(existsSync(join(f.gateway, name)), name);
  }
  f.install();
  assert.equal(readFileSync(f.entry, 'utf8'), installed);
  assert.equal(readFileSync(f.shared, 'utf8'), original);
});

test('QQ adapter rejects another official version before changing its files', t => {
  const f = fixture(t, '0.5.3');
  assert.throws(f.install, error => /supports only official QQ plugin 0\.5\.2/.test(error.stderr));
  assert.equal(readFileSync(f.entry, 'utf8'), original);
  assert.equal(readFileSync(f.shared, 'utf8'), original);
  assert.equal(existsSync(join(f.gateway, 'local-automation-bridge.mjs')), false);
});
