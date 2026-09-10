const state = {
  category: '전체',
  sort: 'latest',
  query: '',
  deals: [],
  visibleCount: 8,
  siteSettings: { home_manual_limit: 4, phone_section_title: '휴대폰 초특가 핫딜' },
};

const elements = {
  searchInput: document.querySelector('#searchInput'),
  phoneDeals: document.querySelector('#phone-deals'),
  phoneDealTitle: document.querySelector('#phone-deal-title'),
  phoneDealGrid: document.querySelector('#phoneDealGrid'),
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
  return `
    <article class="deal-card" tabindex="0" data-deal-url="${escapeHtml(deal.url)}" aria-label="${escapeHtml(deal.title)}, ${formatPrice(deal.price)}">
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
        <div class="card-meta"><span>${escapeHtml(deal.postedAt)}</span><span>${escapeHtml(deal.category)}</span></div>
      </div>
    </article>`;
}

function popularItem(deal, index) {
  const visual = deal.imageUrl
    ? `<span class="popular-visual"><span class="rank-heat">실시간</span><img class="popular-image deal-image" src="${escapeHtml(deal.imageUrl)}" alt="" loading="eager" decoding="async" referrerpolicy="no-referrer" /></span>`
    : '<span class="rank-heat">실시간</span>';
  return `
    <article class="popular-item" tabindex="0" data-deal-url="${escapeHtml(deal.url)}">
      <div class="rank-line"><span class="rank-number">${index + 1}</span>${visual}</div>
      <h3>${escapeHtml(deal.title)}</h3>
      <div class="rank-price"><strong>${formatPrice(deal.price)}</strong></div>
    </article>`;
}

function latestItem(deal) {
  const image = deal.imageUrl
    ? `<img class="latest-image deal-image" src="${escapeHtml(deal.imageUrl)}" alt="" loading="eager" decoding="async" referrerpolicy="no-referrer" />`
    : '';
  return `
    <article class="latest-item" tabindex="0" data-deal-url="${escapeHtml(deal.url)}">
      <span class="latest-media" aria-hidden="true"><span class="latest-icon">${categoryEmoji(deal.category)}</span>${image}</span>
      <div class="latest-copy"><strong>${escapeHtml(deal.title)}</strong><small>${escapeHtml(deal.store)} · ${escapeHtml(deal.postedAt)}</small></div>
      <div class="latest-price"><strong>${formatPrice(deal.price)}</strong></div>
    </article>`;
}

function bindImageFallbacks(container) {
  container.querySelectorAll('.deal-image').forEach((image) => {
    image.addEventListener('error', () => image.remove(), { once: true });
  });
}

