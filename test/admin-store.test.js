const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');
const { migrate } = require('../src/deal-store');
const { createAdminStore, SITE_SETTING_DEFINITIONS } = require('../src/admin/admin-store');

async function setup() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  return { pool, store: createAdminStore(pool) };
}

const deal = {
  title: '갤럭시 S26 번호이동 특가',
  productUrl: 'https://shop.example.com/phones/s26',
  imageUrl: 'https://cdn.example.com/s26.jpg',
  merchant: '안심폰',
  priceAmount: 120000,
  originalPriceAmount: 999000,
  description: '5G 요금제 조건',
  badge: '휴대폰 특가',
  isPublished: true,
  showOnHome: true,
  priority: 20,
};

test('migration is idempotent and creates all admin tables', async () => {
  const { pool } = await setup();
  await migrate(pool);
  for (const table of ['admin_users', 'admin_sessions', 'manual_deals', 'site_settings']) {
    const result = await pool.query(`SELECT * FROM ${table} LIMIT 1`);
    assert.equal(result.rowCount, 0);
  }
  await pool.end();
});

test('bootstrap normalizes username and stores only a bcrypt hash', async () => {
  const { pool, store } = await setup();
  const hash = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxSpFq01.1Q5hDqKX9QG7.m8wyW';
  const user = await store.bootstrapAdmin('  Owner  ', hash);
  assert.equal(user.username, 'owner');
  const raw = await pool.query('SELECT username, password_hash FROM admin_users');
  assert.deepEqual(raw.rows, [{ username: 'owner', password_hash: hash }]);
  await assert.rejects(() => store.bootstrapAdmin('owner', 'plaintext'), /bcrypt/i);
  await pool.end();
});

test('opaque sessions persist only SHA-256 token and CSRF hashes and expire', async () => {
  const { pool, store } = await setup();
  const hash = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxSpFq01.1Q5hDqKX9QG7.m8wyW';
  const user = await store.bootstrapAdmin('owner', hash);
  await store.createSession({ userId: user.id, tokenHash: 'a'.repeat(64), csrfHash: 'b'.repeat(64), expiresAt: '2026-09-11T00:00:00Z' });
  assert.equal((await store.getSession('a'.repeat(64), new Date('2026-09-10T00:00:00Z'))).username, 'owner');
  assert.equal(await store.getSession('a'.repeat(64), new Date('2026-09-12T00:00:00Z')), null);
  const raw = await pool.query('SELECT token_hash, csrf_hash FROM admin_sessions');
  assert.deepEqual(raw.rows[0], { token_hash: 'a'.repeat(64), csrf_hash: 'b'.repeat(64) });
  await pool.end();
});

test('manual deal CRUD synchronizes only its linked source=manual projection', async () => {
  const { pool, store } = await setup();
  await pool.query("INSERT INTO deals(source, source_item_id, title, original_url) VALUES ('ppomppu','rss-1','RSS 상품','https://www.ppomppu.co.kr/1')");
  const created = await store.createManualDeal(deal);
  let projections = await pool.query("SELECT source,title,is_ended,category FROM deals ORDER BY source");
  assert.equal(projections.rows.length, 2);
  assert.deepEqual(projections.rows[0], { source: 'manual', title: deal.title, is_ended: false, category: '디지털/가전' });
  assert.equal(created.dealId, String(created.dealId));

  const updated = await store.updateManualDeal(created.id, { ...deal, title: '수정된 휴대폰', isPublished: false });
  assert.equal(updated.title, '수정된 휴대폰');
  projections = await pool.query('SELECT source,title,is_ended FROM deals WHERE id = $1', [created.dealId]);
  assert.deepEqual(projections.rows[0], { source: 'manual', title: '수정된 휴대폰', is_ended: true });

  assert.equal(await store.deleteManualDeal(created.id), true);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM deals WHERE source='manual'")).rows[0].count, 0);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM deals WHERE source='ppomppu'")).rows[0].count, 1);
  await pool.end();
});

test('public deal listing includes published manual metadata and excludes drafts', async () => {
  const { pool, store } = await setup();
  await store.createManualDeal(deal);
  await store.createManualDeal({ ...deal, title: '숨김 상품', productUrl: 'https://shop.example.com/hidden', isPublished: false });
  const result = await store.listPublicManualDeals({ homeOnly: true, limit: 10 });
  assert.equal(result.length, 1);
  assert.equal(result[0].source, 'manual');
  assert.equal(result[0].badge, '휴대폰 특가');
  assert.equal(result[0].originalPriceAmount, 999000);
  assert.equal(result[0].showOnHome, true);
  assert.deepEqual(await store.getPublishedManualImage(result[0].manualId), { imageUrl: deal.imageUrl });
  assert.equal(await store.getPublishedManualImage('999999'), null);
  await pool.end();
});

test('site settings enforce an allowlist and expose only public definitions', async () => {
  const { pool, store } = await setup();
  assert.ok(SITE_SETTING_DEFINITIONS.home_manual_limit.public);
  await store.setSetting('home_manual_limit', 6);
  await assert.rejects(() => store.setSetting('database_url', 'secret'), /not allowed/i);
  assert.deepEqual(await store.getPublicSettings(), { home_manual_limit: 6 });
  await pool.end();
});
