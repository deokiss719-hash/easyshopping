const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const TOKEN_URL = 'https://oauth2.cert.toss.im/token';
const BEST_SELLING_URL = 'https://sharelink.toss.im/openapi/products/best-selling';
const LINK_URL = 'https://sharelink.toss.im/openapi/links';
const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const SCOPE = 'sharelink:read sharelink:write';

function required(value, name) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/u.test(value)) throw new TypeError(`${name} is required`);
  return value.trim();
}

function defaultTransport({ url, method, headers = {}, body, timeoutMs, maxResponseBytes }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:') return reject(new Error('HTTPS is required'));
    const request = https.request(target, { method, headers, timeout: timeoutMs }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxResponseBytes) {
          request.destroy(new Error('response exceeded size limit'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch (_) { reject(new Error('response was not valid JSON')); return; }
        resolve({ statusCode: response.statusCode, headers: response.headers, body: parsed });
      });
    });
    request.once('timeout', () => request.destroy(new Error('request timed out')));
    request.once('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function createFileTokenCache(filename) {
  const resolved = path.resolve(required(filename, 'token cache path'));
  return Object.freeze({
    load() {
      try {
        const stat = fs.lstatSync(resolved);
        if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) return null;
        const fd = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        try {
          const value = fs.readFileSync(fd, 'utf8');
          if (Buffer.byteLength(value) > 16 * 1024) return null;
          return JSON.parse(value);
        } finally { fs.closeSync(fd); }
      } catch (_) { return null; }
    },
    save(value) {
      fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
      try { fs.chmodSync(path.dirname(resolved), 0o700); } catch (_) {}
      const temporary = `${resolved}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
      let fd;
      try {
        fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
        fs.writeFileSync(fd, `${JSON.stringify(value)}\n`, 'utf8');
        fs.fsyncSync(fd);
        fs.closeSync(fd); fd = undefined;
        fs.renameSync(temporary, resolved);
        fs.chmodSync(resolved, 0o600);
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
        try { fs.unlinkSync(temporary); } catch (_) {}
      }
    },
  });
}

function assertTransportResponse(response) {
  if (!response || !Number.isInteger(response.statusCode)) throw new Error('Toss API returned a malformed transport response');
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('Toss API request failed');
  if (!response.body || typeof response.body !== 'object' || Array.isArray(response.body)) throw new Error('Toss API returned malformed JSON');
  return response.body;
}

function successEnvelope(body) {
  if (body.resultType !== 'SUCCESS' || !body.success || typeof body.success !== 'object' || Array.isArray(body.success)) {
    throw new Error('Toss API did not return SUCCESS');
  }
  return body.success;
}

function createTossSharelinkClient({ accessKey, secretKey, publisherId, tokenCache = null, transport = defaultTransport, now = () => new Date() } = {}) {
  const access = required(accessKey, 'accessKey');
  const secret = required(secretKey, 'secretKey');
  const publisher = required(publisherId, 'publisherId');
  if (typeof transport !== 'function' || typeof now !== 'function') throw new TypeError('transport and now are required');
  const credentialKey = crypto.createHash('sha256').update(access).digest('hex');
  let memoryToken = null;

  async function call(options) {
    try {
      return assertTransportResponse(await transport({
        timeoutMs: TIMEOUT_MS,
        maxResponseBytes: MAX_RESPONSE_BYTES,
        followRedirects: false,
        ...options,
      }));
    } catch (_) {
      throw new Error('Toss API request failed safely');
    }
  }

  function usable(cached) {
    return cached && typeof cached.accessToken === 'string' && cached.accessToken
      && cached.credentialKey === credentialKey && cached.scope === SCOPE
      && Number.isFinite(cached.expiresAt)
      && cached.expiresAt - 60_000 > new Date(now()).getTime();
  }

  async function token() {
    if (usable(memoryToken)) return memoryToken.accessToken;
    const cached = tokenCache?.load?.();
    if (usable(cached)) { memoryToken = cached; return cached.accessToken; }
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: access,
      client_secret: secret,
      scope: SCOPE,
    }).toString();
    const body = await call({
      url: TOKEN_URL,
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': Buffer.byteLength(form),
      },
      body: form,
    });
    const accessToken = body.access_token ?? body.accessToken;
    const expiresIn = Number(body.expires_in ?? body.expiresIn);
    const maximumExpiresIn = 366 * 24 * 60 * 60;
    if (typeof accessToken !== 'string' || !accessToken || !Number.isFinite(expiresIn) || expiresIn <= 60 || expiresIn > maximumExpiresIn) {
      throw new Error('Toss OAuth returned malformed credentials');
    }
    memoryToken = { accessToken, expiresAt: new Date(now()).getTime() + expiresIn * 1000, credentialKey, scope: SCOPE };
    tokenCache?.save?.(memoryToken);
    return accessToken;
  }

  async function authorized(url, method, bodyObject) {
    const accessToken = await token();
    const serialized = bodyObject === undefined ? undefined : JSON.stringify(bodyObject);
    const headers = { authorization: `Bearer ${accessToken}`, accept: 'application/json' };
    if (serialized !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(serialized);
    }
    return call({ url, method, headers, body: serialized });
  }

  return Object.freeze({
    async fetchBestSelling({ size = 100 } = {}) {
      if (!Number.isInteger(size) || size < 1 || size > 100) throw new RangeError('size must be an integer from 1 through 100');
      const body = await authorized(`${BEST_SELLING_URL}?size=${size}`, 'GET');
      return successEnvelope(body);
    },
    async createLink({ tacaItemId } = {}) {
      if (!Number.isSafeInteger(tacaItemId) || tacaItemId <= 0) throw new TypeError('tacaItemId must be a safe positive integer');
      const id = tacaItemId;
      const body = successEnvelope(await authorized(LINK_URL, 'POST', { tacaItemId: id, publisherId: publisher }));
      let short;
      try { short = new URL(required(body.shortUrl, 'shortUrl')); } catch (_) { throw new Error('Toss link response was malformed'); }
      if (short.protocol !== 'https:' || short.hostname !== 'toss.im' || short.port || short.username || short.password || !short.pathname.startsWith('/_m/')) {
        throw new Error('Toss link response had an invalid short URL');
      }
      return { shortUrl: short.href, originUrl: typeof body.originUrl === 'string' ? body.originUrl : null };
    },
  });
}

module.exports = {
  BEST_SELLING_URL,
  LINK_URL,
  MAX_RESPONSE_BYTES,
  TIMEOUT_MS,
  TOKEN_URL,
  createFileTokenCache,
  createTossSharelinkClient,
  defaultTransport,
};
