import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const runner=fileURLToPath(new URL('../tools/lib/run-command.mjs',import.meta.url))
test('command runner preserves arguments and emits a structured failure without a stack',t=>{
 const directory=mkdtempSync(join(tmpdir(),'bili-command-result-'))
 t.after(()=>{assert.ok(resolve(directory).startsWith(resolve(tmpdir())+ (process.platform==='win32'?'\\':'/')+'bili-command-result-'));rmSync(directory,{recursive:true,force:true})})
 const file=join(directory,'command.mjs')
 writeFileSync(file,"console.log(JSON.stringify(process.argv.slice(2)));throw Object.assign(new Error('本地额度已用完'),{code:'BILI_TRAFFIC_PAUSED',reason:'write-budget',submission:'not-sent',retryAt:1234567890000})")
 const result=spawnSync(process.execPath,[runner,file,'--msg','literal $() text'],{encoding:'utf8',timeout:15000,windowsHide:true})
 assert.equal(result.signal,null);assert.equal(result.status,1)
 assert.deepEqual(JSON.parse(result.stdout),['--msg','literal $() text'])
 const receipt=JSON.parse(result.stderr.trim().replace(/^BILI_FAILURE_JSON=/,''))
 assert.equal(receipt.submission,'not-sent');assert.equal(receipt.retryAt,1234567890000)
 assert.doesNotMatch(result.stderr,/at file:|node:internal|Error:/)
})

test('the real CLI executes requests in the process owned by the caller',t=>{
 const directory=mkdtempSync(join(tmpdir(),'bili-command-result-'))
 t.after(()=>{assert.ok(resolve(directory).startsWith(resolve(tmpdir())+ (process.platform==='win32'?'\\':'/')+'bili-command-result-'));rmSync(directory,{recursive:true,force:true})})
 const data=join(directory,'.bili-ai');mkdirSync(data)
 writeFileSync(join(data,'credentials.json'),JSON.stringify({sessdata:'fixture',bili_jct:'a'.repeat(32)}))
 const preload=join(directory,'transport.mjs')
 writeFileSync(preload,"globalThis.fetch=async()=>{console.log('DISPATCH_PID='+process.pid);return new Response('{\"code\":0}',{headers:{'content-type':'application/json'}})}")
 const env={...process.env,HOME:directory,USERPROFILE:directory,DSH_HOME:join(directory,'.dsh'),BILI_WHALE_CONFIG:join(directory,'config.json'),NODE_OPTIONS:'--import='+pathToFileURL(preload).href}
 delete env.BILI_TRAFFIC_TEST
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../tools/bili.mjs',import.meta.url)),'comment-del','--oid','1','--rpid','2','--go'],{env,encoding:'utf8',timeout:15000,windowsHide:true})
 assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr)
 assert.equal(Number(result.stdout.match(/DISPATCH_PID=(\d+)/)?.[1]),result.pid)
})
