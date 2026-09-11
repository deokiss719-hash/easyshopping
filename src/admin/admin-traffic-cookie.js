const crypto = require('node:crypto');

const COOKIE_NAME = 'admin_traffic_exempt';
const VALUE_PATTERN = /^(\d{13})\.([A-Za-z0-9_-]{43})$/;

function secretBuffer(secret) {
  const value = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret || ''));
  if (value.length < 32) throw new TypeError('traffic exemption secret must be at least 32 bytes');
  return value;
}

function signature(secret, expiresAtMs) {
  return crypto.createHmac('sha256', secretBuffer(secret))
    .update(`admin-traffic-exempt-v1\0${expiresAtMs}`)
    .digest('base64url');
}

function createValue(secret, expiresAt) {
  const expiresAtMs = expiresAt instanceof Date ? expiresAt.getTime() : Number(expiresAt);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0) throw new TypeError('valid expiration is required');
  return `${expiresAtMs}.${signature(secret, expiresAtMs)}`;
}

function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return ''; }
  }
  return '';
}

function isValid(header, secret, now = new Date()) {
  const match = cookieValue(header, COOKIE_NAME).match(VALUE_PATTERN);
  if (!match) return false;
  const expiresAtMs = Number(match[1]);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= now.getTime()) return false;
  const expected = signature(secret, expiresAtMs);
  return crypto.timingSafeEqual(Buffer.from(match[2]), Buffer.from(expected));
}

function serialize(value, { production = false, maxAgeMs } = {}) {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly${production ? '; Secure' : ''}; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`;
}

module.exports = { COOKIE_NAME, createValue, isValid, serialize };
