/** Run the real GitHub Agent Reach channel under this plugin's shared traffic guard. */
import {execFile} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {createTrafficGuard} from './traffic.mjs'

export function readWorker(bvid,credentials,{signal}={}){
  const python=process.env.CMEM_VIDEO_READER_PYTHON||'python'
  const script=process.env.CMEM_VIDEO_READER_SCRIPT||fileURLToPath(new URL('../../../../service/bili_video_reader.py',import.meta.url))
  const home=process.env.CMEM_VIDEO_READER_HOME||path.join(process.env.USERPROFILE||process.env.HOME||'.','.dsh','remembers-data','video-reader')
  return new Promise((resolve,reject)=>{
    const child=execFile(python,[script],{windowsHide:true,timeout:30000,maxBuffer:4*1024*1024,encoding:'utf8',signal,
      env:{...process.env,CMEM_VIDEO_READER_HOME:home,PYTHONIOENCODING:'utf-8'}},(error,stdout)=>{
      if(error){reject(Error('Agent Reach 读取进程未完成'));return}
      try{resolve(JSON.parse(stdout))}catch{reject(Error('Agent Reach 未返回结构化结果'))}
    })
    child.stdin.on('error',()=>{})
    child.stdin.end(JSON.stringify({bvid,credentials}))
  })
}

export async function readAgentReach(bvid,{credentials,headers={},worker=readWorker,directory}={}){
  const guard=createTrafficGuard({directory:directory||path.join(process.env.USERPROFILE||process.env.HOME||'.','.bili-ai'),
    transport:async(_url,options)=>{
      const value=await worker(bvid,credentials,{signal:options.signal})
      const code={PLATFORM_BLOCKED:-352,RATE_LIMITED:-799,NEED_LOGIN:-101}[value.errorCode]??0
      return new Response(JSON.stringify({code,data:value}),{headers:{'content-type':'application/json'}})
    }})
  // Reserve a conservative allowance for native video/pages/player/signature calls.
  // Budget and platform pauses fail before launching, without another backend retry.
  const {fetch:guardedRead}=guard
  const response=await guardedRead('https://api.bilibili.com/x/web-interface/view?bvid='+bvid,{headers,readCost:12,signal:AbortSignal.timeout(60000)})
  return (await response.json()).data
}
