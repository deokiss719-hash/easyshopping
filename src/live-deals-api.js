const express = require('express');
const { InvalidQueryError } = require('./deal-store');

function toApiDeal(deal) {
  return {
    id: deal.id,
    badge: deal.isEnded ? '종료' : 'LIVE',
    title: deal.title,
    price: deal.priceAmount,
    priceText: deal.priceText,
    store: deal.merchant || deal.source,
    category: deal.source,
    source: deal.source,
    publishedAt: deal.publishedAt,
    postedAt: deal.publishedAt,
    imageUrl: deal.imageUrl,
    url: deal.originalUrl,
    isEnded: deal.isEnded,
  };
}

function createLiveDealsRouter(store) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    if (!store) {
      return res.status(503).json({
        code: 'DATABASE_NOT_CONFIGURED',
        message: '실시간 핫딜 데이터베이스를 준비 중입니다.',
      });
    }

    try {
      const result = await store.list({
        q: req.query.q,
        source: req.query.source,
        page: req.query.page,
        size: req.query.size,
      });
      return res.json({
        updatedAt: new Date().toISOString(),
        count: result.items.length,
        total: result.total,
        page: result.page,
        size: result.size,
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
