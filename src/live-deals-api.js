const express = require('express');
const { InvalidQueryError } = require('./deal-store');

function toApiDeal(deal) {
  const isManual = deal.source === 'manual';
  const manualImageUrl = isManual
    ? (/^\d+$/.test(String(deal.manualId || '')) && deal.hasManualImage === true
      ? `/api/public/manual-deals/${deal.manualId}/image`
      : null)
    : deal.imageUrl;
  return {
    id: deal.id,
    badge: deal.isEnded ? '종료' : (deal.badge || 'LIVE'),
    title: deal.title,
    price: deal.priceAmount,
    priceText: deal.priceText,
    store: deal.merchant || deal.source,
    category: deal.category || '기타',
    source: deal.source,
    publishedAt: deal.publishedAt,
    postedAt: deal.publishedAt,
    imageUrl: manualImageUrl,
    imageStatus: deal.imageStatus || (manualImageUrl ? 'ready' : 'missing_merchant_url'),
    originalPrice: deal.originalPriceAmount ?? null,
    description: deal.description ?? null,
    isManual,
    showOnHome: deal.showOnHome ?? false,
    priority: deal.priority ?? 0,
    url: deal.originalUrl,
    isEnded: deal.isEnded,
  };
}

function createLiveDealsRouter(store, { imageBaseUrls = [], allowedSources = ['ppomppu', 'manual'] } = {}) {
  const router = express.Router();
  const publicSources = new Set(allowedSources);
  const trustedImageBaseUrls = Object.freeze(
    imageBaseUrls.filter((value) => typeof value === 'string' && value.startsWith('https://')),
  );

  router.get('/', async (req, res) => {
    if (!store) {
      return res.status(503).json({
        code: 'DATABASE_NOT_CONFIGURED',
        message: '실시간 핫딜 데이터베이스를 준비 중입니다.',
      });
    }

    try {
      const requestedSource = String(req.query.source || 'ppomppu').trim();
      if (requestedSource && !publicSources.has(requestedSource)) {
        return res.status(400).json({ code: 'INVALID_QUERY', message: 'source is not supported' });
      }
      const result = await store.list({
        q: req.query.q,
        source: requestedSource,
        category: req.query.category,
        sort: req.query.sort,
        featured: req.query.featured,
        page: req.query.page,
        size: req.query.size,
      });
      return res.json({
        updatedAt: new Date().toISOString(),
        count: result.items.length,
        total: result.total,
        page: result.page,
        size: result.size,
        totalPages: Math.ceil(result.total / result.size),
        hasNextPage: result.page * result.size < result.total,
        imageBaseUrls: trustedImageBaseUrls,
        deals: result.items.map(toApiDeal),
      });
    } catch (error) {
      if (error instanceof InvalidQueryError) {
        return res.status(400).json({ code: 'INVALID_QUERY', message: error.message });
      }
      console.error('실시간 핫딜 조회 실패:', error);
      return res.status(500).json({ code: 'DATABASE_ERROR', message: '데이터를 불러오지 못했습니다.' });
    }
  });

  return router;
}

module.exports = { createLiveDealsRouter, toApiDeal };
