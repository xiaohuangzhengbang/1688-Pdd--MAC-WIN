import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile, readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const api = await import('./domestic-download.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const downloaderApi = await import('./download-assets.mjs').catch(error => {
  if (/Usage:/.test(error.message)) return {};
  throw error;
});
const fn = name => {
  assert.equal(typeof api[name], 'function', `Missing domestic download behavior: ${name}`);
  return api[name];
};

test('public IPv4 validation excludes fake IPs, private networks and reserved addresses', () => {
  const isPublicIPv4 = fn('isPublicIPv4');
  for (const address of ['223.5.5.5', '1.1.1.1', '119.29.29.29']) assert.equal(isPublicIPv4(address), true, address);
  for (const address of ['198.18.0.1', '198.19.255.255', '10.0.0.1', '172.16.0.1', '192.168.1.1', '100.64.0.1', '127.0.0.1', '169.254.1.1', '0.0.0.0', '224.1.1.1', '255.255.255.255', '192.0.2.1', '198.51.100.1', '203.0.113.1', '::1', '1.2.3.256', '001.2.3.4']) assert.equal(isPublicIPv4(address), false, address);
});

test('only approved HTTPS asset URLs can be downloaded, without rewriting signed query strings', () => {
  const approveAssetUrl = fn('approveAssetUrl');
  const signed = 'https://caiyuanbao.alicdn.com/video.mp4?signature=a%2Bb%2Fc&empty=&order=2&order=1';
  assert.equal(approveAssetUrl(signed), signed);
  for (const url of ['http://caiyuanbao.alicdn.com/a.mp4', 'https://alicdn.com.evil.example/a.mp4', 'https://198.18.0.1/a.mp4', 'https://user:pass@caiyuanbao.alicdn.com/a.mp4', 'https://caiyuanbao.alicdn.com:8443/a.mp4']) assert.throws(() => approveAssetUrl(url), /Unapproved/);
});

test('Mac videos select domestic transport and other platforms require an explicit opt-in', () => {
  const useDomesticTransport = fn('useDomesticTransport');
  assert.equal(useDomesticTransport(true, {platform: 'darwin', env: {}}), true);
  assert.equal(useDomesticTransport(false, {platform: 'darwin', env: {}}), false);
  assert.equal(useDomesticTransport(true, {platform: 'linux', env: {}}), false);
  assert.equal(useDomesticTransport(true, {platform: 'linux', env: {ASSET_DOMESTIC_DOWNLOAD: '1'}}), true);
});

test('physical interface discovery refuses a tunnel default route', async () => {
  const discoverDirectInterface = fn('discoverDirectInterface');
  assert.equal(await discoverDirectInterface({platform: 'darwin', env: {}, runCommand: async () => ({stdout: 'route to: default\n  interface: en0\n'})}), 'en0');
  await assert.rejects(discoverDirectInterface({platform: 'darwin', env: {}, runCommand: async () => ({stdout: 'interface: utun1024\n'})}), /physical interface/);
  await assert.rejects(discoverDirectInterface({platform: 'darwin', env: {ASSET_DIRECT_INTERFACE: 'utun1'}}), /physical interface/);
  assert.equal(await discoverDirectInterface({platform: 'darwin', env: {ASSET_DIRECT_INTERFACE: 'en1'}}), 'en1');
});

const videoBytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(32), Buffer.from('moovmdat')]);
const dnsUrl = hostname => `https://dns.alidns.com/resolve?name=${hostname}&type=A`;
const dnsBody = addresses => Buffer.from(JSON.stringify({Status: 0, Answer: addresses.map(data => ({name: 'caiyuanbao.alicdn.com.', type: 1, TTL: 30, data}))}));
const signedUrl = 'https://caiyuanbao.alicdn.com/video.mp4?signature=a%2Bb%2Fc&empty=&order=2&order=1';

function curlScenario(steps) {
  let cursor = 0;
  return async (command, args, options) => {
    const step = steps[cursor++];
    assert.ok(step, 'Unexpected network request or fallback');
    assert.equal(command, 'curl');
    assert.equal(args[0], '--disable', 'User curl configuration must not alter routing or TLS');
    const value = option => args[args.indexOf(option) + 1];
    assert.equal(value('--url'), step.url, 'Signed URL must remain exact');
    assert.equal(value('--interface'), 'en0');
    assert.equal(value('--noproxy'), '*');
    assert.equal(value('--resolve'), step.resolve);
    assert.equal(value('--proto'), '=https');
    assert.equal(args.includes('--location'), false, 'Redirects require new host approval and DNS pinning');
    assert.equal(args.includes('--insecure'), false);
    assert.ok(Number(value('--max-time')) > 0 && Number(value('--max-time')) <= 60);
    assert.ok(options.timeout > 0 && options.timeout <= 61000);
    if (step.error) throw Object.assign(new Error('TLS failed with private signed query'), {code: 60});
    await writeFile(value('--output'), step.body || Buffer.alloc(0));
    await writeFile(value('--dump-header'), `HTTP/1.1 ${step.status || 200} Test\r\n${step.location ? `Location: ${step.location}\r\n` : ''}\r\n`);
    return {stdout: `${step.status || 200}\n${step.sslVerify || 0}\n${step.remoteIp || step.resolve.split(':').at(-1)}\n`, stderr: ''};
  };
}

