/** Reapply the local scheduler adapter after upgrading the Tencent package. */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const home = process.env.DSH_HOME || join(homedir(), ".dsh");
const source = dirname(fileURLToPath(import.meta.url));
const gateway = join(home, "profiles", process.env.CMEM_DSH_PROFILE || "web", "node_modules", "@tencent-connect", "dsh-qqbot", "dist", "gateway");
if (JSON.parse(readFileSync(join(gateway, "..", "..", "package.json"), "utf8")).version !== "0.5.2") {
  throw new Error("This adapter supports only official QQ plugin 0.5.2");
}
const entry = join(gateway, "bootstrap.js");
const original = readFileSync(entry, "utf8");
let text = original.replace(/\r\n/g, "\n");
if (!existsSync(join(home, "remembers-service", "official-qq-bridge.json"))) {
  throw new Error("Prepare official-qq-bridge.json with a private token and pairing code before installing");
}
if (!text.includes('import { installOfficialQqBridge }')) {
  const replacements = [
    ['import { registerSendFileTool } from "../media/send-file-tool.js";', 'import { registerSendFileTool } from "../media/send-file-tool.js";\nimport { installOfficialQqBridge } from "./local-automation-bridge.mjs";\nimport { createUserMessage } from "@deepseek-ai/dsh-llm";'],
    ['    // ── 中间件链 ──', '    let automation;\n    // ── 中间件链 ──'],
    ['        cacheMsgId(mCtx.replyTarget.scope, mCtx.replyTarget.targetId, mCtx.replyTarget.msgId);', '        cacheMsgId(mCtx.replyTarget.scope, mCtx.replyTarget.targetId, mCtx.replyTarget.msgId);\n        if (await automation.handleMessage(mCtx)) return;'],
    ["        .on('session/event', outboundHandler);", "        .on('session/event', (session, event) => {\n        if (automation?.mutedSessions.has(session.header.id)) return;\n        return outboundHandler(session, event);\n    });"],
    ["        bot.on('disconnected', (event) => {", "        bot.on('disconnected', (event) => {\n            if (automation) automation.ready = false;"],
    ["    bot.on('ready', () => {", "    bot.on('ready', () => {\n        if (automation) automation.ready = true;"],
    ['    ctx\n        .effect(() => {', '    await ctx\n        .effect(async () => {\n        automation = await installOfficialQqBridge({ bot, manager, createUserMessage, sendMarkdown: sender.sendMarkdown, logger });'],
    ['            await manager.disposeAll();\n            bot.stop();', '            try { await automation.dispose(); }\n            finally {\n                try { await manager.disposeAll(); }\n                finally { bot.stop(); }\n            }'],
  ];
  for (const [before, after] of replacements) {
    if (text.split(before).length !== 2) throw new Error("Tencent gateway source changed; review adapter before applying");
    text = text.replace(before, after);
  }
  const backup = join(home, "backups", "official-qq-gateway-" + Date.now());
  mkdirSync(backup, { recursive: true });
  writeFileSync(join(backup, "bootstrap.js"), original);
  // Replace the profile-owned inode; pnpm may hard-link the original to its shared store.
  writeFileSync(entry + ".whalemate.tmp", text);
  renameSync(entry + ".whalemate.tmp", entry);
}
const helper = join(gateway, "local-automation-bridge.mjs");
copyFileSync(join(source, "official-qq-bridge.mjs"), helper + ".whalemate.tmp");
renameSync(helper + ".whalemate.tmp", helper);
console.log("Official QQ scheduler adapter installed. Restart the dsh web profile to load it.");
