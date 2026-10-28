import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { galleryUpload, pictureData, commentPicture, dmPicture } from '../vendor/bili-whale/tools/lib/gallery-picture.mjs';
const picture = { image_url: 'https://i0.hdslb.com/bfs/new_dyn/test.png', image_width: 1, image_height: 1, img_size: 1, imageType: 'png' };

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-gallery-test-'));
  t.after(() => { assert.ok(dir.startsWith(join(tmpdir(), 'dsh-gallery-test-'))); rmSync(dir, { recursive: true, force: true }); });
  const filename = join(dir, 'image.png');
  writeFileSync(filename, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jflsAAAAASUVORK5CYII=', 'base64'));
  return { filename, roots: [dir], cacheFile: join(dir, 'cache.json'), headers: { cookie: 'account-a' }, csrf: 'fixture' };
}

test('picture metadata rejects foreign hosts and converts upload HTTP URLs to HTTPS', () => {
  assert.equal(pictureData({ ...picture, image_url: picture.image_url.replace('https:', 'http:') }).image_url, picture.image_url);
  assert.throws(() => pictureData({ ...picture, image_url: 'https://example.test/file.png' }));
  assert.throws(() => pictureData({ ...picture, image_width: 0 }));
  assert.equal(commentPicture(picture).img_src, picture.image_url);
  assert.deepEqual(dmPicture(picture), { url: picture.image_url, height: 1, width: 1, size: 1, imageType: 'png', original: 1 });
});

test('inspection performs no upload or cache write and rejects files outside gallery roots', async t => {
  const options = fixture(t); let calls = 0;
  const result = await galleryUpload({ ...options, transport: async () => { calls++; } });
  assert.equal(result.needsUpload, true); assert.equal(calls, 0); assert.equal(existsSync(options.cacheFile), false);
  await assert.rejects(galleryUpload({ ...options, roots: [join(options.roots[0], 'other')] }), /共享图库/);
});

test('successful uploads are reused per account without making another write', async t => {
  const options = fixture(t); let calls = 0;
  const transport = async () => { calls++; return Response.json({ code: 0, data: { ...picture, image_url: picture.image_url.replace('https:', 'http:') } }); };
  assert.equal((await galleryUpload({ ...options, go: true, transport })).cached, false);
  assert.equal((await galleryUpload({ ...options, go: true, transport })).cached, true);
  assert.equal(calls, 1);
  await galleryUpload({ ...options, headers: { cookie: 'account-b' }, go: true, transport });
  assert.equal(calls, 2);
});

test('uncertain upload is retained and never automatically dispatched twice', async t => {
  const options = fixture(t); let calls = 0;
  const transport = async () => { calls++; throw Error('connection lost'); };
  await assert.rejects(galleryUpload({ ...options, go: true, transport }), /connection lost/);
  await assert.rejects(galleryUpload({ ...options, go: true, transport }), /未自动重传/);
  assert.equal(calls, 1);
});
