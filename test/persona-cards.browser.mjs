/** Exercise persona card editing and channel selection with an isolated service. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(join(resolve(process.argv[2]), 'apps/web/package.json'));
const { chromium } = require('playwright');
const fixture = createServer((_, response) => response.end('<!doctype html><meta charset="utf-8"><div id="root"></div>'));
fixture.listen(0, '127.0.0.1');
await once(fixture, 'listening');
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${fixture.address().port}`);
  await page.addScriptTag({ path: join(dirname(require.resolve('react')), 'umd/react.development.js') });
  await page.addScriptTag({ path: join(dirname(require.resolve('react-dom/client')), 'umd/react-dom.development.js') });
  await page.evaluate(() => {
    window.library = { ok: true, cards: [{ id: 'legacy', name: '原有人设', prompt: '旧设定' }], active: { qq: 'legacy', bili: 'legacy' } };
    window.fetch = async (url, options = {}) => {
      const path = new URL(url).pathname;
      let data = { ok: true };
      if (path === '/persona/cards') {
        if (options.method === 'POST') {
          const body = JSON.parse(options.body);
          if (body.action === 'create') { window.library.cards.push({ id: 'new', name: body.name, prompt: body.prompt }); window.library.changed_id = 'new'; }
          if (body.action === 'update') { Object.assign(window.library.cards.find(x => x.id === body.id), { name: body.name, prompt: body.prompt }); window.library.changed_id = body.id; }
          if (body.action === 'select') window.library.active[body.channel] = body.id;
          if (body.action === 'delete') window.library.cards = window.library.cards.filter(x => x.id !== body.id);
        }
        data = structuredClone(window.library);
      } else if (path === '/persona') data = { ok: true, identity: '', constitution: '', self_model: '', self_image: '' };
      else if (path === '/persona/user') data = { user_profile: '' };
      return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
    };
    window.__ModuleLoader__ = { load(module) {
      const sections = {};
      module.factory(name => { if (name === 'react') return window.React; throw Error(name); }).apply({
        effect: fn => fn(), get: name => name === 'uiConversation' ? { events: { register() {} } } : ({ inject: (_, fn) => fn(), register: (meta, component) => { sections[meta.id] = component; } }),
      });
      window.ReactDOM.createRoot(document.getElementById('root')).render(window.React.createElement(sections['dsh-remembers-persona']));
    } };
  });
  await page.addScriptTag({ path: fileURLToPath(new URL('../client.js', import.meta.url)) });
  const panel = page.locator('[data-persona-cards]');
  await panel.waitFor();
  assert.equal(await page.getByRole('button', { name: '保存用户画像与自我认知' }).count(), 1);
  assert.equal(await panel.getByLabel('QQ 使用').inputValue(), 'legacy');
  assert.equal(await panel.getByLabel('B 站使用').inputValue(), 'legacy');
  await panel.getByRole('button', { name: '新建人物卡' }).click();
  await panel.getByLabel('人物卡名称').fill('鲸汐');
  await panel.getByLabel('系统提示词').fill('温柔的鲸汐 {{文字原样}}');
  await panel.getByRole('button', { name: '保存人物卡' }).click();
  await panel.getByText('已保存。', { exact: true }).waitFor();
  await panel.getByLabel('QQ 使用').selectOption('new');
  await panel.getByText('渠道已切换，QQ 稍后生效。', { exact: true }).waitFor();
  assert.equal(await panel.getByLabel('B 站使用').inputValue(), 'legacy');
  assert.equal(await panel.getByRole('button', { name: '删除人物卡' }).isDisabled(), true);
  await panel.getByLabel('B 站使用').selectOption('new');
  await panel.getByText('渠道已切换，QQ 稍后生效。', { exact: true }).waitFor();
  await panel.getByRole('button', { name: '原有人设' }).click();
  assert.equal(await panel.getByLabel('系统提示词').inputValue(), '旧设定');
  assert.equal(await panel.getByRole('button', { name: '删除人物卡' }).isEnabled(), true);
  assert.deepEqual(errors, []);
  console.log('persona cards browser: create, edit selection and independent channels passed');
} finally {
  await browser?.close();
  fixture.close();
}
