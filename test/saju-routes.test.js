const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { testPool } = require('./helpers/saju-db');
const { createStore } = require('../src/saju/store');
const { createSajuRouter } = require('../src/saju/routes');
test('HTTP funnel, privacy, admin protections, recovery, refund and erasure', async (t) => {
  const pool = await testPool();
  const store = await createStore(pool, 'test-data-secret-'.repeat(4));
  const app = express();
  app.use(express.json());
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const auth = {
    requireAuth: (q, s, n) => (q.get('x-admin-test') === 'yes' ? n() : s.sendStatus(401)),
    requireMutationProtection: (q, s, n) =>
      q.get('x-csrf-test') === 'valid' ? n() : s.sendStatus(403),
  };
  app.use(createSajuRouter({ store, auth, env: { SAJU_PUBLIC_ORIGIN: base, SAJU_ACCESS_MODE: 'paid' } }).router);
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await pool.end();
  });
  let jar = '';
  async function request(path, body, method = body ? 'POST' : 'GET', extra = {}) {
    const r = await fetch(base + path, {
      method,
      headers: {
        Origin: base,
        'X-Saju-Request': '1',
        'Content-Type': 'application/json',
        Cookie: jar,
        ...extra,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (r.headers.get('set-cookie')) {
      const newCookies = r.headers.getSetCookie().map((c) => c.split(';')[0]);
      const m = new Map(
        jar
          .split('; ')
          .filter(Boolean)
          .map((c) => c.split('=')),
      );
      for (const c of newCookies) {
        const [k, v] = c.split('=');
        m.set(k, v);
      }
      jar = [...m].map((p) => p.join('=')).join('; ');
    }
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { r, data };
  }
  const html = await request('/saju');
  assert.equal(html.r.status, 200);
  assert.ok(!html.data.includes('type="tel"'));
  assert.ok(!html.data.includes('meta-pixel'));
  assert.match(html.r.headers.get('cache-control'), /no-store/);
  assert.equal(html.r.headers.get('referrer-policy'), 'no-referrer');
  const cfg = await request('/api/saju/config');
  assert.equal(cfg.data.price, 6900);
  assert.equal(cfg.data.mode, 'demo');
  assert.ok(!JSON.stringify(cfg.data).includes('secret'));
  assert.match(jar, /saju_owner=/);
  const body = {
    date: '1990-01-01',
    calendar: 'solar',
    timeType: 'unknown',
    zone: 'Asia/Seoul',
    consent: true,
  };
  assert.equal(
    (await request('/api/saju/reports', body, 'POST', { Origin: 'https://evil.test' })).r.status,
    403,
  );
  const created = await request('/api/saju/reports', body);
  assert.equal(created.r.status, 201);
  const id = created.data.id;
  let view = await request('/api/saju/reports/' + id);
  assert.equal(view.data.paid, false);
  assert.equal(view.data.chart.pillars.hour, null);
  assert.equal(view.data.report.sections, undefined);
  assert.equal(view.data.report.toc.length, 7);
  const originalJar = jar;
  jar = '';
  assert.equal((await request('/api/saju/reports/' + id)).r.status, 404);
  jar = originalJar;
  const a = await request('/api/saju/reports/' + id + '/orders', {
    terms: true,
    recoverySaved: true,
  });
  assert.equal(a.data.amount, 6900);
  const order = a.data.id;
  assert.equal(
    (await request('/api/saju/orders/' + order + '/confirm', { amount: 1 })).r.status,
    422,
  );
  assert.equal((await request('/api/saju/reports/' + id)).data.paid, false);
  const approved = await request('/api/saju/orders/' + order + '/confirm', { amount: 6900 });
  assert.equal(approved.data.status, 'paid');
  view = await request('/api/saju/reports/' + id);
  assert.equal(view.data.report.sections.length, 7);
  const originalReport = JSON.stringify(view.data.report);
  assert.equal(
    JSON.stringify((await request('/api/saju/reports/' + id)).data.report),
    originalReport,
  );
  jar = '';
  await request('/api/saju/config');
  let recovered = await request('/api/saju/recover', { code: created.data.recovery });
  assert.equal(recovered.data.id, id);
  assert.equal((await request('/api/saju/reports/' + id)).data.paid, true);
  assert.ok(!JSON.stringify(recovered.data).includes(created.data.recovery));
  assert.equal((await request('/api/admin/saju')).r.status, 401);
  assert.equal((await request('/saju/admin.html')).r.status, 404);
  const settings = {
    price: 7900,
    free_sections: 4,
    report_version: 'ko-evidence-1',
    sales_enabled: false,
  };
  assert.equal(
    (await request('/api/admin/saju/settings', settings, 'PATCH', { 'x-admin-test': 'yes' })).r
      .status,
    403,
  );
  assert.equal(
    (
      await request('/api/admin/saju/settings', settings, 'PATCH', {
        'x-admin-test': 'yes',
        'x-csrf-test': 'valid',
      })
    ).r.status,
    200,
  );
  assert.equal((await request('/api/saju/config')).data.price, 7900);
  assert.equal(
    JSON.stringify((await request('/api/saju/reports/' + id)).data.report),
    originalReport,
  );
  const refunded = await request('/api/saju/orders/' + order + '/refund', {});
  assert.equal(refunded.data.status, 'refunded');
  assert.equal((await request('/api/saju/reports/' + id)).data.paid, false);
  const dash = await request('/api/admin/saju', null, 'GET', { 'x-admin-test': 'yes' });
  assert.ok(!JSON.stringify(dash.data).includes('1990-01-01'));
  assert.ok(!JSON.stringify(dash.data).includes('pillars'));
  assert.equal((await request('/api/saju/reports/' + id, null, 'DELETE')).r.status, 204);
  assert.equal((await request('/api/saju/reports/' + id)).r.status, 404);
  assert.equal(
    (await store.one('SELECT payload FROM saju_reports WHERE id=$1', [id])).payload,
    null,
  );
});
