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
  const env = { ...process.env, SAJU_PUBLIC_ORIGIN: `http://localhost:${port}` };
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
