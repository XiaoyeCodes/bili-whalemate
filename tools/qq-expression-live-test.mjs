/** Owner-only, opt-in QQ expression probes over the already-running gateway. */
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

if (!process.argv.includes('--execute')) throw Error('Real owner messages require --execute');
const root = process.env.DSH_HOME || join(homedir(), '.dsh');
const reportPath = join(root, 'remembers-service', 'expression-probability-qq-live.json');
if (existsSync(reportPath)) throw Error('Probe receipt exists; inspect it before any further sends');
const targets = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0;
const requests = new Map();
ws.onmessage = event => {
  const value = JSON.parse(event.data);
  const pending = requests.get(value.id);
  if (!pending) return;
  requests.delete(value.id);
  if (value.error || value.result?.exceptionDetails) pending.reject(Error(JSON.stringify(value.error || value.result.exceptionDetails)));
  else pending.resolve(value.result.result.value);
};
function evaluate(expression) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    requests.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true, timeout: 240000 } }));
  });
}

async function probe(base) {
  const bridge = globalThis[Symbol.for('dsh-remembers.qq-bridge')];
  if (!bridge?.ready || !bridge.config.ownerOpenId || bridge.busy || !bridge.memeAuto) throw Error('Paired QQ gateway is not idle/ready');
  const real = await bridge.manager.getOrCreate('c2c', bridge.config.ownerOpenId, bridge.config.ownerOpenId,
    { scope: 'c2c', targetId: bridge.config.ownerOpenId });
  if (real.agent.status !== 'idle') throw Error('Owner conversation is busy');
  const require = process.getBuiltinModule('module').createRequire(base + 'package.json');
  const { QqReplyStyle } = require('./qq-reply-style.mjs');
  const { QqMemeAuto } = require('./qq-meme-auto.mjs');
  const saved = await bridge.memeAuto.json('/proactive');
  const cases = [];
  for (const rate of [0, 1]) {
    const outcomes = [], images = [];
    const record = { replyTarget: { scope: 'c2c', targetId: bridge.config.ownerOpenId } };
    const manager = { findBySessionId: () => record };
    const settings = { ...saved, textStyleEnabled: true, kaomojiRate: rate, emojiRate: rate, memeRate: rate };
    const auto = new QqMemeAuto({ manager, sender: bridge.memeAuto.sender, logger: bridge.logger,
      endpoint: bridge.memeAuto.endpoint, token: bridge.memeAuto.token, memeDir: bridge.memeAuto.memeDir,
      request: (url, options) => url.endsWith('/proactive') ? Promise.resolve(new Response(JSON.stringify(settings))) : fetch(url, options),
      onOutcome: (_, value) => images.push(value) });
    const style = new QqReplyStyle({ manager, settings: async () => settings, sendMarkdown: bridge.sendMarkdown,
      logger: bridge.logger, observe: (session, event, muted) => auto.observe(session, event, muted),
      onOutcome: value => outcomes.push(value) });
    const session = { header: { id: 'expression-probe-' + rate + '-' + Date.now() } };
    const emit = (type, data) => style.route(session, { type, data }, () => {});
    try {
      await emit('turn/start', { turn: 1 });
      await emit('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '晚安，准备睡觉，想看一张说晚安的可爱表情。' }] });
      const text = rate ? '【表情概率测试 100%】晚安，小鱼来陪你啦。' : '【表情概率测试 0%】这条不会附加语气表情或图库图片。';
      await emit('assistant/message', { message: { content: [{ type: 'text', text }] } });
      await emit('turn/end', { reason: { kind: 'completed' } });
      await Promise.allSettled([...auto.pending]);
      cases.push({ rate, outcomes, images });
    } finally { await style.dispose(); await auto.dispose(); }
  }
  return { cases, productionSettingsUnchanged: JSON.stringify(await bridge.memeAuto.json('/proactive')) === JSON.stringify(saved) };
}

writeFileSync(reportPath, JSON.stringify({ status: 'running', started: new Date().toISOString() }) + '\n');
try {
  const base = new URL('../', import.meta.url).href;
  const result = await evaluate(`(${probe.toString()})(${JSON.stringify(base)})`);
  writeFileSync(reportPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch (error) {
  writeFileSync(reportPath, JSON.stringify({ status: 'unknown', reason: error.message }) + '\n');
  throw error;
} finally { ws.close(); }
