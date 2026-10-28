import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { isAbsolute, resolve } from 'node:path';

registerHooks({ resolve(specifier, context, next) {
  const source = specifier === '@deepseek-ai/dsh-llm' ? 'export const createUserMessage=value=>value;'
    : specifier === '@deepseek-ai/dsh-tools' ? 'export const defineTool=value=>value;' : null;
  return source ? { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true } : next(specifier, context);
} });
const { apply } = await import('../remembers.mjs');

async function fixture(t, rate, enabled = true, cards = null) {
  const originalFetch = globalThis.fetch;
  const events = new Map(), tools = new Map(), cleanups = [], logs = [], sections = [];
  const proactive = { memeRate: rate, kaomojiRate: rate, emojiRate: rate, textStyleEnabled: enabled };
  globalThis.fetch = async url => {
    const path = new URL(url).pathname;
    const value = path === '/persona' ? { ok: true, identity: '大肥鱼', constitution: cards ? '旧的身份' : '', self_model: cards ? '旧自我认知' : '', user_profile: '主人的私人画像', ...(cards ? { persona_cards: cards } : {}) }
      : path === '/profiles' ? { ok: true, profiles: [] } : path === '/proactive' ? proactive
      : path === '/state' ? { mood: 'normal' } : path === '/memes/search' ? { ok: true, memes: [{ file: 'happy.png', emotion: 'happy', caption: '庆祝下班', keywords: '下班 庆祝', match_reason: '当前用户正在庆祝下班' }] } : { ok: true };
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  };
  const ctx = {
    logger: { debug: message => logs.push(message) },
    on(event, fn) { const entries = events.get(event) || []; entries.push(fn); events.set(event, entries); },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') cleanups.push(dispose); },
    get(name) { return name === 'tools' ? { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); } }
      : name === 'systemPrompt' ? { section(section) { sections.push(section); return () => {}; } } : undefined; },
  };
  t.after(() => { for (const cleanup of cleanups.reverse()) cleanup(); globalThis.fetch = originalFetch; });
  apply(ctx, { endpoint: 'http://fixture.test', captureRaw: false, episodeEnabled: false });
  for (let attempt = 0; attempt < 50 && (!tools.has('find_meme') || !logs.some(line => line.includes('persona_refreshed'))); attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(tools.has('find_meme'));
  assert.ok(logs.some(line => line.includes('persona_refreshed')), logs.join('\n'));
  const handler = events.get('agent/pre-step').at(-1);
  const decision = await handler({ agent: { session: { id: 'expression-fixture', header: {} } }, signal: { aborted: false } },
    async () => ({ kind: 'enter', messages: [] }));
  return { text: decision.messages.map(message => message.content.map(part => part.text || '').join('')).join('\n'), tools, sections, handler, events };
}

for (const rate of [0, 0.01, 0.2, 0.37, 0.5, 0.99, 1]) {
  test(`saved ${rate * 100}% settings reach the conversation prompt`, async t => {
    const { text, tools } = await fixture(t, rate);
    if (rate === 0) {
      assert.match(text, /设成不发/); assert.match(text, /文字颜：现在不用/); assert.match(text, /emoji：现在不用/);
    } else {
      assert.match(text, new RegExp(`${rate * 100}%`)); assert.match(text, /图库表情由宿主在正文回复后自动选择并显示/);
      assert.doesNotMatch(text, /qq_send_image/);
      if (rate === 1) assert.doesNotMatch(text, /不是每句都要发/);
    }
    const empty = await tools.get('find_meme').execute({ emotion: 'happy' });
    assert.deepEqual(empty.memes, [], 'emotion alone must not choose a random sticker');
    const result = await tools.get('find_meme').execute({ emotion: 'happy', q: '下班 庆祝', context: '用户：终于下班了；拟回复：下班快乐' });
    assert.equal(result.memes.length, 1);
    assert.match(result.memes[0].match_reason, /下班/);
    assert.ok(isAbsolute(result.memes[0].path));
    assert.equal(resolve(result.memes[0].path), resolve('/home/ubuntu/.dsh/media/onebot/memes/happy.png'));
  });
}

