const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb, DataType } = require('pg-mem');
const { migrate } = require('../src/deal-store');
const { createAdminOperationsStore } = require('../src/admin/admin-operations-store');

async function setup() {
  const db = newDb();
  db.public.registerFunction({ name: 'strpos', args: [DataType.text, DataType.text], returns: DataType.integer, implementation: (text, search) => text.indexOf(search) + 1 });
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  return { pool, store: createAdminOperationsStore(pool) };
}

test('operations product query filters by source/search/status and paginates safely', async () => {
  const { pool, store } = await setup();
  await pool.query(`INSERT INTO deals(source,source_item_id,title,original_url,image_url,is_ended)
    VALUES ('ppomppu','p1','노출 상품','https://example.com/p1','https://cdn.example.com/p1.jpg',FALSE),
           ('toss','t1','토스 이미지 없음','https://toss.im/_m/t1',NULL,FALSE),
           ('fmkorea','f1','종료 상품','https://example.com/f1',NULL,TRUE)`);
  const hidden = await pool.query("SELECT id FROM deals WHERE source='ppomppu'");
  await store.moderate(hidden.rows[0].id, { action: 'hide' });

  const hiddenResult = await store.listProducts({ source: 'ppomppu', status: 'hidden', q: '노출', page: '1' });
  assert.equal(hiddenResult.total, 1);
  assert.equal(hiddenResult.products[0].is_hidden, true);
  assert.equal((await store.listProducts({ status: 'ended' })).total, 1);
  assert.equal((await store.listProducts({ status: 'missing-image' })).total, 2);
  await assert.rejects(() => store.listProducts({ source: 'invalid' }), /조회 조건/);
  await pool.end();
});

test('operations status excludes admin-hidden/admin-ended deals from visible active and missing-image counts', async () => {
  const { pool, store } = await setup();
  const rows = await pool.query(`INSERT INTO deals(source,source_item_id,title,original_url,image_url,is_ended)
    VALUES ('ppomppu','p1','정상','https://example.com/p1','https://cdn.example.com/p1.jpg',FALSE),
           ('ppomppu','p2','숨김','https://example.com/p2',NULL,FALSE),
           ('ppomppu','p3','관리자 종료','https://example.com/p3',NULL,FALSE) RETURNING id,source_item_id`);
  await store.moderate(rows.rows.find((row) => row.source_item_id === 'p2').id, { action: 'hide' });
  await store.moderate(rows.rows.find((row) => row.source_item_id === 'p3').id, { action: 'end' });
  await pool.query("INSERT INTO automation_status(name,payload) VALUES ('image-backfill','{\"status\":\"ok\",\"processed\":3}'::jsonb)");

  const status = await store.getStatus();
  const ppomppu = status.sources.find((row) => row.source === 'ppomppu');
  assert.equal(Number(ppomppu.active_count), 1);
  assert.equal(Number(ppomppu.missing_images), 0);
  assert.equal(status.snapshots[0].name, 'image-backfill');
  await pool.end();
});
