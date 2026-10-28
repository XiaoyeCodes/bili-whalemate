import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebMemeAuto } from "../web-meme-auto.mjs";

async function fixture(t, { match = true, failCommit = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "web-meme-"));
  const records = [], requests = [];
  await writeFile(join(dir, "question.gif"), "fixture");
  const controller = new WebMemeAuto({ endpoint: "http://fixture", memeDir: dir,
    logger: { warn() {} }, isQqSession: session => session.id === "qq",
    appendRecord: (_session, type, data) => {
      if (failCommit && data.status === "sent") throw new Error("record commit failed");
      records.push({ type, data });
    },
    request: async (url, options) => {
      requests.push(new URL(url).pathname);
      return new Response(JSON.stringify(url.endsWith("/proactive") ? { memeRate: 1 }
        : url.endsWith("/memes/search") ? { ok: true, memes: match ? [{ file: "question.gif" }] : [], hint: "当前没有合适图片" }
        : { ok: true }));
    },
  });
  t.after(async () => { await controller.dispose(); await rm(dir, { recursive: true, force: true }); });
  const session = { id: "web", header: { id: "web" } };
  function turn(source = "user", current = session) {
    controller.observe(current, { type: "turn/start", data: { turn: 1 } });
    controller.observe(current, { type: "user/message", data: { source: { kind: source }, content: [{ type: "text", text: "这是张 vv" }] } });
    controller.observe(current, { type: "assistant/message", data: { message: { content: [{ type: "text", text: "是名字还是缩写？" }] } } });
    controller.observe(current, { type: "turn/end", data: { reason: { kind: "completed" } } });
  }
  return { controller, records, requests, turn, session };
}

test("100% Web replies commit a replayable image record and never call a QQ sender", async t => {
  const f = await fixture(t);
  f.turn(); await Promise.all(f.controller.auto.pending);
  assert.equal(f.records.length, 1);
  assert.equal(f.records[0].type, "plugin:dsh-remembers/meme");
  assert.deepEqual({ channel: f.records[0].data.channel, status: f.records[0].data.status, file: f.records[0].data.file },
    { channel: "web", status: "sent", file: "question.gif" });
  assert.equal(f.requests.filter(path => path === "/memes/used").length, 1);
});

test("Web observers skip QQ, scheduled turns and subagents", async t => {
  const f = await fixture(t);
  f.turn("user", { id: "qq", header: { id: "qq" } });
  f.turn("user", { id: "child", header: { id: "child", origin: "subagent" } });
  f.turn("schedule"); await Promise.all(f.controller.auto.pending);
  assert.equal(f.records.length, 0); assert.equal(f.requests.length, 0);
});

test("a failed Web record commit produces a failure record without marking the image as used", async t => {
  const f = await fixture(t, { failCommit: true });
  f.turn(); await Promise.all(f.controller.auto.pending);
  assert.equal(f.records[0].data.status, "failed");
  assert.match(f.records[0].data.reason, /record commit failed/);
  assert.ok(!f.requests.includes("/memes/used"));
});
