const TossRecommendations = (() => {
  const sources = Object.freeze({
    'integrated-best': '통합 베스트',
    'today-special': '하루특가',
  });
  const wonFormatter = new Intl.NumberFormat('ko-KR');
  const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

  function escapeMarkup(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function safeTossSharelinkUrl(value) {
    if (typeof value !== 'string' || /[\\\u0000-\u0020\u007f]/.test(value)) return '';
    try {
      const url = new URL(value);
      const authorityStart = value.indexOf('//') + 2;
      const authorityEnd = value.indexOf('/', authorityStart);
      const authority = authorityEnd < 0 ? value.slice(authorityStart) : value.slice(authorityStart, authorityEnd);
      if (url.protocol !== 'https:' || url.hostname !== 'toss.im'
        || url.username || url.password || url.port || url.search || url.hash
        || authorityStart < 2 || authority.toLowerCase() !== 'toss.im'
        || !/^\/_m\/[A-Za-z0-9_-]+$/.test(url.pathname)) return '';
      return url.href;
    } catch {
      return '';
    }
  }

  function strictTimestamp(value) {
    if (typeof value !== 'string') return null;
    const match = timestampPattern.exec(value);
    if (!match) return null;
    const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    if (!daysInMonth || day < 1 || day > daysInMonth
      || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59
      || (offsetHourText != null && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59))) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function normalizeRecommendation(item, nowTime) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const validProductId = (typeof item.productId === 'number'
      && Number.isSafeInteger(item.productId) && item.productId > 0)
      || (typeof item.productId === 'string' && /^[1-9]\d{0,30}$/.test(item.productId));
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const sourceLabel = Object.hasOwn(sources, item.source) ? sources[item.source] : '';
    const sharelinkUrl = safeTossSharelinkUrl(item.sharelinkUrl);
    const validPrice = item.price === null
      || (Number.isSafeInteger(item.price) && item.price >= 0);
    const validRank = Number.isSafeInteger(item.rank) && item.rank >= 1 && item.rank <= 10;
    let endTime = null;
    if (item.endAt !== null) endTime = strictTimestamp(item.endAt);
    if (!validProductId || !title || title.length > 500 || !sourceLabel || !sharelinkUrl || !validPrice || !validRank
      || (item.endAt !== null && endTime === null) || (endTime !== null && endTime <= nowTime)) return null;
    return { title, sourceLabel, price: item.price, sharelinkUrl };
  }

  function recommendationCard(item) {
    const price = item.price === null ? '가격 확인' : `${wonFormatter.format(item.price)}원`;
    return `<article class="deal-card toss-text-card">
      <div class="card-body">
        <span class="badge badge-recommend toss-source-badge">${escapeMarkup(item.sourceLabel)}</span>
        <h3 class="card-title">${escapeMarkup(item.title)}</h3>
        <div class="price-row"><strong class="current-price">${price}</strong></div>
        <a class="affiliate-cta toss-text-cta" href="${escapeMarkup(item.sharelinkUrl)}" target="_blank" rel="sponsored noopener noreferrer" aria-label="${escapeMarkup(`${item.title} 토스쇼핑에서 보기 (새 창)`)}">토스쇼핑에서 보기 <span aria-hidden="true">→</span></a>
      </div>
    </article>`;
  }

  function renderRecommendations(items, { section, grid, now = new Date() } = {}) {
    if (!section || !grid) {
      if (grid) grid.innerHTML = '';
      if (section) section.hidden = true;
      return [];
    }
    const nowTime = new Date(now).getTime();
    const valid = [];
    if (Array.isArray(items) && Number.isFinite(nowTime)) {
      for (const item of items) {
        const normalized = normalizeRecommendation(item, nowTime);
        if (normalized) valid.push(normalized);
        if (valid.length === 10) break;
      }
    }
    grid.innerHTML = valid.map(recommendationCard).join('');
    section.hidden = valid.length === 0;
    return valid;
  }

  async function loadRecommendations({
    fetchImpl = fetch, section, grid, now = () => new Date(),
    logError = (message) => console.error(message),
  } = {}) {
    if (!section || !grid) return renderRecommendations([], { section, grid });
    const clear = () => renderRecommendations([], { section, grid, now: now() });
    try {
      const response = await fetchImpl('/api/toss-recommendations');
      if (!response?.ok) throw new Error('request failed');
      const payload = await response.json();
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || typeof payload.enabled !== 'boolean' || !Array.isArray(payload.recommendations)
        || payload.recommendations.length > 10) {
        throw new TypeError('invalid response');
      }
      if (payload.enabled !== true || payload.recommendations.length === 0) return clear();
      return renderRecommendations(payload.recommendations, { section, grid, now: now() });
    } catch {
      logError('토스쇼핑 추천 상품을 불러오지 못했습니다.');
      return clear();
    }
  }

  return {
    safeTossSharelinkUrl,
    renderRecommendations,
    loadRecommendations,
    loadTossRecommendations: loadRecommendations,
  };
})();

