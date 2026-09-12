const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const pixel = fs.readFileSync(path.join(root, 'public/meta-pixel.js'), 'utf8');
const { buildContentSecurityPolicy } = require('../src/content-security-policy');

const PIXEL_ID = '1175739998075582';

test('홈페이지는 자체 정적 로더로 지정된 Meta Pixel PageView를 한 번 초기화한다', () => {
  assert.equal((html.match(/<script src="\/meta-pixel\.js"><\/script>/g) || []).length, 1);
  assert.equal((pixel.match(/1175739998075582/g) || []).length, 1);
  assert.equal((pixel.match(/fbq\('init', '1175739998075582'\)/g) || []).length, 1);
  assert.equal((pixel.match(/fbq\('track', 'PageView'\)/g) || []).length, 1);
  assert.match(pixel, /https:\/\/connect\.facebook\.net\/en_US\/fbevents\.js/);
  assert.doesNotMatch(html, /unsafe-inline|connect\.facebook\.net\/en_US\/fbevents\.js/);
});

test('JavaScript 비활성 환경도 CSP 위반 없이 동일한 픽셀 ID의 PageView를 전송한다', () => {
  assert.match(html, new RegExp(`<noscript><img hidden[^>]*src="https://www\\.facebook\\.com/tr\\?id=${PIXEL_ID}&amp;ev=PageView&amp;noscript=1"[^>]*></noscript>`));
  assert.doesNotMatch(html, /<noscript>[\s\S]*?<img[^>]*\sstyle=/i);
});

test('CSP는 Meta Pixel에 필요한 정확한 HTTPS 출처만 허용한다', () => {
  const policy = buildContentSecurityPolicy({ enabled: false }, { enabled: false });
  assert.match(policy, /script-src 'self' https:\/\/connect\.facebook\.net(?:;|\s)/);
  assert.match(policy, /connect-src 'self' https:\/\/www\.facebook\.com(?:;|\s)/);
  assert.match(policy, /img-src[^;]*https:\/\/www\.facebook\.com/);
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval|https:\/\/\*\.facebook\.com/);
});