const options = steps => ({env: {ASSET_DIRECT_INTERFACE: 'en0'}, platform: 'darwin', runCommand: curlScenario(steps)});
const dnsStep = (hostname = 'caiyuanbao.alicdn.com', addresses = ['1.1.1.1']) => ({url: dnsUrl(hostname), resolve: 'dns.alidns.com:443:223.5.5.5', body: dnsBody(addresses)});

test('domestic video download pins live DNS and preserves the signed URL with verified TLS', async () => {
  const downloadDomesticVideo = fn('downloadDomesticVideo');
  const result = await downloadDomesticVideo(signedUrl, options([
    dnsStep(), {url: signedUrl, resolve: 'caiyuanbao.alicdn.com:443:1.1.1.1', body: videoBytes},
  ]));
  assert.deepEqual(result.bytes, videoBytes);
  assert.equal(result.transport.kind, 'domestic-direct');
  assert.equal(result.transport.interface, 'en0');
  assert.equal(result.transport.remoteIp, '1.1.1.1');
  assert.equal(result.transport.finalHost, 'caiyuanbao.alicdn.com');
});

test('fake-IP DNS answers stop before connecting to the asset host', async () => {
  await assert.rejects(fn('downloadDomesticVideo')(signedUrl, options([dnsStep('caiyuanbao.alicdn.com', ['198.18.0.1', '1.1.1.1'])])), /public IPv4/);
});

test('an approved redirect resolves its own host and preserves its query', async () => {
  const destination = 'https://cloud.video.taobao.com/next.mp4?signature=p%2Bq';
  const result = await fn('downloadDomesticVideo')(signedUrl, options([
    dnsStep(), {url: signedUrl, resolve: 'caiyuanbao.alicdn.com:443:1.1.1.1', status: 302, location: destination},
    dnsStep('cloud.video.taobao.com', ['119.29.29.29']), {url: destination, resolve: 'cloud.video.taobao.com:443:119.29.29.29', body: videoBytes},
  ]));
  assert.deepEqual(result.bytes, videoBytes);
  assert.equal(result.transport.finalHost, 'cloud.video.taobao.com');
});

test('unapproved and insecure redirects stop before another network request', async () => {
  for (const location of ['https://evil.example/video.mp4', 'http://caiyuanbao.alicdn.com/video.mp4', 'https://127.0.0.1/video.mp4']) {
    await assert.rejects(fn('downloadDomesticVideo')(signedUrl, options([
      dnsStep(), {url: signedUrl, resolve: 'caiyuanbao.alicdn.com:443:1.1.1.1', status: 302, location},
    ])), /Unapproved/);
  }
});

test('TLS failure is reported without leaking the signed URL or falling back', async () => {
  await assert.rejects(fn('downloadDomesticVideo')(signedUrl, options([
    dnsStep(), {url: signedUrl, resolve: 'caiyuanbao.alicdn.com:443:1.1.1.1', error: true},
  ])), error => /curl.*60/.test(error.message) && !/signature|private signed/.test(error.message));
});

test('successful HTTP responses containing HTML are rejected as invalid video', async () => {
  await assert.rejects(fn('downloadDomesticVideo')(signedUrl, options([
    dnsStep(), {url: signedUrl, resolve: 'caiyuanbao.alicdn.com:443:1.1.1.1', body: Buffer.from('<html>Not a playable video</html>')},
  ])), /Invalid.*video/);
});

test('redirect loops terminate at the configured limit', async () => {
  const steps = Array.from({length: 4}, () => [dnsStep(), {url: signedUrl, resolve: 'caiyuanbao.alicdn.com:443:1.1.1.1', status: 302, location: signedUrl}]).flat();
  await assert.rejects(fn('downloadDomesticVideo')(signedUrl, options(steps)), /redirect limit/);
});

test('an invalid timeout is rejected before network execution', async () => {
  await assert.rejects(fn('downloadDomesticVideo')(signedUrl, {...options([]), timeoutMs: 0}), /timeout/);
});

test('unverified TLS and a different connected IP reject the pinned response', async () => {
  for (const evidence of [{sslVerify: 18}, {remoteIp: '198.18.0.1'}]) {
    await assert.rejects(fn('downloadDomesticVideo')(signedUrl, options([
      dnsStep(), {url: signedUrl, resolve: 'caiyuanbao.alicdn.com:443:1.1.1.1', body: videoBytes, ...evidence},
    ])), /verification failed/);
  }
});

test('control characters in approved URLs are rejected before network execution', async () => {
  await assert.rejects(fn('downloadDomesticVideo')('https://caiyuanbao.alicdn.com/video.mp4?sig=a\nb', options([])), /Unapproved/);
});

