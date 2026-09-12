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

test('검색봇에 대표 URL, 사이트맵, 이지핫딜 구조화 데이터를 제공한다', () => {
  const robots = fs.readFileSync(path.join(publicDir, 'robots.txt'), 'utf8');
  const sitemap = fs.readFileSync(path.join(publicDir, 'sitemap.xml'), 'utf8');

  assert.match(html, /<link rel="canonical" href="https:\/\/easyshoopping\.com\/"\s*\/?>/);
  assert.match(html, /<script type="application\/ld\+json">/);
  assert.match(html, /"@type":\s*"WebSite"/);
  assert.match(html, /"@type":\s*"Organization"/);
  assert.match(html, /"name":\s*"이지핫딜"/);
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Disallow: \/admin\/$/m);
  assert.match(robots, /^Sitemap: https:\/\/easyshoopping\.com\/sitemap\.xml$/m);
  assert.match(sitemap, /<loc>https:\/\/easyshoopping\.com\/<\/loc>/);
});

test('로그인과 MY UI 및 관련 동작 코드가 제거되어 있다', () => {
  assert.doesNotMatch(html, /로그인|>MY<|my-button/);
  assert.doesNotMatch(script, /로그인|MY|my-button/);
  assert.doesNotMatch(styles, /my-button/);
});

test('쿠팡 파트너스 광고는 핫딜 링크와 분리된 독립 영역에서 필수 고지를 제공한다', () => {
  const popularAt = html.indexOf('id="popular"');
  const affiliateAt = html.indexOf('class="affiliate-section');
  const categoriesAt = html.indexOf('id="categories"');

  assert.ok(popularAt >= 0 && popularAt < affiliateAt && affiliateAt < categoriesAt);
  assert.match(html, /href="https:\/\/link\.coupang\.com\/a\/[A-Za-z0-9]+"/);
  assert.match(html, /rel="sponsored noopener noreferrer"/);
  assert.doesNotMatch(html, /ads-partners\.coupang\.com|<iframe/);
  assert.match(html, /쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다/);
  assert.match(styles, /\.affiliate-section\s*\{/);
  assert.match(styles, /\.affiliate-cta\s*\{/);
  assert.match(styles, /\.affiliate-disclosure\s*\{[^}]*color:\s*var\(--text-secondary\)[^}]*font-size:\s*13px[^}]*font-weight:\s*600/);
  assert.match(styles, /@media \(max-width:\s*720px\)[\s\S]*?\.section\.affiliate-section\s*\{\s*width:\s*100%/);
  assert.match(styles, /@media \(max-width:\s*720px\)[\s\S]*?\.affiliate-card\s*\{[^}]*padding:\s*20px 0/);
  assert.match(html, /id="coupangProductGrid"/);
  assert.match(script, /source:\s*'coupang'/);
  assert.match(script, /sponsored noopener noreferrer/);
});

test('MY 제거 후 모바일 메뉴는 기존 네 항목을 균등 배치한다', () => {
  assert.match(styles, /\.bottom-nav\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*1fr\)/);
});

test('운영 RSS 수집은 원문 og:image 보조 요청을 비활성화한다', () => {
  assert.match(server, /enrichImages:\s*false/);
  assert.doesNotMatch(server, /enrichImages:\s*true/);
});

