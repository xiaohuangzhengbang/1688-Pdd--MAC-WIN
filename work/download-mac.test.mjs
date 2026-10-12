import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const offerId = '1075593934641';
async function fixture(t, videos = []) {
  const root = await mkdtemp(join(tmpdir(), '1688-download-cli-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const source = join(root, 'source.json');
  const product = join(root, 'outputs', offerId);
  await mkdir(product, {recursive: true});
  await writeFile(source, JSON.stringify({offerId, url: `https://detail.1688.com/offer/${offerId}.html`, mainImages: [], detailImages: [], videos: [], ...{videos}}));
  await writeFile(join(product, '商品描述.md'), '# 测试商品\n页面规格尚未加载。');
  return {root, source, product};
}
const run = args => spawnSync('/bin/bash', [join(packageRoot, 'download-mac.sh'), ...args], {encoding: 'utf8'});

test('Mac entry creates a copyable preview without a default ZIP', async t => {
  const {root, source, product} = await fixture(t);
  const result = run([source, join(root, 'outputs')]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(await readFile(join(product, '图文预览.html'), 'utf8'), /测试商品/);
  assert.equal((await readdir(join(root, 'outputs'))).some(name => name.endsWith('.zip')), false);
});

test('failed discovered video still produces a current preview and returns failure', async t => {
  const {root, source, product} = await fixture(t, ['http://caiyuanbao.alicdn.com/not-approved.mp4']);
  const result = run([source, join(root, 'outputs')]);
  assert.equal(result.status, 1);
  const manifest = JSON.parse(await readFile(join(product, 'assets-manifest.json')));
  assert.equal(manifest.assets[0].status, 'failed');
  assert.match(await readFile(join(product, '图文预览.html'), 'utf8'), /失败|未成功|failed/i);
});

test('explicit default output directory does not allow a second directory', async t => {
  const {root, source} = await fixture(t);
  const result = run([source, join(packageRoot, 'outputs'), join(root, 'another')]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Only one output directory/);
});
