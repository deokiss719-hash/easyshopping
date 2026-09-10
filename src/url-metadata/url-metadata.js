const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');
const ipaddr = require('ipaddr.js');
const { load } = require('cheerio');

const MAX_HTML_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;

function isPublicAddress(address) {
  // Fail closed: ipaddr.js tracks IANA special-use, translation and transition
  // ranges. Only ordinary globally-routable unicast is fetchable.
  try {
    if (!net.isIP(String(address))) return false;
    return ipaddr.parse(String(address).split('%')[0]).range() === 'unicast';
  } catch { return false; }
}

async function defaultLookup(hostname) { return dns.lookup(hostname, { all: true, verbatim: true }); }
function validateUrl(value) {
  let url;
  try { url = value instanceof URL ? new URL(value.href) : new URL(String(value)); } catch { throw new TypeError('URL must be a valid HTTPS URL'); }
  if (url.protocol !== 'https:') throw new TypeError('URL must use HTTPS');
  if (url.username || url.password || (url.port && url.port !== '443')) throw new TypeError('URL credentials and non-standard ports are not allowed');
  return url;
}
async function resolvePublic(url, lookup) {
  const literalFamily = net.isIP(url.hostname);
  const addresses = literalFamily ? [{ address: url.hostname, family: literalFamily }] : await lookup(url.hostname);
  if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) throw new Error('destination must resolve only to public addresses');
  return addresses[0];
}

function nativeRequest(url, selected, { timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET', headers: { accept: 'text/html,application/xhtml+xml', 'accept-encoding': 'identity', 'user-agent': 'easyshopping-metadata/1.0' },
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
      agent: false,
    }, (response) => {
      const declared = Number(response.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) { response.destroy(); reject(new Error('response body is too large')); return; }
      const chunks = []; let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) { response.destroy(new Error('response body is too large')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ statusCode: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('request timed out')));
    request.on('error', reject);
    request.end();
  });
}

function text(value, max = 2000) { return typeof value === 'string' ? value.trim().slice(0, max) || null : null; }
function absoluteHttps(value, base) {
  if (!value) return null;
  try { const url = new URL(String(Array.isArray(value) ? value[0] : value), base); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function findProduct(node) {
  if (Array.isArray(node)) { for (const item of node) { const found = findProduct(item); if (found) return found; } return null; }
  if (!node || typeof node !== 'object') return null;
  const type = node['@type'];
  if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return node;
  return findProduct(node['@graph']);
}
function extractMetadata(html, baseUrl) {
  const $ = load(String(html));
  let product = null;
  $('script[type="application/ld+json"]').each((_index, element) => {
    if (product) return;
    try { product = findProduct(JSON.parse($(element).text())); } catch { /* ignore malformed publisher data */ }
  });
  const meta = (selector) => text($(selector).first().attr('content'));
  const offer = Array.isArray(product?.offers) ? product.offers[0] : product?.offers;
  const brand = typeof product?.brand === 'string' ? product.brand : product?.brand?.name;
  const price = Number(offer?.price ?? product?.offers?.lowPrice);
  return {
    title: text(product?.name, 300) || meta('meta[property="og:title"]') || text($('title').first().text(), 300),
    description: text(product?.description) || meta('meta[property="og:description"]') || meta('meta[name="description"]'),
    imageUrl: absoluteHttps(product?.image, baseUrl) || absoluteHttps(meta('meta[property="og:image"]'), baseUrl),
    productUrl: absoluteHttps(offer?.url || product?.url, baseUrl) || absoluteHttps(meta('meta[property="og:url"]'), baseUrl) || baseUrl.href,
    merchant: text(brand || product?.manufacturer?.name, 200) || meta('meta[property="og:site_name"]'),
    priceAmount: Number.isSafeInteger(price) && price >= 0 ? price : null,
  };
}

async function fetchUrlMetadata(value, options = {}) {
  const lookup = options.lookup || defaultLookup;
  const request = options.request || nativeRequest;
  const maxBytes = options.maxBytes || MAX_HTML_BYTES;
  let url = validateUrl(value);
  const visited = new Set();
  for (let redirects = 0; redirects <= (options.maxRedirects ?? MAX_REDIRECTS); redirects += 1) {
    if (visited.has(url.href)) throw new Error('redirect loop detected');
    visited.add(url.href);
    const selected = await resolvePublic(url, lookup);
    const response = await request(url, selected, { timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS, maxBytes });
    const status = Number(response.statusCode);
    if ([301, 302, 303, 307, 308].includes(status)) {
      if (redirects >= (options.maxRedirects ?? MAX_REDIRECTS)) throw new Error('too many redirects');
      if (!response.headers?.location) throw new Error('redirect has no location');
      url = validateUrl(new URL(response.headers.location, url));
      continue;
    }
    if (status < 200 || status >= 300) throw new Error(`upstream HTTP status ${status}`);
    const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
    if (!/^text\/html(?:;|$)|^application\/xhtml\+xml(?:;|$)/.test(contentType)) throw new Error('upstream content-type must be HTML');
    if (response.headers?.['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw new Error('compressed responses are not accepted');
    const body = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body || '');
    if (body.length > maxBytes) throw new Error('response body is too large');
    return extractMetadata(body.toString('utf8'), url);
  }
  throw new Error('too many redirects');
}

module.exports = { fetchUrlMetadata, extractMetadata, isPublicAddress, validateUrl, MAX_HTML_BYTES };
