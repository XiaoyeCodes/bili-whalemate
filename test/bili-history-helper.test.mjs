import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

function runHelper(modules, args) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-bili-helper-test-'));
  try {
    const loader = join(directory, 'loader.mjs');
    writeFileSync(loader, `import{registerHooks}from'node:module';const modules=${JSON.stringify(modules)};registerHooks({resolve(s,c,n){const name=s.split('/').at(-1);if(modules[name])return{url:'data:text/javascript,'+encodeURIComponent(modules[name]),shortCircuit:true};return n(s,c)}});`);
    try {
      const output = execFileSync(process.execPath, ['--import', pathToFileURL(loader).href, fileURLToPath(new URL('../tools/bili-owner-history.mjs', import.meta.url)), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return JSON.parse(output);
    } catch (error) {
      if (error.stdout) return JSON.parse(error.stdout);
      throw error;
    }
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\dsh-bili-helper-test-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('root comment verification checks the public main list when the thread endpoint has no root', () => {
    const modules = {
      'config.mjs': 'export const config=()=>({owner:{mid:"123"}});',
      'cred.mjs': 'export const loadCred=()=>({sessdata:"fixture",bili_jct:"fixture",buvid3:"fixture"});',
      'bili-api.mjs': 'export const apiGet=async url=>url.includes("/reply/reply?")?{code:12006}:{code:0,data:{replies:[{rpid_str:"456",content:{message:"@主人 可爱",members:[{mid:123}]}}]}};',
    };
    const result = runHelper(modules, ['verify-comment', '111', 'BV1JKDbBzETH', '456', '456']);
    assert.equal(result.found, true); assert.equal(result.public, true); assert.deepEqual(result.mentions, ['123']);
});

test('notification context requires the exact incoming author and keeps nested coordinates', () => {
  const modules = {
    'config.mjs': 'export const config=()=>({});',
    'cred.mjs': 'export const loadCred=()=>({sessdata:"fixture",bili_jct:"fixture",buvid3:"fixture"});',
    'bili-api.mjs': `export const apiGet=async url=>url.includes('/view?')?{code:0,data:{bvid:'BV1JKDbBzETH',title:'猫咪'}}:{code:0,data:{root:{rpid_str:'100',mid:'555',content:{message:'猫咪'}},replies:[{rpid_str:'200',mid:'999',member:{uname:'陌生人'},content:{message:'可爱'}}]}};`,
  };
  const valid = runHelper(modules, ['notification-context', '111', '200', '100', '999']);
  assert.equal(valid.ok, true); assert.equal(valid.parent_rpid, '200'); assert.equal(valid.root, '100');
  assert.equal(valid.text, '可爱'); assert.equal(valid.actorUid, '999');
  const invalid = runHelper(modules, ['notification-context', '111', '200', '100', '123']);
  assert.equal(invalid.ok, false); assert.match(invalid.error, /发送人/);
});