test('disabled text style leaves kaomoji and emoji use to the persona', async t => {
  const { text } = await fixture(t, 0.5, false);
  assert.doesNotMatch(text, /文字颜：|emoji：/);
});

test('QQ uses the Bilibili persona and text style for the paired owner', async t => {
  const { sections } = await fixture(t, 0.2);
  const key = Symbol.for('dsh-remembers.qq-bridge');
  const agent = {};
  globalThis[key] = { config: { ownerOpenId: 'owner' }, manager: { findByAgent: value => value === agent ? { scope: 'c2c', peerId: 'owner' } : undefined } };
  t.after(() => { delete globalThis[key]; });
  const text = sections.find(section => section.name === 'remembers:persona').text({ agent });
  assert.match(text, /^大肥鱼\n\n主人的私人画像\n\n颜文字和 emoji 由宿主/);
  assert.match(text, /每条回复独立抽签添加/);
  assert.doesNotMatch(text, /大约 20%/);
  assert.match(text, /宿主按设置概率自动匹配并发送/);
  globalThis[key].manager.findByAgent = () => ({ scope: 'c2c', peerId: 'stranger' });
  const stranger = sections.find(section => section.name === 'remembers:persona').text({ agent });
  assert.doesNotMatch(stranger, /主人的私人画像/);
});

test('QQ uses only its selected card as literal text and keeps the owner profile private', async t => {
  const cards = { cards: [{ id: 'a', prompt: '鲸汐 {{原样}}' }, { id: 'b', prompt: 'B站人设' }], active: { qq: 'a', bili: 'b' } };
  const { sections } = await fixture(t, 0.2, true, cards);
  const key = Symbol.for('dsh-remembers.qq-bridge'), agent = {};
  globalThis[key] = { config: { ownerOpenId: 'owner' }, manager: { findByAgent: () => ({ scope: 'c2c', peerId: 'owner' }) } };
  t.after(() => { delete globalThis[key]; });
  const section = sections.find(x => x.name === 'remembers:persona');
  const text = section.text({ agent });
  assert.equal(section.interpolate, false);
  assert.match(text, /^鲸汐 \{\{原样\}\}/);
  assert.match(text, /主人的私人画像/);
  assert.doesNotMatch(text, /B站人设|旧的身份|旧自我认知/);
});

test('QQ reminds the current card without treating old conversation as a style instruction', async t => {
  const cards = { cards: [{ id: 'a', name: '鲸汐', prompt: '温柔设定' }, { id: 'b', name: '澜澜', prompt: '活泼设定' }], active: { qq: 'a', bili: 'b' } };
  const { handler, events } = await fixture(t, 0.2, true, cards);
  const key = Symbol.for('dsh-remembers.qq-bridge');
  const agent = { session: { id: 'qq-fixture', header: {} } };
  globalThis[key] = { manager: { findByAgent: value => value === agent ? {} : undefined } };
  t.after(() => { delete globalThis[key]; });
  const step = async current => handler({ agent: current, signal: { aborted: false } }, async () => ({ kind: 'enter', messages: [] }));
  const text = result => result.messages.flatMap(m => m.content.map(part => part.text)).join('\n');
  const qq = text(await step(agent));
  assert.match(qq, /当前 QQ 人物卡为“鲸汐”/);
  assert.match(qq, /不沿用或模仿其中过时的人设/);
  assert.doesNotMatch(qq, /旧自我认知|说话懒一点/);
  cards.active.qq = 'b';
  await events.get('agent/created')[0]({ agent: { status: 'idle', session: { id: 'refresh', header: {} } }, source: 'test' });
  assert.match(text(await step(agent)), /当前 QQ 人物卡为“澜澜”/);
  assert.doesNotMatch(text(await step({ session: { id: 'web-fixture', header: {} } })), /本轮人物卡/);
});

test('scene matching failures do not fall back to random emotion images', async t => {
  const { tools } = await fixture(t, 0.5);
  const calls = [];
  globalThis.fetch = async url => { calls.push(String(url)); throw new Error('matching unavailable'); };
  const result = await tools.get('find_meme').execute({ q: '晚安 睡觉', context: '用户说晚安，我回复好梦' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.memes, []);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/memes\/search$/);
});
