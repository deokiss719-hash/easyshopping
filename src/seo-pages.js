const express = require('express');
const { GUIDES, UPDATED, relatedGuides } = require('./shopping-guides');
const { toApiDeal } = require('./live-deals-api');
const { COUPANG_PARTNERS_DISCLOSURE, isCoupangPartnerLink } = require('./coupang-manual-link');
function safeUrl(value) {
  try { const url = new URL(String(value || '')); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
function publicImage(deal) {
  const value = toApiDeal(deal).imageUrl;
  return /^\/api\/public\/manual-deals\/\d+\/image$/.test(value || '') ? `https://easyshoopping.com${value}` : safeUrl(value);
}

const CATEGORY_PATHS = Object.freeze({
  digital: '디지털/가전', food: '식품', living: '생활/주방', fashion: '패션/의류',
  beauty: '뷰티', health: '건강', baby: '육아/아동', game: '게임', leisure: '스포츠/레저',
  pet: '반려동물', car: '자동차', travel: '여행/숙박', coupon: '상품권/쿠폰', other: '기타',
});
const CATEGORY_SLUGS = Object.freeze(Object.fromEntries(Object.entries(CATEGORY_PATHS).map(([slug, name]) => [name, slug])));

function esc(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function json(value) { return JSON.stringify(value).replaceAll('<', '\\u003c'); }
function price(value) { return Number.isSafeInteger(value) ? `${value.toLocaleString('ko-KR')}원` : '가격 확인'; }
function sourceLabel(source, originalUrl) { if (source === 'manual' && isCoupangPartnerLink(originalUrl)) return '쿠팡파트너스 · 제휴'; return ({ toss: '토스쇼핑', ppomppu: '뽐뿌', fmkorea: '에펨코리아', ruliweb: '루리웹', manual: '이지핫딜' })[source] || '커뮤니티'; }
function layout({ title, description, canonical, body, structuredData, image }) {
  return `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index, follow, max-image-preview:large"><meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(canonical)}"><link rel="icon" type="image/png" sizes="512x512" href="/favicon.png"><link rel="icon" type="image/x-icon" href="/favicon.ico"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"><meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:image" content="${esc(image || 'https://easyshoopping.com/og-image.png')}"><title>${esc(title)}</title><script type="application/ld+json">${json(structuredData)}</script><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/service-navigation.css"><link rel="stylesheet" href="/shopping-guides.css"><script src="/meta-pixel.js"></script><script src="/merchant-events.js" defer></script></head><body><header class="site-header"><div class="header-inner"><a class="wordmark" href="/" aria-label="이지핫딜 홈"><span class="wordmark-symbol">E</span><span class="wordmark-name">이지핫딜</span></a><nav class="ehd-service-nav" aria-label="주요 서비스"><a href="/" aria-current="page">핫딜</a><a href="/community">커뮤니티</a><a href="/phone.html">휴대폰 상담</a><a href="/saju">이지사주</a></nav></div></header><main>${body}<aside class="ehd-next" aria-label="함께 이용하기"><h2>쇼핑 이야기도 함께 나눠요</h2><div><a href="/community"><strong>커뮤니티 둘러보기 <span aria-hidden="true">→</span></strong><span>상품과 일상에 관한 이야기</span></a><a href="/phone.html"><strong>휴대폰 구매 상담 <span aria-hidden="true">→</span></strong><span>희망 기종과 조건을 알려주세요.</span></a></div></aside></main><footer class="seo-footer"><a href="/">실시간 핫딜 전체 보기</a><span>상품 정보는 판매처 사정에 따라 변경될 수 있습니다.</span></footer><nav class="ehd-mobile-nav" aria-label="모바일 주요 메뉴"><a href="/" aria-current="page"><span aria-hidden="true">⌂</span>핫딜</a><a href="/community"><span aria-hidden="true">☷</span>커뮤니티</a><a href="/phone.html"><span aria-hidden="true">☎</span>휴대폰 상담</a><a href="/saju"><span aria-hidden="true">✦</span>이지사주</a></nav></body></html>`;
}

function guideLinks(category) {
  return `<aside class="guide-context"><strong>구매 전에 도움이 되는 글</strong>${relatedGuides(category).map(g => `<a href="/guides/${g.slug}">${esc(g.title)} →</a>`).join('')}</aside>`;
}
function guidePage(guide) {
  const canonical = `https://easyshoopping.com/guides/${guide.slug}`;
  const body = `<article class="guide-article"><nav class="seo-breadcrumb" aria-label="경로"><a href="/">홈</a><span>›</span><a href="/guides">쇼핑 안내</a></nav><h1>${esc(guide.title)}</h1><p>${esc(guide.description)}</p><p class="guide-meta">이지핫딜 편집팀 · 작성·수정 ${UPDATED}</p>${guide.sections.map(([heading, text]) => `<section><h2>${esc(heading)}</h2><p>${esc(text)}</p></section>`).join('')}${guide.source ? `<p class="guide-meta">참고: <a href="${esc(guide.source[0])}" target="_blank" rel="noopener noreferrer">${esc(guide.source[1])}</a></p>` : ''}<div class="guide-next"><strong>실제 상품과 조건을 비교해 보세요</strong>${guide.links.map(([url, label]) => `<a href="${esc(url)}">${esc(label)} →</a>`).join('')}</div><aside class="guide-next"><strong>함께 읽으면 도움이 되는 글</strong>${GUIDES.filter(g => g.slug !== guide.slug).map(g => `<a href="/guides/${g.slug}">${esc(g.title)} →</a>`).join('')}<a href="/guides">쇼핑 안내 전체 보기</a></aside></article>`;
  return layout({ title: `${guide.title} | 이지핫딜`, description: guide.description, canonical, body, structuredData: { '@context': 'https://schema.org', '@graph': [{ '@type': 'Article', headline: guide.title, description: guide.description, mainEntityOfPage: canonical, datePublished: UPDATED, dateModified: UPDATED, author: { '@type': 'Organization', name: '이지핫딜 편집팀', url: 'https://easyshoopping.com/' } }, { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: '홈', item: 'https://easyshoopping.com/' }, { '@type': 'ListItem', position: 2, name: '쇼핑 안내', item: 'https://easyshoopping.com/guides' }, { '@type': 'ListItem', position: 3, name: guide.title, item: canonical }] }] } });
}
function guideIndex() {
  return layout({ title: '가격 비교·휴대폰 구매 안내 | 이지핫딜', description: '개당 가격, 배송비·쿠폰, 휴대폰 총비용을 쉽게 비교하는 쇼핑 안내입니다.', canonical: 'https://easyshoopping.com/guides', body: `<section class="shopping-guides"><h1>싸게 보이는 가격보다, 실제로 아끼는 쇼핑</h1><p>상품을 고르기 전에 필요한 계산과 조건을 쉽게 정리했어요.</p><div class="guide-cards">${GUIDES.map(g => `<a href="/guides/${g.slug}"><strong>${esc(g.title)}</strong><span>${esc(g.description)}</span></a>`).join('')}</div></section>`, structuredData: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: '이지핫딜 쇼핑 안내', url: 'https://easyshoopping.com/guides' } });
}

