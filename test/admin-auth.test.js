const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const bcrypt = require('bcryptjs');
const { createAdminAuth, createAttemptLimiter } = require('../src/admin/admin-auth');

function fakeStore(passwordHash) {
  const sessions = new Map();
  return {
    async findAdmin(username) { return username === 'owner' ? { id: '1', username, passwordHash, isActive: true } : null; },
    async createSession(session) { sessions.set(session.tokenHash, { ...session, id: 's1', username: 'owner', isActive: true }); },
    async getSession(hash, now) { const s = sessions.get(hash); return s && new Date(s.expiresAt) > now ? s : null; },
    async deleteSession(hash) { return sessions.delete(hash); },
    async recordLogin() {},
  };
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

function cookieFrom(response) { return response.headers.get('set-cookie').split(';')[0]; }

test('login issues opaque strict HttpOnly cookie and authenticated session returns CSRF token', async (t) => {
  const passwordHash = await bcrypt.hash('correct horse battery staple', 4);
  const auth = createAdminAuth({ store: fakeStore(passwordHash), production: true, csrfSecret: 'stable-test-secret-that-is-at-least-32-bytes' });
  const app = express(); app.use(express.json()); app.use('/api/admin/auth', auth.router); app.get('/api/admin/private', auth.requireAuth, (req, res) => res.json({ csrfToken: req.admin.csrfToken }));
  const { server, origin } = await listen(app); t.after(() => server.close());
  const login = await fetch(`${origin}/api/admin/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ username: 'OWNER', password: 'correct horse battery staple' }) });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /admin_session=[A-Za-z0-9_-]+;.*HttpOnly.*Secure.*SameSite=Strict/i);
  const privateResponse = await fetch(`${origin}/api/admin/private`, { headers: { cookie: cookieFrom(login) } });
  assert.equal(privateResponse.status, 200);
  assert.match((await privateResponse.json()).csrfToken, /^[A-Za-z0-9_-]{40,}$/);
});

test('admin authentication rejects missing sessions, cross-origin mutation, and bad CSRF', async (t) => {
  const passwordHash = await bcrypt.hash('password', 4);
  const auth = createAdminAuth({ store: fakeStore(passwordHash), production: false });
  const app = express(); app.use(express.json()); app.use('/api/admin/auth', auth.router); app.post('/api/admin/change', auth.requireAuth, auth.requireMutationProtection, (_req, res) => res.sendStatus(204));
  const { server, origin } = await listen(app); t.after(() => server.close());
  assert.equal((await fetch(`${origin}/api/admin/change`, { method: 'POST' })).status, 401);
  const login = await fetch(`${origin}/api/admin/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ username: 'owner', password: 'password' }) });
  const body = await login.json(); const cookie = cookieFrom(login);
  assert.equal((await fetch(`${origin}/api/admin/change`, { method: 'POST', headers: { cookie, origin: 'https://evil.example', 'x-csrf-token': body.csrfToken } })).status, 403);
  assert.equal((await fetch(`${origin}/api/admin/change`, { method: 'POST', headers: { cookie, origin } })).status, 403);
  assert.equal((await fetch(`${origin}/api/admin/change`, { method: 'POST', headers: { cookie, origin, 'x-csrf-token': body.csrfToken } })).status, 204);
});

test('login limiter keys failures by normalized username and IP', async (t) => {
  const auth = createAdminAuth({ store: fakeStore(await bcrypt.hash('password', 4)), production: false, loginLimit: 2 });
  const app = express(); app.use(express.json()); app.use('/auth', auth.router);
  const { server, origin } = await listen(app); t.after(() => server.close());
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${origin}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ username: ' OWNER ', password: 'wrong' }) });
    assert.equal(response.status, 401);
  }
  const blocked = await fetch(`${origin}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ username: 'owner', password: 'wrong' }) });
  assert.equal(blocked.status, 429);
});