if (typeof module === 'object' && module.exports) {
  module.exports = TossRecommendations;
} else {
const state = {
  category: '전체',
  sort: 'latest',
  query: '',
  deals: [],
  homeDeals: [],
  coupangDeals: [],
  tossRecommendations: [],
  page: 0,
  total: 0,
  hasNextPage: false,
  siteSettings: { home_manual_limit: 4, phone_section_title: '휴대폰 초특가 핫딜' },
};

const elements = {
  searchInput: document.querySelector('#searchInput'),
  phoneDeals: document.querySelector('#phone-deals'),
  phoneDealTitle: document.querySelector('#phone-deal-title'),
  phoneDealGrid: document.querySelector('#phoneDealGrid'),
  coupangProductGrid: document.querySelector('#coupangProductGrid'),
  tossRecommendations: document.querySelector('#tossRecommendations'),
  tossRecommendationGrid: document.querySelector('#tossRecommendationGrid'),
  dealGrid: document.querySelector('#dealGrid'),
  popularList: document.querySelector('#popularList'),
  latestList: document.querySelector('#latestList'),
  categoryList: document.querySelector('#categoryList'),
  emptyState: document.querySelector('#emptyState'),
  loadMore: document.querySelector('#loadMore'),
  resultSummary: document.querySelector('#resultSummary'),
  toast: document.querySelector('#toast'),
};

const won = new Intl.NumberFormat('ko-KR');
let searchTimer;
let toastTimer;
let dealsController;
let dealsRequestSequence = 0;

function formatPrice(price) {
  return Number.isSafeInteger(price) ? `${won.format(price)}원` : '가격 확인';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function badgeClass(badge) {
  if (badge === 'HOT') return 'badge-hot';
  if (badge === '인기') return 'badge-popular';
  if (badge === '추천') return 'badge-recommend';
  return 'badge-new';
}

function categoryEmoji(category) {
  return {
    '디지털/가전': '📱', 식품: '🍜', '생활/주방': '🏠', '패션/의류': '👟',
    뷰티: '🧴', 건강: '💊', '육아/아동': '🍼', 게임: '🎮',
    '스포츠/레저': '🏕️', 반려동물: '🐾', 자동차: '🚗', '여행/숙박': '✈️',
    '상품권/쿠폰': '🎟️', 기타: '✨'
  }[category] || '✨';
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2200);
}

function productCard(deal) {
  const image = deal.imageUrl
    ? `<img class="product-image deal-image" src="${escapeHtml(deal.imageUrl)}" alt="" loading="eager" decoding="async" referrerpolicy="no-referrer" />`
    : '';
  const manualBadge = deal.isManual
    ? '<span class="manual-deal-badge">이지폰 특가</span>'
    : '';
  return DealCardLink.renderCardContainer('deal-card', deal.url, `
      <div class="product-media tone-${escapeHtml(deal.imageTone)}">
        <span class="badge ${badgeClass(deal.badge)}">${escapeHtml(deal.badge)}</span>
        ${manualBadge}
        <div class="product-placeholder" aria-hidden="true"><span>${categoryEmoji(deal.category)}</span><strong>${escapeHtml(deal.imageLabel)}</strong></div>
        ${image}
      </div>
      <div class="card-body">
        <div class="card-store"><strong>${escapeHtml(deal.store)}</strong><span>${escapeHtml(deal.source)}</span></div>
        <h3 class="card-title">${escapeHtml(deal.title)}</h3>
        <div class="price-row"><strong class="current-price">${formatPrice(deal.price)}</strong></div>
        ${deal.originalPrice != null ? `<p class="original-price">${formatPrice(deal.originalPrice)}</p>` : ''}
        ${deal.description ? `<p class="card-benefit">${escapeHtml(deal.description)}</p>` : ''}
        <div class="card-meta"><span>${escapeHtml(deal.postedAt)}</span><span>${escapeHtml(deal.category)}</span></div>
      </div>`, {
    rel: deal.source === 'coupang' ? 'sponsored noopener noreferrer' : 'noopener noreferrer',
  });
}

function popularItem(deal, index) {
  const visual = deal.imageUrl
    ? `<span class="popular-visual"><span class="rank-heat">실시간</span><img class="popular-image deal-image" src="${escapeHtml(deal.imageUrl)}" alt="" loading="eager" decoding="async" referrerpolicy="no-referrer" /></span>`
    : '<span class="rank-heat">실시간</span>';
  return DealCardLink.renderCardContainer('popular-item', deal.url, `
      <div class="rank-line"><span class="rank-number">${index + 1}</span>${visual}</div>
      <h3>${escapeHtml(deal.title)}</h3>
      <div class="rank-price"><strong>${formatPrice(deal.price)}</strong></div>`);
}

function latestItem(deal) {
  const image = deal.imageUrl
    ? `<img class="latest-image deal-image" src="${escapeHtml(deal.imageUrl)}" alt="" loading="eager" decoding="async" referrerpolicy="no-referrer" />`
    : '';
  return DealCardLink.renderCardContainer('latest-item', deal.url, `
      <span class="latest-media" aria-hidden="true"><span class="latest-icon">${categoryEmoji(deal.category)}</span>${image}</span>
      <div class="latest-copy"><strong>${escapeHtml(deal.title)}</strong><small>${escapeHtml(deal.store)} · ${escapeHtml(deal.postedAt)}</small></div>
      <div class="latest-price"><strong>${formatPrice(deal.price)}</strong></div>`);
}

function bindImageFallbacks(container) {
  container.querySelectorAll('.deal-image').forEach((image) => {
    image.addEventListener('error', () => image.remove(), { once: true });
  });
}

function renderDeals() {
  const visibleDeals = state.deals;
  elements.dealGrid.classList.remove('skeleton-grid');
  elements.dealGrid.innerHTML = visibleDeals.map(productCard).join('');

  const hasResults = visibleDeals.length > 0;
  elements.dealGrid.hidden = !hasResults;
  elements.emptyState.hidden = hasResults;
  elements.loadMore.hidden = !hasResults || !state.hasNextPage;
  elements.loadMore.disabled = false;

  if (!hasResults) {
    elements.resultSummary.textContent = state.query
      ? `“${state.query}” 검색 결과가 없어요.`
      : `${state.category} 카테고리에 아직 등록된 핫딜이 없어요.`;
  } else if (state.query) {
    elements.resultSummary.textContent = `“${state.query}” 핫딜 ${state.total}개를 찾았어요.`;
  } else if (state.category !== '전체') {
    elements.resultSummary.textContent = `${state.category} 핫딜 ${state.total}개를 모았어요.`;
  } else {
    elements.resultSummary.textContent = `지금 확인할 수 있는 핫딜 ${state.total}개예요.`;
  }

  bindImageFallbacks(elements.dealGrid);
}

function renderPhoneDeals(deals) {
  const phoneDeals = DealUtils.selectPhoneDeals(deals, { limit: state.siteSettings.home_manual_limit });
  elements.phoneDealTitle.textContent = state.siteSettings.phone_section_title;
  elements.phoneDealGrid.innerHTML = phoneDeals.map(productCard).join('');
  elements.phoneDeals.hidden = phoneDeals.length === 0;
  bindImageFallbacks(elements.phoneDealGrid);
}

function renderCoupangDeals(deals) {
  elements.coupangProductGrid.innerHTML = deals.map(productCard).join('');
  elements.coupangProductGrid.hidden = deals.length === 0;
  bindImageFallbacks(elements.coupangProductGrid);
}

async function loadCoupangDeals() {
  try {
    const result = await DealPage.fetchLiveDealsPage({ source: 'coupang', page: 1, size: 8 });
    state.coupangDeals = result.deals.map((deal) => DealUtils.normalizeDeal(deal));
    renderCoupangDeals(state.coupangDeals);
  } catch (error) {
    if (error?.status !== 400) console.error('쿠팡 추천 상품을 불러오지 못했습니다.', error);
    state.coupangDeals = [];
    renderCoupangDeals([]);
  }
}

async function loadTossRecommendations() {
  state.tossRecommendations = await TossRecommendations.loadRecommendations({
    section: elements.tossRecommendations,
    grid: elements.tossRecommendationGrid,
  });
  return state.tossRecommendations;
}

async function loadDeals({ scroll = false, append = false } = {}) {
  dealsController?.abort();
  const controller = new AbortController();
  const sequence = ++dealsRequestSequence;
  dealsController = controller;
  const requestedPage = append ? state.page + 1 : 1;
  if (append) elements.loadMore.disabled = true;

  try {
    const result = await DealPage.fetchLiveDealsPage({
      query: state.query,
      category: state.category,
      sort: state.sort,
      source: 'ppomppu',
      page: requestedPage,
      size: 8,
      signal: controller.signal,
    });
    if (sequence !== dealsRequestSequence || controller !== dealsController) return;
    const nextDeals = result.deals.map((deal) => DealUtils.normalizeDeal(deal));
    if (append) {
      const byId = new Map(state.deals.map((deal) => [deal.id, deal]));
      nextDeals.forEach((deal) => byId.set(deal.id, deal));
      state.deals = [...byId.values()];
    } else {
      state.deals = nextDeals;
    }
    state.page = result.page;
    state.total = result.total;
    state.hasNextPage = result.hasNextPage;
    renderDeals();
    if (scroll) document.querySelector('#all-deals').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (error.name === 'AbortError' || sequence !== dealsRequestSequence) return;
    console.error('핫딜 데이터를 불러오지 못했습니다.', error);
    if (append && state.deals.length) {
      elements.loadMore.disabled = false;
      showToast('다음 핫딜을 불러오지 못했어요.');
      return;
    }
    state.deals = [];
    state.page = 0;
    state.total = 0;
    state.hasNextPage = false;
    elements.dealGrid.hidden = true;
    elements.emptyState.hidden = false;
    elements.loadMore.hidden = true;
    elements.resultSummary.textContent = '핫딜을 불러오지 못했어요. 잠시 후 다시 시도해주세요.';
  } finally {
    if (sequence === dealsRequestSequence && controller === dealsController) dealsController = null;
  }
}

async function loadSiteSettings() {
  state.siteSettings = await DealUtils.fetchPublicSiteSettings();
}

async function loadHomeDeals() {
  if (state.siteSettings.home_manual_limit === 0) {
    state.homeDeals = [];
    renderPhoneDeals([]);
    return;
  }
  try {
    const result = await DealPage.fetchLiveDealsPage({
      source: 'manual', featured: true, page: 1,
      size: state.siteSettings.home_manual_limit,
    });
    state.homeDeals = result.deals.map((deal) => DealUtils.normalizeDeal(deal));
    renderPhoneDeals(state.homeDeals);
    if (state.page) renderDeals();
  } catch (error) {
    console.error('휴대폰 특가를 불러오지 못했습니다.', error);
    state.homeDeals = [];
    renderPhoneDeals([]);
  }
}

async function loadPopular() {
  try {
    const result = await DealPage.fetchLiveDealsPage({ source: 'ppomppu', page: 1, size: 5 });
    const deals = result.deals.map((deal) => DealUtils.normalizeDeal(deal));
    elements.popularList.classList.remove('skeleton-list');
    elements.popularList.innerHTML = deals.map(popularItem).join('');
    bindImageFallbacks(elements.popularList);
  } catch (error) {
    console.error('인기 핫딜을 불러오지 못했습니다.', error);
    elements.popularList.innerHTML = '<p>인기 핫딜을 불러오지 못했어요.</p>';
  }
}

function renderLatest(deals) {
  const latest = deals.slice(0, 6);
  elements.latestList.innerHTML = latest.map(latestItem).join('');
  if (!latest.length) {
    elements.latestList.innerHTML = '<p style="color:#91a6c8">조건에 맞는 최신 핫딜이 없어요.</p>';
  }
  bindImageFallbacks(elements.latestList);
}

async function loadLatest() {
  try {
    const result = await DealPage.fetchLiveDealsPage({ source: 'ppomppu', page: 1, size: 6, sort: 'latest' });
    renderLatest(result.deals.map((deal) => DealUtils.normalizeDeal(deal)));
  } catch (error) {
    console.error('최신 핫딜을 불러오지 못했습니다.', error);
    renderLatest([]);
  }
}

function syncDealUrl(mode = 'push') {
  const nextUrl = DealUrlState.buildDealStateUrl(window.location, state);
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return;
  if (mode === 'replace') window.history.replaceState(null, '', nextUrl);
  else window.history.pushState(null, '', nextUrl);
}

function applyUrlState(nextState) {
  state.query = nextState.query;
  if (!state.query) window.MetaEvents?.resetSearch();
  state.category = nextState.category;
  state.sort = nextState.sort;
  elements.searchInput.value = nextState.query;
  elements.categoryList.querySelectorAll('[data-category]').forEach((button) => {
    const active = button.dataset.category === nextState.category;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.sort-control button').forEach((button) => {
    button.classList.toggle('active', button.dataset.sort === nextState.sort);
  });
}

function setCategory(category, { scroll = true, updateUrl = true } = {}) {
  state.category = category;
  elements.categoryList.querySelectorAll('[data-category]').forEach((button) => {
    const active = button.dataset.category === category;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (updateUrl) syncDealUrl();
  loadDeals({ scroll });
}

function runSearch(value, { scroll = true, updateUrl = true } = {}) {
  state.query = value.trim().slice(0, 100);
  window.MetaEvents?.trackSearch(state.query);
  if (updateUrl) syncDealUrl('replace');
  loadDeals({ scroll });
}

elements.categoryList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-category]');
  if (button) setCategory(button.dataset.category);
});

