const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

test('메인 히어로에 이지핫딜 카카오톡 입장 버튼이 안전한 공개 링크로 한 번 노출된다', () => {
  const ctaMatches = html.match(/<a\b[^>]*class="kakao-room-cta"[^>]*>[\s\S]*?<\/a>/g) || [];
  assert.equal(ctaMatches.length, 1);

  const cta = ctaMatches[0];
  assert.match(cta, /href="https:\/\/open\.kakao\.com\/o\/pQIoypNi"/);
  assert.match(cta, /target="_blank"/);
  assert.match(cta, /rel="noopener noreferrer"/);
  assert.match(cta, /aria-label="이지핫딜 카톡방 입장하기 \(새 창\)"/);
  assert.match(cta, />\s*이지핫딜 카톡방 입장하기\s*<\/a>/);
  assert.match(css, /\.kakao-room-cta\s*\{/);
  assert.match(css, /\.kakao-room-cta:hover\s*\{/);
});
