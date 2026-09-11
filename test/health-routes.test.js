const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createHealthRouter } = require('../src/health-routes');

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test('legacy health remains a 200 liveness endpoint with fixture metadata', async (t) => {
  const app = express();
  app.use('/api', createHealthRouter({
    getDatabaseMode: () => 'fixture',
    readiness: { handler() { throw new Error('liveness must not probe readiness'); } },
  }));
  const { server, origin } = await listen(app); t.after(() => server.close());
  const response = await fetch(`${origin}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true, service: 'easyshopping', version: '0.4.0', database: 'fixture',
  });
});

test('readiness is exposed separately and preserves its status', async (t) => {
  const app = express();
  app.use('/api', createHealthRouter({
    getDatabaseMode: () => 'postgresql',
    readiness: {
      async handler(_request, response) {
        response.status(503).json({ ok: false, reasons: [{ code: 'database_unavailable' }] });
      },
    },
  }));
  const { server, origin } = await listen(app); t.after(() => server.close());
  const response = await fetch(`${origin}/api/readiness`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, reasons: [{ code: 'database_unavailable' }] });
});