function dealPage(deal) {
  const canonical = `https://easyshoopping.com/deals/${deal.id}`;
  const amount = price(deal.priceAmount);
  const description = `${deal.title} ${amount} ${sourceLabel(deal.source, deal.originalUrl)} 핫딜 정보입니다. 가격과 판매 조건을 확인하세요.`.slice(0, 170);
  const categoryUrl = `/hot-deals/${CATEGORY_SLUGS[deal.category] || 'other'}`;
  const image = publicImage(deal);
  const target = safeUrl(deal.originalUrl);
  const body = `<section class="seo-detail section"><nav class="seo-breadcrumb" aria-label="경로"><a href="/">홈</a><span>›</span><a href="${categoryUrl}">${esc(deal.category || '기타')} 핫딜</a></nav><article class="seo-product">${image ? `<img src="${esc(image)}" alt="${esc(deal.title)}" referrerpolicy="no-referrer">` : `<div class="seo-image-placeholder" aria-hidden="true">HOT</div>`}<div><span class="seo-source">${esc(sourceLabel(deal.source, deal.originalUrl))} · ${esc(deal.category || '기타')}</span><h1>${esc(deal.title)}</h1><strong class="seo-price">${amount}</strong>${deal.description && deal.source !== 'toss' ? `<p>${esc(deal.description)}</p>` : ''}<p class="seo-checked">수집된 할인 정보예요. 원문에서 최종 가격과 품절 여부를 확인해 주세요.</p><a data-deal-id="${esc(deal.id)}" class="seo-buy" href="${esc(target || canonical)}" target="_blank" rel="${deal.source === 'toss' || isCoupangPartnerLink(deal.originalUrl) ? 'sponsored ' : ''}noopener noreferrer">원문에서 상품 확인하기 →</a>${deal.source === 'toss' ? '<small class="seo-disclosure">토스쇼핑 제휴 링크를 통해 구매가 발생하면 일정 수수료를 지급받을 수 있습니다.</small>' : ''}${deal.source === 'manual' && isCoupangPartnerLink(deal.originalUrl) ? `<small class="seo-disclosure">${esc(COUPANG_PARTNERS_DISCLOSURE)}</small>` : ''}</div></article><aside class="seo-related"><h2>${esc(deal.category || '기타')}의 다른 할인 상품도 확인하세요</h2><a href="${categoryUrl}">${esc(deal.category || '기타')} 핫딜 전체 보기 →</a></aside>${guideLinks(deal.category)}</section>`;
  const structuredData = { '@context': 'https://schema.org', '@type': 'Product', name: deal.title, image: image ? [image] : undefined, description, category: deal.category, offers: Number.isSafeInteger(deal.priceAmount) && target ? { '@type': 'Offer', url: target, priceCurrency: 'KRW', price: deal.priceAmount } : undefined };
  return layout({ title: `${deal.title} ${amount} | 이지핫딜`, description, canonical, body, structuredData, image });
}

