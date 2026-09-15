const { createHash } = require('node:crypto');
const { assertEnvelope, mapProduct } = require('./toss-best-candidate-reader');
const { classifyDeal } = require('./deal-category');
const { createDealStore } = require('./deal-store');
const { TOSS_SHARELINK_DISCLOSURE } = require('./kakao-message');

const TOSS_IMAGE_ORIGINS = new Set(['https://static.toss.im', 'https://shopping.toss.im']);

function safeTossImage(value) {
  try {
    const url = new URL(value);
    return TOSS_IMAGE_ORIGINS.has(url.origin) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// Reads the live SQLite database without initializing, migrating, or modifying it.
function readSentTossPublications(db) {
  return db.prepare(`SELECT deal_id, source, original_url, confirmed_at, confirmation_proof,
    generated_message, message_hash FROM kakao_auto_publications
    WHERE source = 'toss' AND status = 'sent' ORDER BY confirmed_at, deal_id`).all();
}

function validatePublication(row) {
  if (!/^toss:[1-9]\d*$/.test(row.deal_id) || row.source !== 'toss'
      || !row.confirmation_proof || !row.confirmed_at
      || !Number.isFinite(new Date(row.confirmed_at).getTime())
      || typeof row.generated_message !== 'string'
      || createHash('sha256').update(row.generated_message).digest('hex') !== row.message_hash) {
    throw new Error('Invalid confirmed Toss publication');
  }
  let url;
  try { url = new URL(row.original_url); } catch { throw new Error('Invalid confirmed Toss link'); }
  if (url.protocol !== 'https:' || url.hostname !== 'toss.im' || url.port || url.username || url.password
      || !/^\/_m\/[A-Za-z0-9_-]+$/.test(url.pathname) || url.search || url.hash
      || !row.generated_message.split(/\r?\n/).includes(row.original_url)) {
    throw new Error('Invalid confirmed Toss link');
  }
}

function buildTossWebSnapshot({ publications, ranking, now = new Date() }) {
  const at = new Date(now);
  if (!Number.isFinite(at.getTime())) throw new TypeError('Invalid observation time');
  const items = assertEnvelope(ranking);
  // Do not interpret an empty/partial/broken upstream reply as mass product removal.
  if (!items.length || (ranking.hasNext && items.length < 100)) throw new Error('Incomplete Toss ranking');
  const products = new Map();
  for (const item of items) {
    const candidate = mapProduct({ ...item, isSoldOut: false }, at.toISOString());
    if (!candidate || typeof item.isSoldOut !== 'boolean') throw new Error('Invalid Toss ranking product');
    if (!item.isSoldOut) products.set(candidate.id, candidate);
  }
  const deals = [];
  const seen = new Set();
  for (const row of publications) {
    validatePublication(row);
    if (new Date(row.confirmed_at) > at) throw new Error('Future Toss confirmation');
    if (seen.has(row.deal_id)) throw new Error('Duplicate Toss publication');
    seen.add(row.deal_id);
    const product = products.get(row.deal_id);
    if (!product) continue;
    const image = safeTossImage(product.thumbnailUrl);
    deals.push({
      source: 'toss', sourceItemId: String(product.tacaItemId), title: product.title,
      priceText: product.priceText, priceAmount: product.priceAmount,
      merchant: '토스쇼핑', originalUrl: row.original_url,
      // Keep the original, already-issued monetized URL. Never create a new link.
      imageUrl: image, sourceImageUrl: image,
      imageStatus: image ? 'ready' : 'unsupported_provider', imageProvider: 'toss-direct',
      category: classifyDeal({ title: product.title, merchant: '토스쇼핑' }),
      publishedAt: new Date(row.confirmed_at).toISOString(),
      authoritativePrice: true,
    });
  }
  return { deals, observedAt: at.toISOString(), confirmedCount: publications.length };
}

async function applyTossWebSnapshot(pool, snapshot) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const store = createDealStore(client);
    for (const deal of snapshot.deals) {
      await store.upsert(deal);
      // Refresh direct images too, including removal of previously trusted thumbnails.
      await client.query(`UPDATE deals SET image_url = $1, source_image_url = $1,
        image_status = $2, description = $3, last_seen_at = $4
        WHERE source = 'toss' AND source_item_id = $5`,
      [deal.imageUrl, deal.imageStatus, TOSS_SHARELINK_DISCLOSURE, snapshot.observedAt, deal.sourceItemId]);
    }
    const ids = snapshot.deals.map((deal) => deal.sourceItemId);
    const exclusion = ids.length ? ` AND source_item_id NOT IN (${ids.map((_, i) => `$${i + 2}`).join(', ')})` : '';
    const ended = await client.query(`UPDATE deals SET is_ended = TRUE, ended_at = $1
      WHERE source = 'toss' AND is_ended = FALSE${exclusion}`, [snapshot.observedAt, ...ids]);
    await client.query('COMMIT');
    return { status: 'synced', upserted: ids.length, ended: ended.rowCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function syncTossWeb({ pool, db, tossClient, dryRun = true, now = () => new Date() }) {
  const run = async () => {
    const ranking = await tossClient.fetchBestSelling({ size: 100 });
    const snapshot = buildTossWebSnapshot({ publications: readSentTossPublications(db), ranking, now: now() });
    if (dryRun) return { status: 'preview', confirmed: snapshot.confirmedCount,
      active: snapshot.deals.length, imageOrigins: [...new Set(ranking.items.map((item) => new URL(item.thumbnailUrl).origin))], deals: snapshot.deals };
    return applyTossWebSnapshot(pool, snapshot);
  };
  if (dryRun) return run();
  // Shared DB lease covers the upstream read as well as commit, preventing stale overwrite.
  const result = await createDealStore(pool).withCollectionLease('toss', run);
  return result || { status: 'skipped', reason: 'already_running' };
}

module.exports = { safeTossImage, readSentTossPublications, buildTossWebSnapshot, applyTossWebSnapshot, syncTossWeb };
