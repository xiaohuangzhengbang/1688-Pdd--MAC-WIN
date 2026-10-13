import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {downloadAssets} from './download-assets.mjs';

const jpeg = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(64, 1)]);
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(32), Buffer.from('moovmdat')]);
async function fixture(t, images = 8, videos = 1) {
  const root = await mkdtemp(join(tmpdir(), 'download-speed-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const source = {url: 'https://detail.1688.com/offer/12345.html',
    mainImages: Array.from({length: images}, (_, index) => `https://img.alicdn.com/photo-${index}.jpeg`),
    detailImages: [], videos: Array.from({length: videos}, (_, index) => `https://cloud.video.taobao.com/video-${index}.mp4`)};
  const input = join(root, 'source.json');
  await writeFile(input, JSON.stringify(source));
  return {root, input, source};
}

// Scheduling source-order image batches postpones video until most images finish.
test('videos enter the first download batch while manifest and filenames retain source order', async t => {
  const {root, input, source} = await fixture(t, 8, 2);
  const started = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let batchReady;
  const batch = new Promise(resolve => { batchReady = resolve; });
  const fetchMedia = async url => {
    started.push(String(url));
    if (started.length === 4) batchReady();
    await gate;
    return new Response(String(url).endsWith('.mp4') ? mp4 : jpeg);
  };
  const running = downloadAssets(input, root, {platform: 'linux', env: {}, fetch: fetchMedia});
  let firstBatch;
  try {
    await batch;
    firstBatch = started.slice(0, 4);
  } finally { release(); }
  const result = await running;
  assert.ok(firstBatch.includes(source.videos[0]), 'Video must start before the image queue finishes');
  assert.ok(firstBatch.some(url => source.mainImages.includes(url)), 'Images must start beside video');
  assert.deepEqual(result.manifest.assets.map(row => row.url), [...source.mainImages, ...source.videos]);
  assert.deepEqual(result.manifest.assets.filter(row => row.group === 'videos').map(row => row.file), ['videos/01.mp4', 'videos/02.mp4']);
  assert.equal(result.summary.downloaded, 10);
});

// Ignoring the configurable worker count causes wrong actual simultaneous transfers.
test('caller and environment concurrency limits control simultaneous downloads', async t => {
  for (const config of [{concurrency: 1, env: {}}, {env: {ASSET_DOWNLOAD_CONCURRENCY: '7'}}, {concurrency: 3, env: {ASSET_DOWNLOAD_CONCURRENCY: '7'}}]) {
    const {root, input} = await fixture(t, 9, 0);
    let active = 0, maximum = 0;
    const result = await downloadAssets(input, root, {...config, platform: 'linux', fetch: async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      return new Response(jpeg);
    }});
    assert.equal(result.summary.failed.length, 0);
    assert.equal(maximum, config.concurrency ?? Number(config.env.ASSET_DOWNLOAD_CONCURRENCY));
  }
});

// Accepting invalid limits silently produces unbounded or stalled download queues.
test('invalid concurrency is rejected before any media request', async t => {
  const {root, input} = await fixture(t);
  for (const concurrency of [0, 13, 1.5, NaN, '4', null]) {
    await assert.rejects(downloadAssets(input, root, {concurrency, env: {}, fetch: () => assert.fail('Invalid limit reached network')}), /concurrency/i);
  }
  for (const value of ['0', '13', '1.5', 'junk', '']) {
    await assert.rejects(downloadAssets(input, root, {env: {ASSET_DOWNLOAD_CONCURRENCY: value}, fetch: () => assert.fail('Invalid limit reached network')}), /concurrency/i);
  }
});

// Priority scheduling must preserve SHA cache reuse for mixed image/video products.
test('a repeated mixed-media run verifies cached bytes with zero network requests', async t => {
  const {root, input} = await fixture(t, 5, 1);
  const first = await downloadAssets(input, root, {platform: 'linux', env: {}, fetch: async url => new Response(String(url).endsWith('.mp4') ? mp4 : jpeg)});
  const second = await downloadAssets(input, root, {platform: 'linux', env: {}, concurrency: 8, fetch: () => assert.fail('Verified cache reached network')});
  assert.equal(second.summary.cached, 6);
  assert.equal(second.summary.failed.length, 0);
  assert.deepEqual(second.manifest.assets.map(row => row.sha256), first.manifest.assets.map(row => row.sha256));
});
