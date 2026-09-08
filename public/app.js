const grid = document.querySelector('#dealGrid');
const emptyState = document.querySelector('#emptyState');
const updatedAt = document.querySelector('#updatedAt');
const searchInput = document.querySelector('#searchInput');
const filterButtons = [...document.querySelectorAll('.filter')];

let activeCategory = '전체';
let debounceTimer;

const won = new Intl.NumberFormat('ko-KR');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function dealCard(deal) {
  const discount = Math.round((1 - deal.price / deal.originalPrice) * 100);

  return `
    <article class="deal-card">
      <div class="card-top">
        <span class="category">${escapeHtml(deal.category)}</span>
        <span class="heat">🔥 ${deal.temperature}°</span>
      </div>
      <div class="product-visual" data-category="${escapeHtml(deal.category)}">
        <span>${escapeHtml(deal.category.slice(0, 1))}</span>
      </div>
      <div class="card-body">
        <div class="meta"><span>${escapeHtml(deal.store)}</span><span>${escapeHtml(deal.postedAt)}</span></div>
        <h3>${escapeHtml(deal.title)}</h3>
        <div class="prices">
          <span class="discount">${discount}%</span>
          <strong>${won.format(deal.price)}원</strong>
          <del>${won.format(deal.originalPrice)}원</del>
        </div>
        <a href="${escapeHtml(deal.url)}" aria-label="${escapeHtml(deal.title)} 보러 가기">딜 보러 가기 <span>→</span></a>
      </div>
    </article>`;
}

async function loadDeals() {
  grid.classList.add('loading');
  const params = new URLSearchParams({ category: activeCategory, q: searchInput.value.trim() });

  try {
    const response = await fetch(`/api/deals?${params}`);
    if (!response.ok) throw new Error('핫딜 정보를 불러오지 못했습니다.');
    const data = await response.json();

    grid.innerHTML = data.deals.map(dealCard).join('');
    emptyState.hidden = data.count !== 0;
    const time = new Date(data.updatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    updatedAt.textContent = `${time} 기준 · ${data.count}개의 할인 정보`;
  } catch (error) {
    grid.innerHTML = '';
    emptyState.hidden = false;
    emptyState.textContent = '잠시 후 다시 시도해 주세요.';
  } finally {
    grid.classList.remove('loading');
  }
}

filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    activeCategory = button.dataset.category;
    filterButtons.forEach((item) => item.classList.toggle('active', item === button));
    loadDeals();
  });
});

searchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadDeals, 250);
});

loadDeals();
