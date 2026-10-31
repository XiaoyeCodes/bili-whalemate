import { guardedFetch as fetch, trafficGuard } from '../lib/traffic.mjs'
import { loadCred, CRED_PATH } from '../lib/cred.mjs'
import { createHash } from 'node:crypto'

const json=process.argv.includes('--json')
let result,account
try {
  const cred=loadCred()
  if(!cred.sessdata)throw Object.assign(Error(),{reason:'invalid-credentials'})
  const accountKey=createHash('sha256').update(cred.sessdata).digest('hex')
  const previous=trafficGuard().status().manual?.[accountKey]
  if(previous)throw Object.assign(Error(),{reason:[-101,401].includes(previous.code)?'platform-authentication':'manual'})
  const response=await fetch('https://api.bilibili.com/x/web-interface/nav',{
    headers:{'user-agent':'Mozilla/5.0',referer:'https://www.bilibili.com/',
      cookie:`SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}`},
    signal:AbortSignal.timeout(20000),
  })
  const nav=await response.json()
  if(Number(nav.code)===-101||response.status===401||(nav.code===0&&nav.data?.isLogin===false)){
    result={state:'expired',reason:'platform-authentication'}
  }else if(response.ok&&nav.code===0&&nav.data?.isLogin===true){
    result={state:'authenticated'}
    account=nav.data
  }else{
    result={state:'unavailable',reason:[412,429].includes(response.status)||[-412,-352].includes(Number(nav.code))?'platform-pause':'verification-failed'}
  }
}catch(error){
  result={state:error.reason==='platform-authentication'?'expired':'unavailable',reason:error.reason??'network'}
  if(Number.isFinite(error.retryAt))result.retryAt=error.retryAt
}
if(json){
  console.log(JSON.stringify(result))
}else if(result.state==='authenticated'){
  console.log('凭据有效 ✓')
  console.log(`  账号      : ${account.uname}`)
  console.log(`  mid       : ${account.mid}`)
  console.log(`  手机绑定  : ${account.mobile_verified?'是（发评论/动态需要）':'否'}`)
  console.log(`  硬币      : ${account.money}   等级: ${account.level_info?.current_level??'-'}`)
  console.log(`  凭据文件  : ${CRED_PATH}`)
}else{
  console.error(result.state==='expired'?'平台确认登录已失效，请重新登录。':'暂时无法验证登录；已保存的凭据未被清除，请稍后重试。')
  process.exitCode=result.state==='expired'?4:3
}
