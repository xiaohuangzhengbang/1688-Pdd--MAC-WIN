import {readFile, writeFile, mkdir, rename, stat} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const sourcePath = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node work/download-assets.mjs outputs/<offerId>/source.json');
const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const offerId = new URL(source.url).pathname.match(/\/offer\/(\d+)\.html/)?.[1];
if (!offerId) throw new Error('Invalid product source URL');
const base = resolve(dirname(fileURLToPath(import.meta.url)), '../outputs', offerId);
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
      const url = new URL(job.url);
      if (url.protocol !== 'https:' || !/(^|\.)(alicdn\.com|taobao\.com|1688\.com)$/.test(url.hostname)) throw new Error('Unapproved asset host');
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
          const response = await fetch(url, {signal: AbortSignal.timeout(60000), headers: {Referer: source.url}});
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          bytes = Buffer.from(await response.arrayBuffer());
          if (!validate(bytes, video)) throw new Error('Invalid media bytes; HTML/errors and unsupported video formats are not saved');
          break;
        } catch (error) { if (attempt === 2) throw error; }
      }
      await writeFile(`${target}.part`, bytes);
      await rename(`${target}.part`, target);
      Object.assign(row, {bytes: bytes.length, sha256: digest(bytes), status: 'downloaded'});
    } catch (error) { Object.assign(row, {status: 'failed', error: error.message}); }
    results[slot] = row;
  }
}));
await writeFile(join(base, '页面原文.txt'), source.text || '', 'utf8');
const manifest = {offerId, sourceUrl: source.url, capturedAt: source.capturedAt, completedAt: new Date().toISOString(), elapsedMs: Date.now() - started, warnings: source.warnings || [], assets: results};
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({offerId, elapsedMs: manifest.elapsedMs, downloaded: results.filter(r => r.status === 'downloaded').length, cached: results.filter(r => r.status === 'cached').length, failed: results.filter(r => r.status === 'failed'), manifestPath}, null, 2));
if (results.some(r => r.status === 'failed')) process.exitCode = 1;
