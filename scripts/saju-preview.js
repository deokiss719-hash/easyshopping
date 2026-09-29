// Isolated local PostgreSQL-WASM database; never uses DATABASE_URL.
const express = require('express');
const { testPool } = require('../test/helpers/saju-db');
const { createStore } = require('../src/saju/store');
const { createSajuRouter } = require('../src/saju/routes');
(async () => {
  const pool = await testPool();
  const store = await createStore(pool, 'local-preview-only-secret-'.repeat(3));
  const port = Number(process.env.PORT) || 3417;
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  // Explicit allowlist: inherited live keys, DATABASE_URL and production mode cannot enter preview.
  const env = { SAJU_ACCESS_MODE: 'paid', SAJU_PAYMENT_MODE: 'demo', SAJU_PUBLIC_ORIGIN: `http://localhost:${port}` };
  if (process.env.SAJU_PREVIEW_PG_TEST === '1') {
    if (!process.env.SAJU_TOSS_CLIENT_KEY?.startsWith('test_ck_') ||
        !process.env.SAJU_TOSS_SECRET_KEY?.startsWith('test_sk_')) {
      await pool.end();
      throw Error('PG preview requires test_ck_ and test_sk_ keys; live keys are refused.');
    }
    env.SAJU_PAYMENT_MODE = 'test';
    env.SAJU_TOSS_CLIENT_KEY = process.env.SAJU_TOSS_CLIENT_KEY;
    env.SAJU_TOSS_SECRET_KEY = process.env.SAJU_TOSS_SECRET_KEY;
  }
  const { router } = createSajuRouter({ store, env });
  app.use(router);
  const server = app.listen(port, '127.0.0.1', () =>
    console.log('Saju isolated preview ready on port ' + port),
  );
  process.on('SIGTERM', () =>
    server.close(async () => {
      await pool.end();
      process.exit();
    }),
  );
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
