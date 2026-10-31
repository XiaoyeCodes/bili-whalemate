import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'

test('real session CLI distinguishes expiry from budget, network and platform failures without leaking cookies',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'bili-session-'))
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
  fs.mkdirSync(path.join(home,'.bili-ai'))
  const credentials={sessdata:'private-session-fixture',bili_jct:'private-csrf-fixture'}
  fs.writeFileSync(path.join(home,'.bili-ai/credentials.json'),JSON.stringify(credentials))
  const fixture=path.join(home,'fixture.json'),preload=path.join(home,'fetch.mjs')
  fs.writeFileSync(preload,`import fs from 'node:fs';globalThis.fetch=async()=>{const f=JSON.parse(fs.readFileSync(process.env.SESSION_FIXTURE,'utf8'));if(f.error)throw Object.assign(Error('private-session-fixture'),f.error);return new Response(JSON.stringify(f.body),{status:f.status??200})}`)
  const script=fileURLToPath(new URL('../tools/verify/session.mjs',import.meta.url))
  const run=value=>{
    fs.writeFileSync(fixture,JSON.stringify(value))
    const child=spawnSync(process.execPath,[script,'--json'],{encoding:'utf8',env:{...process.env,USERPROFILE:home,HOME:home,
      BILI_TRAFFIC_TEST:'1',NODE_TEST_CONTEXT:'child-v8',SESSION_FIXTURE:fixture,NODE_OPTIONS:'--import='+pathToFileURL(preload)}})
    assert.equal(child.status,0,child.stderr)
    assert.doesNotMatch(child.stdout+child.stderr,/private-session-fixture|private-csrf-fixture/)
    return JSON.parse(child.stdout)
  }
  assert.equal(run({body:{code:0,data:{isLogin:true}}}).state,'authenticated')
  assert.equal(run({body:{code:-101}}).state,'expired')
  assert.equal(run({body:{code:0,data:{isLogin:false}}}).state,'expired')
  assert.equal(run({body:{code:-412},status:412}).state,'unavailable')
  assert.equal(run({error:{reason:'read-budget',retryAt:999000}}).reason,'read-budget')
  assert.equal(run({error:{name:'TimeoutError'}}).state,'unavailable')
  const account=createHash('sha256').update(credentials.sessdata).digest('hex')
  fs.writeFileSync(path.join(home,'.bili-ai/traffic-state.json'),JSON.stringify({manual:{[account]:{code:-101}}}))
  assert.equal(run({error:{name:'NetworkMustNotRun'}}).state,'expired')
  fs.writeFileSync(path.join(home,'.bili-ai/traffic-state.json'),JSON.stringify({manual:{[account]:{code:12015}}}))
  assert.equal(run({error:{name:'NetworkMustNotRun'}}).reason,'manual')
})
