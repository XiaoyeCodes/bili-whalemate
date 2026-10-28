/** Real settings persistence and a model preview, with automatic publication paused. */
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.CMEM_URL || 'http://127.0.0.1:8080';
const read = async () => (await (await fetch(base + '/bili/automation')).json());
const baseline = await read();
const original = baseline.config;
assert.equal(original.enabled, false, 'Pause automatic writes before this browser acceptance run');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(url => localStorage.setItem('dsh-remembers:serviceUrl', url), base);
async function open() {
  await page.goto(process.env.DSH_WEB_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '账号菜单' }).click();
  await page.getByRole('menuitem', { name: /设置/ }).click();
  await page.getByText('B 站', { exact: true }).first().click();
  await page.getByRole('checkbox', { name: '鱼鱼碎碎念动态', exact: true }).waitFor();
  await page.getByText('碎碎念主题、时段与偏好', { exact: true }).click();
}
async function save() {
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText(/^已保存 \d/).waitFor();
}
try {
  await open();
  await page.getByRole('checkbox', { name: '鱼鱼碎碎念动态', exact: true }).check();
  await page.getByRole('spinbutton', { name: '鱼鱼碎碎念动态每天最少', exact: true }).fill('1');
  await page.getByRole('spinbutton', { name: '鱼鱼碎碎念动态每天最多', exact: true }).fill('3');
  const prompt = '用大肥鱼的口吻发一到三句短碎碎念，偶尔想想鱼生；不泄露私事。';
  await page.getByRole('textbox', { name: '碎碎念写作提示词', exact: true }).fill(prompt);
  await page.getByRole('checkbox', { name: '动态允许带图库表情包', exact: true }).uncheck();
  await save();
  let state = await read();
  assert.equal(state.config.lifePosts.allowMemes, false);
  assert.equal(state.config.lifePosts.prompt, prompt);
  assert.deepEqual(state.config.daily.dynamic, { min: 1, max: 3 });
  await open();
  assert.equal(await page.getByRole('textbox', { name: '碎碎念写作提示词', exact: true }).inputValue(), prompt);
  assert.equal(await page.getByRole('checkbox', { name: '动态允许带图库表情包', exact: true }).isChecked(), false);
  const started = Date.now() / 1000;
  await page.getByRole('button', { name: '预览碎碎念（不发布）', exact: true }).click();
  for (let i = 0; i < 45; i++) {
    state = await read();
    if (!state.busy && state.lastDynamicPreview?.at >= started - 1) break;
    await page.waitForTimeout(1000);
  }
  assert.ok(state.lastDynamicPreview?.at >= started - 1, state.dynamicError || 'Preview timed out');
  assert.equal(state.lastDynamicPreview.published, false);
  assert.equal(state.lastDynamicPreview.context.city, '上海');
  assert.ok(state.lastDynamicPreview.text.length > 0);
  assert.deepEqual(state.counts.dynamic, baseline.counts.dynamic);
  await page.getByText(/最近预览（未发布）/).waitFor({ timeout: 20000 });
  const screenshot = process.env.LIFE_SCREENSHOT || 'life-settings-preview.png';
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.body.hasAttribute('data-ds-dark-theme'));
  await page.locator('[data-life-post-settings]').screenshot({ path: screenshot.replace('.png', '-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => !document.body.hasAttribute('data-ds-dark-theme'));
  await page.locator('[data-life-post-settings]').screenshot({ path: screenshot.replace('.png', '-light.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, savedAndReloaded: true, memeSwitch: true, realPreview: state.lastDynamicPreview.text,
    weather: state.lastDynamicPreview.context.weather, mobileWidth: 390, browserErrors: errors.length }));
} finally {
  const current = (await read()).config;
  current.lifePosts = original.lifePosts;
  current.daily.dynamic = original.daily.dynamic;
  current.features.dynamic = original.features.dynamic;
  const response = await fetch(base + '/bili/automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(current) });
  assert.ok(response.ok);
  await browser.close();
}
