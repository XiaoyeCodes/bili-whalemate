import {loadCred} from '../lib/cred.mjs'
import {parseVideoTarget,readVideo} from '../lib/video-reader.mjs'

try{
  const input=process.argv[2]
  parseVideoTarget(input)
  const cred=loadCred()
  const value=await readVideo(input,{credentials:cred,headers:{'user-agent':'Mozilla/5.0',referer:'https://www.bilibili.com/',
    cookie:`SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}`}})
  console.log(JSON.stringify(value))
  if(!value.ok)process.exitCode=3
}catch{
  console.log(JSON.stringify({ok:false,coverage:'unavailable',error:'视频读取失败：请检查视频链接、已保存登录凭据和请求额度'}))
  process.exitCode=3
}
