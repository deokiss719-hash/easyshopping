const fs = require('node:fs/promises');
const path = require('node:path');

const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
const MAX_PAGE = 10000;
const MAX_PAGE_SIZE = 100;

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
    imageUrl: row.image_url,
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
        deal.imageUrl ?? null,
        deal.publishedAt ?? null,
        deal.rawHash ?? null,
      ];

      const result = await pool.query(
        `INSERT INTO deals (
          source, source_item_id, title, price_text, price_amount,
          merchant, original_url, image_url, published_at, raw_hash
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (source, source_item_id) DO UPDATE SET
          title = EXCLUDED.title,
          price_text = COALESCE(EXCLUDED.price_text, deals.price_text),
          price_amount = COALESCE(EXCLUDED.price_amount, deals.price_amount),
          merchant = COALESCE(EXCLUDED.merchant, deals.merchant),
          original_url = EXCLUDED.original_url,
          image_url = COALESCE(EXCLUDED.image_url, deals.image_url),
          published_at = COALESCE(EXCLUDED.published_at, deals.published_at),
          raw_hash = COALESCE(EXCLUDED.raw_hash, deals.raw_hash),
          last_seen_at = CURRENT_TIMESTAMP,
          is_ended = FALSE,
          ended_at = NULL
        RETURNING *`,
        values,
      );
      return mapDeal(result.rows[0]);
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
