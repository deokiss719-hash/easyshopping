const test = require('node:test');
const assert = require('node:assert/strict');
const { extractMetadata, fetchUrlMetadata, isPublicAddress } = require('../src/url-metadata/url-metadata');

test('metadata precedence is JSON-LD Product then Open Graph then document metadata', () => {
  const html = `<html><head><title>Fallback</title><meta name="description" content="fallback description"><meta property="og:title" content="OG title"><meta property="og:image" content="/og.jpg"><script type="application/ld+json">{"@type":"Product","name":"JSON Phone","image":["/phone.jpg"],"description":"JSON description","offers":{"price":"123000","url":"/buy"},"brand":{"name":"PhoneCo"}}</script></head></html>`;
  assert.deepEqual(extractMetadata(html, new URL('https://shop.example/products/1')), {
    title: 'JSON Phone', description: 'JSON description', imageUrl: 'https://shop.example/phone.jpg', productUrl: 'https://shop.example/buy', merchant: 'PhoneCo', priceAmount: 123000,
  });
});

test('private, loopback, link-local, reserved and metadata addresses are rejected', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('93.184.216.34'), true);
  assert.equal(isPublicAddress('2606:2800:220:1:248:1893:25c8:1946'), true);
});

test('URL fetch requires HTTPS and rejects a hostname if any DNS answer is non-public', async () => {
  await assert.rejects(() => fetchUrlMetadata('http://example.com'), /HTTPS/i);
  await assert.rejects(() => fetchUrlMetadata('https://mixed.example', { lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }] }), /public/i);
});

test('safe fetch validates every redirect and enforces HTML type and body limit', async () => {
  const lookup = async (hostname) => hostname === 'private.example' ? [{ address: '10.0.0.2', family: 4 }] : [{ address: '93.184.216.34', family: 4 }];
  const redirectRequest = async () => ({ statusCode: 302, headers: { location: 'https://private.example/secret' }, body: Buffer.alloc(0) });
  await assert.rejects(() => fetchUrlMetadata('https://public.example', { lookup, request: redirectRequest }), /public/i);
  const wrongType = async () => ({ statusCode: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{}') });
  await assert.rejects(() => fetchUrlMetadata('https://public.example', { lookup, request: wrongType }), /content-type/i);
  const huge = async () => ({ statusCode: 200, headers: { 'content-type': 'text/html' }, body: Buffer.alloc(513 * 1024) });
  await assert.rejects(() => fetchUrlMetadata('https://public.example', { lookup, request: huge }), /large/i);
});
