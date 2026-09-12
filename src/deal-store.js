const fs = require('node:fs/promises');
const path = require('node:path');
const { isCategory } = require('./deal-category');

const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
const MAX_PAGE = 10000;
const MAX_PAGE_SIZE = 100;
const MAX_QUERY_LENGTH = 100;
const SORT_ORDERS = Object.freeze({
  latest: 'd.published_at DESC NULLS LAST, d.first_seen_at DESC, d.id DESC',
  'price-low': 'd.price_amount ASC NULLS LAST, d.published_at DESC NULLS LAST, d.id DESC',
});
const IMAGE_STATUSES = new Set(['missing_merchant_url', 'pending', 'ready', 'failed', 'unsupported_provider']);
const IMAGE_BACKFILL_ADVISORY_LOCK_NAMESPACE = 1163086169;
const IMAGE_BACKFILL_ADVISORY_LOCK_ID = 1835627636;
const COUPANG_COLLECTION_ADVISORY_LOCK_NAMESPACE = 1129270864;
const COUPANG_COLLECTION_ADVISORY_LOCK_ID = 1347374160;
const migratedPools = new WeakSet();

class InvalidQueryError extends TypeError {}

async function migrate(pool) {
  if (migratedPools.has(pool)) return;
  const sql = await fs.readFile(schemaPath, 'utf8');
  await pool.query(sql);
  migratedPools.add(pool);
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

function koreaDayStart(value) {
  const currentTime = new Date(value);
  if (Number.isNaN(currentTime.getTime())) throw new TypeError('now must be a valid date');
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const shifted = new Date(currentTime.getTime() + kstOffsetMs);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  ) - kstOffsetMs);
}

function mapDeal(row) {
  const deal = {
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
    badge: row.badge,
    description: row.description,
    publishedAt: row.published_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    endedAt: row.ended_at,
    isEnded: row.is_ended,
  };
  if (row.manual_id != null) {
    deal.manualId = String(row.manual_id);
    deal.hasManualImage = row.manual_has_image === true;
    deal.originalPriceAmount = row.manual_original_price_amount == null ? null : safeNumber(row.manual_original_price_amount, 'originalPriceAmount');
    deal.description = row.manual_description;
    deal.badge = row.manual_badge;
    deal.showOnHome = row.manual_show_on_home;
    deal.priority = row.manual_priority;
  }
  return deal;
}

