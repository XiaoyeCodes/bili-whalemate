import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {parseVideoTarget,readVideo} from '../tools/lib/video-reader.mjs'
import {readAgentReach} from '../tools/lib/video-reader-backend.mjs'

const bv='BV1QosZ62Eb5'
function fixture(items=[{from:0,to:2,content:'实际字幕内容'}]){
  const calls=[]
  const backend=async(bvid)=>{calls.push(bvid);return {ok:true,available:items.length>0,items,errorCode:items.length?null:'NOT_FOUND',
    video:{title:'测试视频',description:'仅是简介',duration:120},backend:'agent-reach/bilibili/bili-cli',backendVersion:'1.6.0'}}
  return {backend,calls}
}
test('upstream captions retain timestamps and stay distinct from metadata and discussion',async()=>{
  const f=fixture(),result=await readVideo(bv,f)
  assert.equal(result.coverage,'subtitles');assert.equal(result.transcript,'实际字幕内容')
  assert.equal(result.description,'仅是简介');assert.equal(result.backendVersion,'1.6.0')
  assert.equal(result.captionType,'unspecified','upstream does not expose manual or AI track type')
  assert.deepEqual(result.segments,[{from:0,to:2,text:'实际字幕内容'}])
  assert.equal(result.evidence.danmaku,false);assert.equal(result.evidence.frames,false)
})
test('no subtitles is metadata-only and never substitutes title or discussion',async()=>{
  const result=await readVideo(bv,fixture([]))
  assert.equal(result.ok,true);assert.equal(result.coverage,'metadata_only');assert.equal(result.transcript,'')
  assert.equal(result.evidence.subtitles,false);assert.equal(result.unavailableReason,'no_caption_track')
})
test('foreign and private URLs are rejected before the native backend',async()=>{
  const authenticated=new URL('https://www.bilibili.com/video/'+bv)
  authenticated.username='fixture';authenticated.password='fixture'
  for(const value of ['http://127.0.0.1/video/'+bv,'https://bilibili.com.evil.test/video/'+bv,'file:///tmp/test',authenticated.href]){
    const f=fixture();await assert.rejects(readVideo(value,f));assert.equal(f.calls.length,0)
  }
})
test('long subtitles retain the beginning and explicitly report truncation',async()=>{
  const f=fixture([{from:0,to:1,content:'第一句'},{from:1,to:2,content:'第二句'},{from:2,to:3,content:'第三句'}])
  const result=await readVideo(bv,{...f,maxChars:8})
  assert.equal(result.truncated,true);assert.ok(result.transcript.startsWith('第一句'));assert.equal(result.totalSegments,3)
})
test('unsupported parts fail explicitly rather than silently reading the first part',async()=>{
  const f=fixture(),result=await readVideo('https://www.bilibili.com/video/'+bv+'?p=2',f)
  assert.equal(result.ok,false);assert.match(result.error,/第一分 P/);assert.equal(f.calls.length,0)
  assert.equal(parseVideoTarget(bv).page,1)
})
test('short links resolve one validated redirect without login headers',async()=>{
  const f=fixture()
  f.fetch=async(url,options)=>{
    assert.equal(url,'https://b23.tv/example');assert.equal(options.headers,undefined);assert.equal(options.redirect,'manual')
    return new Response(null,{status:302,headers:{location:'https://www.bilibili.com/video/'+bv}})
  }
  assert.equal((await readVideo('https://b23.tv/example',f)).coverage,'subtitles')
})
test('short links cannot redirect to local or foreign hosts',async()=>{
  const f=fixture()
  f.fetch=async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})
  await assert.rejects(readVideo('https://b23.tv/example',f));assert.equal(f.calls.length,0)
})
test('native backend reserves budget and propagates platform pauses before another launch',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'video-native-'))
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  let calls=0
  const worker=async()=>{calls++;return {ok:false,errorCode:'PLATFORM_BLOCKED'}}
  const result=await readAgentReach(bv,{directory,worker})
  assert.equal(result.errorCode,'PLATFORM_BLOCKED')
  const saved=JSON.parse(fs.readFileSync(path.join(directory,'traffic-state.json'),'utf8'))
  assert.equal(Object.values(saved.accounts)[0].readDay,12)
  await assert.rejects(readAgentReach(bv,{directory,worker}),/暂停/)
  assert.equal(calls,1)
})
