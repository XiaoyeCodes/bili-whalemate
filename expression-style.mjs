/** Shared reply-level sampling and formatting for kaomoji and emoji. */
import { readFileSync } from "node:fs";
const data = JSON.parse(readFileSync(new URL("./expression-style.json", import.meta.url), "utf8"));

/** Draw independently once for each expression type in a reply. */
export function sampleTextStyle(settings, random = Math.random) {
  if (settings?.textStyleEnabled !== true) return null;
  const draw = key => {
    const rate = Number(settings[key] ?? 0.2);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error("文字表情概率必须在 0 到 1 之间");
    return rate === 1 || (rate > 0 && random() < rate);
  };
  return { kaomoji: draw("kaomojiRate"), emoji: draw("emojiRate") };
}

/** Apply the sampled style to prose while preserving code, quotes and links. */
export function applyTextStyle(text, plan) {
  if (!plan || !text.trim()) return text;
  const protectedParts = [];
  let body = text.replace(new RegExp(data.protectedPattern, "gu"), match => {
    protectedParts.push(match); return `\u0000${protectedParts.length - 1}\u0000`;
  });
  body = body.replace(new RegExp(data.kaomojiPattern, "gu"), match =>
    new RegExp(data.facePattern, "u").test(match) && !/[\u4e00-\u9fff0-9]/u.test(match)
      && [...match.matchAll(/[a-z]/g)].every(([letter]) => "mowuxv".includes(letter)) ? "" : match);
  body = body.replace(new RegExp(data.emojiPattern, "gu"), "").replace(/[ \t]+$/gm, "").trim();
  const mood = data.moods.find(row => row.words.some(word => body.includes(word))) || data.default;
  body = body.replace(/\u0000(\d+)\u0000/g, (_, index) => protectedParts[Number(index)]);
  if (!body) body = "嗯。";
  const suffix = [plan.kaomoji ? mood.kaomoji : "", plan.emoji ? mood.emoji : ""].filter(Boolean).join(" ");
  return body + (suffix ? " " + suffix : "");
}
