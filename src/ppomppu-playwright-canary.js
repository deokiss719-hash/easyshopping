'use strict';

const net = require('node:net');
const { XMLParser, XMLValidator } = require('fast-xml-parser');

const RSS_URL = 'https://www.ppomppu.co.kr/rss.php?id=ppomppu';
const MAX_RSS_BYTES = 1024 * 1024;
const POST_URL_PATTERN = /^https:\/\/www\.ppomppu\.co\.kr\/zboard\/view\.php\?id=ppomppu&no=[1-9]\d*$/;
const RSS_POST_URL_PATTERN = /^https?:\/\/www\.ppomppu\.co\.kr\/zboard\/view\.php\?id=ppomppu&no=[1-9]\d*$/;
const XML_CONTENT_TYPE_PATTERN = /^(?:application\/(?:rss\+xml|xml)|text\/xml)(?:\s*;|$)/i;
const RESTRICTION_PATTERN = /captcha|recaptcha|비정상(?:적인)?\s*접근|접근\s*(?:이|이?가)?\s*제한|서비스\s*이용\s*제한|자동\s*등록\s*방지|로봇이\s*아닙니다|access\s*(?:denied|restricted)|unusual\s*traffic|verify\s*(?:that\s*)?you(?:'re| are)\s*human/i;

function requirePostUrl(value, label = 'post URL') {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!POST_URL_PATTERN.test(raw)) {
    throw new Error(`${label} must exactly match the Ppomppu post URL`);
  }
  return raw;
}

function normalizeRssPostUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!RSS_POST_URL_PATTERN.test(raw)) {
    throw new Error('RSS first item link must exactly match the Ppomppu post URL');
  }
  return requirePostUrl(raw.replace(/^http:/, 'https:'), 'RSS first item link');
}

function normalizeHostname(hostname) {
  return hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
}

