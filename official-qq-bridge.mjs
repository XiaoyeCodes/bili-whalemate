/** Local scheduler adapter for the installed Tencent QQ gateway. No separate QQ login. */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { timingSafeEqual } from "node:crypto";
import { QqMemeAuto } from "./qq-meme-auto.mjs";
import { QqReplyStyle } from "./qq-reply-style.mjs";

/** Owns scheduler admission, owner pairing, and SDK sends until gateway teardown. */
export class OfficialQqBridge {
  constructor({ bot, manager, createUserMessage, sendMarkdown, sendImage, chunkText, logger, configPath }) {
    this.bot = bot;
    this.manager = manager;
    this.createUserMessage = createUserMessage;
    this.sendMarkdown = sendMarkdown;
    this.logger = logger;
    this.configPath = configPath;
    this.config = JSON.parse(readFileSync(configPath, "utf8"));
    const c = this.config;
    if (!Number.isInteger(c.port) || c.port < 1024 || c.port > 65535 || typeof c.token !== "string" || c.token.length < 32
      || !Number.isInteger(c.maxMessageChars) || c.maxMessageChars < 1 || !Number.isInteger(c.jobTimeoutMs) || c.jobTimeoutMs < 1000
      || !Number.isInteger(c.maxHistoryEntries) || c.maxHistoryEntries < 1 || typeof c.journalPath !== "string") {
      throw new Error("Invalid official QQ scheduler configuration");
    }
    this.ready = false;
    this.closing = false;
    this.busy = false;
    this.jobs = new Map();
    let history = "";
    try { history = readFileSync(c.journalPath, "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const line of history.trim().split("\n").filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.type === "job") this.jobs.set(event.requestId, { ...event, status: event.status === "queued" ? "interrupted" : event.status });
    }
    while (this.jobs.size > c.maxHistoryEntries) this.jobs.delete(this.jobs.keys().next().value);
    this.mutedSessions = new Set();
    this.requests = new Set();
    this.lastInbound = null;
    this.lastNotification = null;
    this.jobPromise = null;
    this.jobAgent = null;
    if (sendImage) {
      this.memeAuto = new QqMemeAuto({ manager, sender: { sendImage }, logger,
        endpoint: c.serviceEndpoint || process.env.CMEM_URL || process.env.CMEM_ENDPOINT || "http://127.0.0.1:8080",
        token: process.env.CMEM_AUTH_TOKEN || "", memeDir: c.memeDir || process.env.CMEM_MEME_DIR || "/home/ubuntu/.dsh/media/onebot/memes" });
    }
    this.replyStyle = new QqReplyStyle({ manager, sendMarkdown, chunks: chunkText,
      settings: () => this.memeAuto.json("/proactive"), logger,
      observe: (session, event, muted) => this.memeAuto?.observe(session, event, muted),
      onOutcome: outcome => { this.lastReply = { at: new Date().toISOString(), ...outcome }; this.journal({ type: "reply-expression", ...this.lastReply }); } });
    this.server = createServer((req, res) => {
      const task = this.route(req, res).catch(error => {
        this.logger.error(`QQ automation request failed: ${error.message}`);
        this.respond(res, error.status || 500, { ok: false, error: error.message });
      });
      this.requests.add(task);
      void task.finally(() => this.requests.delete(task));
    });
  }

  /** Bind only loopback; callers additionally need the per-install bearer token. */
  async start() {
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.config.port, "127.0.0.1", () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    this.server.on("error", error => this.logger.error(`QQ automation listener: ${error.message}`));
    this.watchGatewayResume();
    globalThis[Symbol.for("dsh-remembers.qq-bridge")] = this;
    return this;
  }

  /** Restore admission after the SDK resumes an existing WebSocket session. */
  watchGatewayResume() {
    if (this.resumeHandler) return;
    this.resumeHandler = () => { if (!this.closing) this.ready = true; };
    this.bot.on("resumed", this.resumeHandler);
  }

  /** Capture only the explicit pairing phrase; no first-user auto-ownership. */
  async handleMessage(context) {
    const m = context.message;
    if (m.kind === "group") return false;
    const text = String(m.content || "").trim();
    const phrase = `绑定自动浏览 ${this.config.pairingCode}`;
    if (this.config.pairingCode && text === phrase) {
      if (this.config.ownerOpenId && this.config.ownerOpenId !== m.senderId) return false;
      this.config.ownerOpenId = m.senderId;
      this.config.pairingCode = "";
      const tmp = this.configPath + ".tmp";
      writeFileSync(tmp, JSON.stringify(this.config, null, 2) + "\n", { mode: 0o600 });
      renameSync(tmp, this.configPath);
      this.lastInbound = { target: context.replyTarget, at: Date.now() };
      await this.bot.sendText(context.replyTarget, "自动浏览通知已绑定到这个 QQ。会沿用大肥鱼的人设，找到值得分享的视频后通知你。");
      this.journal({ type: "paired", at: new Date().toISOString() });
      return true;
    }
    if (m.senderId === this.config.ownerOpenId) this.lastInbound = { target: context.replyTarget, at: Date.now() };
    return false;
  }

  journal(event) {
    mkdirSync(dirname(this.config.journalPath), { recursive: true });
    appendFileSync(this.config.journalPath, JSON.stringify(event) + "\n", { mode: 0o600 });
  }

  respond(res, status, body) {
    if (res.destroyed || res.writableEnded) return;
    const data = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(data);
  }

  async route(req, res) {
    const supplied = Buffer.from(req.headers.authorization || "");
    const expected = Buffer.from(`Bearer ${this.config.token}`);
    if (req.headers.origin || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return this.respond(res, 401, { ok: false, error: "unauthorized" });
    }
    if (req.method === "GET" && req.url === "/status") {
      return this.respond(res, 200, { ok: true, ready: this.ready, ownerBound: !!this.config.ownerOpenId, memeAutoReady: !!this.memeAuto, textStyleReady: !!this.replyStyle,
        busy: this.busy, ownerSessionId: this.config.ownerOpenId ? this.manager.getSessionRecord?.('c2c', this.config.ownerOpenId)?.sessionId : undefined, jobs: [...this.jobs.values()], lastNotification: this.lastNotification, lastReply: this.lastReply });
    }
    if (req.method !== "POST" || !["/wake", "/notify"].includes(req.url)) {
      return this.respond(res, 404, { ok: false, error: "not found" });
    }
    if (this.closing || !this.ready || !this.config.ownerOpenId) {
      return this.respond(res, 503, { ok: false, error: "QQ gateway not ready or owner not paired" });
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > this.config.maxMessageChars * 8) return this.respond(res, 413, { ok: false, error: "body too large" });
      chunks.push(chunk);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch (error) { return this.respond(res, 400, { ok: false, error: "invalid JSON" }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return this.respond(res, 400, { ok: false, error: "object required" });
    if (req.url === "/notify") {
      const text = body.text;
      if (typeof text !== "string" || !text.trim() || text.length > this.config.maxMessageChars) {
        return this.respond(res, 400, { ok: false, error: "invalid notification text" });
      }
      const target = { scope: "c2c", targetId: this.config.ownerOpenId };
      const result = await this.sendMarkdown(target, text);
      this.lastNotification = { at: new Date().toISOString(), id: result?.id || null, accepted: true };
      this.journal({ type: "notification", ...this.lastNotification });
      return this.respond(res, 200, { ok: true, ...this.lastNotification });
    }
    if (typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > this.config.maxMessageChars
      || typeof body.requestId !== "string" || !body.requestId || body.requestId.length > 200
      || (body.silent !== undefined && typeof body.silent !== "boolean")) {
      return this.respond(res, 400, { ok: false, error: "invalid scheduled request" });
    }
    if (this.jobs.has(body.requestId)) {
      const job = this.jobs.get(body.requestId);
      if (job.status === "interrupted") return this.respond(res, 409, { ok: false, error: "previous request was interrupted; inspect journal before retrying", job });
      return this.respond(res, 200, { ok: true, duplicate: true, job });
    }
    if (this.busy) return this.respond(res, 409, { ok: false, error: "QQ automation is busy" });
    this.busy = true;
    let record;
    try {
      record = await this.manager.getOrCreate("c2c", this.config.ownerOpenId, this.config.ownerOpenId,
        { scope: "c2c", targetId: this.config.ownerOpenId });
      if (record.agent.status !== "idle" || this.closing) {
        this.busy = false;
        return this.respond(res, 409, { ok: false, error: "QQ conversation is busy" });
      }
      const job = { requestId: body.requestId, status: "queued", at: new Date().toISOString(), sessionId: record.sessionId };
      this.journal({ type: "job", ...job });
      this.jobs.set(body.requestId, job);
      while (this.jobs.size > this.config.maxHistoryEntries) this.jobs.delete(this.jobs.keys().next().value);
      if (body.silent) this.mutedSessions.add(record.sessionId);
      this.jobAgent = record.agent;
      record.agent.followup(this.createUserMessage({ content: [{ type: "text", text: body.prompt }], source: { kind: "schedule" } }));
      this.jobPromise = this.finishInterval(record, job);
      this.respond(res, 202, { ok: true, accepted: true, job });
    } catch (error) {
      if (record) this.mutedSessions.delete(record.sessionId);
      this.busy = false;
      throw error;
    }
  }

  /** Result describes the owned idle-to-idle interval, not an individual message. */
  async finishInterval(record, job) {
    let timer;
    try {
      await Promise.race([
        record.agent.whenIdle(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("scheduled interval timed out")), this.config.jobTimeoutMs); }),
      ]);
      job.status = "idle";
    } catch (error) {
      job.status = "failed";
      job.error = error.message;
      record.agent.cancel({ kind: "user" });
      await record.agent.whenIdle().catch(cancelError => this.logger.warn(`QQ automation cancellation: ${cancelError.message}`));
      this.logger.error(`QQ automation job failed: ${error.message}`);
    } finally {
      clearTimeout(timer);
      this.mutedSessions.delete(record.sessionId);
      job.endedAt = new Date().toISOString();
      try { this.journal({ type: "job", ...job }); }
      catch (error) { this.logger.error(`QQ automation journal failed: ${error.message}`); }
      this.jobAgent = null;
      this.busy = false;
    }
  }

  /** Stop admission and settle SDK sends and model work before gateway disposal. */
  async dispose() {
    if (this.disposePromise) return this.disposePromise;
    this.closing = true;
    if (globalThis[Symbol.for("dsh-remembers.qq-bridge")] === this) delete globalThis[Symbol.for("dsh-remembers.qq-bridge")];
    if (this.resumeHandler) this.bot.off("resumed", this.resumeHandler);
    this.disposePromise = (async () => {
      const closed = new Promise(resolve => this.server.close(resolve));
      await this.replyStyle.dispose();
      await this.memeAuto?.dispose();
      await Promise.allSettled([...this.requests]);
      if (this.jobAgent) this.jobAgent.cancel({ kind: "user" });
      await this.jobPromise;
      this.server.closeAllConnections();
      await closed;
    })();
    return this.disposePromise;
  }
}

/** Attach one bridge to the gateway's explicit lifecycle. Caller awaits dispose first. */
export async function installOfficialQqBridge(options) {
  const configPath = process.env.CMEM_QQ_BRIDGE_CONFIG || join(process.env.DSH_HOME || join(homedir(), ".dsh"), "remembers-service", "official-qq-bridge.json");
  return new OfficialQqBridge({ ...options, configPath }).start();
}
