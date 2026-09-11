const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');
const { migrate } = require('../src/deal-store');
const { createTrafficAnalyticsStore } = require('../src/traffic-analytics-store');

async function setup() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  return { pool, store: createTrafficAnalyticsStore(pool) };
}

test('traffic migration is idempotent and creates aggregate tables', async () => {
  const { pool } = await setup();
  await migrate(pool);
  for (const table of ['traffic_daily', 'traffic_daily_visitors', 'traffic_daily_referrers']) {
    assert.equal((await pool.query(`SELECT * FROM ${table} LIMIT 1`)).rowCount, 0);
  }
  await pool.end();
});

test('traffic store counts page views, daily browsers, and first-touch sources', async () => {
  const { pool, store } = await setup();
  const day = '2026-09-11';
  await store.recordPageView({ day, visitorHash: 'a'.repeat(64), source: 'search', domain: 'search.naver.com', searchTerm: '갤럭시', referrerUrl: 'https://search.naver.com/search.naver?query=%EA%B0%A4%EB%9F%AD%EC%8B%9C' });
  await store.recordPageView({ day, visitorHash: 'a'.repeat(64), source: 'referral', domain: 'community.example', searchTerm: '', referrerUrl: 'https://community.example/deal' });
  await store.recordPageView({ day, visitorHash: 'b'.repeat(64), source: 'direct', domain: '', searchTerm: '', referrerUrl: '' });

  assert.deepEqual(await store.getDay(day), {
    day,
    timeZone: 'Asia/Seoul',
    uniqueVisitors: 2,
    pageViews: 3,
    referrers: [
      { source: 'direct', domain: null, visitors: 1 },
      { source: 'search', domain: 'search.naver.com', visitors: 1 },
    ],
    referrerDetails: [
      { source: 'search', domain: 'search.naver.com', visitors: 1, searchTerm: '갤럭시', referrerUrl: 'https://search.naver.com/search.naver?query=%EA%B0%A4%EB%9F%AD%EC%8B%9C' },
    ],
    referrerDetailLimit: 100,
  });
  await pool.end();
});

test('traffic detail storage and admin response are bounded, and retention can run without traffic', async () => {
  const { pool } = await setup();
  const store = createTrafficAnalyticsStore(pool, { detailLimit: 1, resultLimit: 1 });
  const day = '2026-09-12';
  await store.recordPageView({ day, visitorHash: 'c'.repeat(64), source: 'search', domain: 'search.naver.com', searchTerm: '아이폰', referrerUrl: 'https://search.naver.com/search.naver?query=%EC%95%84%EC%9D%B4%ED%8F%B0' });
  await store.recordPageView({ day, visitorHash: 'd'.repeat(64), source: 'referral', domain: 'community.example', searchTerm: '', referrerUrl: 'https://community.example/deals/2' });

  const detailRows = await pool.query('SELECT search_term, referrer_url FROM traffic_daily_visitors WHERE day = $1::date ORDER BY visitor_hash', [day]);
  assert.equal(detailRows.rows.filter((row) => row.search_term || row.referrer_url).length, 1);
  const summary = await store.getDay(day);
  assert.equal(summary.referrers.length, 2);
  assert.equal(summary.referrerDetails.length, 1);
  assert.equal(summary.referrerDetailLimit, 1);
  assert.equal(summary.uniqueVisitors, 2);
  assert.equal(summary.pageViews, 2);

  await store.purgeBefore('2026-09-13');
  assert.equal((await pool.query('SELECT COUNT(*) AS count FROM traffic_daily_visitors')).rows[0].count, 0);
  await pool.end();
});

test('traffic store validates bounded aggregate-only inputs', async () => {
  const { pool, store } = await setup();
  const valid = { day: '2026-09-11', visitorHash: 'a'.repeat(64), source: 'direct', domain: '', searchTerm: '', referrerUrl: '' };
  for (const invalid of [
    { ...valid, day: 'September 11' },
    { ...valid, visitorHash: 'raw-ip-address' },
    { ...valid, source: 'anything' },
    { ...valid, domain: 'https://example.com/private?q=secret' },
    { ...valid, domain: `${'a'.repeat(254)}.example` },
    { ...valid, searchTerm: 'x'.repeat(201) },
    { ...valid, referrerUrl: `https://example.com/${'x'.repeat(2048)}` },
  ]) await assert.rejects(() => store.recordPageView(invalid), /invalid/i);
  await assert.rejects(() => store.getDay('today'), /invalid/i);
  await pool.end();
});
