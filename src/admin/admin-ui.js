const express = require('express');
const path = require('node:path');

const PUBLIC_ASSETS = new Set(['admin.css', 'admin.js', 'login.js', 'url-utils.js']);

function createAdminUiRouter({ auth, publicDir = path.join(__dirname, '..', '..', 'public', 'admin') } = {}) {
  const router = express.Router();
  router.use((_req, res, next) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
  router.get('/login', (_req, res) => res.sendFile(path.join(publicDir, 'login.html')));
  router.get('/:asset', (req, res, next) => {
    if (!PUBLIC_ASSETS.has(req.params.asset)) return next();
    return res.sendFile(path.join(publicDir, req.params.asset));
  });

  const requireAuth = auth?.requireAuth || ((_req, res) => res.status(401).json({ error: 'authentication_required' }));
  router.get(['/', '/index.html'], requireAuth, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  router.use((_req, res) => res.sendStatus(404));
  return router;
}

module.exports = { createAdminUiRouter, PUBLIC_ASSETS };
