const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { newDb, DataType } = require('pg-mem');
const { migrate, createDealStore } = require('../src/deal-store');
const { buildTossWebSnapshot, applyTossWebSnapshot, readSentTossPublications, syncTossWeb, safeTossImage,
  MAX_NEW_LINKS_PER_SYNC, LINK_REQUEST_INTERVAL_MS } = require('../src/toss-web-sync');
const SCHEMA = `CREATE TABLE kakao_auto_publications (deal_id TEXT PRIMARY KEY, source TEXT, title TEXT, price_text TEXT, price_amount INTEGER, original_url TEXT, first_seen_at TEXT, generated_message TEXT, message_hash TEXT, status TEXT, confirmation_proof TEXT, confirmed_at TEXT)`;
const { TOSS_SHARELINK_DISCLOSURE } = require('../src/kakao-message');
const now = new Date();
function product(overrides = {}) {
  return { rank: 1, tacaItemId: 10001, displayName: '올리브오일 1L',
    thumbnailUrl: 'https://static.toss.im/image.jpg', productUrl: 'https://toss.shopping/product/10001',
    displayPrice: 12900, originalPrice: 15900, discountRate: 18, isSoldOut: false,
    reviewScore: 4.8, reviewCount: 321, ...overrides };
}
function publication(overrides = {}) {
  const original_url = 'https://toss.im/_m/ExistingLink';
  const generated_message = `${TOSS_SHARELINK_DISCLOSURE}\n상품\n${original_url}`;
  return { deal_id: 'toss:10001', source: 'toss', original_url, confirmed_at: now.toISOString(),
    confirmation_proof: 'exact-ui-match', generated_message,
    message_hash: createHash('sha256').update(generated_message).digest('hex'), ...overrides };
}
const ranking = (items) => ({ items, hasNext: false, nextCursor: null });
const snapshot = (products = [product()], publications = [publication()]) => buildTossWebSnapshot({ publications, ranking: ranking(products), now });
async function database(t) {
  const mem = newDb();
  mem.public.registerFunction({ name: 'strpos', args: [DataType.text, DataType.text], returns: DataType.integer,
    implementation: (text, term) => text.indexOf(term) + 1 });
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool(); await migrate(pool); t.after(() => pool.end());
  return { pool, store: createDealStore(pool) };
}

test('only confirmed products in current ranking use the existing monetized link and latest price', () => {
  const result = snapshot([product(), product({ rank: 2, tacaItemId: 10002 })]);
  assert.equal(result.deals.length, 1);
  assert.equal(result.deals[0].originalUrl, publication().original_url);
  assert.equal(result.deals[0].priceAmount, 12900);
  assert.equal(result.deals[0].sourceItemId, '10001');
  assert.equal(result.deals[0].publishedAt, now.toISOString());
  assert.equal(snapshot([product({ isSoldOut: true })]).deals.length, 0);
  assert.equal(snapshot([product({ tacaItemId: 10002 })]).deals.length, 0);
});

test('bad upstream snapshots or unverified links never produce a writeable batch', () => {
  for (const items of [[], [product({ displayPrice: null })], [product(), product({ rank: 2 })], [product({ displayName: 'hello\nhttps://evil.test' })]]) {
    assert.throws(() => snapshot(items));
  }
  for (const changes of [{ message_hash: '0'.repeat(64) }, { confirmation_proof: null },
    { original_url: 'https://evil.test/_m/link' }, { confirmed_at: 'bad' }, { deal_id: 'toss:0' }]) {
    assert.throws(() => snapshot([product()], [publication(changes)]));
  }
  assert.throws(() => buildTossWebSnapshot({ publications: [], ranking: { ...ranking([product()]), hasNext: true }, now }));
});

test('only exact known HTTPS image origin is allowed; untrusted images use a placeholder', () => {
  assert.equal(safeTossImage('https://static.toss.im/image.jpg'), 'https://static.toss.im/image.jpg');
  for (const url of ['http://static.toss.im/i', 'https://static.toss.im.evil.test/i', 'https://user@static.toss.im/i', 'https://127.0.0.1/i']) {
    assert.equal(safeTossImage(url), null);
  }
  assert.equal(snapshot([product({ thumbnailUrl: 'https://unknown.test/image.jpg' })]).deals[0].imageUrl, null);
});

