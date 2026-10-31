// Exit contract: 0 = message/ack/baseline; 1 + {hit:false} = normal empty; 2 = invalid input; 3 = failure.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {config} from '../lib/config.mjs'
import {readHistory} from '../lib/dm-history.mjs'
import {acquireProcessLock} from '../lib/process-lock.mjs'
const argv=process.argv.slice(2),peek=argv.includes('--peek'),json=argv.includes('--json')
const owner=String(config().owner?.mid??'').trim(),name=String(config().owner?.name??'主人')
const home=process.env.USERPROFILE||process.env.HOME||'/'
const file=path.join(home,'.bili-ai/dm-await-state.json')
function writeState(target,content) {
  const tmp=target+'.'+crypto.randomUUID()+'.tmp'
  try {
    const fd=fs.openSync(tmp,'wx',0o600)
    try{fs.writeFileSync(fd,content);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
    fs.renameSync(tmp,target)
  }finally{fs.rmSync(tmp,{force:true})}
}
function save(state) {
  const content=JSON.stringify(state,null,2)
  writeState(file+'.bak',content)
  writeState(file,content)
}
function loadState(target) {
  const state=JSON.parse(fs.readFileSync(target,'utf8'))
  if(!state||typeof state!=='object'||Array.isArray(state))throw Error('invalid state')
  return state
}
function acknowledge(state,message) {
  const same=Number(state.lastSeen)===message.ts
  const keys=(message.messages??[message]).filter(row=>row.ts===message.ts).map(row=>row.key)
  return {...state,owner,lastSeen:message.ts,lastKey:message.key,lastKeys:[...new Set([...(same?(state.lastKeys??(state.lastKey?[state.lastKey]:[])):[]),...keys])],pending:undefined,queue:state.queue??[],at:new Date().toISOString()}
}
function emit(message){console.log(json?JSON.stringify(message):'DM_HIT mid='+owner+' text='+message.text)}
async function main(){
  if(!owner){console.error('配置里 owner.mid 为空');return 2}
  let state={}
  try{state=loadState(file)}
  catch(primaryError){
    try{state=loadState(file+'.bak')}
    catch(backupError){if(primaryError.code!=='ENOENT'||backupError.code!=='ENOENT')throw Error('私信状态无法读取，已停止推进已读位置：'+primaryError.message)}
  }
  if(state.owner&&state.owner!==owner)state={}
  if(state.lastSeen!==undefined&&(!Number.isFinite(Number(state.lastSeen))||Number(state.lastSeen)<0))throw Error('私信游标损坏，已停止读取')
  if(state.queue!==undefined&&!Array.isArray(state.queue))throw Error('私信待交付队列损坏')
  const ackIndex=argv.indexOf('--ack')
  if(ackIndex>=0){
    if(!state.pending||state.pending.mid!==owner||state.pending.receipt!==argv[ackIndex+1]){console.error('私信确认凭据不匹配，未推进已读状态');return 2}
    save(acknowledge(state,state.pending));console.log('私信交付已确认');return 0
  }
  const afterIndex=argv.indexOf('--after')
  if(afterIndex>=0){
    const after=Number(argv[afterIndex+1])
    if(!Number.isFinite(after)||after<0){console.error('--after 需要有效时间戳');return 2}
    const cutoff=Math.max(after,Number(state.receivedAfter??0))
    const pending=state.pending
    if(pending){
      const rows=pending.messages??[pending]
      if(rows.some(row=>row.ts<=cutoff)){
        const fresh=rows.filter(row=>row.ts>cutoff)
        const keys=new Set(fresh.map(row=>row.key))
        state.queue=[...fresh,...(state.queue??[]).filter(row=>!keys.has(row.key))]
        delete state.pending
      }
    }
    state.queue=(state.queue??[]).filter(row=>row.ts>cutoff)
    if(state.lastSeen===undefined||Number(state.lastSeen)<cutoff){
      state.lastSeen=cutoff;state.lastKeys=[];delete state.lastKey
    }
    state.receivedAfter=cutoff
    save(state)
  }
  if(state.pending?.mid===owner&&!argv.includes('--baseline')){emit(state.pending);return 0}
  if(!state.queue?.length||argv.includes('--baseline')){
    const cred=JSON.parse(fs.readFileSync(path.join(home,'.bili-ai/credentials.json'),'utf8'))
    const headers={'user-agent':'Mozilla/5.0',referer:'https://www.bilibili.com/',cookie:'SESSDATA='+cred.sessdata+'; bili_jct='+cred.bili_jct+'; buvid3='+cred.buvid3}
    const result=await readHistory(owner,headers,state,{baseline:argv.includes('--baseline')})
    if(argv.includes('--baseline')){
      const latest=result.all.at(-1),ts=latest?.ts??0
      save({owner,lastSeen:ts,lastKey:latest?.key,lastKeys:result.all.filter(r=>r.ts===ts).map(r=>r.key),lastIncoming:state.lastIncoming,queue:[]})
      console.log('已把当前私信状态标记为已读');return 0
    }
    state={...state,owner,queue:result.messages,lastIncoming:Math.max(Number(state.lastIncoming??0),...result.messages.map(r=>r.ts))}
    save(state)
  }
  if(!state.queue.length){console.log(json?JSON.stringify({hit:false}):'无新私信');return 1}
  const batch=argv.includes('--batch')?state.queue:[state.queue[0]]
  const row=batch.at(-1),rest=state.queue.slice(batch.length)
  const message={hit:true,mid:owner,name,text:batch.map(item=>item.text).join('\n'),ts:row.ts,key:row.key,receipt:crypto.randomUUID(),
    ...(argv.includes('--batch')?{messages:batch.map(({key,text,ts})=>({key,text,ts}))}:{})}
  state={...state,owner,queue:rest}
  if(peek)save({...state,pending:message})
  else save(acknowledge(state,message))
  emit(message);return 0
}
let release
try{
  fs.mkdirSync(path.dirname(file),{recursive:true})
  release=await acquireProcessLock(file)
  process.exitCode=await main()
}catch(e){console.error(e.message);process.exitCode=3}
finally{if(release)await release()}
