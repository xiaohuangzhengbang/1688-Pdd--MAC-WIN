import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {approveAssetUrl, downloadDomesticVideo, useDomesticTransport} from './domestic-download.mjs';

export async function downloadAssets(inputPath, outputDirectory, {
  platform = process.platform, env = process.env, fetch: fetchAsset = globalThis.fetch, domesticDownload = downloadDomesticVideo,
} = {}) {
  if (!inputPath) throw new Error('Usage: node work/download-assets.mjs <source.json> [output-root]');
  const sourcePath = resolve(inputPath);
  const source = JSON.parse(await readFile(sourcePath, 'utf8'));
  const offerId = new URL(source.url).pathname.match(/\/offer\/(\d+)\.html/)?.[1];
  if (!offerId) throw new Error('Invalid product source URL');
  const outputRoot = outputDirectory ? resolve(outputDirectory) : resolve(dirname(fileURLToPath(import.meta.url)), '../outputs');
  const base = resolve(outputRoot, offerId);
  await mkdir(base, {recursive: true});
  const manifestPath = join(base, 'assets-manifest.json');
  let previous = [];
  try { previous = JSON.parse(await readFile(manifestPath, 'utf8')).assets; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const validate = (bytes, video) => {
    if (video) return bytes.length > 32 && bytes.toString('ascii', 4, 8) === 'ftyp' && bytes.includes(Buffer.from('moov')) && bytes.includes(Buffer.from('mdat'));
    return bytes.length > 32 && (bytes.subarray(0, 3).equals(Buffer.from([255,216,255])) || bytes.toString('ascii', 1, 4) === 'PNG' || bytes.toString('ascii', 0, 3) === 'GIF' || (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'));
  };
  const jobs = ['mainImages', 'detailImages', 'videos'].flatMap(group => [...new Set(source[group] || [])].map((url, index) => ({group, url, index})));
  const results = new Array(jobs.length);
  let cursor = 0;
  const started = Date.now();
  await Promise.all(Array.from({length: 4}, async () => {
    while (cursor < jobs.length) {
      const slot = cursor++, job = jobs[slot];
      const row = {group: job.group, url: job.url};
      try {
        const url = new URL(approveAssetUrl(job.url));
        const video = job.group === 'videos';
        const ext = video ? '.mp4' : url.pathname.match(/\.(webp|png|gif|jpe?g)$/i)?.[0] || '.jpg';
        row.file = `${job.group}/${String(job.index + 1).padStart(2, '0')}${ext}`;
        const target = join(base, row.file);
        await mkdir(dirname(target), {recursive: true});
        const old = previous.find(r => r.url === row.url && r.file === row.file && r.sha256);
        if (old) {
          try {
            const bytes = await readFile(target);
            if (digest(bytes) === old.sha256 && validate(bytes, video)) {
              results[slot] = {...old, status: 'cached'};
              continue;
            }
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        let bytes;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const mappedUrl = video && source.videoResolvedUrls?.[job.url];
            const downloadUrl = approveAssetUrl(mappedUrl || job.url);
            if (useDomesticTransport(video, {platform, env})) {
              const response = await domesticDownload(downloadUrl, {referer: source.url, platform, env});
              bytes = response.bytes;
              row.transport = {...response.transport, resolvedFromBrowser: Boolean(mappedUrl)};
            } else {
              const response = await fetchAsset(downloadUrl, {signal: AbortSignal.timeout(60000), headers: {Referer: source.url}});
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              bytes = Buffer.from(await response.arrayBuffer());
              row.transport = {kind: 'node-fetch', resolvedFromBrowser: Boolean(mappedUrl)};
            }
            if (!validate(bytes, video)) throw new Error('Invalid media bytes; HTML/errors and unsupported video formats are not saved');
            break;
          } catch (error) { if (attempt === 2) throw error; }
        }
        await writeFile(`${target}.part`, bytes);
        await rename(`${target}.part`, target);
        Object.assign(row, {bytes: bytes.length, sha256: digest(bytes), status: 'downloaded'});
      } catch (error) { Object.assign(row, {status: 'failed', error: String(error.message || error).replace(/https?:\/\/\S+/gi, '[asset URL]')}); }
      results[slot] = row;
    }
  }));
  await writeFile(join(base, '页面原文.txt'), source.text || '', 'utf8');
  const manifest = {offerId, sourceUrl: source.url, capturedAt: source.capturedAt, completedAt: new Date().toISOString(), elapsedMs: Date.now() - started, warnings: source.warnings || [], assets: results};
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  const summary = {offerId, elapsedMs: manifest.elapsedMs, downloaded: results.filter(r => r.status === 'downloaded').length, cached: results.filter(r => r.status === 'cached').length, failed: results.filter(r => r.status === 'failed').map(({group, file, error}) => ({group, file, error})), manifestPath};
  return {manifest, summary};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {summary} = await downloadAssets(process.argv[2], process.argv[3]);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed.length) process.exitCode = 1;
}
