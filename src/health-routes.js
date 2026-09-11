const express = require('express');

function createHealthRouter({
  getDatabaseMode,
  readiness,
  service = 'easyshopping',
  version = '0.4.0',
}) {
  if (typeof getDatabaseMode !== 'function') throw new TypeError('getDatabaseMode is required');
  if (!readiness || typeof readiness.handler !== 'function') throw new TypeError('readiness handler is required');

  const router = express.Router();
  router.get('/health', (_request, response) => {
    response.json({ ok: true, service, version, database: getDatabaseMode() });
  });
  router.get('/readiness', (request, response) => readiness.handler(request, response));
  return router;
}

module.exports = { createHealthRouter };
