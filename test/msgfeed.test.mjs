/** Notification pagination is tested without accounts or platform writes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const calls = [];
let responses;
globalThis.__feedTransport = async url => {
  calls.push(new URL(url));
  assert.ok(responses.length, 'unexpected extra page request');
  return new Response(JSON.stringify(responses.shift()));
};
registerHooks({ resolve(s, c, next) {
  const source = s.endsWith('/traffic.mjs') ? 'export const guardedFetch=(...args)=>globalThis.__feedTransport(...args);'
    : s.endsWith('/config.mjs') ? 'export const config=()=>({});' : null;
  return source ? { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true } : next(s, c);
} });
const { pullFeed } = await import('../vendor/bili-whale/tools/lib/msgfeed.mjs');
const item = id => ({ id, user: { mid: '999' }, item: { subject_id: '111', source_id: '222' } });
for (const kind of ['reply', 'at']) {
  test(`${kind} uses numeric pagination fields, deduplicates overlap and stops at the last page`, async () => {
    calls.length = 0;
    responses = [
      { code: 0, data: { items: [item('1')], cursor: { id: '9007199254740993', time: 123, is_end: false } } },
      { code: 0, data: { items: [item('1'), item('2')], cursor: { id: '3', time: 100, is_end: true } } },
    ];
    const feed = await pullFeed(kind, { headers: {}, pages: 3 });
    assert.deepEqual(feed.items.map(row => row.id), ['1', '2']);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].searchParams.get('id'), '9007199254740993');
    assert.equal(calls[1].searchParams.get(kind + '_time'), '123');
    assert.equal(calls[1].searchParams.has('cursor'), false);
  });
}
test('a malformed cursor fails instead of repeatedly fetching the first page', async () => {
  calls.length = 0;
  responses = [{ code: 0, data: { items: [item('1')], cursor: { id: {}, time: 123 } } }];
  await assert.rejects(pullFeed('reply', { headers: {}, pages: 2 }), /pagination cursor/);
  assert.equal(calls.length, 1);
});
