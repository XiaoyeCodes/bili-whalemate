/** Probability-to-wire checks using the same QQ formatter and sender path as production. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleTextStyle, applyTextStyle } from '../expression-style.mjs';
import { QqReplyStyle } from '../qq-reply-style.mjs';

test('independent reply draws match 15% and 40% over 100000 seeded replies', () => {
  let seed = 42;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  let kaomoji = 0, emoji = 0, both = 0;
  for (let i = 0; i < 100000; i++) {
    const plan = sampleTextStyle({ textStyleEnabled: true, kaomojiRate: .15, emojiRate: .4 }, random);
    kaomoji += Number(plan.kaomoji); emoji += Number(plan.emoji);
    both += Number(plan.kaomoji && plan.emoji);
  }
  assert.ok(Math.abs(kaomoji - 15000) < 500, String(kaomoji));
  assert.ok(Math.abs(emoji - 40000) < 600, String(emoji));
  assert.ok(Math.abs(both - 6000) < 500, String(both));
  console.log(JSON.stringify({ samples: 100000, kaomoji, emoji, both }));
});

test('zero and full rates control actual reply text; protected material stays intact', () => {
  for (const rate of [0, 1]) {
    const plan = sampleTextStyle({ textStyleEnabled: true, kaomojiRate: rate, emojiRate: rate }, () => { throw Error('endpoints never draw'); });
    const text = applyTextStyle('晚安 😊 (￣▽￣)', plan);
    assert.equal(text, rate ? '晚安 (´-ω-`) 🌙' : '晚安');
  }
  const content = '解释 `😊` 和 `(￣▽￣)`，链接 https://example.test/😊 ，原话“😊 (￣▽￣)”';
  assert.equal(applyTextStyle(content, { kaomoji: false, emoji: false }), content);
  assert.equal(applyTextStyle('`x = (a > b)` 和 (API)', { kaomoji: false, emoji: false }), '`x = (a > b)` 和 (API)');
  assert.equal(applyTextStyle('自带 😊', sampleTextStyle({ textStyleEnabled: false })), '自带 😊');
  assert.equal(applyTextStyle('嗯 (๑>m<๑)', { kaomoji: false, emoji: false }), '嗯');
  assert.equal(applyTextStyle('😊', { kaomoji: false, emoji: false }), '嗯。');
});

function fixture(t, fail = false) {
  const sent = [], observed = [], forwarded = [], outcomes = [];
  const record = { replyTarget: { scope: 'c2c', targetId: 'owner', msgId: 'incoming' } };
  const style = new QqReplyStyle({ manager: { findBySessionId: () => record },
    settings: async () => ({ textStyleEnabled: true, kaomojiRate: 1, emojiRate: 1 }),
    sendMarkdown: async (target, text) => { if (fail) throw Error('network outcome unknown'); sent.push({ target, text }); return { id: 'sent-id' }; },
    observe: (_, event) => observed.push(event), logger: { warn() {} }, onOutcome: value => outcomes.push(value) });
  t.after(() => style.dispose());
  const session = { header: { id: 'session' } };
  const emit = (type, data) => style.route(session, { type, data }, (_, event) => forwarded.push(event));
  return { sent, observed, outcomes, forwarded, emit };
}

test('QQ sends styled completed text to the current user once, before image eligibility', async t => {
  const f = fixture(t);
  await f.emit('turn/start', { turn: 1 });
  await f.emit('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '晚安' }] });
  await f.emit('assistant/chunk', { chunk: { type: 'text-delta', text: '晚安' } });
  await f.emit('assistant/message', { message: { content: [{ type: 'text', text: '晚安' }] } });
  assert.equal(f.sent.length, 0);
  await f.emit('turn/end', { reason: { kind: 'completed' } });
  await f.emit('turn/end', { reason: { kind: 'completed' } });
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].text, '晚安 (´-ω-`) 🌙');
  assert.equal(f.sent[0].target.targetId, 'owner');
  assert.equal(f.outcomes[0].status, 'accepted');
  assert.equal(f.observed.at(-1).type, 'turn/end');
  assert.equal(f.forwarded.filter(event => event.type === 'assistant/message').length, 0);
});

test('failed QQ text delivery does not authorize an image or claim acceptance', async t => {
  const f = fixture(t, true);
  await f.emit('turn/start', { turn: 1 });
  await f.emit('assistant/message', { message: { content: [{ type: 'text', text: '晚安' }] } });
  await f.emit('turn/end', { reason: { kind: 'completed' } });
  assert.equal(f.outcomes[0].status, 'unknown');
  assert.equal(f.observed.filter(event => event.type === 'turn/end').length, 0);
});
