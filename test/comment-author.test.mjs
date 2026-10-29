/** The dry author check uses the same page range as inbound context lookup. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

test('owner mention on the fifth thread page passes the read-only author check', t => {
  const dir = mkdtempSync(join(tmpdir(), 'whalemate-author-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const transport = `export const guardedFetch=async url=>{const page=Number(new URL(url).searchParams.get('pn'));return new Response(JSON.stringify({code:0,data:{root:{rpid_str:'100',mid:'888'},replies:page<5?Array.from({length:20},()=>({rpid_str:'123',mid:'888'})):[{rpid_str:'9007199254740993',mid:'999',member:{uname:'owner'}}]}}));};`;
  const loader = join(dir, 'loader.mjs');
  writeFileSync(loader, `import{registerHooks}from'node:module';registerHooks({resolve(s,c,n){const value=s.endsWith('/traffic.mjs')?${JSON.stringify(transport)}:s.endsWith('/config.mjs')?'export const config=()=>({owner:{mid:"999"}});':null;return value?{url:'data:text/javascript,'+encodeURIComponent(value),shortCircuit:true}:n(s,c)}});`);
  const result = execFileSync(process.execPath, ['--import', pathToFileURL(loader).href,
    fileURLToPath(new URL('../vendor/bili-whale/tools/commands/comment.mjs', import.meta.url)),
    '--check', '--oid', '111', '--root', '100', '--parent', '9007199254740993'],
    { encoding: 'utf8', env: { ...process.env, USERPROFILE: dir, HOME: dir } });
  assert.match(result, /是主人/);
  assert.match(result, /能发/);
});
