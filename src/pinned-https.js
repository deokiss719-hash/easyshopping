const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');
const { isPublicAddress } = require('./url-metadata/url-metadata');

async function defaultLookup(hostname) {
  return dns.lookup(hostname, { all: true, verbatim: true });
}

async function resolvePublic(url, lookup = defaultLookup) {
  const literalFamily = net.isIP(url.hostname);
  const addresses = literalFamily
    ? [{ address: url.hostname, family: literalFamily }]
    : await lookup(url.hostname);
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error('destination must resolve only to public addresses');
  }
  const normalized = addresses.map((entry) => ({
    address: String(entry?.address || ''),
    family: Number(entry?.family) || net.isIP(String(entry?.address || '')),
  }));
  if (normalized.some((entry) => !entry.family
    || net.isIP(entry.address) !== entry.family
    || !isPublicAddress(entry.address))) {
    throw new Error('destination must resolve only to public addresses');
  }
  return normalized[0];
}

function createPinnedLookup(selected) {
  const pinned = Object.freeze({ address: selected.address, family: selected.family });
  return (_hostname, options, callback) => {
    if (typeof options === 'function') {
      options(null, pinned.address, pinned.family);
      return;
    }
    if (options?.all === true) callback(null, [pinned]);
    else callback(null, pinned.address, pinned.family);
  };
}

function responseHeaders(headers) {
  return {
    get(name) {
      const value = headers[String(name).toLowerCase()];
      return Array.isArray(value) ? value.join(', ') : value == null ? null : String(value);
    },
  };
}

function nativePinnedRequest(url, selected, options = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: options.method || 'GET',
      headers: options.headers,
      lookup: createPinnedLookup(selected),
      agent: false,
      signal: options.signal,
    }, (incoming) => {
      // URL remains the original hostname, so Node derives the correct Host header
      // and TLS servername while the lookup callback fixes the connected address.
      incoming.cancel = async () => incoming.destroy();
      resolve({
        status: incoming.statusCode,
        ok: incoming.statusCode >= 200 && incoming.statusCode < 300,
        headers: responseHeaders(incoming.headers),
        body: incoming,
        async text() {
          const chunks = [];
          for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
          return Buffer.concat(chunks).toString('utf8');
        },
        async arrayBuffer() {
          const chunks = [];
          for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
          return Buffer.concat(chunks);
        },
      });
    });
    if (Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0) {
      request.setTimeout(options.timeoutMs, () => request.destroy(new Error('request timed out')));
    }
    request.on('error', reject);
    request.end();
  });
}

async function requestPinnedHttps(value, options = {}) {
  const url = value instanceof URL ? new URL(value.href) : new URL(String(value));
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new TypeError('pinned request requires HTTPS without credentials or a non-default port');
  }
  const selected = await resolvePublic(url, options.lookup || defaultLookup);
  const request = options.request || nativePinnedRequest;
  return request(url, selected, options);
}

module.exports = {
  createPinnedLookup,
  defaultLookup,
  nativePinnedRequest,
  requestPinnedHttps,
  resolvePublic,
};
