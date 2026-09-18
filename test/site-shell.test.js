const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');
const communityHtml = fs.readFileSync(path.join(publicDir, 'community.html'), 'utf8');
const communityScript = fs.readFileSync(path.join(publicDir, 'community.js'), 'utf8');
const communityStyles = fs.readFileSync(path.join(publicDir, 'community.css'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('커뮤니티 관리자 댓글은 공개 화면에서 관리자 표시와 전용 스타일로 구분한다', () => {
  assert.match(communityScript, /comment\.isAdmin\?'이지핫딜 관리자'/);
  assert.match(communityScript, /text\('span','공식 답변','admin-badge'\)/);
  assert.match(communityScript, /comment\.isAdmin\?' is-admin'/);
  assert.match(communityStyles, /\.comment\.is-admin\{/);
  assert.match(communityStyles, /\.admin-badge\{/);
});


test('커뮤니티 공지글은 목록과 상세에서 공지 배지로 표시한다', () => {
  assert.match(communityScript, /post\.isNotice/);
  assert.match(communityScript, /'공지','notice-badge'/);
  assert.match(communityStyles, /\.notice-badge\{/);
});

test('관리자가 고정한 일반 글은 공개 화면에서 고정 배지로 표시한다', () => {
  assert.match(communityScript, /post\.isPinned/);
  assert.match(communityScript, /'고정','notice-badge'/);
  assert.match(communityScript, /post\.answered/);
  assert.match(communityScript, /'관리자 답변','answer-badge'/);
});

test('커뮤니티 대댓글에도 계속 답글을 달고 깊이를 표시한다', () => {
  assert.match(communityScript, /actions\.append\(actionButton\('답글'/);
  assert.match(communityScript, /inline-reply-form/);
  assert.match(communityScript, /replyComment\(postId,comment\.id,article\)/);
  assert.doesNotMatch(communityScript, /prompt\('답글을 입력하세요\.'/);
  assert.match(communityScript, /--reply-depth/);
  assert.match(communityStyles, /--reply-depth/);
});

test('커뮤니티 작성자 닉네임 옆에 디시 스타일 IP 괄호 표기를 표시한다', () => {
  assert.match(communityScript, /authorLabel\(post\.nickname,post\.ipDisplay\)/);
  assert.match(communityScript, /`\(\$\{ipDisplay\}\)`/);
  assert.match(communityScript, /comment\.ipDisplay/);
  assert.match(communityStyles, /\.ip-display\{/);
});

test('커뮤니티 글 작성에서 이미지를 선택해 업로드하고 상세에서 반응형으로 표시한다', () => {
  assert.match(communityHtml, /id="compose-image" type="file"/);
  assert.match(communityHtml, /accept="image\/jpeg,image\/png,image\/webp,image\/gif,image\/avif"/);
  assert.match(communityHtml, /id="compose-image-preview"/);
  assert.match(communityScript, /fetch\('\/api\/community\/images'/);
  assert.match(communityScript, /imageUrl:imageUrl\|\|undefined/);
  assert.match(communityScript, /post\.imageUrl/);
  assert.match(communityStyles, /\.post-image\{/);
  assert.match(communityStyles, /max-width:100%/);
});


test('커뮤니티 공개 화면은 모바일 폭에서 목록·검색·상세·댓글이 가로로 넘치지 않게 배치한다', () => {
  assert.match(communityStyles, /\.community-hero\{align-items:stretch;flex-direction:column/);
  assert.match(communityStyles, /\.community-tools form\{display:grid;grid-template-columns:92px minmax\(0,1fr\)/);
  assert.match(communityStyles, /\.community-row\{grid-template-columns:64px minmax\(0,1fr\) auto/);
  assert.match(communityStyles, /\.post-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(communityStyles, /\.community-dialog\{width:calc\(100% - 20px\);max-height:calc\(100dvh - 20px\)/);
  assert.match(communityStyles, /\.comment-head\{flex-wrap:wrap/);
  assert.match(communityStyles, /\.comment-body\{overflow-wrap:anywhere/);
});

test('공개 화면은 이지핫딜 브랜드명을 표시한다', () => {
  assert.match(html, /<title>실시간 핫딜 모음·오늘의 특가 \| 이지핫딜<\/title>/);
  assert.match(html, /<h1 id="hero-title">실시간 핫딜, 오늘 뭐가 싸지\?<\/h1>/);
  assert.match(html, /aria-label="이지핫딜 홈"/);
  assert.equal((html.match(/<span class="wordmark-name">이지핫딜<\/span>/g) || []).length, 2);
  assert.doesNotMatch(html, /이지쇼핑/);
});

test('검색봇에 대표 URL, 사이트맵, 이지핫딜 구조화 데이터를 제공한다', () => {
  const robots = fs.readFileSync(path.join(publicDir, 'robots.txt'), 'utf8');
  const sitemap = fs.readFileSync(path.join(publicDir, 'sitemap.xml'), 'utf8');

  assert.match(html, /<link rel="canonical" href="https:\/\/easyshoopping\.com\/"\s*\/?>/);
  assert.match(html, /<link rel="icon" type="image\/png" sizes="512x512" href="\/favicon\.png"\s*\/?>/);
  assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png"\s*\/?>/);
  assert.match(html, /"logo":\s*"https:\/\/easyshoopping\.com\/favicon\.png"/);
  for (const asset of ['favicon.png', 'favicon.ico', 'apple-touch-icon.png']) {
    assert.equal(fs.existsSync(path.join(publicDir, asset)), true);
  }
  assert.match(html, /<script type="application\/ld\+json">/);
  assert.match(html, /"@type":\s*"WebSite"/);
  assert.match(html, /"@type":\s*"Organization"/);
  assert.match(html, /"@type":\s*"SearchAction"/);
  assert.match(html, /"urlTemplate":\s*"https:\/\/easyshoopping\.com\/\?q=\{search_term_string\}"/);
  assert.match(html, /"name":\s*"이지핫딜"/);
  assert.match(html, /<meta name="keywords" content="실시간 핫딜, 핫딜 모음, 오늘의 핫딜, 특가 상품, 토스쇼핑 핫딜, 커뮤니티 핫딜, 할인 정보"/);
  assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"/);
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Disallow: \/admin\/$/m);
  assert.match(robots, /^Sitemap: https:\/\/easyshoopping\.com\/sitemap\.xml$/m);
  assert.match(sitemap, /<loc>https:\/\/easyshoopping\.com\/<\/loc>/);
  assert.match(sitemap, /<lastmod>2026-09-16<\/lastmod>/);
  for (const slug of ['food', 'digital', 'living', 'fashion']) assert.match(html, new RegExp(`href="/hot-deals/${slug}"`));
});

test('로그인과 MY UI 및 관련 동작 코드가 제거되어 있다', () => {
  assert.doesNotMatch(html, /로그인|>MY<|my-button/);
  assert.doesNotMatch(script, /로그인|MY|my-button/);
  assert.doesNotMatch(styles, /my-button/);
});

test('홈페이지에서 쿠팡 파트너스 홍보와 상품 호출을 노출하지 않는다', () => {
  for (const content of [html, script, styles]) {
    assert.doesNotMatch(content, /쿠팡 추천 상품|쿠팡 파트너스|link\.coupang\.com|coupangProductGrid|affiliate-section|affiliate-cta/);
  }
  assert.doesNotMatch(script, /source:\s*['"]coupang['"]/);
});

test('MY 제거 후 모바일 메뉴는 기존 네 항목을 균등 배치한다', () => {
  assert.match(styles, /\.bottom-nav\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*1fr\)/);
});

test('모바일 상품 카드에서도 커뮤니티 출처를 표시한다', () => {
  assert.doesNotMatch(styles, /\.card-store span\s*\{\s*display:\s*none;\s*\}/);
});

test('운영 RSS 수집은 원문 og:image 보조 요청을 비활성화한다', () => {
  assert.match(server, /enrichImages:\s*false/);
  assert.doesNotMatch(server, /enrichImages:\s*true/);
});

test('FMKorea 수집기는 명시적으로 활성화된 경우에만 RSS readiness와 독립적으로 시작한다', () => {
  assert.match(server, /const fmkoreaRuntime = readFmkoreaRuntime\(process\.env\)/);
  assert.match(server, /if \(fmkoreaRuntime\.enabled\) \{[\s\S]*?startFmkoreaScheduler\(/);
  assert.match(server, /createCollectionRunStore\(pool, ['"]fmkorea['"]\)/);
  assert.match(server, /runFmkoreaCollector\(\{[\s\S]*?timeoutMs:\s*fmkoreaRuntime\.timeoutMs/);
  assert.doesNotMatch(server, /freshnessThresholdMs:\s*fmkoreaRuntime/);
});

test('Ruliweb 수집기는 기본 OFF runtime, 실행 기록, 공용 poller에 연결된다', () => {
  assert.match(server, /const ruliwebRuntime = readRuliwebRuntime\(process\.env\)/);
  assert.match(server, /if \(ruliwebRuntime\.enabled\) \{[\s\S]*?startPollingCollector\(/);
  assert.match(server, /createCollectionRunStore\(pool, ['"]ruliweb['"]\)/);
  assert.match(server, /runRuliwebCollector\(\{[\s\S]*?timeoutMs:\s*ruliwebRuntime\.timeoutMs/);
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

test('메인·실시간·최신 상품 영역은 이미지를 지연 로딩하고 실패 시 기존 fallback을 표시한다', () => {
  assert.match(script, /class="product-image[^"']*deal-image[^>]*loading="lazy"[^>]*referrerpolicy="no-referrer"/);
  assert.match(script, /class="popular-image[^"']*deal-image[^>]*loading="lazy"[^>]*referrerpolicy="no-referrer"/);
  assert.match(script, /class="latest-image[^"']*deal-image[^>]*loading="lazy"[^>]*referrerpolicy="no-referrer"/);
  assert.doesNotMatch(script, /class="(?:product|popular|latest)-image[^>]*loading="eager"/);
  assert.match(script, /class="latest-icon"/);
  assert.match(script, /querySelectorAll\('\.deal-image'\)/);
  assert.match(script, /image\.addEventListener\('error',\s*\(\) => image\.remove\(\),\s*\{ once: true \}\)/);
  assert.match(styles, /\.product-image[^}]*object-fit:\s*cover/);
  assert.match(styles, /\.popular-image[^}]*object-fit:\s*cover/);
  assert.match(styles, /\.latest-image[^}]*object-fit:\s*cover/);
});

test('공개 화면은 수동 휴대폰 특가를 전용 섹션에 표시하고 기본 목록은 선택한 출처를 조회한다', () => {
  assert.match(html, /section-kicker[^\n]*실시간 핫딜/);
  assert.match(script, /manual-deal-badge[^\n]*실시간 핫딜/);
  assert.doesNotMatch(html, /이지폰 특가/);
  assert.doesNotMatch(script, /이지폰 특가/);
  assert.match(styles, /\.manual-deal-badge\s*\{/);
  assert.match(script, /DealPage\.fetchLiveDealsPage\(\{\s*query:\s*state\.query,[\s\S]*?source:\s*state\.source/);
  assert.match(script, /fetchLiveDealsPage\(\{\s*source:\s*['"]all['"],\s*page:\s*1,\s*size:\s*5,\s*sort:\s*['"]popular['"]\s*\}\)/);
  assert.match(script, /source:\s*['"]manual['"][^\n]*featured:\s*true/);
  assert.match(script, /selectPhoneDeals\(deals,\s*\{\s*limit:\s*state\.siteSettings\.home_manual_limit\s*\}\)/);
  assert.match(script, /if \(state\.siteSettings\.home_manual_limit === 0\)/);
  assert.match(script, /fetchLiveDealsPage\(\{\s*source:\s*['"]all['"],\s*page:\s*1,\s*size:\s*6,\s*sort:\s*['"]latest['"]\s*\}\)/);
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

test('휴대폰 초특가 섹션은 검색 바로 뒤에 가로형 공용 카드로 표시된다', () => {
  const searchAt = html.indexOf('class="hero-search-wrap"');
  const phoneAt = html.indexOf('id="phone-deals"');
  assert.ok(searchAt >= 0 && searchAt < phoneAt);
  assert.doesNotMatch(html, /class="quick-menu"|data-quick-category/);
  assert.doesNotMatch(styles, /\.quick-menu/);
  assert.match(html, /id="phone-deal-title"/);
  assert.match(html, /id="phoneDealGrid"/);
  assert.match(script, /selectPhoneDeals\(/);
  assert.match(script, /phone_section_title/);
  assert.match(script, /elements\.phoneDealGrid\.innerHTML\s*=\s*phoneDeals\.map/);
  assert.match(script, /class="original-price"/);
  assert.match(styles, /\.phone-deals \.deal-grid\s*\{[^}]*display:\s*flex[^}]*overflow-x:\s*auto/);
});

test('주요 카테고리를 먼저 보여주고 나머지는 더보기로 펼친다', () => {
  assert.match(html, /id="categoryMore"[^>]*aria-expanded="false"/);
  assert.match(html, /class="category-item category-secondary"/);
  assert.match(script, /categoryList\.classList\.toggle\('expanded'\)/);
  assert.match(styles, /\.category-secondary\s*\{\s*display:\s*none/);
  assert.match(styles, /\.category-list\.expanded \.category-secondary\s*\{\s*display:\s*flex/);
});

test('상품 출처는 고객용 한글 이름으로 표시하고 토스 제휴 고지는 한 번 제공한다', () => {
  assert.match(script, /ppomppu:\s*'뽐뿌'/);
  assert.match(script, /manual:\s*'이지핫딜'/);
  assert.doesNotMatch(script, /deal\.source === 'toss' \? '제휴' : deal\.source/);
  assert.match(html, /class="partner-note"[^>]*>토스쇼핑 상품은 제휴 링크/);
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
