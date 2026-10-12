import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

const offerId = '1075593934641';
const productUrl = `https://detail.1688.com/offer/${offerId}.html`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=', 'base64');
const box = (type, payload = Buffer.alloc(0)) => {
  const bytes = Buffer.alloc(8 + payload.length);
  bytes.writeUInt32BE(bytes.length, 0); bytes.write(type, 4); payload.copy(bytes, 8);
  return bytes;
};
const mp4 = Buffer.concat([box('ftyp', Buffer.from('isom0000isommp42')), box('moov'), box('mdat', Buffer.alloc(32, 7))]);
const asset = (group, file, bytes, status = 'downloaded') => ({
  group, file, url: `https://cbu01.alicdn.com/${file}`, status, bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
});

async function api() {
  try { return await import('./create-preview.mjs'); }
  catch (error) { assert.fail(`Preview generator is not implemented (${error.code || error.message})`); }
}
async function serverApi() {
  try { return await import('./serve-preview.mjs'); }
  catch (error) { assert.fail(`Restricted preview server is not implemented (${error.code || error.message})`); }
}
async function fixture(t, changes = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), '1688-preview-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const assets = [asset('mainImages', 'mainImages/01.png', png), asset('videos', 'videos/01.mp4', mp4)];
  const source = { offerId, url: productUrl, title: '围巾兔 - 阿里巴巴', text: '账号余额：9999\n1688采购助手', mainImages: [assets[0].url], detailImages: [], videos: [assets[1].url], warnings: ['Detail images not loaded'] };
  const manifest = { offerId, sourceUrl: productUrl, assets, warnings: ['Detail images not loaded'] };
  Object.assign(source, changes.source);
  Object.assign(manifest, changes.manifest);
  await mkdir(join(root, 'mainImages')); await mkdir(join(root, 'detailImages')); await mkdir(join(root, 'videos'));
  await writeFile(join(root, 'mainImages/01.png'), png);
  await writeFile(join(root, 'mainImages/stale.png'), png);
  await writeFile(join(root, 'videos/01.mp4'), mp4);
  await writeFile(join(root, 'source.json'), JSON.stringify(source));
  await writeFile(join(root, 'assets-manifest.json'), JSON.stringify(manifest));
  await writeFile(join(root, '商品描述.md'), changes.description ?? `# 围巾兔\n\nPU **慢回弹**，独立包装。\n\n| 规格 | 单价 |\n| --- | ---: |\n| 小号 | ¥6.65 |\n\n[商品原链接](${productUrl})\n\n我的1688\n账号余额：9999\n立即下单\n切换为侧边栏模式`);
  await writeFile(join(root, '素材预览.pdf'), '%PDF-1.7 private');
  return { root, source, manifest, assets };
}
const http = (url, options = {}) => new Promise((resolve, reject) => {
  const req = request(url, options, res => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
  });
  req.on('error', reject); req.end();
});
async function running(t, root) {
  const { startServer } = await serverApi();
  const result = await startServer(root);
  t.after(() => new Promise(resolve => result.server.close(resolve)));
  return result;
}