document.querySelectorAll('[data-quick-category]').forEach((button) => {
  button.addEventListener('click', () => setCategory(button.dataset.quickCategory));
});

document.querySelectorAll('.sort-control button').forEach((button) => {
  button.addEventListener('click', () => {
    state.sort = button.dataset.sort;
    document.querySelectorAll('.sort-control button').forEach((item) => item.classList.toggle('active', item === button));
    syncDealUrl();
    loadDeals();
  });
});

elements.searchInput.addEventListener('input', (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(event.target.value), 260);
});

elements.searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') runSearch(event.target.value);
});

document.querySelectorAll('.search-suggestions button').forEach((button) => {
  button.addEventListener('click', () => {
    elements.searchInput.value = button.textContent;
    runSearch(button.textContent);
  });
});

document.querySelectorAll('.search-trigger, .mobile-search-trigger').forEach((button) => {
  button.addEventListener('click', () => {
    elements.searchInput.focus({ preventScroll: true });
    document.querySelector('.hero-search-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
});

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    elements.searchInput.focus();
  }
});

elements.loadMore.addEventListener('click', () => {
  if (state.hasNextPage) loadDeals({ append: true });
});

document.querySelector('#resetSearch').addEventListener('click', () => {
  elements.searchInput.value = '';
  state.query = '';
  window.MetaEvents?.resetSearch();
  setCategory('전체', { scroll: false });
});

document.querySelector('#latestRefresh').addEventListener('click', () => {
  loadLatest();
  showToast('최신 핫딜을 새로 확인했어요.');
});

window.addEventListener('popstate', () => {
  clearTimeout(searchTimer);
  const nextState = DealUrlState.readDealState(window.location.search);
  applyUrlState(nextState);
  loadDeals();
});

const initialUrlState = DealUrlState.readDealState(window.location.search);
applyUrlState(initialUrlState);
syncDealUrl('replace');
Promise.all([
  loadPopular(),
  loadLatest(),
  loadCoupangDeals(),
  loadTossRecommendations(),
  loadSiteSettings().then(() => Promise.all([loadHomeDeals(), loadDeals()])),
]);
}
