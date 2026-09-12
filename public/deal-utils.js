(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DealUtils = api;
})(typeof globalThis === 'object' ? globalThis : this, function createDealUtils() {
  const categories = new Set([
    '디지털/가전', '식품', '생활/주방', '패션/의류', '뷰티', '건강', '육아/아동',
    '게임', '스포츠/레저', '반려동물', '자동차', '여행/숙박', '상품권/쿠폰', '기타',
  ]);

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

  function safeImageUrl(value, allowedBaseUrls = []) {
    const raw = String(value || '');
    if (/^\/api\/public\/manual-deals\/\d+\/image$/.test(raw)) return raw;
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return '';
      const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      const legacyAllowed = host === 'ppomppu.co.kr' || host.endsWith('.ppomppu.co.kr');
      const fmkoreaAllowed = url.origin === 'https://image.fmkorea.com';
      const coupangAllowed = host.endsWith('.coupangcdn.com');
      const configuredAllowed = Array.isArray(allowedBaseUrls) && allowedBaseUrls.some((value) => {
        try {
          const base = new URL(String(value || ''));
          if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) return false;
          const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
          return url.origin === base.origin && (url.pathname === base.pathname || url.pathname.startsWith(basePath));
        } catch {
          return false;
        }
      });
      if (!legacyAllowed && !fmkoreaAllowed && !coupangAllowed && !configuredAllowed) return '';
      if (host === 'localhost' || host.endsWith('.localhost') || host.includes(':')) return '';
      const octets = host.split('.').map(Number);
      if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
        if (octets[0] === 0 || octets[0] === 10 || octets[0] === 127
          || (octets[0] === 169 && octets[1] === 254)
          || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
          || (octets[0] === 192 && octets[1] === 168)) return '';
      }
      return url.href;
    } catch {
      return '';
    }
  }

  function normalizeDeal(raw, now = new Date()) {
    const category = categories.has(raw.category) ? raw.category : '기타';
    const isManual = raw.isManual === true || raw.source === 'manual';
    return {
      id: String(raw.id),
      badge: raw.isEnded ? '종료' : String(raw.badge || 'LIVE'),
      title: String(raw.title || ''),
      price: Number.isSafeInteger(raw.price) && raw.price >= 0 ? raw.price : null,
      originalPrice: Number.isSafeInteger(raw.originalPrice) && raw.originalPrice >= 0
        ? raw.originalPrice
        : null,
      description: raw.description == null ? null : String(raw.description),
      store: String(raw.store || raw.source || '판매처 확인'),
      category,
      source: String(raw.source || ''),
      publishedAt: raw.publishedAt || null,
      postedAt: relativeTime(raw.publishedAt, now),
      imageUrl: safeImageUrl(raw.imageUrl, raw.imageBaseUrls) || null,
      imageTone: 'blue',
      imageLabel: category,
      url: safeExternalUrl(raw.url),
      isEnded: Boolean(raw.isEnded),
      isManual,
      showOnHome: isManual && raw.showOnHome === true,
      priority: Number.isSafeInteger(raw.priority) ? raw.priority : 0,
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

  function mixHomeDeals(deals, { manualLimit = 4, rssLead = 4, interval = 4 } = {}) {
    const safeLimit = Number.isSafeInteger(manualLimit) && manualLimit >= 0 ? manualLimit : 4;
    const rssDeals = deals.filter((deal) => !deal.isManual);
    const manualDeals = deals
      .filter((deal) => deal.isManual && deal.showOnHome)
      .sort((a, b) => (b.priority - a.priority)
        || (new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)))
      .slice(0, safeLimit);

    const mixed = rssDeals.slice(0, rssLead);
    if (rssDeals.length < rssLead) return [...mixed, ...manualDeals];
    let rssIndex = rssLead;
    for (const manualDeal of manualDeals) {
      mixed.push(manualDeal);
      mixed.push(...rssDeals.slice(rssIndex, rssIndex + interval));
      rssIndex += interval;
    }
    mixed.push(...rssDeals.slice(rssIndex));
    return mixed;
  }

  function selectPhoneDeals(deals, { limit = 4 } = {}) {
    const safeLimit = Number.isSafeInteger(limit) && limit >= 0 ? Math.min(limit, 4) : 4;
    return deals
      .filter((deal) => deal.isManual && deal.showOnHome)
      .sort((a, b) => (b.priority - a.priority)
        || (new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)))
      .slice(0, safeLimit);
  }

  async function fetchPublicSiteSettings({ fetchImpl = fetch, signal } = {}) {
    const defaults = { home_manual_limit: 4, phone_section_title: '휴대폰 초특가 핫딜' };
    try {
      const response = await fetchImpl('/api/site-settings', { signal });
      if (!response?.ok) return defaults;
      const settings = await response.json();
      const homeManualLimit = settings?.home_manual_limit;
      const phoneSectionTitle = typeof settings?.phone_section_title === 'string'
        ? settings.phone_section_title.trim()
        : '';
      return {
        home_manual_limit: Number.isSafeInteger(homeManualLimit)
          && homeManualLimit >= 0 && homeManualLimit <= 20
          ? homeManualLimit
          : defaults.home_manual_limit,
        phone_section_title: phoneSectionTitle.length >= 1 && phoneSectionTitle.length <= 100
          ? phoneSectionTitle
          : defaults.phone_section_title,
      };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return defaults;
    }
  }

  return {
    safeImageUrl, relativeTime, normalizeDeal,
    filterAndSortDeals, mixHomeDeals, selectPhoneDeals, fetchPublicSiteSettings,
  };
});
