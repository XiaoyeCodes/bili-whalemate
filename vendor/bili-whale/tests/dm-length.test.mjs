import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath,pathToFileURL} from 'node:url'

test('long DM reaches read-only preflight without the former 300 character rejection',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'bili-dm-length-'))
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
  fs.mkdirSync(path.join(home,'.bili-ai'));fs.mkdirSync(path.join(home,'.dsh'))
  fs.writeFileSync(path.join(home,'.bili-ai/credentials.json'),JSON.stringify({sessdata:'fixture-session',bili_jct:'a'.repeat(32)}))
  const config=path.join(home,'.dsh/bili-whale.config.json')
  fs.writeFileSync(config,JSON.stringify({owner:{mid:'222',name:'owner'}}))
  const preload=path.join(home,'fetch.mjs')
  fs.writeFileSync(preload,`globalThis.fetch=async(url,options={})=>{if(options.method&&options.method!=='GET')throw Error('test must not send');const pathname=new URL(url).pathname;const data=pathname.endsWith('/nav')?{isLogin:true,mid:111,uname:'fixture'}:pathname==='/x/relation'?{attribute:6}:null;if(!data)throw Error('unexpected endpoint');return new Response(JSON.stringify({code:0,data}))}`)
  const script=fileURLToPath(new URL('../tools/commands/dm.mjs',import.meta.url))
  const child=spawnSync(process.execPath,[script,'--msg','完整回复。'.repeat(100),'--dry'],{encoding:'utf8',env:{...process.env,
    USERPROFILE:home,HOME:home,DSH_HOME:path.join(home,'.dsh'),BILI_WHALE_CONFIG:config,
    BILI_TRAFFIC_TEST:'1',NODE_TEST_CONTEXT:'child-v8',NODE_OPTIONS:'--import='+pathToFileURL(preload)}})
  assert.equal(child.status,0,child.stderr)
  assert.match(child.stdout,/预检通过，未发送/)
  assert.equal(fs.existsSync(path.join(home,'.bili-ai/dm-quota.json')),false)
})
