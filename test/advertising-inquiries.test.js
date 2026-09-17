const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAdvertisingInquiryRouter } = require('../src/advertising-inquiries');

async function withServer(app, worker) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try { return await worker(`http://127.0.0.1:${port}`); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('public advertising inquiry endpoint validates consent and stores a valid inquiry', async () => {
  const stored = [];
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  app.use('/api/advertising-inquiries', createAdvertisingInquiryRouter({
    async createAdvertisingInquiry(value) { stored.push(value); return value; },
  }));
  const payload = {
    companyName: '이지브랜드', contactName: '김담당', phone: '010-1234-5678',
    email: 'ads@example.com', adType: 'banner', message: '배너 광고 문의', privacyConsent: true,
  };
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/advertising-inquiries`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { ok: true });
    const rejected = await fetch(`${base}/api/advertising-inquiries`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, privacyConsent: false }),
    });
    assert.equal(rejected.status, 400);
  });
  assert.equal(stored.length, 1);
});

test('honeypot inquiry is silently ignored', async () => {
  let calls = 0;
  const app = express();
  app.use(express.json());
  app.use('/api/advertising-inquiries', createAdvertisingInquiryRouter({
    async createAdvertisingInquiry() { calls += 1; },
  }));
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/advertising-inquiries`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ website: 'https://spam.example', privacyConsent: true }),
    });
    assert.equal(response.status, 204);
  });
  assert.equal(calls, 0);
});
