const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const { createAdminUiRouter } = require('../src/admin/admin-ui');

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

function auth() {
  return {
    requireAuth(req, res, next) {
      if (req.get('authorization') !== 'ok') return res.status(401).json({ error: 'authentication_required' });
      return next();
    },
  };
}

test('admin login is public and noindex while management HTML remains authenticated', async (t) => {
  const app = express();
  app.use('/admin', createAdminUiRouter({
    auth: auth(),
    publicDir: path.join(__dirname, '..', 'public', 'admin'),
  }));
  const { server, origin } = await listen(app);
  t.after(() => server.close());

  const login = await fetch(`${origin}/admin/login`);
  assert.equal(login.status, 200);
  assert.match(login.headers.get('x-robots-tag'), /noindex/);
  assert.match(await login.text(), /<meta\s+name="robots"\s+content="noindex, nofollow"/i);

  assert.equal((await fetch(`${origin}/admin`)).status, 401);
  assert.equal((await fetch(`${origin}/admin/index.html`)).status, 401);
  const shell = await fetch(`${origin}/admin`, { headers: { authorization: 'ok' } });
  assert.equal(shell.status, 200);
  const html = await shell.text();
  for (const text of ['대시보드', '휴대폰 핫딜 관리', '상품 관리', '메인 노출 관리', '사이트 설정']) assert.match(html, new RegExp(text));
  for (const control of ['deal-form', 'metadata-fetch', 'current-price', 'original-price', 'image-url', 'target-url', 'category', 'is-published', 'show-on-home', 'priority']) assert.match(html, new RegExp(`id="${control}"`));
});

test('admin assets are public with noindex headers but cannot expose management document', async (t) => {
  const app = express();
  app.use('/admin', createAdminUiRouter({ auth: auth(), publicDir: path.join(__dirname, '..', 'public', 'admin') }));
  const { server, origin } = await listen(app);
  t.after(() => server.close());

  for (const asset of ['admin.css', 'login.js', 'admin.js']) {
    const response = await fetch(`${origin}/admin/${asset}`);
    assert.equal(response.status, 200, asset);
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
  }
  assert.equal((await fetch(`${origin}/admin/login.html`)).status, 404);
});
