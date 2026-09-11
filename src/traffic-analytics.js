const crypto = require('node:crypto');
const adminTrafficCookie = require('./admin/admin-traffic-cookie');

const COOKIE_NAME = 'daily_visitor';
const BOT_PATTERN = /bot|crawler|spider|slurp|headless|lighthouse|curl|wget|facebookexternalhit|twitterbot|kakaotalk-scrap|preview/i;
const SEARCH_HOSTS = /(^|\.)(google\.com|google\.co\.kr|bing\.com|search\.naver\.com|m\.search\.naver\.com|search\.daum\.net|search\.zum\.com)$/;
const SOCIAL_HOSTS = /(^|\.)(instagram\.com|threads\.net|facebook\.com|t\.co|x\.com|twitter\.com|youtube\.com|youtu\.be|kakao\.com|kakaostory\.com)$/;
const SENSITIVE_QUERY_PARAM = /^(access_?token|token|auth(?:orization)?|password|passwd|session_?id|sid|code|api_?key|secret|email|phone|tel)$/i;
const SEARCH_QUERY_PARAMS = ['query', 'q', 'keyword', 'search_query'];
const SAFE_REFERRER_QUERY_PARAMS = new Set([
  ...SEARCH_QUERY_PARAMS,
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'ref', 'source', 'campaign', 'affiliate_id', 'gclid', 'fbclid',
]);

function koreaDay(at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function truncateUtf16(value, maxLength) {
  let output = '';
  for (const character of value) {
    if (output.length + character.length > maxLength) break;
    output += character;
  }
  return output;
}

function validHostname(value) {
  if (!value || value.length > 253 || !/^[a-z0-9.-]+$/.test(value)) return false;
  if (value.startsWith('.') || value.endsWith('.') || value.includes('..')) return false;
  return value.split('.').every((label) => label.length >= 1 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'));
}

function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return ''; }
  }
  return '';
}

function classifyReferrer(value, siteHosts = new Set()) {
  if (!value) return { source: 'direct', domain: '' };
  try {
    const parsed = new URL(String(value));
    if (!['http:', 'https:'].includes(parsed.protocol)) return { source: 'direct', domain: '' };
    const domain = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!validHostname(domain)) return { source: 'direct', domain: '' };
    if (siteHosts.has(domain)) return { source: 'internal', domain };
    if (SEARCH_HOSTS.test(domain)) return { source: 'search', domain };
    if (SOCIAL_HOSTS.test(domain)) return { source: 'social', domain };
    return { source: 'referral', domain };
  } catch {
    return { source: 'direct', domain: '' };
  }
}

function analyzeReferrer(value, siteHosts = new Set()) {
  const classified = classifyReferrer(value, siteHosts);
  if (!value || classified.source === 'direct') return { ...classified, searchTerm: '', referrerUrl: '' };
  try {
    const parsed = new URL(String(value));
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    let searchTerm = '';
    if (classified.source === 'search') {
      for (const key of SEARCH_QUERY_PARAMS) {
        const candidate = parsed.searchParams.get(key)?.trim();
        if (candidate) {
          searchTerm = truncateUtf16(candidate.normalize('NFKC')
            .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim(), 200);
          break;
        }
      }
    }
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_PARAM.test(key) || !SAFE_REFERRER_QUERY_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    const normalizedUrl = parsed.toString();
    return { ...classified, searchTerm, referrerUrl: normalizedUrl.length <= 2048 ? normalizedUrl : '' };
  } catch {
    return { ...classified, searchTerm: '', referrerUrl: '' };
  }
}

function shouldTrackRequest(req) {
  if (req.method !== 'GET' || !['/', '/index.html'].includes(req.path)) return false;
  const userAgent = String(req.get('user-agent') || '').trim();
  if (!userAgent || BOT_PATTERN.test(userAgent)) return false;
  const purpose = `${req.get('purpose') || ''} ${req.get('sec-purpose') || ''}`;
  if (/prefetch|prerender/i.test(purpose)) return false;
  const destination = String(req.get('sec-fetch-dest') || '').toLowerCase();
  if (destination && destination !== 'document') return false;
  return true;
}

function hmac(secret, purpose, day, id) {
  return crypto.createHmac('sha256', secret).update(`${purpose}\0${day}\0${id}`).digest();
}

function cookieVisitor(cookieHeader, secret, day) {
  const value = cookieValue(cookieHeader, COOKIE_NAME);
  const match = value.match(/^(\d{4}-\d{2}-\d{2})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/);
  if (!match || match[1] !== day) return null;
  const expected = hmac(secret, 'traffic-cookie-v1', day, match[2]);
  let supplied;
  try { supplied = Buffer.from(match[3], 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  return match[2];
}

function newVisitorCookie(secret, day) {
  const id = crypto.randomBytes(16).toString('base64url');
  const signature = hmac(secret, 'traffic-cookie-v1', day, id).toString('base64url');
  return { id, value: `${day}.${id}.${signature}` };
}

function secondsUntilNextKoreaDay(at, day) {
  const nextMidnight = new Date(`${day}T15:00:00.000Z`).getTime();
  return Math.max(1, Math.ceil((nextMidnight - at.getTime()) / 1000));
}

function createTrafficAnalytics({
  store,
  secret,
  production = process.env.NODE_ENV === 'production',
  siteHosts = ['easyshoopping.com', 'www.easyshoopping.com', 'easyshopping-0rku.onrender.com'],
  now = () => new Date(),
  logger = console,
} = {}) {
  if (!store?.recordPageView) throw new TypeError('analytics store is required');
  const key = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret || ''));
  if (key.length < 32) throw new TypeError('analytics secret must be at least 32 bytes');
  const ownHosts = new Set(siteHosts.map((host) => String(host).trim().toLowerCase()).filter(validHostname));

  return (req, res, next) => {
    if (!shouldTrackRequest(req)) return next();
    const at = now();
    const cookieHeader = req.get('cookie');
    if (adminTrafficCookie.isValid(cookieHeader, key, at)) return next();
    const day = koreaDay(at);
    let visitorId = cookieVisitor(cookieHeader, key, day);
    if (!visitorId) {
      const created = newVisitorCookie(key, day);
      visitorId = created.id;
      const attributes = [
        `${COOKIE_NAME}=${created.value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
        `Max-Age=${secondsUntilNextKoreaDay(at, day)}`,
      ];
      if (production) attributes.push('Secure');
      res.append('Set-Cookie', attributes.join('; '));
    }
    const visitorHash = hmac(key, 'traffic-db-v1', day, visitorId).toString('hex');
    const { source, domain, searchTerm, referrerUrl } = analyzeReferrer(req.get('referer'), ownHosts);
    res.once('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 400) return;
      Promise.resolve(store.recordPageView({ day, visitorHash, source, domain, searchTerm, referrerUrl }))
        .catch(() => logger.warn('traffic analytics write failed'));
    });
    return next();
  };
}

module.exports = {
  COOKIE_NAME, analyzeReferrer, classifyReferrer, createTrafficAnalytics, koreaDay, shouldTrackRequest,
};