function bindDealClicks(container) {
  container.querySelectorAll('[data-deal-url]').forEach((card) => {
    const open = () => {
      const url = card.dataset.dealUrl;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });
}

function renderDeals() {
  let matchingDeals = DealUtils.filterAndSortDeals(state.deals, state);
  const isDefaultHome = state.category === '전체' && state.sort === 'latest' && !state.query;
  if (isDefaultHome) {
    matchingDeals = DealUtils.mixHomeDeals(matchingDeals, {
      manualLimit: state.siteSettings.home_manual_limit,
    });
  }
  const visibleDeals = matchingDeals.slice(0, state.visibleCount);
  elements.dealGrid.classList.remove('skeleton-grid');
  elements.dealGrid.innerHTML = visibleDeals.map(productCard).join('');

  const hasResults = matchingDeals.length > 0;
  elements.dealGrid.hidden = !hasResults;
  elements.emptyState.hidden = hasResults;
  elements.loadMore.hidden = !hasResults || state.visibleCount >= matchingDeals.length;

  if (!hasResults) {
    elements.resultSummary.textContent = state.query
      ? `“${state.query}” 검색 결과가 없어요.`
      : `${state.category} 카테고리에 아직 등록된 핫딜이 없어요.`;
  } else if (state.query) {
    elements.resultSummary.textContent = `“${state.query}” 핫딜 ${matchingDeals.length}개를 찾았어요.`;
  } else if (state.category !== '전체') {
    elements.resultSummary.textContent = `${state.category} 핫딜 ${matchingDeals.length}개를 모았어요.`;
  } else {
    elements.resultSummary.textContent = `지금 확인할 수 있는 핫딜 ${matchingDeals.length}개예요.`;
  }

  bindImageFallbacks(elements.dealGrid);
  bindDealClicks(elements.dealGrid);
}

function renderPhoneDeals(deals) {
  const phoneDeals = DealUtils.selectPhoneDeals(deals);
  elements.phoneDealTitle.textContent = state.siteSettings.phone_section_title;
  elements.phoneDealGrid.innerHTML = phoneDeals.map(productCard).join('');
  elements.phoneDeals.hidden = phoneDeals.length === 0;
  bindImageFallbacks(elements.phoneDealGrid);
  bindDealClicks(elements.phoneDealGrid);
}

async function loadDeals({ scroll = false } = {}) {
  dealsController?.abort();
  const controller = new AbortController();
  dealsController = controller;

  try {
    const rawDeals = await DealUtils.fetchAllLiveDeals({
      query: state.query,
      signal: controller.signal,
    });
    if (controller !== dealsController) return;
    state.deals = rawDeals.map((deal) => DealUtils.normalizeDeal(deal));
    if (!state.query) renderPhoneDeals(state.deals);
    renderDeals();
    renderLatest(state.deals);
    if (scroll) document.querySelector('#all-deals').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('핫딜 데이터를 불러오지 못했습니다.', error);
    elements.dealGrid.hidden = true;
    elements.emptyState.hidden = false;
    elements.loadMore.hidden = true;
    elements.resultSummary.textContent = '핫딜을 불러오지 못했어요. 잠시 후 다시 시도해주세요.';
  } finally {
    if (controller === dealsController) dealsController = null;
  }
}

async function loadSiteSettings() {
  state.siteSettings = await DealUtils.fetchPublicSiteSettings();
}

async function loadPopular() {
  try {
    const response = await fetch('/api/live-deals?source=ppomppu&size=5');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const imageBaseUrls = Array.isArray(data.imageBaseUrls) ? data.imageBaseUrls : [];
    const deals = data.deals.map((deal) => DealUtils.normalizeDeal({ ...deal, imageBaseUrls }));
    elements.popularList.classList.remove('skeleton-list');
    elements.popularList.innerHTML = deals.map(popularItem).join('');
    bindImageFallbacks(elements.popularList);
    bindDealClicks(elements.popularList);
  } catch (error) {
    console.error('인기 핫딜을 불러오지 못했습니다.', error);
    elements.popularList.innerHTML = '<p>인기 핫딜을 불러오지 못했어요.</p>';
  }
}

function renderLatest(deals) {
  const latest = DealUtils.filterAndSortDeals(deals, { category: '전체', sort: 'latest' }).slice(0, 6);
  elements.latestList.innerHTML = latest.map(latestItem).join('');
  if (!latest.length) {
    elements.latestList.innerHTML = '<p style="color:#91a6c8">조건에 맞는 최신 핫딜이 없어요.</p>';
  }
  bindImageFallbacks(elements.latestList);
  bindDealClicks(elements.latestList);
}

function setCategory(category, { scroll = true } = {}) {
  state.category = category;
  state.visibleCount = 8;
  elements.categoryList.querySelectorAll('[data-category]').forEach((button) => {
    const active = button.dataset.category === category;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  loadDeals({ scroll });
}

function runSearch(value, { scroll = true } = {}) {
  state.query = value.trim();
  state.visibleCount = 8;
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
    state.visibleCount = 8;
    document.querySelectorAll('.sort-control button').forEach((item) => item.classList.toggle('active', item === button));
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
  state.visibleCount += 4;
  renderDeals();
});

document.querySelector('#resetSearch').addEventListener('click', () => {
  elements.searchInput.value = '';
  state.query = '';
  setCategory('전체', { scroll: false });
});

document.querySelector('#latestRefresh').addEventListener('click', () => {
  loadDeals();
  showToast('최신 핫딜을 새로 확인했어요.');
});

Promise.all([loadPopular(), loadSiteSettings().then(() => loadDeals())]);
