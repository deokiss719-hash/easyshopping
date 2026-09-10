const express = require('express');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
}

function createAdminApiRouter({ store, auth, metadataFetcher } = {}) {
  if (!store || !auth?.requireAuth || !auth?.requireMutationProtection) throw new TypeError('admin store and auth are required');
  const router = express.Router();
  router.use(auth.requireAuth);

  router.get('/manual-deals', asyncRoute(async (_req, res) => res.json({ deals: await store.listManualDeals() })));
  router.post('/manual-deals', auth.requireMutationProtection, asyncRoute(async (req, res) => res.status(201).json(await store.createManualDeal(req.body))));
  const update = asyncRoute(async (req, res) => {
    const deal = await store.updateManualDeal(req.params.id, req.body);
    return deal ? res.json(deal) : res.status(404).json({ error: 'not_found' });
  });
  router.put('/manual-deals/:id', auth.requireMutationProtection, update);
  router.patch('/manual-deals/:id', auth.requireMutationProtection, update);
  router.delete('/manual-deals/:id', auth.requireMutationProtection, asyncRoute(async (req, res) => (
    await store.deleteManualDeal(req.params.id) ? res.sendStatus(204) : res.status(404).json({ error: 'not_found' })
  )));
  router.get('/settings', asyncRoute(async (_req, res) => res.json(await store.getSettings())));
  router.put('/settings', auth.requireMutationProtection, asyncRoute(async (req, res) => res.json(await store.setSettings(req.body?.values))));
  router.put('/settings/:key', auth.requireMutationProtection, asyncRoute(async (req, res) => res.json(await store.setSetting(req.params.key, req.body?.value))));
  router.patch('/settings/:key', auth.requireMutationProtection, asyncRoute(async (req, res) => res.json(await store.setSetting(req.params.key, req.body?.value))));
  router.post('/url-metadata', auth.requireMutationProtection, asyncRoute(async (req, res) => {
    if (typeof metadataFetcher !== 'function') return res.status(503).json({ error: 'metadata_unavailable' });
    return res.json(await metadataFetcher(req.body?.url));
  }));
  router.use((error, _req, res, next) => {
    if (error instanceof TypeError) return res.status(400).json({ error: 'invalid_request', message: error.message });
    if (error?.code && String(error.code).startsWith('23')) return res.status(409).json({ error: 'conflict' });
    if (error instanceof Error) return res.status(422).json({ error: 'request_failed' });
    return next(error);
  });
  return router;
}

function adminJsonErrorHandler(error, req, res, next) {
  if (!String(req.originalUrl || req.url || '').startsWith('/api/admin/')) return next(error);
  if (error?.type === 'entity.too.large' || error?.status === 413) return res.status(413).json({ error: 'request_too_large' });
  if (error?.type === 'entity.parse.failed' && error instanceof SyntaxError) return res.status(400).json({ error: 'invalid_json' });
  return next(error);
}

function createPublicSettingsRouter(store) {
  if (!store?.getPublicSettings) throw new TypeError('settings store is required');
  const router = express.Router();
  router.get('/', asyncRoute(async (_req, res) => res.json(await store.getPublicSettings())));
  return router;
}

module.exports = { createAdminApiRouter, createPublicSettingsRouter, adminJsonErrorHandler };