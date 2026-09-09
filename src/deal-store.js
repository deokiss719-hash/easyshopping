const fs = require('node:fs/promises');
const path = require('node:path');
const { isCategory } = require('./deal-category');

const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
const MAX_PAGE = 10000;
const MAX_PAGE_SIZE = 100;
const IMAGE_STATUSES = new Set(['missing_merchant_url', 'pending', 'ready', 'failed', 'unsupported_provider']);

class InvalidQueryError extends TypeError {}

async function migrate(pool) {
  const sql = await fs.readFile(schemaPath, 'utf8');
  await pool.query(sql);
}

function normalizeDeal(deal) {
  const required = ['source', 'sourceItemId', 'title', 'originalUrl'];
  const missing = required.filter(
    (name) => typeof deal?.[name] !== 'string' || !deal[name].trim(),
  );
  if (missing.length) {
    throw new TypeError(`Missing required deal fields: ${missing.join(', ')}`);
  }

  const normalized = {
    ...deal,
    source: deal.source.trim(),
    sourceItemId: deal.sourceItemId.trim(),
    title: deal.title.trim(),
    originalUrl: deal.originalUrl.trim(),
  };

  if (
    normalized.priceAmount != null
    && (!Number.isSafeInteger(normalized.priceAmount) || normalized.priceAmount < 0)
  ) {
    throw new TypeError('priceAmount must be a safe non-negative integer');
  }
  if (normalized.category != null && !isCategory(normalized.category)) {
    throw new TypeError('category is not supported');
  }
  if (normalized.imageStatus != null && !IMAGE_STATUSES.has(normalized.imageStatus)) {
    throw new TypeError('imageStatus is not supported');
  }

  return normalized;
}

function safeNumber(value, name) {
  const parsed = typeof value === 'bigint' ? value : BigInt(String(value));
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER) || parsed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`${name} is outside JavaScript safe integer range`);
  }
  return Number(parsed);
}

function positiveInteger(value, name, fallback, maximum) {
  if (value == null || value === '') return fallback;
  const text = String(value);
  if (!/^\d+$/.test(text)) throw new InvalidQueryError(`${name} must be a positive integer`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new InvalidQueryError(`${name} must be a positive integer`);
  }
  return Math.min(parsed, maximum);
}

function mapDeal(row) {
  return {
    id: String(row.id),
    source: row.source,
    sourceItemId: row.source_item_id,
    title: row.title,
    priceText: row.price_text,
    priceAmount: row.price_amount == null ? null : safeNumber(row.price_amount, 'priceAmount'),
    merchant: row.merchant,
    originalUrl: row.original_url,
    merchantUrl: row.merchant_url,
    sourceImageUrl: row.source_image_url,
    imageUrl: row.image_url,
    imageStatus: row.image_status || (row.image_url ? 'ready' : 'missing_merchant_url'),
    imageProvider: row.image_provider,
    imageFailureCode: row.image_failure_code,
    imageRetryAt: row.image_retry_at,
    category: row.category,
    publishedAt: row.published_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    endedAt: row.ended_at,
    isEnded: row.is_ended,
  };
}