async function withProduct(run) {
  const directory = await mkdtemp(join(tmpdir(), '1688-downloader-test-'));
  const sourcePath = join(directory, 'source.json');
  const source = {url: 'https://detail.1688.com/offer/1234567890.html', capturedAt: '2026-10-12T00:00:00.000Z', videos: [signedUrl], text: 'Visible product text'};
  await writeFile(sourcePath, JSON.stringify(source));
  try { await run({directory, sourcePath, source}); }
  finally { await rm(directory, {recursive: true, force: true}); }
}

function downloader() {
  assert.equal(typeof downloaderApi.downloadAssets, 'function', 'Downloader must be safe to import and expose its download operation');
  return downloaderApi.downloadAssets;
}

test('Mac integration uses domestic videos and preserves SHA256 cache hits without networking', async () => {
  await withProduct(async ({directory, sourcePath}) => {
    const run = downloader();
    const result = await run(sourcePath, directory, {platform: 'darwin', env: {}, domesticDownload: async url => {
      assert.equal(url, signedUrl);
      return {bytes: videoBytes, transport: {kind: 'domestic-direct', interface: 'en0'}};
    }, fetch: async () => { throw new Error('Unexpected global fetch'); }});
    assert.equal(result.manifest.assets[0].status, 'downloaded');
    assert.equal(result.manifest.assets[0].url, signedUrl);
    assert.equal(result.manifest.assets[0].transport.kind, 'domestic-direct');
    assert.deepEqual(await readFile(join(directory, '1234567890/videos/01.mp4')), videoBytes);
    const cached = await run(sourcePath, directory, {platform: 'darwin', env: {}, domesticDownload: async () => { throw new Error('Unexpected download of cached bytes'); }});
    assert.equal(cached.manifest.assets[0].status, 'cached');
    assert.equal(cached.manifest.assets[0].sha256, result.manifest.assets[0].sha256);
  });
});

test('fresh browser URL mapping preserves the original source identity in the manifest', async () => {
  await withProduct(async ({directory, sourcePath, source}) => {
    const fresh = 'https://caiyuanbao.alicdn.com/fresh.mp4?signature=new%2Bvalue';
    source.videoResolvedUrls = {[signedUrl]: fresh};
    await writeFile(sourcePath, JSON.stringify(source));
    const result = await downloader()(sourcePath, directory, {platform: 'darwin', env: {}, domesticDownload: async url => {
      assert.equal(url, fresh);
      return {bytes: videoBytes, transport: {kind: 'domestic-direct'}};
    }});
    assert.equal(result.manifest.assets[0].url, signedUrl);
    assert.equal(result.manifest.assets[0].transport.resolvedFromBrowser, true);
  });
});

test('failed domestic attempts retain the two-attempt retry limit without global fetch fallback', async () => {
  await withProduct(async ({directory, sourcePath}) => {
    let attempts = 0;
    const result = await downloader()(sourcePath, directory, {platform: 'darwin', env: {}, domesticDownload: async () => {
      attempts++;
      throw new Error('Direct transport unavailable');
    }, fetch: async () => { throw new Error('Unexpected fallback'); }});
    assert.equal(attempts, 2);
    assert.equal(result.manifest.assets[0].status, 'failed');
    assert.equal(result.summary.failed[0].error, 'Direct transport unavailable');
    assert.equal('url' in result.summary.failed[0], false, 'CLI summary must not expose signed queries');
  });
});

test('non-Mac integration retains fetch unless domestic download is explicitly requested', async () => {
  await withProduct(async ({directory, sourcePath}) => {
    const result = await downloader()(sourcePath, directory, {platform: 'linux', env: {}, fetch: async url => {
      assert.equal(String(url), signedUrl);
      return {ok: true, arrayBuffer: async () => videoBytes};
    }, domesticDownload: async () => { throw new Error('Unexpected domestic mode'); }});
    assert.equal(result.manifest.assets[0].status, 'downloaded');
    assert.equal(result.manifest.assets[0].transport.kind, 'node-fetch');
  });
});

test('unsafe fresh browser mappings are rejected before any download', async () => {
  await withProduct(async ({directory, sourcePath, source}) => {
    source.videoResolvedUrls = {[signedUrl]: 'https://evil.example/video.mp4'};
    await writeFile(sourcePath, JSON.stringify(source));
    const result = await downloader()(sourcePath, directory, {platform: 'darwin', env: {}, domesticDownload: async () => { assert.fail('Unsafe mapping reached transport'); }});
    assert.equal(result.manifest.assets[0].status, 'failed');
    assert.match(result.manifest.assets[0].error, /Unapproved/);
  });
});

test('failure summaries redact signed URLs even when a network dependency includes them', async () => {
  await withProduct(async ({directory, sourcePath}) => {
    const result = await downloader()(sourcePath, directory, {platform: 'darwin', env: {}, domesticDownload: async () => { throw new Error(`Unable to download ${signedUrl}`); }});
    assert.doesNotMatch(JSON.stringify(result.summary), /signature|a%2Bb/);
    assert.match(result.summary.failed[0].error, /Unable to download/);
  });
});
