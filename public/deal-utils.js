(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DealUtils = api;
})(typeof globalThis === 'object' ? globalThis : this, function createDealUtils() {
  const categoryRules = [
    ['디지털', /아이폰|갤럭시|스마트폰|휴대폰|태블릿|아이패드|노트북|컴퓨터|모니터|키보드|마우스|이어폰|헤드폰|SSD|메모리|카메라/i],
    ['가전', /냉장고|세탁기|건조기|청소기|에어컨|공기청정기|TV|텔레비전|전자레인지|에어프라이어|밥솥/i],
    ['식품', /라면|김치|고기|소고기|돼지고기|닭|과자|커피|음료|생수|쌀|과일|식품|밀키트|치킨|피자/i],
    ['생활', /휴지|세제|샴푸|칫솔|치약|수건|마스크|주방|생활용품|물티슈/i],
    ['패션', /신발|운동화|티셔츠|셔츠|바지|자켓|재킷|코트|가방|의류|패딩/i],
    ['뷰티', /화장품|크림|에센스|선크림|향수|마스크팩|뷰티/i],
    ['육아', /기저귀|분유|유아|아기|키즈|장난감/i],
    ['게임', /게임|플레이스테이션|PS5|닌텐도|스위치|엑스박스|Xbox/i],
  ];

  function categoryFromTitle(title) {
    const text = String(title || '');
    return categoryRules.find(([, pattern]) => pattern.test(text))?.[0] || '기타';
  }

  function relativeTime(value, now = new Date()) {
    const date = new Date(value);
    const current = new Date(now);
    if (Number.isNaN(date.getTime()) || Number.isNaN(current.getTime())) return '시간 정보 없음';
    const minutes = Math.max(0, Math.floor((current.getTime() - date.getTime()) / 60000));
    if (minutes < 1) return '방금 전';
    if (minutes < 60) return `${minutes}분 전`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}시간 전`;
    return `${Math.floor(hours / 24)}일 전`;
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch {
      return '';
    }
  }

  function normalizeDeal(raw, now = new Date()) {
    return {
      id: String(raw.id),
      badge: raw.isEnded ? '종료' : 'LIVE',
      title: String(raw.title || ''),
      price: Number.isSafeInteger(raw.price) && raw.price >= 0 ? raw.price : null,
      store: String(raw.store || raw.source || '판매처 확인'),
      category: categoryFromTitle(raw.title),
      source: String(raw.source || ''),
      publishedAt: raw.publishedAt || null,
      postedAt: relativeTime(raw.publishedAt, now),
      imageUrl: raw.imageUrl || null,
      imageTone: 'blue',
      imageLabel: categoryFromTitle(raw.title),
      url: safeExternalUrl(raw.url),
      isEnded: Boolean(raw.isEnded),
    };
  }

  function filterAndSortDeals(deals, { category = '전체', sort = 'latest' } = {}) {
    const filtered = category === '전체' ? [...deals] : deals.filter((deal) => deal.category === category);
    if (sort === 'price-low') {
      return filtered.sort((a, b) => {
        if (a.price == null) return 1;
        if (b.price == null) return -1;
        return a.price - b.price;
      });
    }
    return filtered.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  }

  async function fetchAllLiveDeals({ source = 'ppomppu', query = '', fetchImpl = fetch, signal } = {}) {
    const all = [];
    let page = 1;
    let total = 0;

    do {
      const params = new URLSearchParams({ source, q: query, page: String(page), size: '100' });
      const response = await fetchImpl(`/api/live-deals?${params}`, { signal });
      if (!response?.ok) throw new Error(`Live deals request failed: HTTP ${response?.status || 'unknown'}`);
      const data = await response.json();
      if (!Array.isArray(data?.deals) || !Number.isSafeInteger(data.total) || data.total < 0) {
        throw new TypeError('Invalid live deals response');
      }
      total = data.total;
      all.push(...data.deals);
      if (data.deals.length === 0) break;
      page += 1;
      if (page > Math.ceil(total / 100) + 1) throw new Error('Live deals pagination did not terminate');
    } while (all.length < total);

    return all.slice(0, total);
  }

  return { categoryFromTitle, relativeTime, normalizeDeal, filterAndSortDeals, fetchAllLiveDeals };
});
