const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');
const express = require('express');
const { validateUrl, isPublicAddress } = require('./url-metadata/url-metadata');

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

async function defaultLookup(hostname) {
  return dns.lookup(hostname, { all: true, verbatim: true });
}

async function resolvePublic(url, lookup) {
  const family = net.isIP(url.hostname);
  const addresses = family ? [{ address: url.hostname, family }] : await lookup(url.hostname);
  if (!Array.isArray(addresses) || addresses.length === 0
    || addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new Error('destination must resolve only to public addresses');
  }
  return addresses[0];
}

function createPinnedLookup(selected) {
  return (_hostname, options, callback) => {
    if (options?.all === true) {
      callback(null, [selected]);
      return;
    }
    callback(null, selected.address, selected.family);
  };
}

function nativeImageRequest(url, selected, { timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET',
      headers: {
        accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif',
        'accept-encoding': 'identity',
        'user-agent': 'easyshopping-manual-image/1.0',
      },
      lookup: createPinnedLookup(selected),
      agent: false,
    }, (response) => {
      const declared = Number(response.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        response.destroy();
        reject(new Error('response body is too large'));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          response.destroy(new Error('response body is too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
      response.on('error', reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('request timed out')));
    request.on('error', reject);
    request.end();
  });
}

async function fetchStoredImage(value, options = {}) {
  const lookup = options.lookup || defaultLookup;
  const request = options.request || nativeImageRequest;
  const maxBytes = options.maxBytes || MAX_IMAGE_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  let url = validateUrl(value);
  const visited = new Set();

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    if (visited.has(url.href)) throw new Error('redirect loop detected');
    visited.add(url.href);
    const selected = await resolvePublic(url, lookup);
    const response = await request(url, selected, {
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      maxBytes,
    });
    const status = Number(response.statusCode);
    if ([301, 302, 303, 307, 308].includes(status)) {
      if (redirects >= maxRedirects) throw new Error('too many redirects');
      if (!response.headers?.location) throw new Error('redirect has no location');
      url = validateUrl(new URL(response.headers.location, url));
      continue;
    }
    if (status < 200 || status >= 300) throw new Error(`upstream HTTP status ${status}`);
    const contentType = String(response.headers?.['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(contentType)) throw new Error('upstream content-type must be a supported image');
    const encoding = String(response.headers?.['content-encoding'] || 'identity').trim().toLowerCase();
    if (encoding !== 'identity') throw new Error('compressed responses are not accepted');
    const body = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body || '');
    if (body.length > maxBytes) throw new Error('response body is too large');
    return { contentType, body };
  }
  throw new Error('too many redirects');
}

function createManualDealImageRouter({ store, imageFetcher = fetchStoredImage } = {}) {
  if (!store?.getPublishedManualImage) throw new TypeError('manual image store is required');
  const router = express.Router();
  router.get('/:id', async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.sendStatus(404);
    try {
      const record = await store.getPublishedManualImage(req.params.id);
      if (!record?.imageUrl) return res.sendStatus(404);
      const image = await imageFetcher(record.imageUrl);
      res.set('Content-Type', image.contentType);
      res.set('Cache-Control', 'public, max-age=300, no-transform');
      res.set('X-Content-Type-Options', 'nosniff');
      return res.send(image.body);
    } catch {
      return res.status(502).json({ error: 'image_unavailable' });
    }
  });
  return router;
}

module.exports = {
  fetchStoredImage, createManualDealImageRouter, createPinnedLookup, MAX_IMAGE_BYTES, IMAGE_TYPES,
};