test('SQLite reader excludes sending, failed, uncertain and non-Toss rows without changing DB', () => {
  const db = new DatabaseSync(':memory:'); db.exec(SCHEMA);
  const row = publication();
  for (const [i, status] of ['sent', 'sending', 'uncertain', 'failed', 'linking'].entries()) {
    db.prepare(`INSERT INTO kakao_auto_publications (deal_id, source, title, price_text, price_amount,
      original_url, first_seen_at, generated_message, message_hash, status, confirmation_proof, confirmed_at)
      VALUES (?, 'toss', 'test', '100원', 100, ?, ?, ?, ?, ?, ?, ?)`).run(`toss:${10001 + i}`,
      row.original_url, now.toISOString(), row.generated_message, row.message_hash, status, row.confirmation_proof, row.confirmed_at);
  }
  const before = db.prepare('SELECT * FROM kakao_auto_publications').all();
  db.exec('PRAGMA query_only = ON');
  assert.deepEqual(readSentTossPublications(db).map((r) => r.deal_id), ['toss:10001']);
  assert.deepEqual(db.prepare('SELECT * FROM kakao_auto_publications').all(), before);
  db.close();
});

test('sync is idempotent, refreshes price/image, expires missing products, preserves other sources', async (t) => {
  const { pool, store } = await database(t);
  await store.upsert({ source: 'ppomppu', sourceItemId: '10001', title: '커뮤니티', originalUrl: 'https://example.com' });
  await applyTossWebSnapshot(pool, snapshot());
  await applyTossWebSnapshot(pool, snapshot([product({ displayPrice: 9900, thumbnailUrl: 'https://static.toss.im/new.jpg' })]));
  let result = await store.list({ source: 'toss' });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].priceAmount, 9900);
  assert.equal(result.items[0].imageUrl, 'https://static.toss.im/new.jpg');
  assert.equal(result.items[0].originalUrl, publication().original_url);
  assert.equal(result.items[0].description, TOSS_SHARELINK_DISCLOSURE);
  await applyTossWebSnapshot(pool, snapshot([product({ isSoldOut: true })]));
  assert.equal((await store.list({ source: 'toss' })).total, 0);
  assert.equal((await store.list({ source: 'ppomppu' })).total, 1);
  await applyTossWebSnapshot(pool, snapshot());
  assert.equal((await store.list({ source: 'toss' })).total, 1);
  assert.equal((await pool.query("SELECT * FROM deals WHERE source = 'toss'")).rowCount, 1);
});

test('stale Toss prices are hidden after 26 hours without hiding community posts', async (t) => {
  const { pool, store } = await database(t);
  await applyTossWebSnapshot(pool, snapshot());
  await store.upsert({ source: 'ppomppu', sourceItemId: 'old', title: '커뮤니티', originalUrl: 'https://example.com' });
  await pool.query('UPDATE deals SET last_seen_at = $1', [new Date(now.getTime() - 1561 * 60000).toISOString()]);
  assert.equal((await store.list({ source: 'toss' })).total, 0);
  assert.equal((await store.list({ source: 'ppomppu' })).total, 1);
});

test('dry run never requests a new link or touches PostgreSQL', async () => {
  const db = { prepare: () => ({ all: () => [publication()] }) };
  const result = await syncTossWeb({ db, pool: new Proxy({}, { get() { throw new Error('must not touch DB'); } }),
    tossClient: { fetchBestSelling: async () => ranking([product()]), createLink() { throw new Error('must not issue link'); } }, now: () => now });
  assert.equal(result.status, 'preview'); assert.equal(result.active, 1);
});

test('failed transaction rolls back and releases connection', async () => {
  const calls = [];
  const pool = { connect: async () => ({ async query(sql) { calls.push(sql); if (sql.includes('INSERT INTO deals')) throw new Error('write failed'); }, release() { calls.push('release'); } }) };
  await assert.rejects(applyTossWebSnapshot(pool, snapshot()), /write failed/);
  assert.equal(calls.at(-2), 'ROLLBACK'); assert.equal(calls.at(-1), 'release');
});

test('popular selection combines quality with Toss rank or observed web clicks', () => {
 const {isPopularProduct}=require('../src/toss-web-sync');
 assert.equal(isPopularProduct(product()),true);
 assert.equal(isPopularProduct(product({reviewCount:99})),false);
 assert.equal(isPopularProduct(product({reviewScore:4.4})),false);
 assert.equal(isPopularProduct(product({rank:50}),2),false);
 assert.equal(isPopularProduct(product({rank:50}),3),true);
 assert.equal(isPopularProduct(product({rank:50,reviewScore:4.1}),100),false);
});

