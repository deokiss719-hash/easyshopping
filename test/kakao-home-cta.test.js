const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

test('상단·상품 목록·모바일 고정 영역에 안전한 카카오 유입 버튼을 제공한다', () => {
  const ctaMatches = html.match(/<a\b[^>]*data-kakao-placement="(?:hero|middle|mobile)"[^>]*>[\s\S]*?<\/a>/g) || [];
  assert.equal(ctaMatches.length, 3);

  for (const cta of ctaMatches) {
    assert.match(cta, /href="https:\/\/open\.kakao\.com\/o\/pQIoypNi"/);
    assert.match(cta, /target="_blank"/);
    assert.match(cta, /rel="noopener noreferrer"/);
  }
  assert.match(html, /data-kakao-placement="hero"[\s\S]*?>놓치기 전에 카톡으로 핫딜 알림받기<\/a>/);
  assert.match(html, /data-kakao-placement="middle"/);
  assert.match(html, /data-kakao-placement="mobile"/);
  assert.match(html, /<script src="\/cta-events\.js" defer><\/script>/);
  assert.match(css, /\.kakao-room-cta\s*\{/);
  assert.match(css, /\.kakao-room-cta:hover\s*\{/);
  assert.match(css, /\.kakao-mid-banner\s*\{/);
  assert.match(css, /\.kakao-mobile-cta\s*\{\s*display:\s*none/);
});
