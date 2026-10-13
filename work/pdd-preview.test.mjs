import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadProduct, renderPreview } from './create-preview.mjs';
import { startServer } from './serve-preview.mjs';

const id = '959763271745';
const canonical = 'https://mobile.yangkeduo.com/goods.html?goods_id=959763271745';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=', 'base64');
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pdd-preview-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const image = { group: 'mainImages', file: 'mainImages/01.png', url: 'https://img.pddpic.com/pdd-image.png', status: 'downloaded', bytes: png.length, sha256: createHash('sha256').update(png).digest('hex') };
  const source = { goodsId: id, offerId: id, url: `${canonical}&refer_page_name=search_result`, title: '车载香氛', mainImages: [image.url], detailImages: [], videos: [] };
  const manifest = { offerId: id, sourceUrl: canonical, assets: [image] };
  const write = async () => {
    await writeFile(join(root, 'source.json'), JSON.stringify(source));
    await writeFile(join(root, 'assets-manifest.json'), JSON.stringify(manifest));
  };
  await mkdir(join(root, 'mainImages'));
  await writeFile(join(root, image.file), png);
  await write();
  await writeFile(join(root, '商品描述.md'), `# 车载香氛\n[商品页](${canonical}&tracking=unrelated)\n[错误平台](https://detail.1688.com/offer/${id}.html)`);
  return { root, source, manifest, write };
}

test('PDD source retains the real canonical product link in the copyable description', async t => {
  const { root, source, write } = await fixture(t);
  delete source.offerId; await write();
  const product = await loadProduct(root);
  assert.equal(product.offerId, id);
  assert.equal(product.canonicalUrl, canonical);
  assert.equal(product.description, '车载香氛\n商品页：https://mobile.yangkeduo.com/goods.html?goods_id=959763271745\n错误平台');
  const html = renderPreview(product);
  assert.doesNotMatch(html, /detail\.1688\.com|tracking=|refer_page_name=/);
  assert.match(html, /图库 1 张/);
});

test('PDD source refuses lookalike hosts, credentials, ports and invalid product IDs', async t => {
  const { root, source, write } = await fixture(t);
  for (const url of [
    'https://mobile.yangkeduo.com.evil.test/goods.html?goods_id=959763271745',
    'https://name:secret@mobile.yangkeduo.com/goods.html?goods_id=959763271745',
    'https://mobile.yangkeduo.com:443/goods.html?goods_id=959763271745',
    'https://mobile.yangkeduo.com:8443/goods.html?goods_id=959763271745',
    'http://mobile.yangkeduo.com/goods.html?goods_id=959763271745',
    'https://mobile.yangkeduo.com/goods.html?goods_id=oops',
    'https://mobile.yangkeduo.com/goods.html?goods_id=959763271745&goods_id=42',
  ]) {
    source.url = url; await write();
    await assert.rejects(loadProduct(root), /source URL/i);
  }
});

test('PDD goods ID, optional offer ID and manifest ID must match the genuine source product', async t => {
  const { root, source, manifest, write } = await fixture(t);
  source.goodsId = '42'; await write();
  await assert.rejects(loadProduct(root), /offer ID mismatch/i);
  delete source.goodsId; await write();
  await assert.rejects(loadProduct(root), /offer ID mismatch/i);
  source.goodsId = id; source.offerId = '42'; await write();
  await assert.rejects(loadProduct(root), /offer ID mismatch/i);
  source.offerId = id; manifest.offerId = '42'; await write();
  await assert.rejects(loadProduct(root), /offer ID mismatch/i);
  manifest.offerId = id; manifest.goodsId = '42'; await write();
  await assert.rejects(loadProduct(root), /offer ID mismatch/i);
  manifest.goodsId = id; delete manifest.sourceUrl; await write();
  await assert.rejects(loadProduct(root), /source URL/i);
  manifest.sourceUrl = `https://detail.1688.com/offer/${id}.html`; await write();
  await assert.rejects(loadProduct(root), /offer ID mismatch/i);
});

test('1688 cannot reuse the source URL of a PDD manifest with an identical numeric ID', async t => {
  const { root, source, write } = await fixture(t);
  source.url = `https://detail.1688.com/offer/${id}.html`; delete source.goodsId; await write();
  await assert.rejects(loadProduct(root), /offer ID mismatch/i);
});

test('platform metadata cannot contradict the genuine source and manifest URLs', async t => {
  const { root, source, manifest, write } = await fixture(t);
  source.platform = '1688'; await write();
  await assert.rejects(loadProduct(root), /offer ID mismatch/i);
  source.platform = 'pdd'; manifest.platform = '1688'; await write();
  await assert.rejects(loadProduct(root), /offer ID mismatch/i);
  manifest.platform = 'pdd'; await write();
  assert.equal((await loadProduct(root)).canonicalUrl, canonical);
});

test('PDD restricted server delivers the same copyable sidebar and only its validated image', async t => {
  const { root } = await fixture(t);
  const result = await startServer(root);
  t.after(() => new Promise(resolve => result.server.close(resolve)));
  const preview = await fetch(result.url);
  assert.equal(preview.status, 200);
  assert.match(await preview.text(), /商品页：https:\/\/mobile\.yangkeduo\.com\/goods.html\?goods_id=959763271745/);
  assert.match(preview.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(preview.headers.get('content-security-policy'), /connect-src 'none'/);
  const image = await fetch(`${result.url}mainImages/01.png`);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  assert.equal((await fetch(`${result.url}source.json`)).status, 404);
});
