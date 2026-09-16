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

const POPULAR_POLICY = Object.freeze({ maxRank: 30, minScore: 4.5, minReviews: 100, minClicks24h: 3 });
const WEB_PRODUCT_LIMIT = 50;
const MAX_NEW_LINKS_PER_SYNC = 48;
function isPopularProduct(product, clicks = 0) {
  return product.reviewScore >= POPULAR_POLICY.minScore && product.reviewCount >= POPULAR_POLICY.minReviews
    && (product.rank <= POPULAR_POLICY.maxRank || clicks >= POPULAR_POLICY.minClicks24h);
}
function isWebProduct(product) {
  return Number.isInteger(product.rank) && product.rank >= 1 && product.rank <= WEB_PRODUCT_LIMIT;
}
function validShortUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'toss.im' && !u.port && !u.username && !u.password
      && /^\/_m\/[A-Za-z0-9_-]+$/.test(u.pathname) && !u.search && !u.hash;
  } catch { return false; }
}
function buildTossWebSnapshot({ publications, ranking, webLinks = [], clickCounts = {}, now = new Date() }) {
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
  const deals = new Map();
  const popular = [...products.values()].filter(isWebProduct);
  function add(product, url, publishedAt) {
    const image = safeTossImage(product.thumbnailUrl);
    deals.set(product.id, {
      source: 'toss', sourceItemId: String(product.tacaItemId), title: product.title,
      priceText: product.priceText, priceAmount: product.priceAmount,
      merchant: '토스쇼핑', originalUrl: url,
      imageUrl: image, sourceImageUrl: image,
      imageStatus: image ? 'ready' : 'unsupported_provider', imageProvider: 'toss-direct',
      category: classifyDeal({ title: product.title, merchant: '토스쇼핑' }),
      publishedAt: new Date(publishedAt).toISOString(), authoritativePrice: true,
      tossRank: product.rank, reviewScore: product.reviewScore, reviewCount: product.reviewCount,
      isPopular: isPopularProduct(product, clickCounts[product.tacaItemId] || 0),
    });
  }
  const seen = new Set();
  for (const row of publications) {
    validatePublication(row);
    if (new Date(row.confirmed_at) > at) throw new Error('Future Toss confirmation');
    if (seen.has(row.deal_id)) throw new Error('Duplicate Toss publication');
    seen.add(row.deal_id);
    const product = products.get(row.deal_id);
    if (product && isWebProduct(product)) add(product, row.original_url, row.confirmed_at);
  }
  for (const link of webLinks) {
    if (link.status !== 'ready') continue;
    if (!validShortUrl(link.short_url) || !link.created_at || !Number.isFinite(new Date(link.created_at).getTime())) throw new Error('Invalid cached Toss link');
    const product = products.get(`toss:${link.source_item_id}`);
    if (!product) continue;
    // Keep the web URL stable even if Kakao subsequently publishes this same product.
    if (deals.has(product.id) || isWebProduct(product)) add(product, link.short_url, link.created_at);
  }
  return { deals: [...deals.values()], popularCandidates: popular, observedAt: at.toISOString(), confirmedCount: publications.length };
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
        image_status = $2, description = $3, last_seen_at = $4,
        toss_rank = $6, review_score = $7, review_count = $8, is_popular = $9
        WHERE source = 'toss' AND source_item_id = $5`,
      [deal.imageUrl, deal.imageStatus, TOSS_SHARELINK_DISCLOSURE, snapshot.observedAt, deal.sourceItemId, deal.tossRank ?? null, deal.reviewScore ?? null, deal.reviewCount ?? null, deal.isPopular === true]);
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

async function readTossWebSignals(pool, now) {
  const links = (await pool.query('SELECT * FROM toss_web_links')).rows;
  const clicks = (await pool.query(`SELECT d.source_item_id, COUNT(*) AS clicks
    FROM deal_clicks c JOIN deals d ON d.id = c.deal_id
    WHERE d.source = 'toss' AND c.clicked_at >= $1 GROUP BY d.source_item_id`,
  [new Date(now.getTime() - 24*3600000).toISOString()])).rows;
  return { links, clickCounts: Object.fromEntries(clicks.map((r) => [r.source_item_id, Number(r.clicks)])) };
}

async function syncTossWeb({ pool, db, tossClient, dryRun = true, now = () => new Date() }) {
  const run = async () => {
    const ranking = await tossClient.fetchBestSelling({ size: 100 });
    const at = now();
    const publications = readSentTossPublications(db);
    const { links, clickCounts } = dryRun ? { links: [], clickCounts: {} } : await readTossWebSignals(pool, at);
    let snapshot = buildTossWebSnapshot({ publications, ranking, webLinks: links, clickCounts, now: at });
    if (dryRun) return { status: 'preview', confirmed: snapshot.confirmedCount,
      active: snapshot.deals.length, popularEligible: snapshot.popularCandidates.length,
      popularityPolicy: POPULAR_POLICY, clicksAvailable: false,
      imageOrigins: [...new Set(ranking.items.map((item) => new URL(item.thumbnailUrl).origin))], deals: snapshot.deals };
    const existing = new Set(snapshot.deals.map((d) => d.sourceItemId));
    const kakaoIds = new Set(db.prepare("SELECT deal_id FROM kakao_auto_publications WHERE source = 'toss'").all().map((r) => r.deal_id));
    const reserved = new Set(links.map((r) => r.source_item_id));
    let issued = 0, uncertain = 0;
    for (const product of snapshot.popularCandidates) {
      if (issued >= MAX_NEW_LINKS_PER_SYNC) break;
      const id = String(product.tacaItemId);
      if (existing.has(id) || reserved.has(id) || kakaoIds.has(product.id)) continue;
      // Persist the reservation BEFORE the external API call. Unknown outcomes never auto-retry.
      const claim = await pool.query(`INSERT INTO toss_web_links (source_item_id, status)
        VALUES ($1, 'pending') ON CONFLICT (source_item_id) DO NOTHING RETURNING source_item_id`, [id]);
      if (!claim.rowCount) continue;
      try {
        const link = await tossClient.createLink({ tacaItemId: product.tacaItemId });
        if (!validShortUrl(link.shortUrl)) throw new Error('Invalid short URL');
        const saved = await pool.query(`UPDATE toss_web_links SET status = 'ready', short_url = $2,
          updated_at = CURRENT_TIMESTAMP WHERE source_item_id = $1 AND status = 'pending' RETURNING *`, [id, link.shortUrl]);
        if (saved.rowCount !== 1) throw new Error('Link reservation lost');
        links.push(saved.rows[0]); issued++;
      } catch {
        await pool.query("UPDATE toss_web_links SET status = 'uncertain', updated_at = CURRENT_TIMESTAMP WHERE source_item_id = $1 AND status = 'pending'", [id]);
        uncertain++;
      }
    }
    // Re-read rank/price/availability after link issuance to avoid publishing stale products.
    const freshRanking = issued ? await tossClient.fetchBestSelling({ size: 100 }) : ranking;
    snapshot = buildTossWebSnapshot({ publications, ranking: freshRanking, webLinks: links, clickCounts, now: now() });
    return { ...await applyTossWebSnapshot(pool, snapshot), popular: snapshot.deals.filter((d) => d.isPopular).length, linksIssued: issued, uncertainLinks: uncertain };
  };
  if (dryRun) return run();
  const result = await createDealStore(pool).withCollectionLease('toss', run);
  return result || { status: 'skipped', reason: 'already_running' };
}
module.exports = { safeTossImage, readSentTossPublications, buildTossWebSnapshot, applyTossWebSnapshot, syncTossWeb, isPopularProduct, isWebProduct, POPULAR_POLICY, WEB_PRODUCT_LIMIT, MAX_NEW_LINKS_PER_SYNC, readTossWebSignals };