test('운영 RSS 수집은 뽐뿌 작성자 본문 이미지를 R2에 저속·차단 감지 방식으로 저장한다', () => {
  assert.match(server, /createPpomppuImageProvider/);
  assert.match(server, /productMatcher:\s*null/);
  assert.doesNotMatch(server, /createNaverShoppingProvider/);
  assert.match(server, /createR2Storage/);
  assert.match(server, /ImageBackfillCircuitBreaker/);
  assert.match(server, /runGuardedImageBackfill/);
  assert.match(server, /requestIntervalMs:\s*5_000/);
  assert.match(server, /limit:\s*5/);
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

test('Render 등 차단된 실행 환경에서는 RSS 수집을 유지한 채 이미지 backfill만 끌 수 있다', () => {
  assert.match(server, /IMAGE_BACKFILL_ENABLED/);
  assert.match(server, /imageBackfillEnabled/);
  assert.match(server, /if \(imagePipeline\.enabled && imageBackfillEnabled\)/);
});

test('메인·실시간·최신 상품 영역은 실제 이미지와 기존 fallback을 함께 지원한다', () => {
  assert.match(script, /class="product-image[^"']*deal-image[^>]*loading="eager"/);
  assert.match(script, /class="popular-image[^"']*deal-image[^>]*loading="eager"/);
  assert.match(script, /class="latest-image[^"']*deal-image[^>]*loading="eager"/);
  assert.match(script, /class="latest-icon"/);
  assert.match(script, /querySelectorAll\('\.deal-image'\)/);
  assert.match(styles, /\.product-image[^}]*object-fit:\s*cover/);
  assert.match(styles, /\.popular-image[^}]*object-fit:\s*cover/);
  assert.match(styles, /\.latest-image[^}]*object-fit:\s*cover/);
});

test('공개 화면은 수동 휴대폰 특가를 전용 섹션에 표시하고 기본 목록은 RSS만 조회한다', () => {
  assert.match(script, /manual-deal-badge[^\n]*이지폰 특가/);
  assert.match(styles, /\.manual-deal-badge\s*\{/);
  assert.match(script, /DealPage\.fetchLiveDealsPage\(\{\s*query:\s*state\.query,[\s\S]*?source:\s*['"]ppomppu['"]/);
  assert.match(script, /source:\s*['"]manual['"][^\n]*featured:\s*true/);
  assert.match(script, /selectPhoneDeals\(deals,\s*\{\s*limit:\s*state\.siteSettings\.home_manual_limit\s*\}\)/);
  assert.match(script, /if \(state\.siteSettings\.home_manual_limit === 0\)/);
  assert.match(script, /fetchLiveDealsPage\(\{\s*source:\s*['"]ppomppu['"],\s*page:\s*1,\s*size:\s*6,\s*sort:\s*['"]latest['"]\s*\}\)/);
  assert.match(script, /fetchPublicSiteSettings/);
  assert.doesNotMatch(script, /mixHomeDeals\(/);
  assert.match(script, /home_manual_limit/);
});

test('상품 목록은 전체 페이지를 선다운로드하지 않고 서버 필터와 증분 페이지를 사용한다', () => {
  assert.match(html, /<script src="\/deal-page\.js" defer><\/script>[\s\S]*<script src="\/app\.js" defer><\/script>/);
  assert.doesNotMatch(script, /fetchAllLiveDeals/);
  assert.match(script, /DealPage\.fetchLiveDealsPage/);
  assert.match(script, /category:\s*state\.category/);
  assert.match(script, /sort:\s*state\.sort/);
  assert.match(script, /append:\s*true/);
  assert.match(script, /new AbortController\(\)/);
});

test('휴대폰 초특가 섹션은 검색 바로 뒤, 빠른 메뉴 앞에 있고 설정 제목과 공용 카드를 쓴다', () => {
  const searchAt = html.indexOf('class="hero-search-wrap"');
  const phoneAt = html.indexOf('id="phone-deals"');
  const quickAt = html.indexOf('class="quick-menu"');
  assert.ok(searchAt >= 0 && searchAt < phoneAt && phoneAt < quickAt);
  assert.match(html, /id="phone-deal-title"/);
  assert.match(html, /id="phoneDealGrid"/);
  assert.match(script, /selectPhoneDeals\(/);
  assert.match(script, /phone_section_title/);
  assert.match(script, /elements\.phoneDealGrid\.innerHTML\s*=\s*phoneDeals\.map\(productCard\)/);
  assert.match(script, /class="original-price"/);
});

test('검색 입력은 기존 검색 박스 전체를 label로 유지하고 시각적 문구 없이 접근 가능한 이름을 제공한다', () => {
  assert.match(html, /<label class="hero-search" for="searchInput">[\s\S]*<input id="searchInput"[^>]*aria-label="핫딜 검색"[^>]*>[\s\S]*<\/label>/);
  assert.doesNotMatch(html, /hero-search-label|>\s*핫딜 검색\s*</);
  assert.doesNotMatch(styles, /\.hero-search-label\s*\{/);
});

test('모든 상품 카드는 URL 유무에 따라 안전한 링크 또는 비활성 요소를 사용한다', () => {
  assert.match(html, /<script src="\/deal-card-link\.js" defer><\/script>[\s\S]*<script src="\/app\.js" defer><\/script>/);
  for (const className of ['deal-card', 'popular-item', 'latest-item']) {
    assert.match(script, new RegExp(`DealCardLink\\.renderCardContainer\\('${className}', deal\\.url,`));
  }

  assert.doesNotMatch(script, /<a class="(?:deal-card|popular-item|latest-item)"/);
  assert.doesNotMatch(script, /data-deal-url|bindDealClicks|window\.open/);
});

test('검색·카테고리·정렬은 URL과 동기화되고 초기 로드와 popstate에서 복원한다', () => {
  assert.match(html, /<script src="\/url-state\.js" defer><\/script>[\s\S]*<script src="\/app\.js" defer><\/script>/);
  assert.match(script, /DealUrlState\.readDealState\(window\.location\.search\)/);
  assert.match(script, /DealUrlState\.buildDealStateUrl\(window\.location/);
  assert.match(script, /window\.history\.(?:pushState|replaceState)/);
  assert.match(script, /window\.addEventListener\(['"]popstate['"]/);
  assert.match(script, /elements\.searchInput\.value\s*=\s*nextState\.query/);
  assert.match(script, /button\.dataset\.sort\s*===\s*nextState\.sort/);
});

test('공개 GET 404 미들웨어는 API 라우트 뒤에 연결된다', () => {
  assert.match(server, /require\(['"]\.\/src\/public-not-found['"]\)/);
  assert.match(server, /app\.use\(adminJsonErrorHandler\);\s*app\.use\(publicNotFound\);/);
});
