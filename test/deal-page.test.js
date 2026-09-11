const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchLiveDealsPage } = require('../public/deal-page');

test('fetchLiveDealsPage requests exactly one small server-filtered page', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return { deals: [{ id: 1 }], total: 9, page: 2, size: 8, totalPages: 2, hasNextPage: false, imageBaseUrls: [] };
      },
    };
  };
  const signal = {};
  const result = await fetchLiveDealsPage({
    query: '모니터', category: '디지털/가전', sort: 'price-low', page: 2, size: 8, signal, fetchImpl,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.signal, signal);
  const url = new URL(calls[0].url, 'https://example.test');
  assert.equal(url.searchParams.get('q'), '모니터');
  assert.equal(url.searchParams.get('category'), '디지털/가전');
  assert.equal(url.searchParams.get('sort'), 'price-low');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('size'), '8');
  assert.equal(result.total, 9);
  assert.equal(result.hasNextPage, false);
});

test('fetchLiveDealsPage omits the 전체 category and rejects inconsistent metadata', async () => {
  let requestedUrl;
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => ({ deals: [], total: 0, page: 1, size: 8 }) };
  };
  await assert.rejects(
    () => fetchLiveDealsPage({ category: '전체', page: 1, size: 8, fetchImpl }),
    /Invalid live deals response/,
  );
  assert.equal(new URL(requestedUrl, 'https://example.test').searchParams.has('category'), false);
});
