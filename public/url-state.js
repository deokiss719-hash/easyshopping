(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DealUrlState = api;
})(typeof globalThis === 'object' ? globalThis : this, function createDealUrlState() {
  const categories = new Set([
    '전체', '디지털/가전', '식품', '생활/주방', '패션/의류', '뷰티', '건강',
    '육아/아동', '게임', '스포츠/레저', '반려동물', '자동차', '여행/숙박',
    '상품권/쿠폰', '기타',
  ]);
  const sorts = new Set(['latest', 'price-low']);
  const defaults = { query: '', category: '전체', sort: 'latest' };

  function readDealState(search = '') {
    const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    const query = String(params.get('q') || '').trim();
    const category = String(params.get('category') || '');
    const sort = String(params.get('sort') || '');
    return {
      query: query.length <= 100 ? query : defaults.query,
      category: categories.has(category) ? category : defaults.category,
      sort: sorts.has(sort) ? sort : defaults.sort,
    };
  }

  function buildDealStateUrl(currentUrl, state) {
    const url = new URL(String(currentUrl), 'https://easyshoopping.com');
    const normalized = readDealState(new URLSearchParams({
      q: state?.query || '',
      category: state?.category || '',
      sort: state?.sort || '',
    }).toString());

    for (const key of ['q', 'category', 'sort']) url.searchParams.delete(key);
    if (normalized.query) url.searchParams.set('q', normalized.query);
    if (normalized.category !== defaults.category) url.searchParams.set('category', normalized.category);
    if (normalized.sort !== defaults.sort) url.searchParams.set('sort', normalized.sort);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  return { readDealState, buildDealStateUrl };
});
