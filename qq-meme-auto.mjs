/** Select and send at most one relevant gallery image after an eligible QQ reply. */
import { basename, join, resolve } from "node:path";
import { stat } from "node:fs/promises";

export class QqMemeAuto {
  constructor({ manager, sender, logger, endpoint, token = "", memeDir, timeoutMs = 30000, random = Math.random, request = fetch, channel = "qq", onOutcome }) {
    Object.assign(this, { manager, sender, logger, endpoint: endpoint.replace(/\/+$/, ""), token, memeDir: resolve(memeDir), timeoutMs, random, request, channel, onOutcome });
    this.turns = new Map();
    this.pending = new Set();
    this.closed = false;
    this.abort = new AbortController();
  }

  async json(path, body) {
    const response = await this.request(this.endpoint + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(this.token ? { "X-Auth-Token": this.token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(this.timeoutMs)]),
    });
    if (!response.ok) throw new Error(`memory service HTTP ${response.status}`);
    return response.json();
  }

  observe(session, event, muted = false) {
    if (this.closed) return;
    const id = String(session?.header?.id ?? session?.id ?? "");
    const record = this.manager.findBySessionId(id);
    if (!record) return;
    if (event.type === "turn/start") {
      this.turns.set(id, { turn: event.data.turn, user: "", reply: "", target: { ...record.replyTarget } });
      return;
    }
    const turn = this.turns.get(id);
    if (!turn) return;
    const message = event.type === "user/message" ? event.data : event.data?.message;
    if (event.type === "user/message" && message?.source?.kind === "user") {
      turn.user = (message.content || []).filter(part => part.type === "text").map(part => part.text).join("\n").trim();
    }
    if (event.type === "assistant/message") {
      const text = (message?.content || []).filter(part => part.type === "text").map(part => part.text).join("\n").trim();
      if (text) turn.reply = text;
    }
    if (event.type !== "turn/end") return;
    if (turn.done) return;
    turn.done = true;
    if (muted || event.data?.reason?.kind !== "completed" || !turn.user || !turn.reply) return;
    const task = this.send(id, turn, record).catch(error => {
      if (!this.closed) {
        this.logger.warn(`自动配图失败: ${error.message}`);
        return this.report(id, turn, { status: "failed", reason: "配图未完成：" + error.message });
      }
    });
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  }

  current(id, turn, record) {
    return !this.closed && this.turns.get(id) === turn && this.manager.findBySessionId(id) === record
      && record.replyTarget?.msgId === turn.target.msgId && record.replyTarget?.targetId === turn.target.targetId;
  }

  async report(id, turn, outcome) {
    if (this.closed || this.turns.get(id) !== turn) return;
    const value = { channel: this.channel, turn: turn.turn, at: Date.now(), ...outcome };
    try { await this.onOutcome?.(id, value); }
    catch (error) { this.logger.warn(`配图结果未记录: ${error.message}`); }
    try { await this.json("/memes/delivery-status", value); }
    catch (error) { this.logger.warn(`配图状态未保存: ${error.message}`); }
  }

  async send(id, turn, record) {
    const settings = await this.json("/proactive");
    const rate = Number(settings.memeRate ?? 0.2);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error("配图概率设置无效");
    if (rate === 0 || (rate < 1 && this.random() >= rate)) {
      return this.report(id, turn, { status: "skipped", reason: rate === 0 ? "已关闭自动配图" : "本轮未抽中配图机会" });
    }
    if (!this.current(id, turn, record)) return;
    const result = await this.json("/memes/search", { q: `${turn.user}\n${turn.reply}`.slice(0, 2000),
      context: `用户：${turn.user.slice(0, 2000)}\n实际回复：${turn.reply.slice(0, 2000)}` });
    if (!this.current(id, turn, record)) return;
    if (!result?.ok) throw new Error(result?.error || "图片匹配服务未返回有效结果");
    const file = result?.ok && Array.isArray(result.memes) ? result.memes[0]?.file : null;
    if (!file) return this.report(id, turn, { status: "skipped", reason: result.hint || "没有适合当前回复的图片" });
    if (typeof file !== "string" || basename(file) !== file || /[\\/]/.test(file)) throw new Error("匹配结果包含无效图片文件名");
    const path = join(this.memeDir, file);
    if (!(await stat(path)).isFile() || !this.current(id, turn, record)) return;
    const receipt = await this.sender.sendImage(turn.target, { localPath: path });
    const messageId = receipt?.message?.id || receipt?.id;
    if (this.channel === "qq" && !messageId) throw new Error("QQ 未返回图片消息 ID，结果待确认，不自动重发");
    await this.report(id, turn, { status: "sent", reason: this.channel === "qq" ? "QQ 已接受表情包，消息 ID：" + messageId : "已配表情包", file, messageId });
    try { await this.json("/memes/used", { file }); }
    catch (error) { this.logger.warn(`QQ 表情已发送，但使用统计未保存: ${error.message}`); }
  }

  async dispose() {
    this.closed = true;
    this.abort.abort();
    await Promise.allSettled([...this.pending]);
    this.turns.clear();
  }
}
