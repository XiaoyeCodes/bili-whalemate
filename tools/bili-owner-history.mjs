/** Narrow read-only helpers over the existing Bilibili libraries and credentials. */
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const root = process.env.DSH_HOME || join(homedir(), '.dsh');
const bili = process.env.CMEM_BILI_DIR || join(root, 'sources', 'dsh-bili-whale');
const load = name => import(pathToFileURL(join(bili, 'tools', 'lib', name)).href);
const { config } = await load('config.mjs');
const { loadCred } = await load('cred.mjs');
const { apiGet } = await load('bili-api.mjs');
const cred = loadCred();
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';
const headers = { 'user-agent': ua, referer: 'https://www.bilibili.com/',
  cookie: `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}` };
const [mode, ...args] = process.argv.slice(2);

async function findComment(aid, bvid, rootId, replyId) {
  const publicHeaders = { 'user-agent': ua, referer: `https://www.bilibili.com/video/${bvid}/` };
  for (let page = 1; page <= 5; page++) {
    const data = await apiGet(`https://api.bilibili.com/x/v2/reply/reply?type=1&oid=${aid}&root=${rootId}&pn=${page}&ps=20`, publicHeaders, { noCache: true });
    if (data.code === 12006) break;
    if (data.code !== 0) throw Error(`评论回读失败 code=${data.code}`);
    const found = [data.data?.root, ...(data.data?.replies || [])].filter(Boolean).find(row => String(row.rpid_str || row.rpid) === replyId);
    if (found) return found;
    if ((data.data?.replies || []).length < 20) break;
  }
  if (rootId === replyId) {
    for (const sort of [0, 2]) {
      for (let page = 1; page <= 3; page++) {
        const data = await apiGet(`https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&sort=${sort}&pn=${page}&ps=20`, publicHeaders, { noCache: true });
        if (data.code !== 0) throw Error(`主评论列表回读失败 code=${data.code}`);
        const rows = data.data?.replies || [];
        const found = rows.find(row => String(row.rpid_str || row.rpid) === replyId);
        if (found) return found;
        if (rows.length < 20) break;
      }
    }
  }
  return null;
}

async function identity() {
  const nav = await apiGet('https://api.bilibili.com/x/web-interface/nav', headers);
  if (nav.code !== 0) throw Error('B 站登录态失效');
  return { self: String(nav.data.mid), selfName: nav.data.uname };
}

try {
  if (mode === 'identity') {
    console.log(JSON.stringify({ ok: true, ...await identity() }));
  } else if (mode === 'notifications') {
    const { pullFeed } = await load('msgfeed.mjs');
    const me = await identity();
    const reply = await pullFeed('reply', { headers, pages: 2 });
    const at = await pullFeed('at', { headers, pages: 2 });
    const items = [...reply.items, ...at.items].map(row => ({ ...row, rpid: row.parent, time: row.t }));
    console.log(JSON.stringify({ ok: true, ...me, items }));
  } else if (mode === 'notification-context') {
    const [aid, parent, rootId, actor] = args;
    if (![aid, parent, rootId, actor].every(v => /^\d+$/.test(v || ''))) throw Error('无效的通知定位参数');
    const view = await apiGet(`https://api.bilibili.com/x/web-interface/view?aid=${aid}`, headers);
    if (view.code !== 0 || !/^BV[0-9A-Za-z]{10}$/.test(view.data?.bvid || '')) throw Error('通知对应视频不可读取');
    const bvid = view.data.bvid;
    const row = await findComment(aid, bvid, rootId, parent);
    if (!row || String(row.mid || row.member?.mid) !== actor) throw Error('通知楼层或发送人未通过公开回读验证');
    const root = rootId === parent ? row : await findComment(aid, bvid, rootId, rootId);
    console.log(JSON.stringify({ ok: true, aid, bvid, title: view.data.title, root: rootId, parent_rpid: parent,
      actorUid: actor, actorName: row.member?.uname || '', text: String(row.content?.message || ''),
      threadText: String(root?.content?.message || '') }));
  } else if (mode === 'write-ready') {
    const { trafficGuard, riskSettings } = await load('traffic.mjs');
    const state = trafficGuard().status(), settings = riskSettings();
    const account = createHash('sha256').update(cred.sessdata).digest('hex');
    const data = state.accounts?.[account] || {};
    const gap = args[0] === 'dm' ? settings.dmGapSec : settings.writeGapSec;
    const readyAt = Math.max(Number(state.until || 0), Number(data.lastWrite || 0) + gap * 1000);
    console.log(JSON.stringify({ ok: true, manual: !!state.manual?.[account], readyAt,
      waitSeconds: Math.max(0, Math.ceil((readyAt - Date.now()) / 1000)) }));
  } else if (mode === 'dm-history') {
    const owner = String(config().owner?.mid || '');
    if (!/^\d+$/.test(owner)) throw Error('主人 UID 尚未配置');
    const nav = await apiGet('https://api.bilibili.com/x/web-interface/nav', headers);
    if (nav.code !== 0) throw Error('B 站登录态失效');
    const { readHistory } = await load('dm-history.mjs');
    const result = await readHistory(owner, headers, {}, { baseline: true });
    const messages = result.all.map(row => {
      let picture = null;
      if (row.type === 2) { try { picture = JSON.parse(row.text).url || null; } catch { /* Invalid wire content remains available as text. */ } }
      return { ...row, picture };
    });
    console.log(JSON.stringify({ ok: true, self: String(nav.data.mid), selfName: nav.data.uname, owner, messages }));
  } else if (mode === 'verify-comment') {
    const [aid, bvid, rootId, replyId] = args;
    if (![aid, rootId, replyId].every(v => /^\d+$/.test(v || '')) || !/^BV[0-9A-Za-z]{10}$/.test(bvid || '')) throw Error('无效的评论定位参数');
    const found = await findComment(aid, bvid, rootId, replyId);
    console.log(JSON.stringify({ ok: true, found: !!found, public: !!found, rpid: replyId,
      text: found?.content?.message, mentions: (found?.content?.members || []).map(m => String(m.mid)),
      pictures: (found?.content?.pictures || []).map(p => ({ url: p.img_src, width: p.img_width, height: p.img_height })),
      url: `https://www.bilibili.com/video/${bvid}/#reply${replyId}` }));
  } else {
    throw Error('未知的只读检查');
  }
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
}
