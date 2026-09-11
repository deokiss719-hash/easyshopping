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
  for (const text of ['대시보드', '오늘 트래픽', '오늘 방문자', '페이지 조회수', '유입 경로', '휴대폰 핫딜 관리', '상품 관리', '메인 노출 관리', '사이트 설정']) assert.match(html, new RegExp(text));
  for (const control of ['stat-visitors-today', 'stat-pageviews-today', 'analytics-day', 'referrer-breakdown', 'analytics-message']) assert.match(html, new RegExp(`id="${control}"`));
  for (const control of ['deal-form', 'metadata-fetch', 'current-price', 'original-price', 'image-file', 'image-preview', 'image-upload-status', 'image-url', 'target-url', 'category', 'is-published', 'show-on-home', 'priority']) assert.match(html, new RegExp(`id="${control}"`));
  assert.match(html, /id="image-file"[^>]+type="file"[^>]+accept="image\/jpeg,image\/png,image\/webp,image\/gif,image\/avif"/);
  const adminScript = await (await fetch(`${origin}/admin/admin.js`)).text();
  assert.match(adminScript, /\/api\/admin\/images/);
  assert.match(adminScript, /setValue\('image-url',\s*data\.imageUrl\)/);
  assert.doesNotMatch(adminScript, /URL\.(?:createObjectURL|revokeObjectURL)|blob:|data:/);
  assert.match(adminScript, /preview\.src\s*=\s*data\.imageUrl/);
  assert.match(adminScript, /new AbortController\(\)/);
  assert.match(adminScript, /signal:\s*controller\.signal/);
  assert.match(adminScript, /state\.uploadController\?\.abort\(\)/);
  assert.match(adminScript, /state\.formGeneration\s*\+=\s*1/);
  assert.match(adminScript, /\+\+state\.uploadGeneration/);
  assert.match(adminScript, /state\.uploadPromise\s*=\s*uploadPromise/);
  assert.match(adminScript, /await\s+(?:state\.)?uploadPromise/);
  assert.match(adminScript, /state\.uploadPromise\s*!==\s*null/);
  assert.match(adminScript, /state\.formGeneration\s*!==\s*formGeneration\s*\|\|\s*state\.uploadGeneration\s*!==\s*uploadGeneration/);
  assert.match(adminScript, /state\.uploadPromise\s*===\s*uploadPromise/);
  assert.match(adminScript, /setValue\('image-url',\s*''\)/);
  assert.doesNotMatch(adminScript, /X-File-Name/i);
  assert.match(adminScript, /'current-price'/);
  assert.match(adminScript, /'original-price'/);
  assert.match(adminScript, /normalizeHttpsUrlInput\(byId\('target-url'\)\.value\)/);
  assert.match(adminScript, /normalizeHttpsUrlInput\(byId\('metadata-url'\)\.value\)/);
  assert.match(adminScript, /productUrl,\s*\n/);
  assert.match(adminScript, /\/api\/admin\/analytics\/today/);
  assert.match(adminScript, /referrer-breakdown/);
  assert.match(adminScript, /row\.searchTerm/);
  assert.match(adminScript, /row\.referrerUrl/);
  assert.match(adminScript, /textContent/);
});

test('admin assets are public with noindex headers but cannot expose management document', async (t) => {
  const app = express();
  app.use('/admin', createAdminUiRouter({ auth: auth(), publicDir: path.join(__dirname, '..', 'public', 'admin') }));
  const { server, origin } = await listen(app);
  t.after(() => server.close());

  for (const asset of ['admin.css', 'login.js', 'admin.js', 'url-utils.js']) {
    const response = await fetch(`${origin}/admin/${asset}`);
    assert.equal(response.status, 200, asset);
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
  }
  assert.equal((await fetch(`${origin}/admin/login.html`)).status, 404);
});
