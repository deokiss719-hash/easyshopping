const { Pool } = require('pg');
const { migrate, createDealStore } = require('../deal-store');
const { readR2Config, createR2Storage } = require('./r2-storage');
const { createProviderRegistry } = require('./provider-registry');
const { createPpomppuImageProvider } = require('./ppomppu-source-provider');
const {
  createImagePipeline,
  runGuardedImageBackfill,
  ImageBackfillCircuitBreaker,
} = require('./image-pipeline');

const STOP_FAILURE_CODES = Object.freeze([
  'page_http_403',
  'page_http_429',
  'image_http_403',
  'image_http_429',
]);
const REQUIRED_TABLES = Object.freeze(['deals', 'image_backfill_control']);

function boundedInteger(value, fallback, min, max, name) {
  const candidate = value == null || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < min || candidate > max) {
    throw new TypeError(`${name} must be between ${min} and ${max}`);
  }
  return candidate;
}

function readLocalBackfillConfig(env = process.env) {
  const databaseUrl = String(env.DATABASE_URL || '').trim();
  if (!databaseUrl) throw new TypeError('DATABASE_URL is required');
  let parsedDatabaseUrl;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new TypeError('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)
    || !parsedDatabaseUrl.hostname || !parsedDatabaseUrl.pathname.slice(1)) {
    throw new TypeError('DATABASE_URL must be a valid PostgreSQL URL');
  }

  const r2Config = readR2Config(env);
  if (!r2Config.enabled) {
    throw new TypeError(`R2 configuration is incomplete: ${r2Config.missing.join(', ')}`);
  }

  return {
    databaseUrl,
    limit: boundedInteger(env.IMAGE_BACKFILL_LIMIT, 15, 1, 15, 'IMAGE_BACKFILL_LIMIT'),
    requestIntervalMs: boundedInteger(
      env.IMAGE_REQUEST_INTERVAL_MS,
      5_000,
      5_000,
      60_000,
      'IMAGE_REQUEST_INTERVAL_MS',
    ),
    source: 'ppomppu',
    r2Config,
  };
}

const DEFAULT_DEPENDENCIES = Object.freeze({
  Pool,
  migrate,
  createDealStore,
  createR2Storage,
  createPpomppuImageProvider,
  createProviderRegistry,
  createImagePipeline,
  runGuardedImageBackfill,
  ImageBackfillCircuitBreaker,
});

async function runLocalImageBackfill({
  env = process.env,
  checkOnly = false,
  dependencies = {},
  logger = console,
} = {}) {
  const config = readLocalBackfillConfig(env);
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const pool = new deps.Pool({
    connectionString: config.databaseUrl,
    application_name: 'easyhotdeal-local-image-backfill',
    max: 2,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
  });

  try {
    const storage = deps.createR2Storage({ config: config.r2Config });
    if (!storage.enabled) throw new Error('R2 storage is not enabled');
    if (checkOnly) {
      const schema = await pool.query(
        `SELECT to_regclass($1) AS deals,
                to_regclass($2) AS image_backfill_control`,
        REQUIRED_TABLES,
      );
      const missing = REQUIRED_TABLES.filter((table) => schema.rows[0]?.[table] == null);
      if (missing.length) throw new Error(`database schema is missing required tables: ${missing.join(', ')}`);
      return { status: 'checked', database: 'ok', storage: 'configured' };
    }

    await deps.migrate(pool);
    const store = deps.createDealStore(pool);
    const provider = deps.createPpomppuImageProvider({
      requestIntervalMs: config.requestIntervalMs,
    });
    const providerRegistry = deps.createProviderRegistry([provider]);
    const pipeline = deps.createImagePipeline({
      store,
      storage,
      providerRegistry,
      logger,
    });
    const breaker = new deps.ImageBackfillCircuitBreaker({
      failureCodes: STOP_FAILURE_CODES,
    });
    return await deps.runGuardedImageBackfill({
      store,
      pipeline,
      breaker,
      source: config.source,
      limit: config.limit,
      concurrency: 1,
      delayMs: config.requestIntervalMs,
      stopOnFailureCodes: [...STOP_FAILURE_CODES],
    });
  } finally {
    await pool.end();
  }
}

module.exports = {
  STOP_FAILURE_CODES,
  REQUIRED_TABLES,
  readLocalBackfillConfig,
  runLocalImageBackfill,
};
