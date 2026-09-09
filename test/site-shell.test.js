const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('공개 화면은 이지핫딜 브랜드명을 표시한다', () => {
  assert.match(html, /<title>이지핫딜 — 오늘 뭐가 싸지\?<\/title>/);
  assert.match(html, /aria-label="이지핫딜 홈"/);
  assert.equal((html.match(/<span class="wordmark-name">이지핫딜<\/span>/g) || []).length, 2);
  assert.doesNotMatch(html, /이지쇼핑/);
});

test('로그인과 MY UI 및 관련 동작 코드가 제거되어 있다', () => {
  assert.doesNotMatch(html, /로그인|>MY<|my-button/);
  assert.doesNotMatch(script, /로그인|MY|my-button/);
  assert.doesNotMatch(styles, /my-button/);
});

test('MY 제거 후 모바일 메뉴는 기존 네 항목을 균등 배치한다', () => {
  assert.match(styles, /\.bottom-nav\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*1fr\)/);
});

test('운영 RSS 수집은 원문 og:image 보조 요청을 비활성화한다', () => {
  assert.match(server, /enrichImages:\s*false/);
  assert.doesNotMatch(server, /enrichImages:\s*true/);
});

test('운영 RSS 수집은 뽐뿌 작성자 본문 provider와 R2 배치 파이프라인만 사용한다', () => {
  assert.match(server, /createPpomppuImageProvider/);
  assert.match(server, /productMatcher:\s*null/);
  assert.doesNotMatch(server, /createNaverShoppingProvider/);
  assert.match(server, /createR2Storage/);
  assert.match(server, /runImageBackfill\(\{ store, pipeline: imagePipeline, limit: 100, concurrency: 3 \}\)/);
});

test('신규 네이버 매칭은 중단해도 이미 저장된 네이버 이미지 CDN은 계속 표시한다', () => {
  assert.match(server, /NAVER_IMAGE_BASE_URLS/);
  assert.match(server, /imageBaseUrls[\s\S]*NAVER_IMAGE_BASE_URLS/);
  assert.match(server, /buildContentSecurityPolicy\(r2Config,\s*\{\s*enabled:\s*true,\s*imageBaseUrls:\s*NAVER_IMAGE_BASE_URLS,?\s*\}\)/);
});

test('RSS 수집 실패와 무관하게 R2 backfill을 별도 보호 구간에서 실행한다', () => {
  assert.match(server, /let collectionError = null/);
  assert.match(server, /catch \(error\) \{\s*collectionError = error;/);
  assert.match(server, /if \(collectionError\) throw collectionError/);
});

test('메인·실시간·최신 상품 영역은 실제 이미지와 기존 fallback을 함께 지원한다', () => {
  assert.match(script, /class="product-image[^"']*deal-image/);
  assert.match(script, /class="popular-image[^"']*deal-image/);
  assert.match(script, /class="latest-image[^"']*deal-image/);
  assert.match(script, /class="latest-icon"/);
  assert.match(script, /querySelectorAll\('\.deal-image'\)/);
  assert.match(styles, /\.product-image[^}]*object-fit:\s*cover/);
  assert.match(styles, /\.popular-image[^}]*object-fit:\s*cover/);
  assert.match(styles, /\.latest-image[^}]*object-fit:\s*cover/);
});
