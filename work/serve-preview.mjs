import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIENT_SCRIPT, createPreview, DEFAULT_OUTPUT_NAME } from './create-preview.mjs';

function requestPath(target) {
  if (typeof target !== 'string' || !target.startsWith('/') || target.includes('?') || target.includes('#') || target.includes('\\') || /%2f|%5c/i.test(target) || target.includes('//')) return null;
  try {
    const decoded = decodeURIComponent(target);
    if (decoded.includes('\\') || decoded.split('/').some(part => part === '.' || part === '..')) return null;
    return decoded;
  } catch { return null; }
}

function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
    end = Math.min(size - 1, end);
  }
  return { start, end };
}

export async function startServer(directory, { port = 0, outputName = DEFAULT_OUTPUT_NAME } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid preview port');
  const { offerId, product, html, previewPath, warnings } = await createPreview(directory, { outputName });
  // Serve validated in-memory snapshots. A file/directory later changed into a
  // symlink cannot make the already-running endpoint read anything else.
  const preview = { bytes: Buffer.from(html), type: 'text/html; charset=utf-8' };
  const routes = new Map([['/', preview], [`/${outputName}`, preview], ...product.media.map(item => [`/${item.file}`, item])]);
  const scriptHash = createHash('sha256').update(CLIENT_SCRIPT).digest('base64');
  const security = {
    'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; img-src 'self'; media-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  };
  let expectedHost;
  const server = createServer((req, res) => {
    const finish = (status, headers = {}, bytes = Buffer.alloc(0)) => {
      res.writeHead(status, { ...security, 'Content-Length': bytes.length, ...headers });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    };
    if (req.headers.host !== expectedHost) return finish(403);
    if (!['GET', 'HEAD'].includes(req.method)) return finish(405, { Allow: 'GET, HEAD' });
    const path = requestPath(req.url);
    const item = path == null ? undefined : routes.get(path);
    if (!item) return finish(404);
    const headers = { 'Content-Type': item.type };
    if (item.type === 'video/mp4') {
      headers['Accept-Ranges'] = 'bytes';
      if (req.headers.range != null) {
        const range = byteRange(req.headers.range, item.bytes.length);
        if (!range) return finish(416, { ...headers, 'Content-Range': `bytes */${item.bytes.length}` });
        headers['Content-Range'] = `bytes ${range.start}-${range.end}/${item.bytes.length}`;
        return finish(206, headers, item.bytes.subarray(range.start, range.end + 1));
      }
    }
    return finish(200, headers, item.bytes);
  });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); accept(); });
  });
  const actualPort = server.address().port;
  expectedHost = `127.0.0.1:${actualPort}`;
  return { server, url: `http://${expectedHost}/`, offerId, previewPath, warnings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('Usage: node work/serve-preview.mjs <product-output-dir> [preview-name.html]');
    const { server, url, offerId, previewPath, warnings } = await startServer(process.argv[2], { outputName: process.argv[3] || DEFAULT_OUTPUT_NAME });
    console.log(JSON.stringify({ ready: true, offerId, url, previewPath, warnings }));
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      server.close(() => process.exit(0));
      server.closeIdleConnections();
    };
    process.on('SIGINT', close); process.on('SIGTERM', close);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
