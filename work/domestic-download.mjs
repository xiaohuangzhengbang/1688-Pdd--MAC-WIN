import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const runCommand = promisify(execFile);

export function isPublicIPv4(address) {
  if (typeof address !== 'string' || !/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(address)) return false;
  const [a, b, c, d] = address.split('.').map(Number);
  if ([a, b, c, d].some(part => part > 255)) return false;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

export function approveAssetUrl(value, {allowProductReferer = false} = {}) {
  let url;
  if (/[\u0000-\u0020\u007f]/.test(String(value))) throw new Error('Unapproved asset URL');
  try { url = new URL(value); } catch { throw new Error('Unapproved asset URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    !(/(^|\.)(alicdn\.com|taobao\.com|1688\.com|pddpic\.com)$/.test(url.hostname) ||
      (allowProductReferer && url.hostname === 'mobile.yangkeduo.com'))) throw new Error('Unapproved asset URL');
  return String(value);
}

export function useDomesticTransport(video, {platform = process.platform, env = process.env} = {}) {
  return video && (platform === 'darwin' || env.ASSET_DOMESTIC_DOWNLOAD === '1');
}

function physicalInterface(name) {
  if (!/^(en\d+|eth\d+|wlan\d+|enp[\w.-]+|wlp[\w.-]+)$/.test(name || '')) {
    throw new Error('Domestic download requires a physical interface; set ASSET_DIRECT_INTERFACE to the physical network interface');
  }
  return name;
}

export async function discoverDirectInterface({platform = process.platform, env = process.env, runCommand: run = runCommand} = {}) {
  if (env.ASSET_DIRECT_INTERFACE) return physicalInterface(env.ASSET_DIRECT_INTERFACE);
  if (platform !== 'darwin') throw new Error('Domestic download requires an explicit physical interface on this platform');
  const {stdout} = await run('/sbin/route', ['-n', 'get', 'default'], {timeout: 5000, maxBuffer: 65536, encoding: 'utf8'});
  return physicalInterface(String(stdout).match(/^\s*interface:\s*(\S+)/m)?.[1]);
}

async function requestPinned(url, {interfaceName, address, referer, run, deadline, maxBytes}) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Domestic download timeout');
  const directory = await mkdtemp(join(tmpdir(), '1688-domestic-'));
  const bodyPath = join(directory, 'body');
  const headerPath = join(directory, 'headers');
  try {
    const host = new URL(url).hostname;
    const args = ['--disable', '--silent', '--show-error', '--noproxy', '*', '--interface', interfaceName,
      '--resolve', `${host}:443:${address}`, '--proto', '=https', '--connect-timeout', String(Math.min(15, remaining / 1000)),
      '--max-time', String(remaining / 1000), '--max-filesize', String(maxBytes), '--output', bodyPath,
      '--dump-header', headerPath, '--write-out', '%{http_code}\n%{ssl_verify_result}\n%{remote_ip}\n'];
    if (referer) args.push('--referer', referer);
    args.push('--url', url);
    let stdout;
    try { ({stdout} = await run('curl', args, {timeout: remaining + 1000, maxBuffer: 65536, encoding: 'utf8'})); }
    catch (error) { throw new Error(`Domestic curl failed (${Number.isInteger(error.code) ? error.code : 'transport error'})`); }
    const [status, sslVerify, remoteIp] = String(stdout).trim().split(/\r?\n/);
    if (sslVerify !== '0' || remoteIp !== address) throw new Error('Domestic TLS or pinned address verification failed');
    const bytes = await readFile(bodyPath);
    if (bytes.length > maxBytes) throw new Error('Domestic response exceeds the size limit');
    const headers = await readFile(headerPath, 'utf8');
    const block = headers.trim().split(/\r?\n\r?\n/).at(-1);
    const location = block.match(/^location:\s*(.*?)\s*$/im)?.[1];
    return {status: Number(status), location, bytes, remoteIp};
  } finally { await rm(directory, {recursive: true, force: true}); }
}

async function resolvePublicAddresses(hostname, options) {
  const response = await requestPinned(`https://dns.alidns.com/resolve?name=${hostname}&type=A`, {
    ...options, address: '223.5.5.5', maxBytes: 1024 * 1024,
  });
  if (response.status !== 200) throw new Error(`Domestic DNS HTTP ${response.status}`);
  let answer;
  try { answer = JSON.parse(response.bytes.toString('utf8')); } catch { throw new Error('Invalid domestic DNS response'); }
  const addresses = [...new Set((answer.Answer || []).filter(row => row.type === 1).map(row => row.data))];
  if (answer.Status !== 0 || !addresses.length || !addresses.every(isPublicIPv4)) throw new Error('Domestic DNS requires public IPv4 answers');
  return addresses;
}

export async function downloadDomesticVideo(value, {
  referer, env = process.env, platform = process.platform, runCommand: run = runCommand, timeoutMs = 60000,
} = {}) {
  let url = approveAssetUrl(value);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) throw new Error('Invalid domestic download timeout');
  if (referer) approveAssetUrl(referer, {allowProductReferer: true});
  const deadline = Date.now() + timeoutMs;
  const interfaceName = await discoverDirectInterface({env, platform, runCommand: run});
  for (let redirects = 0; ; redirects++) {
    const hostname = new URL(url).hostname;
    const addresses = await resolvePublicAddresses(hostname, {interfaceName, run, deadline});
    const response = await requestPinned(url, {interfaceName, address: addresses[0], referer, run, deadline, maxBytes: 512 * 1024 * 1024});
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects >= 3) throw new Error('Domestic download redirect limit exceeded');
      if (!response.location) throw new Error('Domestic redirect missing its location');
      url = approveAssetUrl(new URL(response.location, url).href);
      continue;
    }
    if (response.status !== 200) throw new Error(`Domestic video HTTP ${response.status}`);
    const bytes = response.bytes;
    if (!(bytes.length > 32 && bytes.toString('ascii', 4, 8) === 'ftyp' && bytes.includes(Buffer.from('moov')) && bytes.includes(Buffer.from('mdat')))) {
      throw new Error('Invalid MP4 video bytes; HTML and unsupported formats are not saved');
    }
    return {bytes, transport: {kind: 'domestic-direct', interface: interfaceName, dns: 'AliDNS HTTPS', finalHost: hostname, remoteIp: response.remoteIp, tlsVerified: true}};
  }
}
