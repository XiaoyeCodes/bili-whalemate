/** Exercise the shipped settings UI against an isolated in-page service fixture. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

assert.ok(process.argv[2], 'Pass the Harness workspace containing apps/web dependencies');
const require = createRequire(join(resolve(process.argv[2]), 'apps/web/package.json'));
const { chromium } = require('playwright');
const fixture = createServer((_, response) => {
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end('<!doctype html><meta charset="utf-8"><div id="root"></div>');
});
fixture.listen(0, '127.0.0.1');
await once(fixture, 'listening');
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  await page.clock.install({ time: new Date('2026-10-28T12:00:00+08:00') });
  await page.clock.pauseAt(new Date('2026-10-28T12:59:50+08:00'));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${fixture.address().port}`);
  await page.addScriptTag({ path: join(dirname(require.resolve('react')), 'umd/react.development.js') });
  await page.addScriptTag({ path: join(dirname(require.resolve('react-dom/client')), 'umd/react-dom.development.js') });
  await page.evaluate(() => {
    const automation = {
      managed: true, enabled: true,
      actionProbability: { recommend: 50, comment: 50, interact: 50 },
      features: { browse: true, recommend: true, comment: true, interact: true, dmReply: true, strangerReply: true, ownerReply: true },
      daily: { browse: { min: 6, max: 10 }, recommend: { min: 1, max: 2 }, comment: { min: 0, max: 2 }, interact: { min: 0, max: 1 } },
      dmDailyMax: 20, strangerDailyMax: 5, ownerCommentDailyMax: 20,
      startHour: 8, endHour: 23, minGapMinutes: 10, maxGapMinutes: 30,
      dmPollSeconds: 60, strangerPollSeconds: 60, strangerBatchSize: 3, minInterestingScore: 13,
      dmAllDay: true, strangerAllDay: true, dmRequireMention: false, notifyQq: true,
    };
    window.saved = { automation, preferences: { like: ['猫咪'], dislike: [] }, owner: { mid: '123', name: '主人' } };
    window.posts = [];
    window.usage = { daily: 31, hourly: 4, hourStartedAt: Date.parse('2026-10-28T12:00:00+08:00') / 1000 };
    window.fetch = async (url, options = {}) => {
      const path = new URL(url).pathname;
      let data;
      if (options.method === 'POST') {
        const body = JSON.parse(options.body);
        window.posts.push(path);
        if (path === '/bili/cfg') {
          for (const update of body.updates) {
            let target = window.saved;
            for (const key of update.path.slice(0, -1)) target = target[key] ??= {};
            target[update.path.at(-1)] = update.value;
          }
          // Configuration resolution adds defaults and need not preserve JSON key order.
          window.saved.automation.replyThinkingEnabled ??= false;
          const reorder = value => Array.isArray(value) ? value.map(reorder)
            : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
          window.saved = reorder(window.saved);
          data = window.saved;
        } else data = body;
      } else if (path === '/bili/status') data = { enabled: true, logged_in: true, owner_mid: '123', owner_name: '主人' };
      else if (path === '/bili/cfg') {
        data = structuredClone(window.saved);
        if (window.wrongReadback) data.risk.writeDaily += 1;
      }
      else if (path === '/bili/tools') data = { tools: [] };
      else if (path === '/bili/write-usage') {
        if (window.usageFailure) return new Response('{"error":"fixture unavailable"}', { status: 503 });
        const hourStartedAt = Math.floor(Date.now() / 3600000) * 3600;
        const hourly = hourStartedAt === window.usage.hourStartedAt ? window.usage.hourly : 0;
        const { writeDaily: dailyLimit = 30, writeHourly: hourlyLimit = 12 } = window.saved.risk || {};
        data = { daily: window.usage.daily, hourly, dailyLimit, hourlyLimit,
          dailyRemaining: Math.max(0, dailyLimit - window.usage.daily), hourlyRemaining: Math.max(0, hourlyLimit - hourly),
          hourStartedAt, hourResetsAt: hourStartedAt + 3600 };
      }
      else if (path === '/bili/automation') data = { config: window.saved.automation, day: '2026-10-28', targets: { browse: 6, recommend: 1, comment: 1, interact: 1, dmReply: 20, strangerReply: 5, ownerReply: 20 }, counts: {}, events: [
        { id: 'fixture-unknown', kind: 'dmReply', status: 'unknown', error: 'file:///private/example.mjs:59\n at guarded (node:internal/task:10)\n' + 'detail '.repeat(80) },
      ] };
      else data = {};
      return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
    };
    window.__ModuleLoader__ = { load(module) {
      if (module.id !== 'bili-whalemate') throw Error('The portable client must register as bili-whalemate');
      const sections = {};
      module.factory(name => { if (name === 'react') return window.React; throw Error(name); }).apply({
        effect: fn => fn(),
        get: name => name === 'uiConversation' ? { events: { register() {} } } : ({ inject: (_, fn) => fn(), register: (meta, component) => { sections[meta.id] = component; } }),
      });
      window.ReactDOM.createRoot(document.getElementById('root')).render(window.React.createElement(sections['dsh-remembers-bili']));
    } };
  });
  await page.addScriptTag({ path: fileURLToPath(new URL('../client.js', import.meta.url)) });
  const panel = page.locator('[data-bili-automation]');
  await panel.waitFor();
  const usage = page.locator('[data-write-usage]');
  await usage.getByText('今日已用 31 / 30 次，剩余 0 次（北京时间零点重置）', { exact: true }).waitFor();
  await usage.getByText('本小时 12:00–13:00：已用 4 / 12 次，剩余 8 次', { exact: true }).waitFor();
  await usage.getByText('小时额度将在 13:00 自动重置（北京时间，每 10 秒刷新）', { exact: true }).waitFor();
  await page.clock.fastForward(10000);
  await usage.getByText('本小时 13:00–14:00：已用 0 / 12 次，剩余 12 次', { exact: true }).waitFor();
  await page.evaluate(() => { window.usage.hourStartedAt = Math.floor(Date.now() / 3600000) * 3600; window.usage.hourly = 3; window.usage.daily = 34; });
  await page.clock.fastForward(10000);
  await usage.getByText('本小时 13:00–14:00：已用 3 / 12 次，剩余 9 次', { exact: true }).waitFor();
  await page.evaluate(() => { window.usageFailure = true; });
  await page.clock.fastForward(10000);
  await usage.getByText('写操作用量暂时无法读取，请检查记忆服务和 B 站登录状态', { exact: true }).waitFor();
  await page.evaluate(() => { window.usageFailure = false; });
  await page.clock.fastForward(10000);
  await usage.getByText('本小时 13:00–14:00：已用 3 / 12 次，剩余 9 次', { exact: true }).waitFor();
  const dailyBudget = page.getByRole('spinbutton', { name: '每天最多写操作', exact: true });
  const hourlyBudget = page.getByRole('spinbutton', { name: '每小时最多写操作', exact: true });
  assert.equal(await dailyBudget.inputValue(), '30');
  assert.equal(await hourlyBudget.inputValue(), '12');
  for (const value of ['', '0', '1.5', '100001']) {
    await dailyBudget.fill(value);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByText('每天最多写操作：请输入 1～100000 的整数', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.posts.length), 0);
  }
  await dailyBudget.fill('80');
  await hourlyBudget.fill('20');
  await page.clock.fastForward(10000);
  await usage.getByText('本小时 13:00–14:00：已用 3 / 12 次，剩余 9 次', { exact: true }).waitFor();
  const input = page.getByRole('spinbutton', { name: '私信检查间隔（秒）', exact: true });
  for (const value of ['', '14', '3601', '60.5']) {
    await page.getByText('时间、私信与推荐设置', { exact: true }).evaluate(el => { el.parentElement.open = true; });
    await input.fill(value);
    await input.evaluate(el => { el.closest('details').open = false; });
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByText('私信检查间隔（秒）：请输入 15～3600 的整数', { exact: true }).waitFor();
    assert.equal(await input.inputValue(), value);
    assert.equal(await input.evaluate(el => document.activeElement === el), true);
    assert.equal(await page.evaluate(() => window.posts.length), 0);
  }
  await input.fill('60');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText(/^已保存 /).waitFor();
  assert.equal(await page.evaluate(() => window.saved.automation.dmPollSeconds), 60);
  assert.deepEqual(await page.evaluate(() => window.saved.risk), { writeDaily: 80, writeHourly: 20 });
  await page.clock.fastForward(10000);
  await usage.getByText('本小时 13:00–14:00：已用 3 / 20 次，剩余 17 次', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.posts.filter(path => path === '/bili/cfg').length), 1);
  const chance = page.getByRole('spinbutton', { name: '推荐给主人每轮抽签概率（%）', exact: true });
  await chance.waitFor();
  for (const value of ['', '0', '101', '50.5']) {
    await chance.fill(value);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByText('推荐给主人每轮抽签概率（%）：请输入 1～100 的整数', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.posts.filter(path => path === '/bili/cfg').length), 1);
  }
  await chance.fill('75');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText(/^已保存 /).waitFor();
  assert.equal(await page.evaluate(() => window.saved.automation.actionProbability.recommend), 75);
  await page.evaluate(() => { window.wrongReadback = true; });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('保存未完成：B 站设置“risk / writeDaily”回读不一致，请重试保存', { exact: true }).waitFor();
  await page.evaluate(() => { window.wrongReadback = false; });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText(/^已保存 /).waitFor();
  await page.getByText('最近执行记录', { exact: true }).click();
  const detail = page.locator('pre').filter({ hasText: 'file:///private/example.mjs' });
  assert.equal(await detail.isVisible(), false);
  await page.getByText('技术详情', { exact: true }).click();
  assert.equal(await detail.isVisible(), true);
  await page.getByText('技术详情', { exact: true }).click();
  assert.deepEqual(errors, []);
  const output = process.argv[3];
  if (output) {
    await page.evaluate(() => window.scrollTo(0, 0));
    mkdirSync(output, { recursive: true });
    for (const [theme, background, foreground] of [['dark', '#252525', '#eeeeee'], ['light', '#ffffff', '#202020']]) {
      await page.addStyleTag({ content: `body{background:${background};color:${foreground};font:14px sans-serif;--dsw-alias-label-primary:${foreground};--dsw-alias-label-secondary:${foreground};--dsw-alias-bg-layer-1:${background};--dsw-alias-border-l4:#777;--dsw-alias-state-error-primary:#c34d4d}` });
      await panel.screenshot({ path: join(output, `settings-${theme}.png`) });
    }
  }
  console.log(JSON.stringify({ hourlyReset: true, liveUsageRefresh: true, usageFailureVisible: true, savedBudgetDisplay: true, invalidNumbersPreventWrites: true, invalidFieldExpandedAndFocused: true, validSave: true, diagnosticDetailsCollapsed: true, browserErrors: errors }));
} finally {
  if (browser) await browser.close();
  await new Promise((resolve, reject) => fixture.close(error => error ? reject(error) : resolve()));
}