function createDealStore(pool) {
  return {
    async getImageBackfillCooldown() {
      const result = await pool.query('SELECT cooldown_until FROM image_backfill_control WHERE singleton = TRUE');
      const value = result.rows[0]?.cooldown_until;
      return value == null ? null : new Date(value).toISOString();
    },

    async recordImageBackfillCooldown(code, retryAt) {
      const normalizedCode = String(code || '');
      const date = new Date(retryAt);
      if (!/^[a-z0-9_]{1,64}$/.test(normalizedCode)) throw new TypeError('failure code is invalid');
      if (Number.isNaN(date.getTime())) throw new TypeError('retryAt must be a valid date');
      const result = await pool.query(
        `INSERT INTO image_backfill_control (singleton, cooldown_until, failure_code)
         VALUES (TRUE, $1, $2)
         ON CONFLICT (singleton) DO UPDATE SET
           cooldown_until = CASE
             WHEN image_backfill_control.cooldown_until IS NULL
               OR image_backfill_control.cooldown_until < EXCLUDED.cooldown_until
             THEN EXCLUDED.cooldown_until ELSE image_backfill_control.cooldown_until END,
           failure_code = CASE
             WHEN image_backfill_control.cooldown_until IS NULL
               OR image_backfill_control.cooldown_until < EXCLUDED.cooldown_until
             THEN EXCLUDED.failure_code ELSE image_backfill_control.failure_code END,
           updated_at = CURRENT_TIMESTAMP
         RETURNING cooldown_until`,
        [date.toISOString(), normalizedCode],
      );
      return new Date(result.rows[0].cooldown_until).toISOString();
    },

    async withImageBackfillLease(worker) {
      if (typeof worker !== 'function') throw new TypeError('worker is required');
      const client = await pool.connect();
      let acquired = false;
      let workerError = null;
      try {
        const result = await client.query(
          `SELECT pg_try_advisory_lock(${IMAGE_BACKFILL_ADVISORY_LOCK_NAMESPACE}, ${IMAGE_BACKFILL_ADVISORY_LOCK_ID}) AS acquired`,
        );
        acquired = result.rows[0]?.acquired === true;
        if (!acquired) return null;
        try {
          return await worker();
        } catch (error) {
          workerError = error;
          throw error;
        }
      } finally {
        let unlockError = null;
        try {
          if (acquired) {
            const unlockResult = await client.query(
              `SELECT pg_advisory_unlock(${IMAGE_BACKFILL_ADVISORY_LOCK_NAMESPACE}, ${IMAGE_BACKFILL_ADVISORY_LOCK_ID}) AS unlocked`,
            );
            if (unlockResult.rows[0]?.unlocked !== true) {
              throw new Error('image backfill advisory unlock failed');
            }
          }
        } catch (error) {
          unlockError = error;
        } finally {
          client.release(unlockError ? true : undefined);
        }
        if (unlockError) {
          if (workerError) workerError.advisoryUnlockError = unlockError;
          else throw unlockError;
        }
      }
    },

    async withCoupangCollectionLease(worker) {
      if (typeof worker !== 'function') throw new TypeError('worker is required');
      const client = await pool.connect();
      let acquired = false;
      let workerError = null;
      try {
        const result = await client.query(
          `SELECT pg_try_advisory_lock(${COUPANG_COLLECTION_ADVISORY_LOCK_NAMESPACE}, ${COUPANG_COLLECTION_ADVISORY_LOCK_ID}) AS acquired`,
        );
        acquired = result.rows[0]?.acquired === true;
        if (!acquired) return null;
        try {
          return await worker();
        } catch (error) {
          workerError = error;
          throw error;
        }
      } finally {
        let unlockError = null;
        try {
          if (acquired) {
            const unlockResult = await client.query(
              `SELECT pg_advisory_unlock(${COUPANG_COLLECTION_ADVISORY_LOCK_NAMESPACE}, ${COUPANG_COLLECTION_ADVISORY_LOCK_ID}) AS unlocked`,
            );
            if (unlockResult.rows[0]?.unlocked !== true) {
              throw new Error('Coupang collection advisory unlock failed');
            }
          }
        } catch (error) {
          unlockError = error;
        } finally {
          client.release(unlockError ? true : undefined);
        }
        if (unlockError) {
          if (workerError) workerError.advisoryUnlockError = unlockError;
          else throw unlockError;
        }
      }
    },

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
        deal.imageStatus ?? (deal.imageUrl ? 'ready' : 'pending'),
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

    async syncCoupangSnapshot(inputs) {
      if (!Array.isArray(inputs) || inputs.length === 0) {
        throw new TypeError('Coupang snapshot must contain at least one product');
      }
      const deals = inputs.map(normalizeDeal);
      if (deals.some((deal) => deal.source !== 'coupang')) {
        throw new TypeError('Coupang snapshot may only contain coupang products');
      }
      const ids = deals.map((deal) => deal.sourceItemId);
      if (new Set(ids).size !== ids.length) throw new TypeError('Coupang snapshot contains duplicate product IDs');

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(1129270343, 1886218864)');
        for (const deal of deals) {
          await client.query(
            `INSERT INTO deals (
              source, source_item_id, title, price_text, price_amount, merchant, original_url,
              source_image_url, image_url, image_status, image_provider, published_at, category,
              badge, description
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            ON CONFLICT (source, source_item_id) DO UPDATE SET
              title = EXCLUDED.title,
              price_text = EXCLUDED.price_text,
              price_amount = EXCLUDED.price_amount,
              merchant = EXCLUDED.merchant,
              original_url = EXCLUDED.original_url,
              source_image_url = EXCLUDED.source_image_url,
              image_url = EXCLUDED.image_url,
              image_status = EXCLUDED.image_status,
              image_provider = EXCLUDED.image_provider,
              category = EXCLUDED.category,
              badge = EXCLUDED.badge,
              description = EXCLUDED.description,
              last_seen_at = CURRENT_TIMESTAMP,
              is_ended = FALSE,
              ended_at = NULL`,
            [
              deal.source, deal.sourceItemId, deal.title, deal.priceText ?? null,
              deal.priceAmount ?? null, deal.merchant ?? null, deal.originalUrl,
              deal.sourceImageUrl ?? null, deal.imageUrl ?? null, deal.imageStatus ?? 'ready',
              deal.imageProvider ?? 'coupang-api', deal.publishedAt ?? null,
              deal.category ?? '기타', deal.badge ?? '쿠팡추천', deal.description ?? null,
            ],
          );
        }
        const idParameters = ids.map((_, index) => `$${index + 2}`).join(',');
        const ended = await client.query(
          `UPDATE deals
           SET is_ended = TRUE, ended_at = CURRENT_TIMESTAMP
           WHERE source = $1 AND is_ended = FALSE
             AND source_item_id NOT IN (${idParameters})`,
          ['coupang', ...ids],
        );
        await client.query('COMMIT');
        return { upserted: deals.length, ended: ended.rowCount };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async reclassify(classifier) {
      if (typeof classifier !== 'function') throw new TypeError('classifier is required');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query("SELECT id, title, category FROM deals WHERE source <> 'manual' AND (category IS NULL OR category = '기타') FOR UPDATE");
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

    async updateImageState(id, update = {}, { onlyIfImageMissing = false, backfillNow = null } = {}) {
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
      const idParameter = values.length;
      const assignments = entries.map(([, column], index) => `${column} = $${index + 1}`);
      let condition = onlyIfImageMissing ? ' AND image_url IS NULL' : '';
      if (backfillNow != null) {
        const currentTime = new Date(backfillNow);
        if (Number.isNaN(currentTime.getTime())) throw new TypeError('backfillNow must be a valid date');
        values.push(koreaDayStart(currentTime), new Date(currentTime.getTime() - 60 * 60 * 1000), currentTime);
        condition += ` AND published_at >= $${values.length - 2}
          AND published_at >= $${values.length - 1}
          AND published_at <= $${values.length}`;
      }
      const result = await pool.query(
        `UPDATE deals SET ${assignments.join(', ')} WHERE id = $${idParameter}${condition} RETURNING *`,
        values,
      );
      return result.rows[0] ? mapDeal(result.rows[0]) : null;
    },

    async listImageBackfillCandidates({ limit = 20, now = new Date(), source = null } = {}) {
      const safeLimit = positiveInteger(limit, 'limit', 20, 100);
      const currentTime = new Date(now);
      if (Number.isNaN(currentTime.getTime())) throw new TypeError('now must be a valid date');
      const todayStart = koreaDayStart(currentTime);
      const oneHourAgo = new Date(currentTime.getTime() - 60 * 60 * 1000);
      const normalizedSource = source == null ? null : String(source).trim();
      if (normalizedSource != null && !/^[a-z0-9_-]{1,64}$/i.test(normalizedSource)) {
        throw new TypeError('source is invalid');
      }
      const result = await pool.query(
        `SELECT * FROM deals
         WHERE is_ended = FALSE
           AND image_url IS NULL
           AND image_status IN ('missing_merchant_url', 'pending', 'failed', 'unsupported_provider')
           AND (image_retry_at IS NULL OR image_retry_at <= $1)
           AND ($2::text IS NULL OR source = $2)
           AND published_at >= $4
           AND published_at >= $5
           AND published_at <= $1
         ORDER BY published_at DESC NULLS LAST, id DESC
         LIMIT $3`,
        [currentTime.toISOString(), normalizedSource, safeLimit, todayStart.toISOString(), oneHourAgo.toISOString()],
      );
      return result.rows.map(mapDeal);
    },

    async deleteBefore(source, cutoff) {
      const normalizedSource = String(source || '').trim();
      if (!/^[a-z0-9_-]{1,64}$/i.test(normalizedSource)) throw new TypeError('source is invalid');
      if (normalizedSource === 'manual') throw new TypeError('manual deals cannot be deleted by retention');
      const cutoffDate = new Date(cutoff);
      if (Number.isNaN(cutoffDate.getTime())) throw new TypeError('valid cutoff is required');
      const result = await pool.query(
        `DELETE FROM deals
         WHERE source = $1
           AND published_at <= $2::timestamptz`,
        [normalizedSource, cutoffDate.toISOString()],
      );
      return result.rowCount;
    },

    async list({ q = '', source = '', category = '', sort = 'latest', featured = false, page = 1, size = 20 } = {}) {
      const safePage = positiveInteger(page, 'page', 1, MAX_PAGE);
      const safeSize = positiveInteger(size, 'size', 20, MAX_PAGE_SIZE);
      const normalizedQuery = String(q).trim();
      const normalizedCategory = String(category).trim();
      const normalizedSort = String(sort || 'latest').trim();
      const isFeatured = featured === true || featured === 'true';
      if (normalizedQuery.length > MAX_QUERY_LENGTH) throw new InvalidQueryError(`q must be at most ${MAX_QUERY_LENGTH} characters`);
      if (normalizedCategory && !isCategory(normalizedCategory)) throw new InvalidQueryError('category is not supported');
      if (!Object.hasOwn(SORT_ORDERS, normalizedSort)) throw new InvalidQueryError('sort is not supported');
      if (featured !== false && featured !== '' && featured != null && featured !== true && featured !== 'true') {
        throw new InvalidQueryError('featured must be true');
      }
      const conditions = [
        'd.is_ended = FALSE',
        `(d.source <> 'manual' OR (m.deal_id IS NOT NULL AND m.is_published = TRUE))`,
      ];
      const values = [];

      if (normalizedQuery) {
        values.push(normalizedQuery);
        conditions.push(`(STRPOS(LOWER(d.title), LOWER($${values.length})) > 0
          OR STRPOS(LOWER(COALESCE(d.merchant, '')), LOWER($${values.length})) > 0)`);
      }
      if (String(source).trim()) {
        values.push(String(source).trim());
        conditions.push(`d.source = $${values.length}`);
      }
      if (normalizedCategory) {
        values.push(normalizedCategory);
        conditions.push(`d.category = $${values.length}`);
      }
      if (isFeatured) conditions.push(`d.source = 'manual' AND m.show_on_home = TRUE`);

      const where = `WHERE ${conditions.join(' AND ')}`;
      const orderBy = isFeatured
        ? 'm.priority DESC, d.published_at DESC NULLS LAST, d.id DESC'
        : SORT_ORDERS[normalizedSort];
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const countResult = await client.query(
          `SELECT COUNT(*) AS total
           FROM deals d
           LEFT JOIN manual_deals m ON d.source = 'manual' AND m.deal_id = d.id
           ${where}`,
          values,
        );
        const listValues = [...values, safeSize, (safePage - 1) * safeSize];
        const listResult = await client.query(
          `SELECT d.*,
             m.id AS manual_id,
             (m.image_url IS NOT NULL) AS manual_has_image,
             m.original_price_amount AS manual_original_price_amount,
             m.description AS manual_description,
             m.badge AS manual_badge,
             m.show_on_home AS manual_show_on_home,
             m.priority AS manual_priority
           FROM deals d
           LEFT JOIN manual_deals m ON d.source = 'manual' AND m.deal_id = d.id
           ${where}
           ORDER BY ${orderBy}
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
