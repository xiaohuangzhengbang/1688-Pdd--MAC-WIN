import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const DEFAULT_OUTPUT_NAME = '图文预览.html';
const groups = ['mainImages', 'detailImages', 'videos'];
const groupLabel = { mainImages: '图库', detailImages: '详情图', videos: '视频' };
// Node 22 does not expose this Darwin flag, but passes numeric open flags to
// the kernel. Unlike O_NOFOLLOW, it atomically rejects every path symlink.
// Apple definition: https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/fcntl.h
const noFollowAny = constants.O_NOFOLLOW_ANY ?? (process.platform === 'darwin' ? 0x20000000 : 0);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

// This script has no product data interpolated into JavaScript. All product
// values are escaped HTML text or validated local paths in the surrounding DOM.
export const CLIENT_SCRIPT = `
const message = document.getElementById('message');
document.getElementById('copy-text').addEventListener('click', async () => {
  const field = document.getElementById('description');
  try {
    await navigator.clipboard.writeText(field.value);
    message.textContent = '商品描述已复制';
  } catch {
    field.focus(); field.select();
    message.textContent = document.execCommand('copy') ? '商品描述已复制' : '文字已选中，请按 Command+C 复制';
  }
});
for (const button of document.querySelectorAll('[data-image]')) {
  button.addEventListener('click', async () => {
    const img = document.getElementById(button.dataset.image);
    button.disabled = true;
    try {
      const png = (async () => {
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context || !canvas.width || !canvas.height) throw new Error('Cannot prepare image');
        context.drawImage(img, 0, 0);
        return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Cannot prepare image')), 'image/png'));
      })();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      message.textContent = img.alt + '已复制';
    } catch {
      message.textContent = '请右键这张图片，选择“复制图片”';
      img.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } finally { button.disabled = false; }
  });
}
`;

function offerIdFromUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid product source URL'); }
  const id = url.pathname.match(/^\/offer\/(\d{1,30})\.html$/)?.[1];
  if (!id || url.protocol !== 'https:' || url.hostname !== 'detail.1688.com' || url.port || url.username || url.password) throw new Error('Invalid product source URL');
  return id;
}

async function outputRoot(directory) {
  if (!noFollowAny) throw new Error('Secure preview generation and serving currently require macOS; Windows/Linux preview is unsupported');
  const root = resolve(directory);
  const info = await lstat(root);
  if (info.isSymbolicLink()) throw new Error('Output root must not be a symbolic link');
  if (!info.isDirectory()) throw new Error('Output root must be a directory');
  return await realpath(root);
}

async function readContained(root, filename) {
  const parts = filename.split('/');
  let expectedFile;
  for (let index = 0; index < parts.length; index++) {
    const info = await lstat(join(root, ...parts.slice(0, index + 1)), { bigint: true });
    if (info.isSymbolicLink()) throw new Error('Symbolic links are not allowed');
    if (index < parts.length - 1 && !info.isDirectory()) throw new Error('Media group must be a directory');
    if (index === parts.length - 1 && !info.isFile()) throw new Error('Expected a regular file');
    if (index === parts.length - 1) expectedFile = info;
  }
  const path = join(root, ...parts);
  const actual = await realpath(path);
  const within = relative(root, actual);
  if (within === '..' || within.startsWith(`..${sep}`) || resolve(root, within) !== actual) throw new Error('File escapes the output root');
  const handle = await open(path, constants.O_RDONLY | noFollowAny);
  try {
    const openedFile = await handle.stat({ bigint: true });
    if (!openedFile.isFile()) throw new Error('Expected a regular file');
    if (openedFile.dev !== expectedFile.dev || openedFile.ino !== expectedFile.ino) throw new Error('File changed between validation and open');
    return await handle.readFile();
  } finally { await handle.close(); }
}

