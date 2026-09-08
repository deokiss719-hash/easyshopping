const state = {
  category: '전체',
  sort: 'popular',
  query: '',
  deals: [],
  visibleCount: 8,
};

const elements = {
  searchInput: document.querySelector('#searchInput'),
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

function formatPrice(price) {
  return `${won.format(price)}원`;
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
    디지털: '📱', 가전: '📺', 식품: '🍜', 생활: '🧻', 패션: '👟',
    뷰티: '🧴', 육아: '🍼', 게임: '🎮', 기타: '✨'
  }[category] || '✨';
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2200);
}

function productCard(deal) {
  return `
    <article class="deal-card" tabindex="0" data-deal-id="${deal.id}" aria-label="${escapeHtml(deal.title)}, ${formatPrice(deal.price)}">
      <div class="product-media tone-${escapeHtml(deal.imageTone)}">
        <span class="badge ${badgeClass(deal.badge)}">${escapeHtml(deal.badge)}</span>
        <div class="product-placeholder" aria-hidden="true">${escapeHtml(deal.imageLabel)}</div>
      </div>
      <div class="card-body">
        <div class="card-store"><strong>${escapeHtml(deal.store)}</strong><span>${escapeHtml(deal.shipping)}</span></div>
        <h3 class="card-title">${escapeHtml(deal.title)}</h3>
        <div class="price-row"><span class="discount">${deal.discountRate}%</span><strong class="current-price">${formatPrice(deal.price)}</strong></div>
        <p class="original-price">${formatPrice(deal.originalPrice)}</p>
        <div class="card-meta">
          <span>${escapeHtml(deal.postedAt)}</span>
          <div class="reactions" aria-label="조회 ${deal.views}, 댓글 ${deal.comments}, 추천 ${deal.votes}">
            <span>👁 ${won.format(deal.views)}</span><span>💬 ${deal.comments}</span><span class="hot">♥ ${deal.votes}</span>
          </div>
        </div>
      </div>
    </article>`;
}

function popularItem(deal, index) {
  return `
    <article class="popular-item" tabindex="0" data-deal-id="${deal.id}">
      <div class="rank-line"><span class="rank-number">${index + 1}</span><span class="rank-heat">🔥 ${deal.votes}</span></div>
      <h3>${escapeHtml(deal.title)}</h3>
      <div class="rank-price"><strong>${formatPrice(deal.price)}</strong><em>${deal.discountRate}% ↓</em></div>
    </article>`;
}

function latestItem(deal) {
  return `
    <article class="latest-item" tabindex="0" data-deal-id="${deal.id}">
      <span class="latest-icon" aria-hidden="true">${categoryEmoji(deal.category)}</span>
      <div class="latest-copy"><strong>${escapeHtml(deal.title)}</strong><small>${escapeHtml(deal.store)} · ${escapeHtml(deal.postedAt)}</small></div>
      <div class="latest-price"><em>${deal.discountRate}%</em><strong>${formatPrice(deal.price)}</strong></div>
    </article>`;
}

function bindDealClicks(container) {
  container.querySelectorAll('[data-deal-id]').forEach((card) => {
    const open = () => showToast('상품 상세페이지는 다음 제작 단계에서 연결됩니다.');
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
  const visibleDeals = state.deals.slice(0, state.visibleCount);
  elements.dealGrid.classList.remove('skeleton-grid');
  elements.dealGrid.innerHTML = visibleDeals.map(productCard).join('');

  const hasResults = state.deals.length > 0;
  elements.dealGrid.hidden = !hasResults;
  elements.emptyState.hidden = hasResults;
  elements.loadMore.hidden = !hasResults || state.visibleCount >= state.deals.length;

  if (!hasResults) {
    elements.resultSummary.textContent = state.query
      ? `“${state.query}” 검색 결과가 없어요.`
      : `${state.category} 카테고리에 아직 등록된 핫딜이 없어요.`;
  } else if (state.query) {
    elements.resultSummary.textContent = `“${state.query}” 핫딜 ${state.deals.length}개를 찾았어요.`;
  } else if (state.category !== '전체') {
    elements.resultSummary.textContent = `${state.category} 핫딜 ${state.deals.length}개를 모았어요.`;
  } else {
    elements.resultSummary.textContent = `지금 확인할 수 있는 핫딜 ${state.deals.length}개예요.`;
  }

  bindDealClicks(elements.dealGrid);
}

async function loadDeals({ scroll = false } = {}) {
  const params = new URLSearchParams({
    category: state.category,
    sort: state.sort,
    q: state.query,
  });

  try {
    const response = await fetch(`/api/deals?${params}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.deals = data.deals;
    renderDeals();
    renderLatest(state.deals);
    if (scroll) document.querySelector('#all-deals').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error('핫딜 데이터를 불러오지 못했습니다.', error);
    elements.dealGrid.hidden = true;
    elements.emptyState.hidden = false;
    elements.loadMore.hidden = true;
    elements.resultSummary.textContent = '핫딜을 불러오지 못했어요. 잠시 후 다시 시도해주세요.';
  }
}

async function loadPopular() {
  try {
    const response = await fetch('/api/popular');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    elements.popularList.classList.remove('skeleton-list');
    elements.popularList.innerHTML = data.deals.map(popularItem).join('');
    bindDealClicks(elements.popularList);
  } catch (error) {
    console.error('인기 핫딜을 불러오지 못했습니다.', error);
    elements.popularList.innerHTML = '<p>인기 핫딜을 불러오지 못했어요.</p>';
  }
}

function renderLatest(deals) {
  const latest = [...deals].sort((a, b) => a.postedMinutes - b.postedMinutes).slice(0, 6);
  elements.latestList.innerHTML = latest.map(latestItem).join('');
  if (!latest.length) {
    elements.latestList.innerHTML = '<p style="color:#91a6c8">조건에 맞는 최신 핫딜이 없어요.</p>';
  }
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

document.querySelectorAll('.my-button, .bottom-nav button:not(.mobile-search-trigger)').forEach((button) => {
  button.addEventListener('click', () => showToast('로그인과 MY는 다음 제작 단계에서 연결됩니다.'));
});

Promise.all([loadPopular(), loadDeals()]);