function createDealStore(pool) {
  return {
    async upsert(input) {
      const deal = normalizeDeal(input);
      const values = [
        deal.source,
        deal.sourceItemId,
        deal.title,
        deal.priceText ?? null,
        deal.priceAmount ?? null,
        deal.merchant ?? null,
        deal.originalUrl,
        deal.merchantUrl ?? null,
        deal.sourceImageUrl ?? null,
        deal.imageUrl ?? null,
        deal.imageStatus ?? (deal.imageUrl ? 'ready' : (deal.merchantUrl ? 'pending' : 'missing_merchant_url')),
        deal.imageProvider ?? null,
        deal.imageFailureCode ?? null,
        deal.imageRetryAt ?? null,
        deal.publishedAt ?? null,
        deal.rawHash ?? null,
        deal.category ?? null,
      ];

      const result = await pool.query(
        `INSERT INTO deals (
          source, source_item_id, title, price_text, price_amount, merchant, original_url,
          merchant_url, source_image_url, image_url, image_status, image_provider,
          image_failure_code, image_retry_at, published_at, raw_hash, category
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,COALESCE($17, '기타'))
        ON CONFLICT (source, source_item_id) DO UPDATE SET
          title = EXCLUDED.title,
          price_text = COALESCE(EXCLUDED.price_text, deals.price_text),
          price_amount = COALESCE(EXCLUDED.price_amount, deals.price_amount),
          merchant = COALESCE(EXCLUDED.merchant, deals.merchant),
          original_url = EXCLUDED.original_url,
          merchant_url = COALESCE(deals.merchant_url, EXCLUDED.merchant_url),
          source_image_url = CASE
            WHEN deals.image_url IS NOT NULL THEN deals.source_image_url
            ELSE COALESCE(EXCLUDED.source_image_url, deals.source_image_url)
          END,
          image_url = COALESCE(deals.image_url, EXCLUDED.image_url),
          image_status = CASE
            WHEN COALESCE(deals.image_url, EXCLUDED.image_url) IS NOT NULL THEN 'ready'
            WHEN COALESCE(deals.merchant_url, EXCLUDED.merchant_url) IS NULL THEN 'missing_merchant_url'
            WHEN deals.image_status IN ('failed', 'unsupported_provider') THEN deals.image_status
            WHEN EXCLUDED.merchant_url IS NULL AND deals.merchant_url IS NOT NULL THEN deals.image_status
            ELSE EXCLUDED.image_status
          END,
          image_provider = CASE
            WHEN deals.image_url IS NOT NULL THEN deals.image_provider
            WHEN EXCLUDED.image_url IS NOT NULL THEN EXCLUDED.image_provider
            ELSE COALESCE(deals.image_provider, EXCLUDED.image_provider)
          END,
          image_failure_code = CASE
            WHEN deals.image_url IS NULL AND EXCLUDED.image_url IS NOT NULL THEN NULL
            ELSE deals.image_failure_code
          END,
          image_retry_at = CASE
            WHEN deals.image_url IS NULL AND EXCLUDED.image_url IS NOT NULL THEN NULL
            ELSE deals.image_retry_at
          END,
          published_at = COALESCE(EXCLUDED.published_at, deals.published_at),
          raw_hash = COALESCE(EXCLUDED.raw_hash, deals.raw_hash),
          category = COALESCE($17, deals.category),
          last_seen_at = CURRENT_TIMESTAMP,
          is_ended = FALSE,
          ended_at = NULL
        RETURNING *`,
        values,
      );
      return mapDeal(result.rows[0]);
    },

    async reclassify(classifier) {
      if (typeof classifier !== 'function') throw new TypeError('classifier is required');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query("SELECT id, title, category FROM deals WHERE category IS NULL OR category = '기타' FOR UPDATE");
        let updated = 0;
        for (const row of result.rows) {
          const category = classifier({ title: row.title });
          if (!isCategory(category)) throw new TypeError('classifier returned an unsupported category');
          if (category !== row.category) {
            const changed = await client.query(
              'UPDATE deals SET category = $1 WHERE id = $2',
              [category, row.id],
            );
            updated += changed.rowCount;
          }
        }
        await client.query('COMMIT');
        return updated;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async updateImageState(id, update = {}) {
      if (!/^\d+$/.test(String(id || ''))) throw new TypeError('deal id is invalid');
      if (!IMAGE_STATUSES.has(update.imageStatus)) throw new TypeError('imageStatus is not supported');
      const fields = {
        imageStatus: 'image_status',
        imageUrl: 'image_url',
        sourceImageUrl: 'source_image_url',
        imageProvider: 'image_provider',
        imageFailureCode: 'image_failure_code',
        imageRetryAt: 'image_retry_at',
      };
      const entries = Object.entries(fields).filter(([name]) => Object.hasOwn(update, name));
      const values = entries.map(([name]) => update[name] ?? null);
      values.push(String(id));
      const assignments = entries.map(([, column], index) => `${column} = $${index + 1}`);
      const result = await pool.query(
        `UPDATE deals SET ${assignments.join(', ')} WHERE id = $${values.length} RETURNING *`,
        values,
      );
      return result.rows[0] ? mapDeal(result.rows[0]) : null;
    },

    async listImageBackfillCandidates({ limit = 20, now = new Date() } = {}) {
      const safeLimit = positiveInteger(limit, 'limit', 20, 100);
      const currentTime = new Date(now);
      if (Number.isNaN(currentTime.getTime())) throw new TypeError('now must be a valid date');
      const result = await pool.query(
        `SELECT * FROM deals
         WHERE is_ended = FALSE
           AND image_url IS NULL
           AND merchant_url IS NOT NULL
           AND image_status IN ('pending', 'failed', 'unsupported_provider')
           AND (image_retry_at IS NULL OR image_retry_at <= $1)
         ORDER BY published_at DESC NULLS LAST, id DESC
         LIMIT $2`,
        [currentTime.toISOString(), safeLimit],
      );
      return result.rows.map(mapDeal);
    },

    async markEndedBefore(source, cutoff) {
      const normalizedSource = String(source || '').trim();
      const cutoffDate = new Date(cutoff);
      if (!normalizedSource || Number.isNaN(cutoffDate.getTime())) {
        throw new TypeError('source and valid cutoff are required');
      }
      const result = await pool.query(
        `UPDATE deals
         SET is_ended = TRUE, ended_at = CURRENT_TIMESTAMP
         WHERE source = $1
           AND is_ended = FALSE
           AND published_at < $2`,
        [normalizedSource, cutoffDate.toISOString()],
      );
      return result.rowCount;
    },

    async list({ q = '', source = '', page = 1, size = 20 } = {}) {
      const safePage = positiveInteger(page, 'page', 1, MAX_PAGE);
      const safeSize = positiveInteger(size, 'size', 20, MAX_PAGE_SIZE);
      const conditions = ['is_ended = FALSE'];
      const values = [];

      if (String(q).trim()) {
        values.push(String(q).trim());
        conditions.push(`(STRPOS(LOWER(title), LOWER($${values.length})) > 0
          OR STRPOS(LOWER(COALESCE(merchant, '')), LOWER($${values.length})) > 0)`);
      }
      if (String(source).trim()) {
        values.push(String(source).trim());
        conditions.push(`source = $${values.length}`);
      }

      const where = `WHERE ${conditions.join(' AND ')}`;
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const countResult = await client.query(
          `SELECT COUNT(*) AS total FROM deals ${where}`,
          values,
        );
        const listValues = [...values, safeSize, (safePage - 1) * safeSize];
        const listResult = await client.query(
          `SELECT * FROM deals ${where}
           ORDER BY published_at DESC NULLS LAST, first_seen_at DESC, id DESC
           LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          listValues,
        );
        await client.query('COMMIT');

        return {
          page: safePage,
          size: safeSize,
          total: safeNumber(countResult.rows[0].total, 'total'),
          items: listResult.rows.map(mapDeal),
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

module.exports = { migrate, createDealStore, InvalidQueryError };
