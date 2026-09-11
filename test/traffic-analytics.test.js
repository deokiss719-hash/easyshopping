const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  COOKIE_NAME,
  analyzeReferrer,
  classifyReferrer,
  createTrafficAnalytics,
  koreaDay,
  shouldTrackRequest,
} = require('../src/traffic-analytics');
const adminTrafficCookie = require('../src/admin/admin-traffic-cookie');

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('analytics write did not complete');
}

test('Korea day changes at 15:00 UTC', () => {
  assert.equal(koreaDay(new Date('2026-09-11T14:59:59.999Z')), '2026-09-11');
  assert.equal(koreaDay(new Date('2026-09-11T15:00:00.000Z')), '2026-09-12');
});

test('referrer classification keeps only a bounded hostname', () => {
  const ownHosts = new Set(['easyshoopping.com', 'www.easyshoopping.com']);
  assert.deepEqual(classifyReferrer('', ownHosts), { source: 'direct', domain: '' });
  assert.deepEqual(classifyReferrer('not a url', ownHosts), { source: 'direct', domain: '' });
  assert.deepEqual(classifyReferrer('https://easyshoopping.com/deals?q=secret', ownHosts), { source: 'internal', domain: 'easyshoopping.com' });
  assert.deepEqual(classifyReferrer('https://search.naver.com/search.naver?query=secret', ownHosts), { source: 'search', domain: 'search.naver.com' });
  assert.deepEqual(classifyReferrer('https://www.google.com/search?q=secret', ownHosts), { source: 'search', domain: 'www.google.com' });
  assert.deepEqual(classifyReferrer('https://google.evil.example/search?q=secret', ownHosts), { source: 'referral', domain: 'google.evil.example' });
  assert.deepEqual(classifyReferrer('https://l.instagram.com/?u=https%3A%2F%2Fevil.example', ownHosts), { source: 'social', domain: 'l.instagram.com' });
  assert.deepEqual(classifyReferrer('https://community.example/path?member=someone', ownHosts), { source: 'referral', domain: 'community.example' });
  assert.deepEqual(classifyReferrer('javascript:alert(1)', ownHosts), { source: 'direct', domain: '' });
  assert.deepEqual(classifyReferrer(`https://${'a'.repeat(254)}.example/path`, ownHosts), { source: 'direct', domain: '' });
});

test('referrer details keep search terms and sanitized URLs without secrets or fragments', () => {
  const ownHosts = new Set(['easyshoopping.com']);
  assert.deepEqual(
    analyzeReferrer('https://search.naver.com/search.naver?query=%EA%B0%A4%EB%9F%AD%EC%8B%9C%0A%20S26&utm_source=naver&token=do-not-store&refresh_token=secret2&client_secret=private&user%5Bemail%5D=a%40b.com#account', ownHosts),
    {
      source: 'search',
      domain: 'search.naver.com',
      searchTerm: '갤럭시 S26',
      referrerUrl: 'https://search.naver.com/search.naver?query=%EA%B0%A4%EB%9F%AD%EC%8B%9C%0A+S26&utm_source=naver',
    },
  );
  assert.deepEqual(
    analyzeReferrer('https://community.example/deals/42?campaign=fall&session_id=private', ownHosts),
    {
      source: 'referral',
      domain: 'community.example',
      searchTerm: '',
      referrerUrl: 'https://community.example/deals/42?campaign=fall',
    },
  );
  const emojiSearch = analyzeReferrer(`https://www.google.com/search?q=${encodeURIComponent('📱'.repeat(101))}`, ownHosts);
  assert.equal(emojiSearch.searchTerm, '📱'.repeat(100));
  assert.equal(emojiSearch.searchTerm.length, 200);
});

test('tracking allowlist accepts only real homepage document GETs', () => {
  const request = (overrides = {}) => ({
    method: 'GET', path: '/',
    get(name) {
      const headers = { 'user-agent': 'Mozilla/5.0 Safari/605.1', 'sec-fetch-dest': 'document' };
      return (overrides.headers || {})[name.toLowerCase()] ?? headers[name.toLowerCase()];
    },
    ...overrides,
  });
  assert.equal(shouldTrackRequest(request()), true);
  assert.equal(shouldTrackRequest(request({ path: '/index.html' })), true);
  for (const path of ['/admin', '/api/live-deals', '/styles.css', '/robots.txt', '/sitemap.xml', '/google-token.html']) {
    assert.equal(shouldTrackRequest(request({ path })), false, path);
  }
  assert.equal(shouldTrackRequest(request({ method: 'HEAD' })), false);
  assert.equal(shouldTrackRequest(request({ headers: { 'user-agent': 'Googlebot/2.1' } })), false);
  assert.equal(shouldTrackRequest(request({ headers: { 'user-agent': 'Mozilla/5.0', 'purpose': 'prefetch' } })), false);
  assert.equal(shouldTrackRequest(request({ headers: { 'user-agent': 'Mozilla/5.0', 'sec-fetch-dest': 'image' } })), false);
  assert.equal(shouldTrackRequest(request({ headers: { 'user-agent': '', 'sec-fetch-dest': 'document' } })), false);
});

