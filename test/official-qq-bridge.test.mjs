import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { OfficialQqBridge } from "../official-qq-bridge.mjs";

function fixture(t, { paired = true, deferIdle = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "dsh-qq-bridge-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const configPath = join(directory, "config.json");
  writeFileSync(configPath, JSON.stringify({ port: 3081, token: "x".repeat(64), pairingCode: "642891",
    ownerOpenId: paired ? "owner-openid" : "", maxMessageChars: 12000, jobTimeoutMs: 5000,
    maxHistoryEntries: 20, journalPath: join(directory, "events.jsonl") }));
  const calls = [];
  let finish;
  const idle = deferIdle ? new Promise(resolve => { finish = resolve; }) : Promise.resolve();
  const agent = { status: "idle", followup(message) { calls.push(message); }, whenIdle() { return idle; }, cancel() { finish?.(); } };
  const bridge = new OfficialQqBridge({ configPath, bot: { async sendText() {} },
    manager: { async getOrCreate() { return { sessionId: "test-session", agent }; } },
    createUserMessage: message => message, sendMarkdown: async () => ({ id: "message-id" }),
    logger: { error() {}, warn() {} } });
  bridge.ready = true;
  return { bridge, calls, finish, configPath };
}

async function route(bridge, path, body, authorized = true) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = "POST"; req.url = path;
  req.headers = authorized ? { authorization: "Bearer " + "x".repeat(64) } : {};
  const res = { writeHead(status) { this.status = status; }, end(value) { this.body = JSON.parse(value); } };
  await bridge.route(req, res);
  return res;
}

test("unauthorized requests never enqueue a model task", async t => {
  const { bridge, calls } = fixture(t);
  const res = await route(bridge, "/wake", { prompt: "hello", requestId: "a" }, false);
  assert.equal(res.status, 401); assert.equal(calls.length, 0);
});

test("SDK session resume restores notification admission and disposal removes the listener", async t => {
  const { bridge } = fixture(t);
  const handlers = new Map();
  bridge.bot.on = (event, handler) => handlers.set(event, handler);
  bridge.bot.off = (event, handler) => { assert.equal(handlers.get(event), handler); handlers.delete(event); };
  bridge.ready = false;
  bridge.watchGatewayResume();
  handlers.get("resumed")();
  assert.equal(bridge.ready, true);
  assert.equal((await route(bridge, "/notify", { text: "restored" })).status, 200);
  await bridge.dispose();
  assert.equal(handlers.size, 0);
});

test("owner is paired only by the exact private pairing phrase", async t => {
  const { bridge, configPath } = fixture(t, { paired: false });
  assert.equal(await bridge.handleMessage({ message: { kind: "c2c", senderId: "stranger", content: "hello" } }), false);
  assert.equal(bridge.config.ownerOpenId, "");
  assert.equal(await bridge.handleMessage({ message: { kind: "group", senderId: "stranger", content: "绑定自动浏览 642891" } }), false);
  assert.equal(await bridge.handleMessage({ message: { kind: "c2c", senderId: "owner", content: "绑定自动浏览 642891" }, replyTarget: {} }), true);
  const saved = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(saved.ownerOpenId, "owner"); assert.equal(saved.pairingCode, "");
});

test("one request is queued once and silent output stays muted through its interval", async t => {
  const { bridge, calls, finish } = fixture(t, { deferIdle: true });
  const body = { prompt: "browse", requestId: "browse-1", silent: true };
  assert.equal((await route(bridge, "/wake", body)).status, 202);
  assert.equal((await route(bridge, "/wake", body)).body.duplicate, true);
  assert.equal(calls.length, 1); assert.equal(calls[0].source.kind, "schedule");
  assert.ok(bridge.mutedSessions.has("test-session"));
  assert.equal((await route(bridge, "/wake", { ...body, requestId: "browse-2" })).status, 409);
  finish(); await bridge.jobPromise;
  assert.equal(bridge.busy, false); assert.equal(bridge.mutedSessions.size, 0);
  assert.equal(bridge.jobs.get("browse-1").status, "idle");
});

test("notifications never accept a caller-supplied recipient", async t => {
  const { bridge } = fixture(t);
  let target;
  bridge.sendMarkdown = async (recipient) => { target = recipient; return { id: "sent" }; };
  const response = await route(bridge, "/notify", { text: "hello", targetId: "stranger" });
  assert.equal(response.status, 200); assert.equal(target.targetId, "owner-openid");
});

test("interrupted requests are retained across reload and cannot be sent twice", async t => {
  const { bridge, configPath } = fixture(t);
  bridge.journal({ type: "job", requestId: "interrupted", status: "queued" });
  const restored = new OfficialQqBridge({ configPath, bot: {}, manager: {}, logger: {} });
  restored.ready = true;
  const response = await route(restored, "/wake", { requestId: "interrupted", prompt: "browse" });
  assert.equal(response.status, 409); assert.equal(response.body.job.status, "interrupted");
});
