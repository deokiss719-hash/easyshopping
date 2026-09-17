const express = require('express');

function createAdvertisingInquiryRouter(store) {
  if (!store?.createAdvertisingInquiry) throw new TypeError('advertising inquiry store is required');
  const router = express.Router();
  router.post('/', async (req, res, next) => {
    try {
      if (String(req.body?.website || '').trim()) return res.status(204).end();
      if (req.body?.privacyConsent !== true) return res.status(400).json({ error: 'privacy_consent_required' });
      await store.createAdvertisingInquiry(req.body);
      return res.status(201).json({ ok: true });
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ error: 'invalid_request', message: error.message });
      return next(error);
    }
  });
  return router;
}

module.exports = { createAdvertisingInquiryRouter };