function requireHttpUrl(value, label) {
  const raw = typeof value === 'string' ? value.trim() : '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('merchant URL must use HTTP or HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not contain credentials`);
  }

  const hostname = normalizeHostname(parsed.hostname);
  const isLocalName = hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname.endsWith('.home.arpa');
  if (!hostname.includes('.') || isLocalName || net.isIP(hostname) !== 0) {
    throw new Error(`${label} must use a public multi-label hostname, not a local name or literal IP`);
  }
  const safePort = parsed.protocol === 'http:' ? '80' : '443';
  if (parsed.port && parsed.port !== safePort) {
    throw new Error(`${label} must not use an unsafe port`);
  }
  return parsed.href;
}

function decodePpomppuTarget(href) {
  const redirect = new URL(requireHttpUrl(href, 'topTitleLinkHref'));
  if (normalizeHostname(redirect.hostname) !== 's.ppomppu.co.kr') {
    return requireHttpUrl(redirect.href, 'topTitleLinkHref');
  }

  const targets = redirect.search.slice(1).split('&').flatMap((part) => {
    const separator = part.indexOf('=');
    const rawName = separator < 0 ? part : part.slice(0, separator);
    const rawValue = separator < 0 ? '' : part.slice(separator + 1);
    try {
      return decodeURIComponent(rawName) === 'target' ? [decodeURIComponent(rawValue)] : [];
    } catch {
      throw new Error('s.ppomppu redirect target is invalid');
    }
  });
  if (targets.length === 0 || !targets[0]) throw new Error('s.ppomppu redirect target is missing');
  if (targets.length !== 1) throw new Error('s.ppomppu redirect target must not be duplicated');

  const encodedTarget = targets[0];
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedTarget)) {
    throw new Error('s.ppomppu redirect target is invalid');
  }
  const bytes = Buffer.from(encodedTarget, 'base64');
  if (bytes.toString('base64') !== encodedTarget) throw new Error('s.ppomppu redirect target is invalid');
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
  } catch {
    throw new Error('s.ppomppu redirect target is invalid UTF-8');
  }
  if (!decoded) throw new Error('s.ppomppu redirect target is invalid');
  return requireHttpUrl(decoded, 's.ppomppu redirect target');
}

function parseFirstRssPostUrl(xml) {
  if (typeof xml !== 'string' || !xml.trim()) throw new Error('RSS body is empty');
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new Error('RSS XML is malformed');

  let parsed;
  try {
    parsed = new XMLParser({ trimValues: true, parseTagValue: false }).parse(xml);
  } catch {
    throw new Error('RSS XML is malformed');
  }
  const channel = parsed?.rss?.channel;
  const firstItem = Array.isArray(channel?.item) ? channel.item[0] : channel?.item;
  if (!firstItem || typeof firstItem !== 'object') throw new Error('RSS first item is missing or malformed');
  if (typeof firstItem.link !== 'string' || !firstItem.link.trim()) {
    throw new Error('RSS first item link is missing or malformed');
  }
  return normalizeRssPostUrl(firstItem.link);
}

function validateRssResponse(response) {
  if (!response || !response.ok) {
    throw new Error(`RSS request failed with HTTP ${response?.status ?? 'none'}`);
  }
  if (response.url !== RSS_URL) throw new Error('RSS response URL did not remain the exact configured endpoint');
  const contentType = response.headers?.get?.('content-type') || '';
  if (!XML_CONTENT_TYPE_PATTERN.test(contentType.trim())) {
    throw new Error('RSS response content type must be XML/RSS');
  }
  const contentLength = response.headers?.get?.('content-length');
  if (contentLength != null && contentLength !== '') {
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > MAX_RSS_BYTES) {
      throw new Error(`RSS body exceeds ${MAX_RSS_BYTES} bytes`);
    }
  }
}

async function readCappedBody(response, maxBytes = MAX_RSS_BYTES) {
  if (!response.body?.getReader) throw new Error('RSS response body is not readable');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`RSS body exceeds ${maxBytes} bytes`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function evaluateCanarySnapshot(snapshot) {
  requirePostUrl(snapshot.postUrl);
  if (snapshot.httpStatus !== 200) throw new Error(`HTTP 200 required; received ${snapshot.httpStatus ?? 'none'}`);
  if (!snapshot.topTitlePresent) throw new Error('#topTitle is missing');
  if (!snapshot.boardContentsPresent) throw new Error('.board-contents is missing');
  if (!snapshot.topTitleLinkHref) throw new Error('.topTitle-link a is missing');

  const captchaOrRestriction = RESTRICTION_PATTERN.test(String(snapshot.pageText || ''));
  if (captchaOrRestriction) throw new Error('CAPTCHA or access restriction detected');

  const linkTextUrl = requireHttpUrl(snapshot.topTitleLinkText, '.topTitle-link a text');
  const dataUrl = requireHttpUrl(snapshot.dataUrl, '[data-url]');
  const hrefTargetUrl = decodePpomppuTarget(snapshot.topTitleLinkHref);
  if (new Set([linkTextUrl, dataUrl, hrefTargetUrl]).size !== 1) {
    throw new Error('merchant URL candidates do not match');
  }

  const merchantDomain = normalizeHostname(new URL(linkTextUrl).hostname);
  if (merchantDomain === 'ppomppu.co.kr' || merchantDomain.endsWith('.ppomppu.co.kr')) {
    throw new Error('merchant URL must be external to ppomppu.co.kr');
  }

  return {
    success: true,
    playwrightSuccess: true,
    postUrl: snapshot.postUrl,
    httpStatus: snapshot.httpStatus,
    topTitleLinkPresent: true,
    merchantUrl: linkTextUrl,
    merchantDomain,
    dataUrlMatches: true,
    captchaOrRestriction: false,
    verdict: 'success',
  };
}

module.exports = {
  MAX_RSS_BYTES,
  RSS_URL,
  decodePpomppuTarget,
  evaluateCanarySnapshot,
  parseFirstRssPostUrl,
  readCappedBody,
  requireHttpUrl,
  requirePostUrl,
  validateRssResponse,
};
