const APPROVED_FEED_SOURCE = 'ppomppu';
const APPROVED_FEED_URL = 'https://www.ppomppu.co.kr/rss.php?id=ppomppu';

function hasValue(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function readAdminRuntime(env = process.env) {
  const hasUsername = hasValue(env.ADMIN_USERNAME);
  const hasPasswordHash = hasValue(env.ADMIN_PASSWORD_HASH);
  if (hasUsername !== hasPasswordHash) {
    throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD_HASH must be configured together');
  }

  const authEnabled = hasValue(env.ADMIN_SESSION_SECRET);
  return {
    authEnabled,
    sessionSecret: authEnabled ? env.ADMIN_SESSION_SECRET : null,
    bootstrap: authEnabled && hasUsername
      ? { username: env.ADMIN_USERNAME, passwordHash: env.ADMIN_PASSWORD_HASH }
      : null,
  };
}

async function mountDatabaseApis({
  app,
  adminStore,
  adminRuntime,
  createAuth,
  createAdminApi,
  createPublicSettings,
  createManualImages,
}) {
  let auth = null;
  if (adminRuntime.authEnabled) {
    if (adminRuntime.bootstrap) {
      await adminStore.bootstrapAdmin(adminRuntime.bootstrap.username, adminRuntime.bootstrap.passwordHash);
    }
    auth = createAuth(adminRuntime.sessionSecret);
    app.use('/api/admin/auth', auth.router);
    app.use('/api/admin', createAdminApi(auth));
  }
  app.use('/api/site-settings', createPublicSettings());
  app.use('/api/public/manual-deals', createManualImages());
  return auth;
}

function readCollectorRuntime(env = process.env) {
  const intervalMs = Number(env.RSS_POLL_INTERVAL_MS || 600000);
  const freshnessThresholdMs = Number(env.RSS_FRESHNESS_THRESHOLD_MS || intervalMs * 3);
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new Error('RSS_POLL_INTERVAL_MS must be a positive integer');
  }
  if (!Number.isSafeInteger(freshnessThresholdMs) || freshnessThresholdMs < 1) {
    throw new Error('RSS_FRESHNESS_THRESHOLD_MS must be a positive integer');
  }
  return {
    source: APPROVED_FEED_SOURCE,
    feedUrl: APPROVED_FEED_URL,
    intervalMs,
    freshnessThresholdMs,
  };
}

module.exports = {
  APPROVED_FEED_SOURCE,
  APPROVED_FEED_URL,
  readAdminRuntime,
  readCollectorRuntime,
  mountDatabaseApis,
};