function categoryPage(slug, category, deals) {
  const canonical = `https://easyshoopping.com/hot-deals/${slug}`;
  const title = `${category} 실시간 핫딜·오늘의 특가 | 이지핫딜`;
  const description = `${category} 분야의 오늘의 실시간 핫딜과 특가 상품을 모았습니다. 가격과 판매처를 한눈에 비교해 보세요.`;
  const cards = deals.map((deal) => `<article class="seo-deal-card">${publicImage(deal) ? `<img src="${esc(publicImage(deal))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="seo-card-placeholder" aria-hidden="true">HOT</div>'}<div><span>${esc(sourceLabel(deal.source, deal.originalUrl))}</span><h2><a href="/deals/${deal.id}">${esc(deal.title)}</a></h2><strong>${price(deal.priceAmount)}</strong><a class="seo-card-link" href="/deals/${deal.id}">핫딜 자세히 보기 →</a></div></article>`).join('');
  const body = `<section class="seo-listing section"><nav class="seo-breadcrumb" aria-label="경로"><a href="/">홈</a><span>›</span><span>${esc(category)} 핫딜</span></nav><header><span>오늘의 특가</span><h1>${esc(category)} 실시간 핫딜</h1><p>${esc(description)}</p></header><div class="seo-deal-grid">${cards || '<p>현재 확인 가능한 상품을 준비하고 있어요.</p>'}</div><a class="seo-home-link" href="/?category=${encodeURIComponent(category)}#all-deals">전체 목록에서 더 보기 →</a>${guideLinks(category)}</section>`;
  const structuredData = { '@context': 'https://schema.org', '@type': 'ItemList', name: `${category} 실시간 핫딜`, itemListElement: deals.map((deal, index) => ({ '@type': 'ListItem', position: index + 1, url: `https://easyshoopping.com/deals/${deal.id}`, name: deal.title })) };
  return layout({ title, description, canonical, body, structuredData });
}

function sitemapXml(deals, communityPosts = []) {
  const urls = [
    { loc: 'https://easyshoopping.com/', priority: '1.0' },
    { loc: 'https://easyshoopping.com/community', priority: '0.8' },
    { loc: 'https://easyshoopping.com/guides', priority: '0.7' },
    ...GUIDES.map(g => ({ loc: `https://easyshoopping.com/guides/${g.slug}`, lastmod: UPDATED, priority: '0.7' })),
    ...['/phone.html', '/saju', '/advertise.html'].map(path => ({ loc: `https://easyshoopping.com${path}`, priority: '0.8' })),
    ...Object.keys(CATEGORY_PATHS).map((slug) => ({ loc: `https://easyshoopping.com/hot-deals/${slug}`, priority: '0.8' })),
    ...deals.map((deal) => ({ loc: `https://easyshoopping.com/deals/${deal.id}`, lastmod: deal.updatedAt.slice(0, 10), priority: '0.6' })),
    ...communityPosts.map((post) => ({ loc: `https://easyshoopping.com/community/posts/${post.id}`, lastmod: new Date(post.updatedAt).toISOString().slice(0, 10), priority: '0.5' })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((entry) => `  <url><loc>${entry.loc}</loc>${entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ''}<changefreq>${entry.priority === '1.0' ? 'hourly' : 'daily'}</changefreq><priority>${entry.priority}</priority></url>`).join('\n')}\n</urlset>\n`;
}

function createSeoPagesRouter(store, communityStore = null) {
  const router = express.Router();
  router.get('/guides', (_req, res) => res.type('html').send(guideIndex()));
  router.get('/guides/:slug', (req, res) => { const guide = GUIDES.find(g => g.slug === req.params.slug); return guide ? res.type('html').send(guidePage(guide)) : res.status(404).type('html').send('<h1>안내 글을 찾을 수 없어요</h1><a href="/guides">쇼핑 안내로 돌아가기</a>'); });
  router.get('/sitemap.xml', async (_req, res, next) => {
    try {
      const [deals, communityPosts] = await Promise.all([
        store.listSitemapDeals(),
        communityStore?.sitemapPosts ? communityStore.sitemapPosts() : [],
      ]);
      res.type('application/xml').send(sitemapXml(deals, communityPosts));
    } catch (error) { next(error); }
  });
  router.get('/deals/:id', async (req, res, next) => { try { const deal = await store.getPublicById(req.params.id); if (!deal) return next(); return res.type('html').send(dealPage(deal)); } catch (error) { return next(error); } });
  router.get('/hot-deals/:slug', async (req, res, next) => { try { const category = Object.hasOwn(CATEGORY_PATHS, req.params.slug) ? CATEGORY_PATHS[req.params.slug] : null; if (!category) return next(); const result = await store.list({ source: ['ppomppu', 'fmkorea', 'ruliweb', 'toss', 'manual'], category, sort: 'latest', page: 1, size: 24 }); return res.type('html').send(categoryPage(req.params.slug, category, result.items)); } catch (error) { return next(error); } });
  return router;
}

module.exports = { CATEGORY_PATHS, createSeoPagesRouter, dealPage, categoryPage, sitemapXml };
