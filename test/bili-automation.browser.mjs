import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base = process.env.CMEM_URL || 'http://127.0.0.1:8080';
const original = (await (await fetch(base + '/bili/automation')).json()).config;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
async function open() {
  await page.goto(process.env.DSH_WEB_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '账号菜单' }).click();
  await page.getByRole('menuitem', { name: /设置/ }).click();
  await page.getByText('B 站', { exact: true }).first().click();
  await page.getByText('自动浏览与互动', { exact: true }).waitFor({ timeout: 45000 });
}
async function save() {
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText(/^已保存 \d/).waitFor();
}
try {
  await open();
  const beforeLikes = (await (await fetch(base + '/bili/cfg')).json()).preferences.like;
  const input = page.getByRole('spinbutton', { name: '浏览视频每天最少', exact: true });
  await input.fill('7'); await save();
  assert.equal((await (await fetch(base + '/bili/automation')).json()).config.daily.browse.min, 7);
  await open();
  assert.equal(await input.inputValue(), '7');
  const strangerCap = page.getByRole('spinbutton', { name: '陌生人每天最多 AI 回复', exact: true });
  await strangerCap.fill('0'); await save();
  await open();
  assert.equal(await strangerCap.inputValue(), '0');
  const ownerCap = page.getByRole('spinbutton', { name: '主人评论每天最多回复', exact: true });
  assert.equal(await ownerCap.inputValue(), String(original.ownerCommentDailyMax));
  await page.getByText(/顶层评论可附图，楼中楼仅文字/).waitFor();
  await page.getByText(/超限后直接回复「token快要用完啦/).waitFor();
  await strangerCap.fill(String(original.strangerDailyMax)); await save();
  await input.fill('11');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText(/保存未完成/).waitFor();
  assert.equal(await input.inputValue(), '11');
  assert.equal((await (await fetch(base + '/bili/automation')).json()).config.daily.browse.min, 7);
  await input.fill(String(original.daily.browse.min)); await save();
  const fieldset = page.locator('fieldset.dsh-remembers-settings');
  const saveBox = await page.getByRole('button', { name: '保存', exact: true }).boundingBox();
  const containerBox = await fieldset.boundingBox();
  assert.ok(saveBox.x >= containerBox.x && saveBox.x + saveBox.width <= containerBox.x + containerBox.width + 1);
  const panel = page.locator('[data-bili-automation]');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(200);
  const dark = await panel.evaluate(el => getComputedStyle(el).backgroundColor);
  await page.screenshot({ path: join(tmpdir(), 'dsh-bili-automation-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(200);
  const light = await panel.evaluate(el => getComputedStyle(el).backgroundColor);
  await page.screenshot({ path: join(tmpdir(), 'dsh-bili-automation-light.png') });
  assert.notEqual(dark, light);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const overflow = await panel.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  assert.ok(overflow.scroll <= overflow.client + 1, JSON.stringify(overflow));
  await page.screenshot({ path: join(tmpdir(), 'dsh-bili-automation-mobile.png') });
  assert.deepEqual((await (await fetch(base + '/bili/cfg')).json()).preferences.like, beforeLikes);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ saveReload: true, invalidRangeRejected: true, failedSaveKeepsForm: true,
    strangerCapSaveReload: true, fixedNoticeVisible: true,
    saveButtonInsideSettings: true, dark, light, mobileNoOverflow: true, preferencesPreserved: true, browserErrors: errors }));
} finally {
  await fetch(base + '/bili/automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(original) });
  await browser.close();
}
