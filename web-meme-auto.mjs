/** Publish automatic Web stickers as replayable, UI-only plugin records. */
import { QqMemeAuto } from "./qq-meme-auto.mjs";
import { basename } from "node:path";

export class WebMemeAuto {
  constructor({ appendRecord, isQqSession, ...options }) {
    this.records = new Map();
    this.appendRecord = appendRecord;
    this.isQqSession = isQqSession;
    this.auto = new QqMemeAuto({ ...options, channel: "web",
      manager: { findBySessionId: id => this.records.get(id) },
      sender: { sendImage: async (target, source) => {
        const record = this.records.get(target.targetId);
        this.appendRecord(record.session, "plugin:dsh-remembers/meme", {
          channel: "web", turn: Number(target.msgId), at: Date.now(), status: "sent",
          reason: "已配表情包", file: basename(source.localPath),
        });
      } },
      onOutcome: (id, outcome) => {
        const record = this.records.get(id);
        if (record && outcome.status === "failed") {
          this.appendRecord(record.session, "plugin:dsh-remembers/meme", outcome);
        }
      },
    });
  }

  observe(session, event) {
    if (this.isQqSession(session) || session.header?.origin === "subagent") return;
    const id = String(session.header?.id ?? session.id);
    if (event.type === "turn/start") {
      this.records.set(id, { session, replyTarget: { scope: "web", targetId: id, msgId: String(event.data.turn) } });
    }
    this.auto.observe(session, event);
    if (event.type === "turn/end") {
      const current = this.auto.turns.get(id);
      void Promise.allSettled([...this.auto.pending]).then(() => {
        if (this.auto.turns.get(id) === current) {
          this.auto.turns.delete(id);
          this.records.delete(id);
        }
      });
    }
  }

  async dispose() {
    await this.auto.dispose();
    this.records.clear();
  }
}
