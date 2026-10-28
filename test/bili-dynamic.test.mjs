/** Run the actual dynamic CLI against an isolated fake transport and fake credentials. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function run(extra = [], dry = false, buvid3 = 'fixture') {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-dynamic-test-'));
  try {
    mkdirSync(join(directory, '.bili-ai'));
    writeFileSync(join(directory, '.bili-ai/credentials.json'), JSON.stringify({ sessdata: 'fixture', bili_jct: 'fixture', buvid3 }));
    const log = join(directory, 'request.json');
    const transport = `import {writeFileSync} from 'node:fs';export async function guardedFetch(url,options={}){if(String(url).includes('create/dyn')){writeFileSync(${JSON.stringify(log)},JSON.stringify({url:String(url),body:JSON.parse(options.body)}));return new Response(JSON.stringify(new URL(url).searchParams.get('csrf')==='fixture'?{code:0,data:{dyn_id_str:'456'}}:{code:-111,message:'csrf missing from URL'}),{status:200})}return new Response(JSON.stringify({code:0,data:{mid:123,uname:'fixture',mobile_verified:true,wbi_img:{img_url:'https://example.test/abcdefghijklmnopqrstuvwxyz012345.png',sub_url:'https://example.test/abcdefghijklmnopqrstuvwxyz012345.png'}}}),{status:200})}`;
    const loader = join(directory, 'loader.mjs');
    writeFileSync(loader, `import {registerHooks} from 'node:module';registerHooks({resolve(s,c,n){let source=s.endsWith('/traffic.mjs')?${JSON.stringify(transport)}:s.endsWith('/quota-gate.mjs')?'export const gate=()=>true;export const record=()=>{};':null;return source?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:n(s,c)}})`);
    const cli = join(fileURLToPath(new URL('../vendor/bili-whale/', import.meta.url)), 'tools/commands/dynamic.mjs');
    const output = execFileSync(process.execPath, ['--import', pathToFileURL(loader).href, cli, 'post', '--text', '鱼鱼今天想一想宇宙。', ...extra, dry ? '--dry' : '--go'],
      { encoding: 'utf8', env: { ...process.env, USERPROFILE: directory, HOME: directory } });
    const request = existsSync(log) ? JSON.parse(readFileSync(log, 'utf8')) : null;
    return { output, body: request?.body || null, request };
  } finally {
    assert.equal(dirname(directory), resolve(tmpdir())); assert.ok(basename(directory).startsWith('dsh-dynamic-test-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('text dynamics use scene 1 and exit naturally after one create request', () => {
  const result = run();
  assert.equal(result.body.dyn_req.scene, 1);
  assert.equal(result.body.dyn_req.content.contents[0].raw_text, '鱼鱼今天想一想宇宙。');
  assert.equal(result.body.dyn_req.pics, undefined);
  assert.match(result.output, /dyn_id=456/);
  assert.equal(new URL(result.request.url).searchParams.get('csrf'), 'fixture');
  assert.equal(result.body.csrf, undefined);
});
test('gallery dynamics reuse validated uploaded metadata in scene 2', () => {
  const picture = { image_url: 'https://i0.hdslb.com/bfs/new_dyn/fixture.png', image_width: 10, image_height: 20, img_size: 1.5, imageType: 'png' };
  const result = run(['--picture-data', JSON.stringify(picture)]);
  assert.equal(result.body.dyn_req.scene, 2);
  assert.deepEqual(result.body.dyn_req.pics, [{ img_src: picture.image_url, img_width: 10, img_height: 20, img_size: 1.5 }]);
});
test('a dry preview never sends create/dyn', () => {
  assert.equal(run([], true).body, null);
});

test('QR login credentials can publish without an optional buvid3 cookie', () => {
  const result = run([], false, '');
  assert.match(result.output, /dyn_id=456/);
  assert.equal(result.body.dyn_req.scene, 1);
});
