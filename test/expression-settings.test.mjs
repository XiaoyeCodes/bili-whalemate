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

async function fixture(t, rate, enabled = true) {
  const originalFetch = globalThis.fetch;
  const events = new Map(), tools = new Map(), cleanups = [], logs = [];
  const proactive = { memeRate: rate, kaomojiRate: rate, emojiRate: rate, textStyleEnabled: enabled };
  globalThis.fetch = async url => {
    const path = new URL(url).pathname;
    const value = path === '/persona' ? { ok: true, identity: '大肥鱼', constitution: '', self_model: '' }
      : path === '/profiles' ? { ok: true, profiles: [] } : path === '/proactive' ? proactive
      : path === '/state' ? { mood: 'normal' } : path === '/memes/search' ? { ok: true, memes: [{ file: 'happy.png', emotion: 'happy', caption: '庆祝下班', keywords: '下班 庆祝', match_reason: '当前用户正在庆祝下班' }] } : { ok: true };
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  };
  const ctx = {
    logger: { debug: message => logs.push(message) },
    on(event, fn) { const entries = events.get(event) || []; entries.push(fn); events.set(event, entries); },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') cleanups.push(dispose); },
    get(name) { return name === 'tools' ? { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); } }
      : name === 'systemPrompt' ? { section() { return () => {}; } } : undefined; },
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
  return { text: decision.messages.map(message => message.content.map(part => part.text || '').join('')).join('\n'), tools };
}

for (const rate of [0, 0.2, 0.5, 1]) {
  test(`saved ${rate * 100}% settings reach the conversation prompt`, async t => {
    const { text, tools } = await fixture(t, rate);
    if (rate === 0) {
      assert.match(text, /设成不发/); assert.match(text, /文字颜：现在不用/); assert.match(text, /emoji：现在不用/);
    } else {
      assert.match(text, new RegExp(`${rate * 100}%`)); assert.match(text, /qqbot_send_file\(file_path=/);
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
