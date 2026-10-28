/** Verify profile selection, repeat installation and validation before bootstrap mutation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const original = `import { registerSendFileTool } from "../media/send-file-tool.js";
    // ── 中间件链 ──
        cacheMsgId(mCtx.replyTarget.scope, mCtx.replyTarget.targetId, mCtx.replyTarget.msgId);
        .on('session/event', outboundHandler);
        bot.on('disconnected', (event) => {
    bot.on('ready', () => {
    ctx
        .effect(() => {
            await manager.disposeAll();
            bot.stop();
`;
function fixture(t, source = original, version = '0.5.2') {
  const home = mkdtempSync(join(tmpdir(), 'whalemate-adapter-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const pkg = join(home, 'profiles', 'desktop', 'node_modules', '@tencent-connect', 'dsh-qqbot');
  const gateway = join(pkg, 'dist', 'gateway');
  mkdirSync(gateway, { recursive: true });
  mkdirSync(join(home, 'remembers-service'));
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ version }));
  writeFileSync(join(home, 'remembers-service', 'official-qq-bridge.json'), '{}');
  const entry = join(gateway, 'bootstrap.js');
  writeFileSync(entry, source);
  const shared = join(home, 'shared-original.js');
  linkSync(entry, shared);
  const run = () => spawnSync(process.execPath, [fileURLToPath(new URL('../install-official-qq-bridge.mjs', import.meta.url))],
    { encoding: 'utf8', env: { ...process.env, DSH_HOME: home, CMEM_DSH_PROFILE: 'desktop' } });
  return { run, entry, shared, gateway };
}
test('desktop adapter upgrades once, installs dependencies and preserves a shared original inode', t => {
  const f = fixture(t);
  const first = f.run();
  assert.equal(first.status, 0, first.stderr);
  const updated = readFileSync(f.entry, 'utf8');
  assert.match(updated, /automation.replyStyle.route/);
  assert.match(updated, /chunkMarkdownText/);
  assert.equal(readFileSync(f.shared, 'utf8'), original);
  for (const name of ['local-automation-bridge.mjs', 'qq-meme-auto.mjs', 'qq-reply-style.mjs', 'expression-style.mjs', 'expression-style.json']) {
    assert.ok(readFileSync(join(f.gateway, name)).length);
  }
  const second = f.run();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(f.entry, 'utf8'), updated);
});
test('unknown plugin version or missing source anchors leave the bootstrap untouched', t => {
  for (const [source, version] of [[original, '0.6.0'], ['changed source', '0.5.2']]) {
    const f = fixture(t, source, version);
    assert.notEqual(f.run().status, 0);
    assert.equal(readFileSync(f.entry, 'utf8'), source);
  }
});
