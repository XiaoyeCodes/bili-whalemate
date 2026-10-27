/** Browser acceptance against a separately installed, unbound test profile. */
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.WHALEMATE_SERVICE_URL;
if (!base || !process.env.DSH_WEB_URL) throw new Error('Set WHALEMATE_SERVICE_URL and DSH_WEB_URL to an isolated test profile.');
const original = (await (await fetch(base + '/bili/automation')).json()).config;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(url => localStorage.setItem('dsh-remembers:serviceUrl', url), base);
async function settings(section) {
  await page.goto(process.env.DSH_WEB_URL, { waitUntil: 'domcontentloaded' });
  const welcome = page.getByRole('button', { name: '继续', exact: true });
  await page.getByRole('button', { name: /^(继续|添加 API Key)$/ }).first().waitFor();
  if (await welcome.isVisible()) await welcome.click();
  // A deliberately unbound install reaches settings through Harness onboarding.
  await page.getByRole('button', { name: '添加 API Key', exact: true }).click();
  await page.getByRole('button', { name: '稍后配置', exact: true }).click();
  await page.getByRole('button', { name: '账号菜单' }).click();
  await page.getByRole('menuitem', { name: /设置/ }).click();
  await page.getByText(section, { exact: true }).first().click();
}
try {
  const gallery = await (await fetch(base + '/memes?limit=500')).json();
  assert.equal(gallery.length, 444);
  const persona = await (await fetch(base + '/persona')).json();
  assert.ok(JSON.stringify(persona).includes('大肥鱼'));
  await settings('B 站');
  const min = page.getByRole('spinbutton', { name: '浏览视频每天最少', exact: true });
  assert.equal(await min.inputValue(), String(original.daily.browse.min));
  assert.equal(await page.getByRole('spinbutton', { name: '陌生人每天最多 AI 回复', exact: true }).inputValue(), '5');
  await min.fill('7');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText(/^已保存 \d/).waitFor();
  await settings('B 站');
  assert.equal(await min.inputValue(), '7');
  await page.getByText(/顶层评论可附图，楼中楼仅文字/).waitFor();
  await settings('表情包');
  await page.getByText('新建图库包', { exact: true }).waitFor();
  await page.getByText('全部表情包', { exact: true }).waitFor();
  await page.getByText('大肥鱼', { exact: true }).first().waitFor();
  await settings('人格设定');
  assert.ok((await page.locator('body').innerText()).includes('人格'));
  await settings('QQ 机器人');
  await page.getByText(/扫码|绑定/).first().waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, gallery: 444, settingsSaveReload: true, qqBindingPage: true, browserErrors: errors.length }));
} finally {
  const response = await fetch(base + '/bili/automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(original) });
  assert.ok(response.ok);
  await browser.close();
}
