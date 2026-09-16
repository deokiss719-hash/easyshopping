const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { newDb } = require('pg-mem');
const { migrate } = require('../src/deal-store');
const { createTrafficAnalytics } = require('../src/traffic-analytics');
const { createCtaEventStore, createCtaEventsRouter } = require('../src/cta-events');

test('CTA events are daily deduplicated by visitor, placement and event', async (t) => {
  const db = newDb(); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  await migrate(pool); t.after(() => pool.end());
  const store = createCtaEventStore(pool);
  const input = { day: '2026-09-16', visitorHash: 'a'.repeat(64), placement: 'hero', event: 'click' };
  assert.equal(await store.record(input), true);
  assert.equal(await store.record(input), false);
  assert.equal(await store.record({ ...input, placement: 'middle' }), true);
  await assert.rejects(() => store.record({ ...input, placement: 'footer' }), /invalid/i);
});

test('CTA endpoint accepts only signed first-party browser events', async (t) => {
  const records = []; const secret = 'c'.repeat(48); const app = express(); app.use(express.json());
  app.use(createTrafficAnalytics({ store: { recordPageView: async () => {} }, secret, production: false }));
  app.get('/', (_req, res) => res.send('ok'));
  app.use('/api/cta-events', createCtaEventsRouter({ store: { record: async (value) => records.push(value) }, secret }));
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(origin, { headers: { 'user-agent': 'Mozilla/5.0' } });
  const cookie = page.headers.get('set-cookie').split(';')[0];
  const send = (headers = {}, body = { placement: 'hero', event: 'click' }) => fetch(`${origin}/api/cta-events`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin, cookie, 'user-agent': 'Mozilla/5.0', ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await send()).status, 204); assert.equal(records.length, 1);
  await send({ origin: 'https://evil.test' }); await send({}, { placement: 'footer', event: 'click' });
  assert.equal(records.length, 1); assert.match(records[0].visitorHash, /^[a-f0-9]{64}$/);
});
