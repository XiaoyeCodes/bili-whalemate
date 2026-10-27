/** Exercise real service ownership without model credentials or social accounts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchService } from '../runtime.mjs';

const python = process.env.WHALEMATE_TEST_PYTHON;
async function listener() {
  const server = createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true,"whalemate_instance":"unrelated"}'); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server;
}
function fixture(t, port) {
  const home = mkdtempSync(join(tmpdir(), 'whalemate-runtime-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return { home, python, node: process.execPath, profile: 'test', port, endpoint: `http://127.0.0.1:${port}`,
    startupTimeoutMs: 10000, dataDir: join(home, 'remembers-data'), memeDir: join(home, 'media') };
}
test('service health belongs to this launch and disposal releases its listener', { skip: !python }, async t => {
  const reservation = await listener(); const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const config = fixture(t, port);
  const service = await launchService(config);
  try {
    const health = await (await fetch(config.endpoint + '/health')).json();
    assert.ok(health.ok); assert.ok(health.whalemate_instance);
  } finally { await service.close(); }
  await assert.rejects(fetch(config.endpoint + '/health', { signal: AbortSignal.timeout(500) }));
  await service.close();
});
test('an unrelated listener is never adopted or terminated', { skip: !python }, async t => {
  const unrelated = await listener();
  t.after(() => { unrelated.closeAllConnections(); return new Promise(resolve => unrelated.close(resolve)); });
  const config = fixture(t, unrelated.address().port);
  await assert.rejects(launchService(config), /exited|healthy/);
  assert.equal(unrelated.listening, true);
});