function mediaType(bytes, video) {
  if (bytes.length <= 32) throw new Error('Invalid media signature');
  if (video) {
    let offset = 0;
    const found = new Set();
    while (offset + 8 <= bytes.length) {
      let size = bytes.readUInt32BE(offset);
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      let header = 8;
      if (size === 1) {
        if (offset + 16 > bytes.length) throw new Error('Invalid MP4 signature');
        const wideSize = bytes.readBigUInt64BE(offset + 8);
        if (wideSize > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid MP4 signature');
        size = Number(wideSize); header = 16;
      } else if (size === 0) size = bytes.length - offset;
      if (size < header || size > bytes.length - offset || (offset === 0 && type !== 'ftyp')) throw new Error('Invalid MP4 signature');
      found.add(type); offset += size;
    }
    if (offset !== bytes.length || !['ftyp', 'moov', 'mdat'].every(type => found.has(type))) throw new Error('Invalid MP4 signature');
    return 'video/mp4';
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'image/gif';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new Error('Invalid image signature');
}

function safeMediaPath(row) {
  if (!groups.includes(row.group) || typeof row.file !== 'string') return false;
  const pattern = row.group === 'videos' ? /^[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$/i : /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|gif|webp)$/i;
  const parts = row.file.split('/');
  return parts.length === 2 && parts[0] === row.group && !parts[1].includes('..') && pattern.test(parts[1]);
}

function cleanDescription(markdown, canonicalUrl) {
  const unrelated = /^(?:我的1688|1688采购助手|官方插件.*|账号(?:余额|信息|设置).*|账户(?:余额|信息|设置).*|会员中心|我的订单|采购车|立即下单|加采购车|跨境铺货|收藏|客服|APP|复制链接|顶部|反馈|采集此商品|清除缓存|停用插件|切换为侧边栏模式)$/i;
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n').map(line => {
    let text = line.trim().replace(/^#{1,6}\s+/, '').replace(/\*\*([^]*?)\*\*/g, '$1').replace(/__([^]*?)__/g, '$1');
    text = text.replace(/\[([^\]]+)\]\(([^)]*)\)/g, (_, label, url) => {
      try { return offerIdFromUrl(url) === offerIdFromUrl(canonicalUrl) ? `${label}：${canonicalUrl}` : label; }
      catch { return label; }
    });
    if (unrelated.test(text) || /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(text)) return null;
    if (text.startsWith('|') && text.endsWith('|')) text = text.slice(1, -1).split('|').map(cell => cell.trim()).join(' · ');
    return text;
  }).filter(line => line !== null);
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.includes(canonicalUrl) ? text : `${text}${text ? '\n\n' : ''}商品链接：${canonicalUrl}`;
}

function diagnostic(value) {
  // Download URLs can carry short-lived credentials; failure text only needs
  // the origin/path, never a signed query string or URL user information.
  return String(value ?? '').replace(/https?:\/\/[^\s<>"']+/g, match => {
    try { const url = new URL(match); return `${url.origin}${url.pathname}`; } catch { return '[URL]'; }
  }).slice(0, 1000);
}

function unresolvedWarning(value, counts) {
  const text = diagnostic(value);
  if (/detail images? not (?:loaded|found)|详情图(?:未加载|未找到)/i.test(text)) return counts.detailImages ? null : '详情图未加载';
  if (/videos? not (?:loaded|found)|未找到.*视频/i.test(text)) return counts.videos ? null : '未找到商品视频';
  if (/^(?:main )?images? not (?:loaded|found)$/i.test(text)) return counts.mainImages + counts.detailImages ? null : '未找到商品图片';
  return text || null;
}

