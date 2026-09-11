function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} function is required`);
}

function createOperationalHealth({
  checkDatabase,
  getCollectionStatus,
  freshnessThresholdMs,
  timeoutMs = 2000,
  now = () => new Date(),
  service = 'easyshopping',
}) {
  if (checkDatabase != null) requireFunction(checkDatabase, 'checkDatabase');
  requireFunction(getCollectionStatus, 'getCollectionStatus');
  requireFunction(now, 'now');
  if (!Number.isSafeInteger(freshnessThresholdMs) || freshnessThresholdMs < 1) {
    throw new TypeError('freshnessThresholdMs must be a positive integer');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('timeoutMs must be a positive integer');
  }

  async function readStatusBeforeDeadline() {
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('readiness deadline exceeded')), timeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([
        (async () => {
          if (checkDatabase) await checkDatabase({ timeoutMs });
          return getCollectionStatus({ timeoutMs });
        })(),
        deadline,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function check() {
    let collectionStatus;
    try {
      collectionStatus = await readStatusBeforeDeadline();
    } catch {
      return {
        statusCode: 503,
        body: {
          ok: false,
          service,
          checks: { database: 'down', rss: 'unknown' },
          reasons: [{ code: 'database_unavailable' }],
        },
      };
    }

    const lastSuccessAt = collectionStatus?.lastSuccessAt;
    if (lastSuccessAt == null) {
      return {
        statusCode: 503,
        body: {
          ok: false,
          service,
          checks: { database: 'up', rss: 'pending' },
          reasons: [{ code: 'rss_initial_collection_pending' }],
        },
      };
    }

    const currentTime = new Date(now()).getTime();
    const successfulTime = new Date(lastSuccessAt).getTime();
    const age = currentTime - successfulTime;
    const fresh = Number.isFinite(currentTime)
      && Number.isFinite(successfulTime)
      && age >= 0
      && age <= freshnessThresholdMs;
    if (!fresh) {
      return {
        statusCode: 503,
        body: {
          ok: false,
          service,
          checks: { database: 'up', rss: 'stale' },
          reasons: [{ code: 'rss_collection_stale' }],
        },
      };
    }

    return {
      statusCode: 200,
      body: {
        ok: true,
        service,
        checks: { database: 'up', rss: 'fresh' },
        reasons: [],
      },
    };
  }

  return {
    check,
    async handler(_request, response) {
      const result = await check();
      response.status(result.statusCode).json(result.body);
    },
  };
}

module.exports = { createOperationalHealth };
