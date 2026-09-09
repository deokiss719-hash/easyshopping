const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readLocalBackfillConfig,
  runLocalImageBackfill,
} = require('../src/images/local-backfill-runner');

const VALID_ENV = Object.freeze({
  DATABASE_URL: 'postgresql://user:password@db.example.com:5432/easyshopping?sslmode=require',
  R2_ACCOUNT_ID: 'account123',
  R2_ACCESS_KEY_ID: 'access-key',
  R2_SECRET_ACCESS_KEY: 'secret-key',
  R2_BUCKET_NAME: 'easyshopping-images',
  R2_PUBLIC_BASE_URL: 'https://images.example.com',
});

test('로컬 이미지 배치 설정은 ppomppu 소스와 보수적인 처리량만 허용한다', () => {
  assert.deepEqual(readLocalBackfillConfig(VALID_ENV), {
    databaseUrl: VALID_ENV.DATABASE_URL,
    limit: 15,
    requestIntervalMs: 5_000,
    source: 'ppomppu',
    r2Config: {
      enabled: true,
      accountId: 'account123',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      bucketName: 'easyshopping-images',
      publicBaseUrl: 'https://images.example.com',
      endpoint: 'https://account123.r2.cloudflarestorage.com',
    },
  });
  assert.equal(readLocalBackfillConfig({ ...VALID_ENV, IMAGE_BACKFILL_LIMIT: '3' }).limit, 3);
  assert.throws(() => readLocalBackfillConfig({ ...VALID_ENV, IMAGE_BACKFILL_LIMIT: '16' }), /between 1 and 15/);
  assert.throws(() => readLocalBackfillConfig({ ...VALID_ENV, IMAGE_REQUEST_INTERVAL_MS: '4999' }), /between 5000 and 60000/);
  assert.throws(() => readLocalBackfillConfig({ ...VALID_ENV, DATABASE_URL: '' }), /DATABASE_URL/);
});

test('로컬 one-shot은 DB migration 후 ppomppu 후보만 직렬 실행하고 연결을 닫는다', async () => {
  const calls = [];
  const pool = {
    query: async () => ({ rows: [{ ok: 1 }] }),
    end: async () => { calls.push(['pool.end']); },
  };
  class PoolImpl {
    constructor(options) {
      calls.push(['Pool', options]);
      return pool;
    }
  }
  const store = { name: 'store' };
  const storage = { enabled: true };
  const provider = { name: 'ppomppu-source-post' };
  const registry = { name: 'registry' };
  const pipeline = { enabled: true };
  const expected = { status: 'completed', selected: 2, ready: 2, failed: 0, skipped: 0 };
  const dependencies = {
    Pool: PoolImpl,
    migrate: async (value) => calls.push(['migrate', value]),
    createDealStore: (value) => { calls.push(['store', value]); return store; },
    createR2Storage: ({ config }) => { calls.push(['storage', config]); return storage; },
    createPpomppuImageProvider: (options) => { calls.push(['provider', options]); return provider; },
    createProviderRegistry: (providers) => { calls.push(['registry', providers]); return registry; },
    createImagePipeline: (options) => { calls.push(['pipeline', options]); return pipeline; },
    ImageBackfillCircuitBreaker: class Breaker {
      constructor() { this.failureCodes = new Set(['page_http_403', 'page_http_429', 'image_http_403', 'image_http_429']); }
    },
    runGuardedImageBackfill: async (options) => { calls.push(['run', options]); return expected; },
  };

  const result = await runLocalImageBackfill({ env: VALID_ENV, dependencies });

  assert.equal(result, expected);
  const providerCall = calls.find(([name]) => name === 'provider');
  assert.equal(providerCall[1].requestIntervalMs, 5_000);
  const runCall = calls.find(([name]) => name === 'run');
  assert.equal(runCall[1].source, 'ppomppu');
  assert.equal(runCall[1].limit, 15);
  assert.equal(runCall[1].concurrency, 1);
  assert.equal(runCall[1].delayMs, 5_000);
  assert.deepEqual(runCall[1].stopOnFailureCodes, [
    'page_http_403', 'page_http_429', 'image_http_403', 'image_http_429',
  ]);
  assert.equal(calls.at(-1)[0], 'pool.end');
});

test('--check 경로는 DB와 R2 설정만 검증하고 원문 provider와 쓰기 배치를 호출하지 않는다', async () => {
  const calls = [];
  const pool = {
    query: async (sql, parameters) => {
      calls.push(['query', sql, parameters]);
      return { rows: [{ deals: 'deals', image_backfill_control: 'image_backfill_control' }] };
    },
    end: async () => calls.push(['end']),
  };
  const dependencies = {
    Pool: class { constructor() { return pool; } },
    migrate: async () => { throw new Error('migrate must not run'); },
    createDealStore: () => { throw new Error('store must not be created'); },
    createR2Storage: () => { calls.push(['storage']); return { enabled: true }; },
    createPpomppuImageProvider: () => { throw new Error('provider must not be created'); },
    runGuardedImageBackfill: async () => { throw new Error('backfill must not run'); },
  };

  const result = await runLocalImageBackfill({ env: VALID_ENV, checkOnly: true, dependencies });

  assert.deepEqual(result, { status: 'checked', database: 'ok', storage: 'configured' });
  assert.equal(calls[0][0], 'storage');
  assert.equal(calls[1][0], 'query');
  assert.match(calls[1][1], /^SELECT to_regclass/);
  assert.doesNotMatch(calls[1][1], /INSERT|UPDATE|DELETE|CREATE|ALTER|DROP/i);
  assert.deepEqual(calls[1][2], ['deals', 'image_backfill_control']);
  assert.deepEqual(calls[2], ['end']);
});

test('--check 경로는 필수 DB schema가 없으면 실패하고 pool을 닫는다', async () => {
  const calls = [];
  const pool = {
    query: async () => ({ rows: [{ deals: 'deals', image_backfill_control: null }] }),
    end: async () => calls.push('end'),
  };
  const dependencies = {
    Pool: class { constructor() { return pool; } },
    migrate: async () => { throw new Error('migrate must not run'); },
    createR2Storage: () => ({ enabled: true }),
    createPpomppuImageProvider: () => { throw new Error('provider must not be created'); },
    runGuardedImageBackfill: async () => { throw new Error('backfill must not run'); },
  };

  await assert.rejects(
    () => runLocalImageBackfill({ env: VALID_ENV, checkOnly: true, dependencies }),
    /database schema is missing required tables: image_backfill_control/,
  );
  assert.deepEqual(calls, ['end']);
});

test('오류가 발생해도 로컬 one-shot은 DB pool을 닫는다', async () => {
  let ended = false;
  const pool = { query: async () => ({}), end: async () => { ended = true; } };
  const dependencies = {
    Pool: class { constructor() { return pool; } },
    migrate: async () => { throw new Error('migration failed'); },
  };

  await assert.rejects(
    () => runLocalImageBackfill({ env: VALID_ENV, dependencies }),
    /migration failed/,
  );
  assert.equal(ended, true);
});
