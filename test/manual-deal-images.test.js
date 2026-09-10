const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  fetchStoredImage, createManualDealImageRouter, createPinnedLookup, MAX_IMAGE_BYTES,
} = require('../src/manual-deal-images');

const PUBLIC = [{ address: '93.184.216.34', family: 4 }];

test('pinned DNS lookup supports Node single and all-address callback forms', async () => {
  const lookup = createPinnedLookup(PUBLIC[0]);
  const single = await new Promise((resolve, reject) => {
    lookup('cdn.example', { all: false }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  const multiple = await new Promise((resolve, reject) => {
    lookup('cdn.example', { all: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });

  assert.deepEqual(single, PUBLIC[0]);
  assert.deepEqual(multiple, PUBLIC);
});

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test('stored image fetch pins public DNS and returns only exact supported image types', async () => {
  const selections = [];
  const result = await fetchStoredImage('https://cdn.example/phone.webp', {
    lookup: async () => PUBLIC,
    request: async (url, selected, options) => {
      selections.push({ url: url.href, selected, options });
      return { statusCode: 200, headers: { 'content-type': 'image/webp', 'content-encoding': 'identity' }, body: Buffer.from('image') };
    },
  });
  assert.equal(result.contentType, 'image/webp');
  assert.equal(result.body.toString(), 'image');
  assert.equal(selections[0].selected.address, PUBLIC[0].address);
  assert.equal(selections[0].options.maxBytes, MAX_IMAGE_BYTES);
});

test('stored image fetch validates every redirect against SSRF and HTTPS rules', async () => {
  const lookup = async (hostname) => hostname === 'private.example' ? [{ address: '169.254.169.254', family: 4 }] : PUBLIC;
  await assert.rejects(() => fetchStoredImage('https://cdn.example/a.jpg', {
    lookup,
    request: async () => ({ statusCode: 302, headers: { location: 'https://private.example/secret' }, body: Buffer.alloc(0) }),
  }), /public/i);
  await assert.rejects(() => fetchStoredImage('http://cdn.example/a.jpg', { lookup }), /HTTPS/i);
});

test('stored image fetch rejects compression, disguised types, and bodies over 10 MiB', async () => {
  const base = { lookup: async () => PUBLIC };
  await assert.rejects(() => fetchStoredImage('https://cdn.example/a.svg', {
    ...base, request: async () => ({ statusCode: 200, headers: { 'content-type': 'image/svg+xml' }, body: Buffer.from('<svg/>') }),
  }), /content-type/i);
  await assert.rejects(() => fetchStoredImage('https://cdn.example/a.jpg', {
    ...base, request: async () => ({ statusCode: 200, headers: { 'content-type': 'image/jpeg', 'content-encoding': 'gzip' }, body: Buffer.from('x') }),
  }), /compressed/i);
  await assert.rejects(() => fetchStoredImage('https://cdn.example/a.jpg', {
    ...base, request: async () => ({ statusCode: 200, headers: { 'content-type': 'image/jpeg' }, body: Buffer.alloc(MAX_IMAGE_BYTES + 1) }),
  }), /large/i);
});

test('public image endpoint only accepts numeric stored published records', async (t) => {
  const calls = [];
  const store = {
    async getPublishedManualImage(id) {
      calls.push(id);
      return id === '7' ? { imageUrl: 'https://cdn.example/phone.png' } : null;
    },
  };
  const app = express();
  app.use('/api/manual-deal-images', createManualDealImageRouter({
    store,
    imageFetcher: async () => ({ contentType: 'image/png', body: Buffer.from('png') }),
  }));
  const { server, origin } = await listen(app);
  t.after(() => server.close());

  assert.equal((await fetch(`${origin}/api/manual-deal-images/anything`)).status, 404);
  assert.equal((await fetch(`${origin}/api/manual-deal-images/8`)).status, 404);
  const image = await fetch(`${origin}/api/manual-deal-images/7`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.match(image.headers.get('cache-control'), /max-age/);
  assert.equal(Buffer.from(await image.arrayBuffer()).toString(), 'png');
  assert.deepEqual(calls, ['8', '7']);
});
