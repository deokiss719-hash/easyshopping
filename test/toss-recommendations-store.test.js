'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { newDb } = require('pg-mem');

const { migrate, createDealStore } = require('../src/deal-store');

const recommendation = Object.freeze({
  productId: '101',
  source: 'integrated-best',
  title: '공식 추천 상품',
  priceAmount: 12900,
  sharelinkUrl: 'https://toss.im/_m/official101',
  rank: 1,
  endAt: null,
});

async function makeStore() {
  const memoryDb = newDb();
  const { Pool } = memoryDb.adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  return { pool, store: createDealStore(pool) };
}

test('schema creates a dedicated constrained Toss recommendation table without sensitive or media columns', async () => {
  const { pool } = await makeStore();
  const columns = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'toss_recommendations'
    ORDER BY ordinal_position
  `);
  assert.deepEqual(columns.rows.map((row) => row.column_name), [
    'product_id', 'source_kind', 'title', 'price_amount', 'sharelink_url', 'source_rank',
    'end_at', 'first_seen_at', 'last_seen_at', 'is_active',
  ]);
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const tossTable = schema.match(/CREATE TABLE IF NOT EXISTS toss_recommendations[\s\S]*?\);/i)?.[0] || '';
  assert.doesNotMatch(tossTable, /raw|product_url|original_url|image|token|secret/i);
  assert.match(schema, /toss_recommendations_active_rank_idx/i);
  await assert.rejects(
    () => pool.query(`INSERT INTO toss_recommendations
      (product_id, source_kind, title, price_amount, sharelink_url, source_rank)
      VALUES ('bad-price', 'integrated-best', 'bad', -1, 'https://toss.im/_m/x', 1)`),
  );
  await pool.end();
});

test('Toss snapshot is validated, capped at ten, upserted transactionally, and missing products become inactive', async () => {
  const { pool, store } = await makeStore();
  const today = {
    ...recommendation,
    productId: '202',
    source: 'today-special',
    title: '오늘만 특가',
    rank: 2,
    endAt: '2099-09-12T12:00:00.000Z',
  };
  assert.deepEqual(await store.syncTossSharelinkSnapshot([recommendation, today]), { upserted: 2, ended: 0 });
  assert.deepEqual(await store.syncTossSharelinkSnapshot([{ ...today, title: '수정된 오늘 특가', rank: 1 }]), { upserted: 1, ended: 1 });

  const rows = await pool.query('SELECT product_id, title, is_active FROM toss_recommendations ORDER BY product_id');
  assert.deepEqual(rows.rows, [
    { product_id: '101', title: '공식 추천 상품', is_active: false },
    { product_id: '202', title: '수정된 오늘 특가', is_active: true },
  ]);
  await assert.rejects(
    () => store.syncTossSharelinkSnapshot(Array.from({ length: 11 }, (_, index) => ({
      ...recommendation, productId: String(index + 1), rank: index + 1,
    }))),
    /at most 10/i,
  );
  await assert.rejects(
    () => store.syncTossSharelinkSnapshot([{ ...recommendation, sharelinkUrl: 'https://shop.example/product/101' }]),
    /sharelink/i,
  );
  await pool.end();
});

test('Toss snapshot normalization enforces collector-parity bounds and strict timezone timestamps', async () => {
  const { pool, store } = await makeStore();
  const invalidChanges = [
    { productId: 0 },
    { productId: Number.MAX_SAFE_INTEGER + 1 },
    { productId: '01' },
    { source: 'other' },
    { title: '' },
    { title: 'x'.repeat(501) },
    { priceAmount: -1 },
    { priceAmount: undefined },
    { priceAmount: 1.5 },
    { rank: 0 },
    { rank: 11 },
    { sharelinkUrl: 'javascript:alert(1)' },
    { sharelinkUrl: 'http://toss.im/_m/x' },
    { sharelinkUrl: 'https://wrong.example/_m/x' },
    { sharelinkUrl: 'https://user:pass@toss.im/_m/x' },
    { sharelinkUrl: 'https://toss.im:444/_m/x' },
    { sharelinkUrl: 'https://toss.im/wrong/x' },
    { endAt: '2099-09-12T12:00:00' },
    { endAt: undefined },
    { endAt: '2099-02-30T12:00:00Z' },
  ];
  for (const change of invalidChanges) {
    await assert.rejects(
      () => store.syncTossSharelinkSnapshot([{ ...recommendation, ...change }]),
      /Toss|sharelink/i,
    );
  }
  await assert.doesNotReject(() => store.syncTossSharelinkSnapshot([{
    ...recommendation,
    endAt: '2099-09-12T21:00:00+09:00',
  }]));
  await pool.end();
});

test('database checks enforce practical Toss recommendation constraints', async () => {
  const { pool } = await makeStore();
  const base = ['101', 'integrated-best', 'valid', 1000, 'https://toss.im/_m/x', 1];
  const invalidRows = [
    ['', ...base.slice(1)],
    ['1'.repeat(32), ...base.slice(1)],
    [base[0], 'other', ...base.slice(2)],
    [base[0], base[1], '', ...base.slice(3)],
    [base[0], base[1], 'x'.repeat(501), ...base.slice(3)],
    [base[0], base[1], base[2], -1, ...base.slice(4)],
    [base[0], base[1], base[2], base[3], 'http://toss.im/_m/x', base[5]],
    [base[0], base[1], base[2], base[3], base[4], 0],
    [base[0], base[1], base[2], base[3], base[4], 11],
  ];
  for (const values of invalidRows) {
    await assert.rejects(() => pool.query(`INSERT INTO toss_recommendations
      (product_id, source_kind, title, price_amount, sharelink_url, source_rank)
      VALUES ($1, $2, $3, $4, $5, $6)`, values));
  }
  await pool.end();
});

test('dedicated Toss listing excludes inactive and expired rows, is deterministic, and never enters ordinary deals', async () => {
  const { pool, store } = await makeStore();
  await store.syncTossSharelinkSnapshot([
    { ...recommendation, productId: '303', source: 'today-special', rank: 1, endAt: '2026-09-12T10:00:00.000Z' },
    { ...recommendation, productId: '202', source: 'today-special', rank: 2, endAt: '2026-09-12T12:00:00.000Z' },
    { ...recommendation, productId: '101', source: 'integrated-best', rank: 1 },
  ]);
  const listed = await store.listTossRecommendations({ now: '2026-09-12T11:00:00.000Z' });
  assert.deepEqual(listed.map((item) => item.productId), ['101', '202']);
  assert.equal(listed[0].priceAmount, 12900);
  assert.equal(listed[1].endAt.toISOString(), '2026-09-12T12:00:00.000Z');
  assert.ok(listed.every((item) => Object.hasOwn(item, 'lastSeenAt')));
  const ordinary = await store.list();
  assert.equal(ordinary.total, 0);
  await pool.end();
});

test('Toss collection lease uses a distinct fixed advisory lock and always unlocks its dedicated connection', async () => {
  const events = [];
  const sqls = [];
  const client = {
    async query(sql) {
      sqls.push(sql);
      if (/pg_try_advisory_lock/.test(sql)) { events.push('lock'); return { rows: [{ acquired: true }] }; }
      if (/pg_advisory_unlock/.test(sql)) { events.push('unlock'); return { rows: [{ unlocked: true }] }; }
      throw new Error(`unexpected query: ${sql}`);
    },
    release() { events.push('release'); },
  };
  const store = createDealStore({ connect: async () => client });
  const value = await store.withTossSharelinkCollectionLease(async () => { events.push('worker'); return 'done'; });
  assert.equal(value, 'done');
  assert.deepEqual(events, ['lock', 'worker', 'unlock', 'release']);
  assert.notEqual(sqls[0].match(/\(([-\d]+),\s*([-\d]+)\)/)?.[0], '(1129270864, 1347374160)');
});

test('Toss collection lease contention does not run the worker', async () => {
  let worked = false;
  let released = false;
  const store = createDealStore({
    connect: async () => ({
      query: async () => ({ rows: [{ acquired: false }] }),
      release() { released = true; },
    }),
  });
  assert.equal(await store.withTossSharelinkCollectionLease(async () => { worked = true; }), null);
  assert.equal(worked, false);
  assert.equal(released, true);
});