test('preview uses only successful current manifest media, leaving stale and failed files out', async t => {
  const { root, source, manifest } = await fixture(t);
  const failed = asset('detailImages', 'detailImages/failed.png', png, 'failed');
  failed.error = 'HTTP 403'; source.detailImages = [failed.url];
  manifest.assets.push(failed, asset('mainImages', 'mainImages/stale.png', png));
  await writeFile(join(root, 'detailImages/failed.png'), png);
  await writeFile(join(root, 'source.json'), JSON.stringify(source));
  await writeFile(join(root, 'assets-manifest.json'), JSON.stringify(manifest));
  const { loadProduct, renderPreview } = await api();
  const product = await loadProduct(root);
  assert.deepEqual(product.media.map(item => item.file), ['mainImages/01.png', 'videos/01.mp4']);
  const html = renderPreview(product);
  assert.match(html, /<textarea[^>]*>[^]*PU 慢回弹，独立包装。/);
  assert.match(html, /<video[^>]*src="videos\/01.mp4"/);
  assert.match(html, /href="videos\/01.mp4"[^>]*download=/);
  assert.match(html, /HTTP 403/);
  assert.doesNotMatch(html, /(?:stale\.png|failed\.png"|账号余额|采购助手|我的1688|立即下单|侧边栏模式)/);
});

test('preview escapes product HTML in titles, description, and failure messages', async t => {
  const evil = '</textarea><script>alert("owned")</script><img src=x onerror=alert(1)>';
  const failed = { group: 'detailImages', url: 'https://cbu01.alicdn.com/f.png', status: 'failed', error: evil };
  const { root } = await fixture(t, { source: { title: evil, detailImages: [failed.url] }, manifest: { assets: [failed] }, description: `# 商品\n${evil}\n[点击](javascript:alert(1))` });
  const { loadProduct, renderPreview } = await api();
  const html = renderPreview(await loadProduct(root));
  assert.doesNotMatch(html, /<script>alert|<img src=x|onerror=alert\(1\)>/);
  assert.match(html, /&lt;\/textarea&gt;&lt;script&gt;alert\(&quot;owned&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /(?:src|href)="(?:javascript:|https:\/\/cbu01)/);
});

test('pure renderer rejects active URLs and derives displayed counts from validated media', async t => {
  const { root } = await fixture(t);
  const { loadProduct, renderPreview } = await api();
  const product = await loadProduct(root);
  assert.throws(() => renderPreview({ ...product, media: [{ group: 'mainImages', file: 'javascript:alert(1)' }] }), /preview media path/i);
  const html = renderPreview({ ...product, counts: { mainImages: '<img src=x onerror=alert(1)>', detailImages: 999, videos: 999 } });
  assert.doesNotMatch(html, /<img src=x|999/);
  assert.match(html, /图库 1 张 · 详情图 0 张 · MP4 视频 1 个/);
});

test('resolved extraction warnings disappear while missing required media is reported', async t => {
  const { root, source, manifest } = await fixture(t);
  const detail = asset('detailImages', 'detailImages/01.png', png);
  source.detailImages = [detail.url]; source.videos = [];
  manifest.assets = [manifest.assets[0], detail];
  await writeFile(join(root, detail.file), png);
  await writeFile(join(root, 'source.json'), JSON.stringify(source));
  await writeFile(join(root, 'assets-manifest.json'), JSON.stringify(manifest));
  const { loadProduct, renderPreview } = await api();
  const html = renderPreview(await loadProduct(root));
  assert.doesNotMatch(html, /Detail images not loaded|详情图未加载/);
  assert.match(html, /未采集到可用 MP4 视频/);
  assert.match(html, /详情图 1/);
});

test('source and manifest offer IDs must agree with a credential-free 1688 product URL', async t => {
  const { root, source, manifest } = await fixture(t);
  const { loadProduct } = await api();
  for (const url of ['file:///etc/passwd', 'https://detail.1688.com.evil.test/offer/1075593934641.html', 'https://name:secret@detail.1688.com/offer/1075593934641.html']) {
    await writeFile(join(root, 'source.json'), JSON.stringify({ ...source, url }));
    await assert.rejects(loadProduct(root), /source URL/i);
  }
  await writeFile(join(root, 'source.json'), JSON.stringify(source));
  await writeFile(join(root, 'assets-manifest.json'), JSON.stringify({ ...manifest, offerId: '42' }));
  await assert.rejects(loadProduct(root), /offer ID/i);
});

test('unsafe media paths, symlink escapes, tampered hashes, and disguised PDF bytes cannot be served', async t => {
  const { root, source, manifest } = await fixture(t);
  const escaped = `${root}-outside.png`;
  await writeFile(escaped, png); t.after(() => rm(escaped, { force: true }));
  await symlink(escaped, join(root, 'mainImages/link.png'));
  const pdf = Buffer.from('%PDF-1.7 this must never become image/png');
  await writeFile(join(root, 'mainImages/pdf.png'), pdf);
  const rows = [
    asset('mainImages', 'mainImages/link.png', png),
    asset('mainImages', 'mainImages/pdf.png', pdf),
    { ...asset('mainImages', 'mainImages/01.png', png), sha256: '0'.repeat(64) },
    asset('mainImages', '../outside-1688-preview.png', png),
    asset('other', 'other/01.png', png),
    asset('mainImages', 'videos/01.mp4', mp4),
    asset('mainImages', '/mainImages/01.png', png),
  ];
  source.mainImages = rows.map(row => row.url); manifest.assets = rows;
  await writeFile(join(root, 'source.json'), JSON.stringify(source));
  await writeFile(join(root, 'assets-manifest.json'), JSON.stringify(manifest));
  const { loadProduct } = await api();
  const product = await loadProduct(root);
  assert.deepEqual(product.media, []);
  assert.ok(product.warnings.length >= 4);
  const { url } = await running(t, root);
  for (const path of ['mainImages/link.png', 'mainImages/pdf.png', 'mainImages/01.png']) assert.equal((await http(`${url}${path}`)).status, 404);
});

test('group directory and required metadata symlinks cannot escape the output root', async t => {
  const { root } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), '1688-preview-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, '01.png'), png);
  await rm(join(root, 'mainImages'), { recursive: true });
  await symlink(outside, join(root, 'mainImages'));
  const { loadProduct } = await api();
  assert.equal((await loadProduct(root)).media.some(item => item.group === 'mainImages'), false);
  await rm(join(root, 'source.json'));
  await writeFile(join(outside, 'source.json'), JSON.stringify({ url: productUrl }));
  await symlink(join(outside, 'source.json'), join(root, 'source.json'));
  await assert.rejects(loadProduct(root), /symlink|symbolic/i);
});

test('a group swapped to an outside symlink between validation and open is rejected', async t => {
  const { root } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), '1688-preview-open-swap-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, '01.png'), png);
  const { loadProduct } = await api();
  const originalOpen = fsPromises.open;
  const mockedOpen = t.mock.method(fsPromises, 'open', async (...args) => {
    if (args[0] === join(root, 'mainImages/01.png')) {
      await rm(join(root, 'mainImages'), { recursive: true });
      await symlink(outside, join(root, 'mainImages'));
    }
    return originalOpen(...args);
  });
  syncBuiltinESMExports();
  try {
    const product = await loadProduct(root);
    assert.equal(product.media.some(item => item.group === 'mainImages'), false);
    assert.match(product.warnings.join('\n'), /changed|替换|symbolic|ELOOP/i);
  } finally { mockedOpen.mock.restore(); syncBuiltinESMExports(); }
});

test('staged directory swaps cannot supply an outside inode to validation and open', async t => {
  const { root } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), '1688-preview-staged-swap-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, '01.png'), png);
  const { loadProduct } = await api();
  const group = join(root, 'mainImages');
  const hiddenGroup = join(root, 'mainImages-held');
  const file = join(group, '01.png');
  const originalLstat = fsPromises.lstat, originalRealpath = fsPromises.realpath;
  const swapOutside = async () => { await rename(group, hiddenGroup); await symlink(outside, group); };
  const swapInside = async () => { await rm(group); await rename(hiddenGroup, group); };
  const mockedLstat = t.mock.method(fsPromises, 'lstat', async (...args) => {
    const result = await originalLstat(...args);
    if (args[0] === group) await swapOutside();
    if (args[0] === file) await swapInside();
    return result;
  });
  const mockedRealpath = t.mock.method(fsPromises, 'realpath', async (...args) => {
    const result = await originalRealpath(...args);
    if (args[0] === file) await swapOutside();
    return result;
  });
  syncBuiltinESMExports();
  try {
    const product = await loadProduct(root);
    assert.equal(product.media.some(item => item.group === 'mainImages'), false);
    assert.match(product.warnings.join('\n'), /symlink|symbolic|loop|ELOOP/i);
  } finally { mockedLstat.mock.restore(); mockedRealpath.mock.restore(); syncBuiltinESMExports(); }
});

test('createPreview writes only the chosen HTML artifact and refuses an output symlink', async t => {
  const { root } = await fixture(t);
  const { createPreview } = await api();
  const result = await createPreview(root);
  assert.equal(result.offerId, offerId);
  assert.equal(result.previewPath, join(root, '图文预览.html'));
  assert.match(await readFile(result.previewPath, 'utf8'), /复制商品描述/);
  await rm(result.previewPath);
  await symlink(join(root, 'source.json'), result.previewPath);
  await assert.rejects(createPreview(root), /symlink|symbolic/i);
  await assert.rejects(createPreview(root, { outputName: '../outside.html' }), /output name/i);
});

test('localhost server exposes only generated preview and allowed media with correct MIME and HEAD', async t => {
  const { root } = await fixture(t);
  const { server, url, offerId: id } = await running(t, root);
  assert.equal(server.address().address, '127.0.0.1');
  assert.equal(id, offerId);
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const preview = await http(url);
  assert.equal(preview.status, 200);
  assert.match(preview.headers['content-type'], /text\/html/);
  assert.match(preview.bytes.toString(), /复制商品描述/);
  assert.match(preview.headers['content-security-policy'], /default-src 'none'/);
  assert.match(preview.headers['content-security-policy'], /connect-src 'none'/);
  assert.doesNotMatch(preview.headers['content-security-policy'], /script-src[^;]*unsafe-inline/);
  const image = await http(`${url}mainImages/01.png`);
  assert.equal(image.headers['content-type'], 'image/png');
  assert.deepEqual(image.bytes, png);
  const head = await http(`${url}videos/01.mp4`, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.bytes.length, 0);
  assert.equal(Number(head.headers['content-length']), mp4.length);
  assert.equal(head.headers['content-type'], 'video/mp4');
  for (const file of ['source.json', 'assets-manifest.json', '商品描述.md', '素材预览.pdf', 'mainImages/stale.png', 'favicon.ico']) assert.equal((await http(`${url}${encodeURI(file)}`)).status, 404);
});

test('HTTP traversal, encoded separators, unexpected hosts, and non-read methods are denied', async t => {
  const { root } = await fixture(t);
  const { url } = await running(t, root);
  for (const path of ['/../source.json', '/%2e%2e/source.json', '/mainImages%2f01.png', '/mainImages\\01.png', '/mainImages/../source.json', '/%zz', '//mainImages/01.png']) {
    const result = await http(url, { path }); assert.equal(result.status, 404, path);
  }
  assert.equal((await http(url, { headers: { Host: 'evil.test' } })).status, 403);
  const post = await http(url, { method: 'POST' });
  assert.equal(post.status, 405); assert.equal(post.headers.allow, 'GET, HEAD');
});

test('MP4 ranges support seeking, open ends and suffixes, and reject unsatisfiable ranges', async t => {
  const { root } = await fixture(t);
  const { url } = await running(t, root);
  const cases = [
    ['bytes=4-11', 4, 11], ['bytes=24-', 24, mp4.length - 1], ['bytes=-8', mp4.length - 8, mp4.length - 1],
    ['bytes=0-99999', 0, mp4.length - 1],
  ];
  for (const [range, start, end] of cases) {
    const result = await http(`${url}videos/01.mp4`, { headers: { Range: range } });
    assert.equal(result.status, 206);
    assert.equal(result.headers['content-range'], `bytes ${start}-${end}/${mp4.length}`);
    assert.deepEqual(result.bytes, mp4.subarray(start, end + 1));
  }
  for (const range of ['bytes=99999-', 'bytes=8-4', 'bytes=-0', 'bytes=0-1,3-4', 'bytes=a-b']) {
    const result = await http(`${url}videos/01.mp4`, { headers: { Range: range } });
    assert.equal(result.status, 416, range); assert.equal(result.headers['content-range'], `bytes */${mp4.length}`);
  }
  const head = await http(`${url}videos/01.mp4`, { method: 'HEAD', headers: { Range: 'bytes=4-11' } });
  assert.equal(head.status, 206); assert.equal(head.bytes.length, 0); assert.equal(head.headers['content-length'], '8');
});

test('server keeps a validated media snapshot when a listed file becomes a symlink', async t => {
  const { root } = await fixture(t);
  const { url } = await running(t, root);
  await rm(join(root, 'mainImages/01.png'));
  await symlink(join(root, 'source.json'), join(root, 'mainImages/01.png'));
  const image = await http(`${url}mainImages/01.png`);
  assert.equal(image.status, 200); assert.deepEqual(image.bytes, png);
});

test('server CLI announces offer and HTTP URL, remains alive, and exits cleanly on SIGTERM', async t => {
  const { root } = await fixture(t);
  await serverApi();
  const child = spawn(process.execPath, [fileURLToPath(new URL('./serve-preview.mjs', import.meta.url)), root], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  const ready = await Promise.race([
    once(child.stdout, 'data').then(([bytes]) => JSON.parse(bytes.toString())),
    once(child, 'exit').then(([code]) => assert.fail(`Server exited before ready: ${code}`)),
  ]);
  assert.equal(ready.offerId, offerId); assert.match(ready.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.equal(child.exitCode, null); assert.equal((await http(ready.url)).status, 200);
  const exited = once(child, 'exit'); child.kill('SIGTERM');
  const [code] = await exited; assert.equal(code, 0);
});
