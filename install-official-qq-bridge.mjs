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
function writeEntry(value) {
  writeFileSync(entry + ".whalemate.tmp", value);
  renameSync(entry + ".whalemate.tmp", entry);
}
function copyHelper(name) {
  const destination = join(gateway, name);
  copyFileSync(join(source, name), destination + ".whalemate.tmp");
  renameSync(destination + ".whalemate.tmp", destination);
}
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
  writeEntry(text);
}
const bridge = join(gateway, "local-automation-bridge.mjs");
copyFileSync(join(source, "official-qq-bridge.mjs"), bridge + ".whalemate.tmp");
renameSync(bridge + ".whalemate.tmp", bridge);
copyHelper("qq-meme-auto.mjs");
for (const file of ["qq-reply-style.mjs", "expression-style.mjs", "expression-style.json"]) copyHelper(file);
text = readFileSync(entry, "utf8").replace(/\r\n/g, "\n");
if (!text.includes("automation?.memeAuto?.observe") && !text.includes('automation.replyStyle.route')) {
  const before = "        if (automation?.mutedSessions.has(session.header.id)) return;";
  if (text.split(before).length !== 2) throw new Error("Tencent gateway event hook changed; review before applying");
  text = text.replace(before, "        automation?.memeAuto?.observe(session, event, automation.mutedSessions.has(session.header.id));\n" + before);
}
if (!text.includes("sendImage: mediaSender.sendImage")) {
  const before = "sendMarkdown: sender.sendMarkdown, logger";
  if (text.split(before).length !== 2) throw new Error("Tencent gateway lifecycle changed; review before applying");
  text = text.replace(before, "sendMarkdown: sender.sendMarkdown, sendImage: mediaSender.sendImage, logger");
}
writeEntry(text);
if (!text.includes('import { chunkMarkdownText }')) {
  text = text.replace('import { createUserMessage } from "@deepseek-ai/dsh-llm";', 'import { createUserMessage } from "@deepseek-ai/dsh-llm";\nimport { chunkMarkdownText } from "../transport/chunker.js";');
}
if (!text.includes('chunkText: text => chunkMarkdownText')) {
  text = text.replace('sendImage: mediaSender.sendImage, logger', 'sendImage: mediaSender.sendImage, chunkText: text => chunkMarkdownText(text, config.textChunkLimit), logger');
}
const oldHook = '        automation?.memeAuto?.observe(session, event, automation.mutedSessions.has(session.header.id));\n        if (automation?.mutedSessions.has(session.header.id)) return;\n        return outboundHandler(session, event);';
if (!text.includes('automation.replyStyle.route')) {
  if (text.split(oldHook).length !== 2) throw new Error('Tencent reply hook changed; review before applying');
  text = text.replace(oldHook, '        if (automation) return automation.replyStyle.route(session, event, outboundHandler, automation.mutedSessions.has(session.header.id));\n        return outboundHandler(session, event);');
}
writeEntry(text);
console.log("Official QQ scheduler adapter installed. Restart the dsh web profile to load it.");
