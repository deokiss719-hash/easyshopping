(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DealPage = api;
})(typeof globalThis === 'object' ? globalThis : this, function createDealPage() {
  async function fetchLiveDealsPage({
    source, query = '', category = '전체', sort = 'latest', featured = false,
    page = 1, size = 8, fetchImpl = fetch, signal,
  } = {}) {
    const params = new URLSearchParams({
      q: String(query), sort: String(sort), page: String(page), size: String(size),
    });
    if (source != null && source !== '') params.set('source', source);
    if (category && category !== '전체') params.set('category', category);
    if (featured) params.set('featured', 'true');
    const response = await fetchImpl(`/api/live-deals?${params}`, { signal });
    if (!response?.ok) throw new Error(`Live deals request failed: HTTP ${response?.status || 'unknown'}`);
    const data = await response.json();
    if (!Array.isArray(data?.deals)
      || !Number.isSafeInteger(data.total) || data.total < 0
      || !Number.isSafeInteger(data.page) || data.page < 1
      || !Number.isSafeInteger(data.size) || data.size < 1
      || !Number.isSafeInteger(data.totalPages) || data.totalPages < 0
      || typeof data.hasNextPage !== 'boolean'
      || data.totalPages !== Math.ceil(data.total / data.size)
      || data.hasNextPage !== (data.page * data.size < data.total)
      || (data.imageBaseUrls != null && (!Array.isArray(data.imageBaseUrls)
        || data.imageBaseUrls.some((value) => typeof value !== 'string')))) {
      throw new TypeError('Invalid live deals response');
    }
    const imageBaseUrls = data.imageBaseUrls || [];
    return {
      ...data,
      deals: data.deals.map((deal) => ({ ...deal, imageBaseUrls })),
    };
  }

  return { fetchLiveDealsPage };
});
