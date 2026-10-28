/** Upload only a prepared shared-gallery image with the existing Bilibili credentials. */
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const home = process.env.DSH_HOME || join(homedir(), '.dsh');
const bili = process.env.CMEM_BILI_DIR || fileURLToPath(new URL('../vendor/bili-whale/', import.meta.url));
const load = name => import(pathToFileURL(join(bili, 'tools', 'lib', name)).href);
try {
  const [mode, filename, flag] = process.argv.slice(2);
  if (!['inspect', 'upload'].includes(mode) || !filename || (mode === 'upload' && flag !== '--go')) throw Error('上传需要显式 --go');
  const { galleryUpload } = await load('gallery-picture.mjs');
  const { loadCred } = await load('cred.mjs'); const cred = loadCred();
  const result = await galleryUpload({ filename, go: mode === 'upload',
    roots: [resolve(process.env.CMEM_MEME_DIR || join(home, 'media', 'whalemate')), join(process.env.CMEM_DATA_DIR || join(home, 'remembers-data'), 'bili-gallery-cache')],
    headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://www.bilibili.com/', cookie: `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3 || ''}` },
    csrf: cred.bili_jct, cacheFile: join(homedir(), '.bili-ai', 'gallery-uploads.json') });
  console.log(JSON.stringify(result));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1;
}