test('middleware counts same daily browser once and stores sanitized search referral details', async (t) => {
  const calls = [];
  const store = { async recordPageView(value) { calls.push(value); } };
  const analytics = createTrafficAnalytics({
    store,
    secret: 'x'.repeat(32),
    production: false,
    siteHosts: ['easyshoopping.com'],
    now: () => new Date('2026-09-11T12:00:00Z'),
  });
  const app = express();
  app.use(analytics);
  app.get('/', (_req, res) => res.send('ok'));
  const { server, origin } = await listen(app);
  t.after(() => server.close());

  const headers = {
    'user-agent': 'Mozilla/5.0 Safari/605.1',
    'sec-fetch-dest': 'document',
    referer: 'https://search.naver.com/search.naver?query=%EA%B0%A4%EB%9F%AD%EC%8B%9C&access_token=private',
  };
  const first = await fetch(`${origin}/`, { headers });
  assert.equal(first.status, 200);
  const setCookie = first.headers.get('set-cookie');
  assert.match(setCookie, new RegExp(`^${COOKIE_NAME}=`));
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);

  const cookie = setCookie.split(';', 1)[0];
  assert.equal((await fetch(`${origin}/`, { headers: { ...headers, cookie } })).status, 200);
  await waitFor(() => calls.length === 2);
  assert.equal(calls[0].day, '2026-09-11');
  assert.equal(calls[0].source, 'search');
  assert.equal(calls[0].domain, 'search.naver.com');
  assert.equal(calls[0].searchTerm, '갤럭시');
  assert.equal(calls[0].referrerUrl, 'https://search.naver.com/search.naver?query=%EA%B0%A4%EB%9F%AD%EC%8B%9C');
  assert.match(calls[0].visitorHash, /^[a-f0-9]{64}$/);
  assert.equal(calls[1].visitorHash, calls[0].visitorHash);
  const serialized = JSON.stringify(calls);
  assert.equal(serialized.includes('private'), false);
  assert.equal(serialized.includes('Mozilla'), false);
  assert.equal(serialized.includes('127.0.0.1'), false);
});

test('middleware excludes signed admin sessions and isolates analytics failures from public responses', async (t) => {
  let calls = 0;
  const secret = 'x'.repeat(32);
  const adminValue = adminTrafficCookie.createValue(secret, new Date('2026-09-12T00:00:00Z'));
  const analytics = createTrafficAnalytics({
    store: { async recordPageView() { calls += 1; throw new Error('database contains private details'); } },
    secret,
    production: false,
    logger: { warn() {} },
  });
  const app = express(); app.use(analytics); app.get('/', (_req, res) => res.send('ok'));
  const { server, origin } = await listen(app); t.after(() => server.close());
  const base = { 'user-agent': 'Mozilla/5.0', 'sec-fetch-dest': 'document' };
  assert.equal((await fetch(`${origin}/`, { headers: { ...base, cookie: `${adminTrafficCookie.COOKIE_NAME}=${adminValue}` } })).status, 200);
  assert.equal((await fetch(`${origin}/`, { headers: base })).status, 200);
  await waitFor(() => calls === 1);
});

test('malformed and fake admin cookies never break or evade homepage analytics', async (t) => {
  let calls = 0;
  const analytics = createTrafficAnalytics({
    store: { async recordPageView() { calls += 1; } },
    secret: 'x'.repeat(32),
    production: false,
  });
  const app = express(); app.use(analytics); app.get('/', (_req, res) => res.send('ok'));
  const { server, origin } = await listen(app); t.after(() => server.close());
  const base = { 'user-agent': 'Mozilla/5.0', 'sec-fetch-dest': 'document' };
  assert.equal((await fetch(`${origin}/`, { headers: { ...base, cookie: 'broken=%; admin_session=x' } })).status, 200);
  assert.equal((await fetch(`${origin}/`, { headers: { ...base, cookie: `${adminTrafficCookie.COOKIE_NAME}=9999999999999.${'b'.repeat(43)}` } })).status, 200);
  await waitFor(() => calls === 2);
});
