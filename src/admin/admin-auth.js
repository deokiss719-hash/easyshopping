const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const trafficCookie = require('./admin-traffic-cookie');

const COOKIE_NAME = 'admin_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const DUMMY_PASSWORD_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.0H8TnP9w5Yh6vQ7t8F9g0h1i2j3k4lK';

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function token() { return crypto.randomBytes(32).toString('base64url'); }
function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map((part) => part.trim().split(/=(.*)/s)).filter((pair) => pair[0]).map(([key, value]) => [key, decodeURIComponent(value || '')]));
}
function sameOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === req.get('host') && parsed.protocol === `${req.protocol}:`;
  } catch { return false; }
}
function equalHash(left, right) {
  if (!/^[a-f0-9]{64}$/.test(String(left)) || !/^[a-f0-9]{64}$/.test(String(right))) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function createAttemptLimiter({ limit, windowMs, maxEntries }) {
  const entries = new Map();
  function prune(at) {
    for (const [key, entry] of entries) {
      if (at - entry.startedAt >= windowMs) entries.delete(key);
    }
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  }
  return {
    isLimited(key, at) {
      prune(at);
      return (entries.get(key)?.count || 0) >= limit;
    },
    fail(key, at) {
      prune(at);
      const entry = entries.get(key);
      if (entry) entry.count += 1;
      else {
        entries.set(key, { count: 1, startedAt: at });
        while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      }
    },
    reset(key) { entries.delete(key); },
    get size() { return entries.size; },
  };
}

function createAdminAuth({
  store,
  production = process.env.NODE_ENV === 'production',
  loginLimit = 5,
  ipLoginLimit = loginLimit,
  loginWindowMs = 15 * 60 * 1000,
  maxLimiterEntries = 10_000,
  sessionTtlMs = SESSION_TTL_MS,
  now = () => new Date(),
  csrfSecret = process.env.ADMIN_SESSION_SECRET,
} = {}) {
  if (!store) throw new TypeError('admin store is required');
  if (production && !csrfSecret) throw new TypeError('ADMIN_SESSION_SECRET is required in production');
  const secret = csrfSecret == null ? crypto.randomBytes(32) : Buffer.from(csrfSecret);
  if (secret.length < 32) throw new TypeError('ADMIN_SESSION_SECRET must be at least 32 bytes');
  if (!Number.isInteger(maxLimiterEntries) || maxLimiterEntries < 1) throw new TypeError('maxLimiterEntries must be positive');
  const pairAttempts = createAttemptLimiter({ limit: loginLimit, windowMs: loginWindowMs, maxEntries: maxLimiterEntries });
  const ipAttempts = createAttemptLimiter({ limit: ipLoginLimit, windowMs: loginWindowMs, maxEntries: maxLimiterEntries });
  const router = express.Router();

  function csrfFor(sessionToken) { return crypto.createHmac('sha256', secret).update(sessionToken).digest('base64url'); }
  function cookie(value, maxAge = sessionTtlMs) {
    return `${COOKIE_NAME}=${value}; Path=/; HttpOnly${production ? '; Secure' : ''}; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(maxAge / 1000))}`;
  }
  function limiterKeys(req, username) {
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
    return { ip, pair: `${ip}|${String(username || '').trim().toLowerCase()}` };
  }

  router.post('/login', async (req, res, next) => {
    try {
      if (!sameOrigin(req)) return res.status(403).json({ error: 'same_origin_required' });
      const username = String(req.body?.username || '').trim().toLowerCase();
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (username.length > 64 || password.length > 1024) return res.status(400).json({ error: 'invalid_request' });
      const at = now(); const keys = limiterKeys(req, username); const atMs = at.getTime();
      if (ipAttempts.isLimited(keys.ip, atMs) || pairAttempts.isLimited(keys.pair, atMs)) {
        return res.status(429).set('Retry-After', String(Math.ceil(loginWindowMs / 1000))).json({ error: 'too_many_attempts' });
      }
      const user = await store.findAdmin(username);
      const passwordValid = await bcrypt.compare(password, user?.passwordHash || DUMMY_PASSWORD_HASH);
      const valid = Boolean(user?.isActive) && passwordValid;
      if (!valid) {
        ipAttempts.fail(keys.ip, atMs);
        pairAttempts.fail(keys.pair, atMs);
        return res.status(401).json({ error: 'invalid_credentials' });
      }
      ipAttempts.reset(keys.ip);
      pairAttempts.reset(keys.pair);
      const sessionToken = token();
      const csrfToken = csrfFor(sessionToken);
      const expiresAt = new Date(at.getTime() + sessionTtlMs);
      await store.createSession({ userId: user.id, tokenHash: sha256(sessionToken), csrfHash: sha256(csrfToken), expiresAt: expiresAt.toISOString() });
      await store.recordLogin(user.id);
      res.set('Cache-Control', 'no-store');
      res.append('Set-Cookie', cookie(sessionToken));
      res.append('Set-Cookie', trafficCookie.serialize(
        trafficCookie.createValue(secret, expiresAt),
        { production, maxAgeMs: sessionTtlMs },
      ));
      return res.json({ username: user.username, csrfToken, expiresAt: expiresAt.toISOString() });
    } catch (error) { return next(error); }
  });

  async function requireAuth(req, res, next) {
    try {
      const sessionToken = parseCookies(req.get('cookie'))[COOKIE_NAME];
      if (!sessionToken || !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) return res.status(401).json({ error: 'authentication_required' });
      const session = await store.getSession(sha256(sessionToken), now());
      if (!session) return res.status(401).set('Set-Cookie', cookie('', 0)).json({ error: 'authentication_required' });
      req.admin = { userId: String(session.admin_user_id || session.userId), username: session.username, sessionTokenHash: sha256(sessionToken), csrfHash: session.csrf_hash || session.csrfHash, csrfToken: csrfFor(sessionToken) };
      res.set('Cache-Control', 'no-store');
      return next();
    } catch (error) { return next(error); }
  }

  function requireMutationProtection(req, res, next) {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'same_origin_required' });
    if (!equalHash(sha256(String(req.get('x-csrf-token') || '')), req.admin?.csrfHash)) return res.status(403).json({ error: 'csrf_invalid' });
    return next();
  }

  router.get('/session', requireAuth, (req, res) => res.json({ username: req.admin.username, csrfToken: req.admin.csrfToken }));
  router.post('/logout', requireAuth, requireMutationProtection, async (req, res, next) => {
    try {
      await store.deleteSession(req.admin.sessionTokenHash);
      res.append('Set-Cookie', cookie('', 0));
      res.append('Set-Cookie', trafficCookie.serialize('', { production, maxAgeMs: 0 }));
      return res.sendStatus(204);
    } catch (error) { return next(error); }
  });

  return { router, requireAuth, requireMutationProtection };
}

module.exports = { createAdminAuth, createAttemptLimiter, sha256, parseCookies, sameOrigin, COOKIE_NAME };
