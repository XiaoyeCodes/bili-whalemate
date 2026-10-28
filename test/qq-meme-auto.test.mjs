import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { QqMemeAuto } from "../qq-meme-auto.mjs";

function fixture(t, { rate = 1, random = () => 0.5, match = true, request: override } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "qq-meme-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "sleep.gif"), "image");
  const sent = [], calls = [];
  const record = { replyTarget: { scope: "c2c", targetId: "owner", msgId: "one" } };
  const manager = { findBySessionId: id => id === "qq-session" ? record : undefined };
  const request = override || (async (url, options) => {
    calls.push({ path: new URL(url).pathname, body: options.body && JSON.parse(options.body) });
    const value = url.endsWith("/proactive") ? { memeRate: rate }
      : url.endsWith("/memes/search") ? { ok: true, memes: match ? [{ file: "sleep.gif" }] : [] } : { ok: true };
    return new Response(JSON.stringify(value));
  });
  const auto = new QqMemeAuto({ manager, sender: { async sendImage(target, source) { sent.push({ target, source }); return { message: { id: 'image-' + sent.length } }; } },
    logger: { warn() {} }, endpoint: "http://fixture", memeDir: dir, random, request });
  t.after(() => auto.dispose());
  const session = { header: { id: "qq-session" } };
  const turn = (number, { source = "user", reason = "completed", muted = false } = {}) => {
    auto.observe(session, { type: "turn/start", data: { turn: number } });
    auto.observe(session, { type: "user/message", data: { source: { kind: source }, content: [{ type: "text", text: "晚安" }] } });
    auto.observe(session, { type: "assistant/message", data: { message: { content: [{ type: "text", text: "晚安，好梦" }] } } });
    auto.observe(session, { type: "turn/end", data: { reason: { kind: reason } } }, muted);
  };
  const settle = async () => { await Promise.all([...auto.pending]); };
  return { auto, record, sent, calls, turn, settle, session };
}

for (const [rate, expected] of [[0, 0], [0.2, 200], [0.5, 500], [1, 1000]]) {
  test(`${rate * 100}% samples once per real reply and sends only approved images`, async t => {
    let draw = 0;
    const f = fixture(t, { rate, random: () => (draw++ % 1000) / 1000 });
    for (let i = 0; i < 1000; i++) { f.turn(i); await f.settle(); }
    assert.equal(f.sent.length, expected);
    assert.equal(f.calls.filter(x => x.path === "/memes/search").length, expected);
    assert.equal(f.calls.filter(x => x.path === "/memes/used").length, expected);
    if (expected) assert.match(f.calls.find(x => x.path === "/memes/search").body.context, /实际回复：晚安，好梦/);
  });
}

test("no image is sent for absent matches, scheduled turns, muted turns, or failed turns", async t => {
  const f = fixture(t, { match: false });
  f.turn(1); await f.settle();
  f.turn(2, { source: "schedule" }); f.turn(3, { muted: true }); f.turn(4, { reason: "error" });
  await f.settle();
  assert.equal(f.sent.length, 0);
  assert.equal(f.calls.filter(x => x.path === "/memes/search").length, 1);
});

test("a new incoming turn cancels a delayed selection for the previous message", async t => {
  let release;
  const f = fixture(t, { request: async url => {
    if (url.endsWith("/proactive")) return new Response('{"memeRate":1}');
    await new Promise(resolve => { release = resolve; });
    return new Response('{"ok":true,"memes":[{"file":"sleep.gif"}]}');
  } });
  f.turn(1);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  f.record.replyTarget = { ...f.record.replyTarget, msgId: "two" };
  f.auto.observe(f.session, { type: "turn/start", data: { turn: 2 } });
  release(); await f.settle();
  assert.equal(f.sent.length, 0);
});

test("invalid file and repeated turn/end cannot trigger a send", async t => {
  const f = fixture(t, { request: async url => new Response(url.endsWith("/proactive") ? '{"memeRate":1}' : '{"ok":true,"memes":[{"file":"../bad.gif"}]}') });
  f.turn(1);
  f.auto.observe(f.session, { type: "turn/end", data: { reason: { kind: "completed" } } });
  await f.settle();
  assert.equal(f.sent.length, 0);
});

test("matching or sending failures do not retry or fall back to another image", async t => {
  const f = fixture(t);
  let attempts = 0;
  f.auto.sender.sendImage = async () => { attempts++; throw new Error("QQ upload failed"); };
  f.turn(1); await f.settle();
  assert.equal(attempts, 1);
  assert.equal(f.calls.filter(x => x.path === "/memes/used").length, 0);
  const bad = fixture(t, { request: async url => url.endsWith("/proactive")
    ? new Response('{"memeRate":1}') : new Response('error', { status: 500 }) });
  bad.turn(1); await bad.settle();
  assert.equal(bad.sent.length, 0);
});