export async function loadProduct(directory) {
  const root = await outputRoot(directory);
  const source = JSON.parse((await readContained(root, 'source.json')).toString('utf8'));
  const manifest = JSON.parse((await readContained(root, 'assets-manifest.json')).toString('utf8'));
  const offerId = offerIdFromUrl(source?.url);
  if ((source.offerId != null && String(source.offerId) !== offerId) || String(manifest?.offerId) !== offerId || (manifest.sourceUrl != null && offerIdFromUrl(manifest.sourceUrl) !== offerId)) throw new Error('Source and manifest offer ID mismatch');
  if (!Array.isArray(manifest.assets)) throw new Error('Manifest assets must be an array');
  const canonicalUrl = `https://detail.1688.com/offer/${offerId}.html`;
  const warnings = [];
  let markdown = '';
  try { markdown = (await readContained(root, '商品描述.md')).toString('utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    warnings.push('商品描述.md 不存在，尚未整理商品描述');
  }
  if (!markdown.trim() && !warnings.length) warnings.push('商品描述为空，尚未整理商品描述');
  const title = String(source.title || `商品 ${offerId}`).replace(/\s*[-–—|]\s*阿里巴巴\s*$/, '').trim();
  const description = cleanDescription(markdown.trim() ? markdown : title, canonicalUrl);
  const currentUrls = Object.fromEntries(groups.map(group => [group, new Set(Array.isArray(source[group]) ? source[group].filter(url => typeof url === 'string') : [])]));
  const media = [];
  const usedFiles = new Set();
  for (const row of manifest.assets) {
    if (!row || typeof row !== 'object') { warnings.push('清单中存在无效媒体记录'); continue; }
    if (!groups.includes(row.group)) { warnings.push('清单中存在未知媒体分组'); continue; }
    if (!currentUrls[row.group].has(row.url)) continue;
    if (row.status === 'failed') { warnings.push(`${groupLabel[row.group]}下载失败：${diagnostic(row.error || '原因未知')}`); continue; }
    if (!['downloaded', 'cached'].includes(row.status)) continue;
    if (!safeMediaPath(row)) { warnings.push(`${groupLabel[row.group]}文件路径无效`); continue; }
    if (usedFiles.has(row.file)) continue;
    try {
      const bytes = await readContained(root, row.file);
      const type = mediaType(bytes, row.group === 'videos');
      if (row.bytes != null && (!Number.isSafeInteger(row.bytes) || row.bytes !== bytes.length)) throw new Error('Media size differs from the current manifest');
      if (row.sha256 != null && (!/^[a-f0-9]{64}$/i.test(row.sha256) || createHash('sha256').update(bytes).digest('hex') !== row.sha256.toLowerCase())) throw new Error('Media hash differs from the current manifest');
      usedFiles.add(row.file);
      media.push({ group: row.group, file: row.file, type, bytes });
    } catch (error) { warnings.push(`${groupLabel[row.group]}不可用：${diagnostic(error.code === 'ENOENT' ? '清单文件不存在' : error.message)}`); }
  }
  const counts = Object.fromEntries(groups.map(group => [group, media.filter(item => item.group === group).length]));
  for (const value of [...(Array.isArray(source.warnings) ? source.warnings : []), ...(Array.isArray(manifest.warnings) ? manifest.warnings : [])]) {
    const warning = unresolvedWarning(value, counts);
    if (warning) warnings.push(warning);
  }
  if (!counts.mainImages && !counts.detailImages) warnings.push('未采集到可用商品图片');
  if (!counts.videos) warnings.push('未采集到可用 MP4 视频');
  return { root, offerId, canonicalUrl, title, description, media, counts, warnings: [...new Set(warnings)] };
}

export function renderPreview(product) {
  if (!Array.isArray(product.media) || product.media.some(item => !item || !safeMediaPath(item))) throw new Error('Invalid preview media path');
  const counts = Object.fromEntries(groups.map(group => [group, product.media.filter(item => item.group === group).length]));
  const images = product.media.filter(item => item.group !== 'videos');
  const videos = product.media.filter(item => item.group === 'videos');
  const warnings = product.warnings.length ? `<section class="warnings" aria-label="采集未完成项"><h2>采集未完成项</h2><ul>${product.warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></section>` : '';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(product.title)} · 素材</title>
<style>
:root{color-scheme:light dark;--bg:light-dark(#fff,#181a1d);--fg:light-dark(#20252b,#f0f1f3);--muted:light-dark(#626b75,#adb4be);--line:light-dark(#e0e4e8,#383d43);--accent:light-dark(#2167cc,#85b4ff)}*{box-sizing:border-box}body{margin:0;padding:24px;font:15px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;background:var(--bg);color:var(--fg)}h1{font-size:22px;line-height:1.4;margin:0 0 8px;overflow-wrap:anywhere}h2{font-size:17px;margin:26px 0 10px}.status{color:var(--muted);font-size:13px;margin:0 0 20px}button{font:inherit;color:var(--fg);background:transparent;border:1px solid var(--line);border-radius:8px;padding:7px 13px;cursor:pointer}button:hover{border-color:var(--accent)}button:focus-visible,textarea:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}button:disabled{opacity:.6;cursor:wait}textarea{display:block;width:100%;height:390px;resize:vertical;margin-top:12px;padding:14px;border:1px solid var(--line);border-radius:8px;font:14px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:var(--fg);background:var(--bg)}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px 14px}figure{margin:0;min-width:0}figure img{display:block;width:100%;height:240px;object-fit:contain;background:var(--bg)}figcaption{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:8px;font-size:13px;color:var(--muted)}figcaption button{font-size:13px;padding:4px 9px}a{color:var(--accent)}#message{font-size:13px;min-height:22px;margin:6px 0;color:var(--muted)}video{display:block;width:100%;max-height:420px;background:#111}.warnings{border:1px solid var(--line);border-radius:8px;padding:0 14px 12px;margin-top:20px;overflow-wrap:anywhere}.warnings h2{margin-top:12px}.warnings ul{padding-left:20px;margin-bottom:0}@media(max-width:380px){body{padding:16px}.grid{grid-template-columns:1fr}figure img{height:auto;max-height:500px}}
</style></head><body>
<h1>${escapeHtml(product.title)}</h1>
<p class="status">图库 ${counts.mainImages} 张 · 详情图 ${counts.detailImages} 张 · MP4 视频 ${counts.videos} 个</p>
${videos.length ? `<section aria-label="商品视频"><h2>商品视频</h2>${videos.map((item, index) => `<video controls playsinline preload="metadata" src="${escapeHtml(item.file)}" aria-label="商品视频 ${index + 1}"></video><p><a href="${escapeHtml(item.file)}" download="${escapeHtml(product.offerId)}-${index + 1}.mp4">保存视频${videos.length > 1 ? ` ${index + 1}` : ''}</a></p>`).join('')}</section>` : ''}
<section aria-label="商品描述"><h2>商品描述</h2><button type="button" id="copy-text">复制商品描述</button><div id="message" role="status" aria-live="polite"></div><textarea id="description" aria-label="可复制或编辑的商品描述">${escapeHtml(product.description)}</textarea></section>
${images.length ? `<section aria-label="商品图片"><h2>商品图片</h2><div class="grid">${images.map((item, index) => `<figure><a href="${escapeHtml(item.file)}" target="_blank" rel="noopener"><img src="${escapeHtml(item.file)}" alt="${groupLabel[item.group]} ${index + 1}" id="image-${index + 1}" loading="lazy"></a><figcaption>${groupLabel[item.group]} ${index + 1}<button type="button" data-image="image-${index + 1}">复制图片</button></figcaption></figure>`).join('')}</div></section>` : ''}
${warnings}
<script>${CLIENT_SCRIPT}</script>
</body></html>
`;
}

function validOutputName(outputName) {
  if (typeof outputName !== 'string' || basename(outputName) !== outputName || outputName.includes('\\') || outputName.includes('..') || /[\x00-\x1f]/.test(outputName) || !outputName.endsWith('.html') || outputName.startsWith('.')) throw new Error('Invalid preview output name');
  return outputName;
}

export async function createPreview(directory, { outputName = DEFAULT_OUTPUT_NAME } = {}) {
  validOutputName(outputName);
  const product = await loadProduct(directory);
  const previewPath = join(product.root, outputName);
  try {
    if ((await lstat(previewPath)).isSymbolicLink()) throw new Error('Preview output must not be a symbolic link');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const html = renderPreview(product);
  const handle = await open(previewPath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollowAny, 0o600);
  try { await handle.writeFile(html, 'utf8'); } finally { await handle.close(); }
  return { offerId: product.offerId, previewPath, counts: product.counts, warnings: product.warnings, html, product };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('Usage: node work/create-preview.mjs <product-output-dir> [preview-name.html]');
    const { offerId, previewPath, counts, warnings } = await createPreview(process.argv[2], { outputName: process.argv[3] || DEFAULT_OUTPUT_NAME });
    console.log(JSON.stringify({ offerId, previewPath, counts, warnings }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
