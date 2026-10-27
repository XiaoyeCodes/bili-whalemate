/** Catalogue image upload cache and the picture fields shared by comments and owner DMs. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { guardedFetch } from './traffic.mjs';

/** Validate uploaded metadata before it reaches either Bilibili write command. */
export function pictureData(raw) {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || typeof value !== 'object') throw Error('图片上传结果不是对象');
  const url = new URL(value.image_url);
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || !/^i\d+\.hdslb\.com$/.test(url.hostname) || !url.pathname.startsWith('/bfs/')) throw Error('图片必须来自 B 站图库上传 CDN');
  if (![value.image_width, value.image_height].every(n => Number.isInteger(n) && n > 0)
      || !Number.isFinite(value.img_size) || value.img_size <= 0 || !['png', 'jpg', 'gif'].includes(value.imageType)) throw Error('图片上传结果缺少有效尺寸或格式');
  return { image_url: url.href, image_width: value.image_width, image_height: value.image_height, img_size: value.img_size, imageType: value.imageType };
}

export function commentPicture(raw) {
  const p = pictureData(raw);
  return { img_src: p.image_url, img_width: p.image_width, img_height: p.image_height, img_size: p.img_size };
}

export function dmPicture(raw) {
  const p = pictureData(raw);
  return { url: p.image_url, height: p.image_height, width: p.image_width, size: p.img_size, imageType: p.imageType, original: 1 };
}

function readInput(filename, roots) {
  const file = fs.realpathSync(filename);
  if (!roots.some(root => { const rel = path.relative(path.resolve(root), file); return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); })) throw Error('只能上传共享图库或其传输缓存中的图片');
  const bytes = fs.readFileSync(file);
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw Error('图片为空或超过 10 MiB');
  const type = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg'
    : /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6)) ? 'gif' : null;
  if (!type) throw Error('传输图片必须为 PNG、JPEG 或 GIF');
  return { bytes, type, hash: createHash('sha256').update(bytes).digest('hex') };
}

function readCache(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || typeof value.entries !== 'object' || Array.isArray(value.entries)) throw Error('invalid entries');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return { entries: {} };
    throw Error('图片上传缓存损坏，已停止重复上传');
  }
}

function writeCache(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value) + '\n');
  fs.renameSync(temporary, file);
}

/** Inspection is read-only. Uploads require go=true and use the original traffic guard. */
export async function galleryUpload({ filename, roots, headers, csrf, cacheFile, go = false, transport = guardedFetch }) {
  const input = readInput(filename, roots);
  const account = createHash('sha256').update(headers.cookie || '').digest('hex');
  const key = account + ':' + input.hash;
  const cache = readCache(cacheFile), previous = cache.entries[key];
  if (previous?.status === 'success') return { ok: true, cached: true, picture: pictureData(previous.picture) };
  if (previous?.status === 'unverified') {
    const picture = pictureData({ ...previous.response, imageType: previous.imageType });
    if (go) { cache.entries[key] = { status: 'success', picture }; writeCache(cacheFile, cache); }
    return { ok: true, cached: true, picture };
  }
  if (previous?.status === 'pending' || previous?.status === 'unknown') throw Error('这张图上次上传结果不明，请核查缓存；未自动重传');
  if (previous?.status === 'metadata-lost' && Date.now() < previous.retryAfter) throw Error('该图片已上传但地址回执未保留，原写入去重窗口结束后恢复；本轮只发文字');
  if (!go) return { ok: true, needsUpload: true, imageType: input.type, bytes: input.bytes.length };
  const form = new FormData();
  form.append('file_up', new Blob([input.bytes], { type: input.type === 'jpg' ? 'image/jpeg' : 'image/' + input.type }), 'gallery.' + input.type);
  form.append('category', 'daily'); form.append('csrf', csrf);
  cache.entries[key] = { status: 'pending' }; writeCache(cacheFile, cache);
  try {
    const response = await transport('https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs', { method: 'POST', headers, body: form });
    const result = await response.json();
    if (!response.ok || result.code !== 0) {
      cache.entries[key] = { status: 'failed' }; writeCache(cacheFile, cache);
      throw Error('图库上传失败 code=' + result.code + ' ' + (result.message || ''));
    }
    cache.entries[key] = { status: 'unverified', response: result.data, imageType: input.type }; writeCache(cacheFile, cache);
    const picture = pictureData({ ...result.data, imageType: input.type });
    cache.entries[key] = { status: 'success', picture }; writeCache(cacheFile, cache);
    return { ok: true, cached: false, picture };
  } catch (error) {
    if (cache.entries[key].status === 'pending') {
      cache.entries[key] = { status: error.code === 'BILI_TRAFFIC_PAUSED' ? 'failed' : 'unknown' };
      writeCache(cacheFile, cache);
    }
    throw error;
  }
}
