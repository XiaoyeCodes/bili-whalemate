/** Apply one sampled text-expression decision before each completed QQ reply. */
import { sampleTextStyle, applyTextStyle } from "./expression-style.mjs";

export class QqReplyStyle {
  constructor({ manager, settings, sendMarkdown, chunks = text => [text], observe, logger, onOutcome }) {
    Object.assign(this, { manager, settings, sendMarkdown, chunks, observe, logger, onOutcome });
    this.turns = new Map();
    this.queues = new Map();
    this.closed = false;
  }

  route(session, event, forward, muted = false) {
    if (this.closed) return;
    const id = String(session.header?.id ?? session.id);
    if (!this.manager.findBySessionId(id)) return forward(session, event);
    const previous = this.queues.get(id) || Promise.resolve();
    const task = previous.then(() => this.handle(id, session, event, forward, muted)).catch(error => {
      this.logger.warn(`QQ 文字表情处理失败: ${error.message}`);
    });
    this.queues.set(id, task);
    void task.finally(() => { if (this.queues.get(id) === task) this.queues.delete(id); });
    return task;
  }

  async handle(id, session, event, forward, muted) {
    if (this.closed) return;
    if (event.type === "turn/start") {
      const record = this.manager.findBySessionId(id);
      let plan = null;
      try { plan = sampleTextStyle(await this.settings()); }
      catch (error) { this.logger.warn(`QQ 文字表情设置读取失败，本轮沿用原回复: ${error.message}`); }
      if (this.closed) return;
      this.turns.set(id, { plan, record, target: { ...record.replyTarget }, messages: [], done: false });
    }
    const turn = this.turns.get(id);
    if (!turn?.plan || muted) {
      this.observe?.(session, event, muted);
      return muted ? undefined : forward(session, event);
    }
    if (event.type === "assistant/chunk") return;
    if (event.type === "assistant/message") {
      const text = (event.data?.message?.content || []).filter(part => part.type === "text").map(part => part.text).join("\n");
      if (text.trim()) turn.messages.push(text);
      return;
    }
    if (event.type === "turn/end") {
      if (turn.done) return;
      turn.done = true;
      if (event.data?.reason?.kind === "completed" && turn.messages.length && this.manager.findBySessionId(id) === turn.record) {
        const text = applyTextStyle(turn.messages.join("\n\n"), turn.plan);
        const ids = [];
        try {
          for (const chunk of this.chunks(text)) {
            if (this.closed) return;
            const receipt = await this.sendMarkdown(turn.target, chunk);
            if (!receipt?.id) throw new Error("QQ 未返回正文消息 ID，发送结果待确认");
            ids.push(receipt.id);
          }
          await this.onOutcome?.({ status: "accepted", plan: turn.plan, ids, text });
          this.observe?.(session, { type: "assistant/message", data: { message: { content: [{ type: "text", text }] } } }, false);
          this.observe?.(session, event, false);
        } catch (error) {
          await this.onOutcome?.({ status: "unknown", plan: turn.plan, ids, reason: error.message });
          this.logger.warn(`QQ 正文发送未确认，跳过本轮配图且不自动重发: ${error.message}`);
        }
      }
      return forward(session, event);
    }
    this.observe?.(session, event, false);
    return forward(session, event);
  }

  async dispose() {
    this.closed = true;
    await Promise.allSettled([...this.queues.values()]);
    this.turns.clear();
  }
}