test('web links prefer the current top 50 and use lower ranks only to fill empty slots', () => {
 const link={source_item_id:'10002',status:'ready',short_url:'https://toss.im/_m/WebLink',created_at:now.toISOString()};
 const build=(p,clickCounts={})=>buildTossWebSnapshot({publications:[],ranking:ranking([p]),webLinks:[link],clickCounts,now});
 assert.equal(build(product({tacaItemId:10002})).deals[0].originalUrl,link.short_url);
 assert.equal(build(product({tacaItemId:10002,rank:50})).deals.length,1);
 assert.equal(build(product({tacaItemId:10002,rank:51}),{'10002':100}).deals.length,1);
 assert.equal(build(product({tacaItemId:10002,isSoldOut:true})).deals.length,0);
 assert.equal(snapshot([product({reviewScore:4.1})]).deals.length,1);
 const products=Array.from({length:51},(_,index)=>product({rank:index+1,tacaItemId:30000+index}));
 const links=products.map((item)=>({source_item_id:String(item.tacaItemId),status:'ready',short_url:`https://toss.im/_m/link${item.tacaItemId}`,created_at:now.toISOString()}));
 const full=buildTossWebSnapshot({publications:[],ranking:ranking(products),webLinks:links,now});
 assert.equal(full.deals.length,50);
 assert.equal(full.deals.some((deal)=>deal.sourceItemId==='30050'),false);
});

test('link reservation survives timeout without duplicate issuance on next run',async(t)=>{
 const {pool}=await database(t);
 // pg-mem does not implement advisory locks. Supply the same successful lease result.
 const query=pool.query.bind(pool),connect=pool.connect.bind(pool);
 pool.connect=async()=>{const c=await connect();const q=c.query.bind(c);c.query=(sql,args)=>/pg_try_advisory_lock/.test(sql)?Promise.resolve({rows:[{acquired:true}]}):/pg_advisory_unlock/.test(sql)?Promise.resolve({rows:[{unlocked:true}]}):q(sql,args);return c;};
 const db={prepare:()=>({all:()=>[]})};let issued=0;
 const api={fetchBestSelling:async()=>ranking([product()]),createLink:async()=>{issued++;throw new Error('timeout');}};
 const first=await syncTossWeb({pool,db,tossClient:api,dryRun:false,now:()=>now});
 assert.equal(first.uncertainLinks,1);assert.equal(issued,1);
 await syncTossWeb({pool,db,tossClient:api,dryRun:false,now:()=>now});assert.equal(issued,1);
 assert.equal((await query('SELECT * FROM toss_web_links')).rows[0].status,'uncertain');
});

test('new popular product gets one link, uses fresh price, and reuses link on repeated sync',async(t)=>{
 const {pool}=await database(t);
 const connect=pool.connect.bind(pool);
 pool.connect=async()=>{const c=await connect();const q=c.query.bind(c);c.query=(sql,args)=>/pg_try_advisory_lock/.test(sql)?Promise.resolve({rows:[{acquired:true}]}):/pg_advisory_unlock/.test(sql)?Promise.resolve({rows:[{unlocked:true}]}):q(sql,args);return c;};
 const db={prepare:()=>({all:()=>[]})};let issued=0,reads=0;
 const api={fetchBestSelling:async()=>{reads++;return ranking([product({displayPrice:reads===1?12900:9900})]);},createLink:async()=>{issued++;return {shortUrl:'https://toss.im/_m/newLink'};}};
 const first=await syncTossWeb({pool,db,tossClient:api,dryRun:false,now:()=>new Date()});
 assert.equal(first.linksIssued,1);assert.equal(first.upserted,1);
 await syncTossWeb({pool,db,tossClient:api,dryRun:false,now:()=>new Date()});
 assert.equal(issued,1);
 const rows=(await pool.query("SELECT * FROM deals WHERE source='toss'")).rows;
 assert.equal(rows.length,1);assert.equal(Number(rows[0].price_amount),9900);
});

test('link requests are paced and failed attempts remain inside the daily request budget',async(t)=>{
 const {pool}=await database(t);
 const connect=pool.connect.bind(pool);
 pool.connect=async()=>{const c=await connect();const q=c.query.bind(c);c.query=(sql,args)=>/pg_try_advisory_lock/.test(sql)?Promise.resolve({rows:[{acquired:true}]}):/pg_advisory_unlock/.test(sql)?Promise.resolve({rows:[{unlocked:true}]}):q(sql,args);return c;};
 const db={prepare:()=>({all:()=>[]})};let attempts=0;const delays=[];
 const items=Array.from({length:50},(_,index)=>product({rank:index+1,tacaItemId:20000+index}));
 const api={fetchBestSelling:async()=>ranking(items),createLink:async()=>{attempts++;throw new Error('unknown outcome');}};
 const result=await syncTossWeb({pool,db,tossClient:api,dryRun:false,now:()=>now,sleep:async(ms)=>delays.push(ms)});
 assert.equal(attempts,MAX_NEW_LINKS_PER_SYNC);
 assert.equal(result.linkAttempts,MAX_NEW_LINKS_PER_SYNC);
 assert.equal(result.uncertainLinks,MAX_NEW_LINKS_PER_SYNC);
 assert.equal(delays.length,MAX_NEW_LINKS_PER_SYNC-1);
 assert.equal(delays.every((ms)=>ms===LINK_REQUEST_INTERVAL_MS),true);
});
