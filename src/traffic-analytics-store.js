const crypto = require('node:crypto');

const SOURCES = new Set(['direct', 'internal', 'search', 'social', 'referral']);
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const HOST_PATTERN = /^[a-z0-9.-]{1,253}$/;
const QUERY_TIMEOUT_MS = 2_000;

function validDay(day) {
  if (!DAY_PATTERN.test(String(day))) return false;
  const date = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

function safeCount(value, name) {
  const parsed = BigInt(String(value ?? 0));
  if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${name} is outside JavaScript safe integer range`);
  return Number(parsed);
}

function validReferrerUrl(value, domain) {
  if (value === '') return true;
  if (value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol)
      && parsed.hostname.toLowerCase() === domain
      && !parsed.username && !parsed.password && !parsed.hash;
  } catch { return false; }
}

function normalizeInput(value) {
  const day = String(value?.day || '');
  const visitorHash = String(value?.visitorHash || '');
  const source = String(value?.source || '');
  const domain = String(value?.domain || '');
  const searchTerm = String(value?.searchTerm || '');
  const referrerUrl = String(value?.referrerUrl || '');
  if (!validDay(day)) throw new TypeError('invalid analytics day');
  if (!HASH_PATTERN.test(visitorHash)) throw new TypeError('invalid analytics visitor hash');
  if (!SOURCES.has(source)) throw new TypeError('invalid analytics source');
  if (source === 'direct' ? domain !== '' : !HOST_PATTERN.test(domain)) throw new TypeError('invalid analytics domain');
  if (searchTerm.length > 200 || /[\u0000-\u001f\u007f]/.test(searchTerm) || (source !== 'search' && searchTerm !== '')) throw new TypeError('invalid analytics search term');
  if (!validReferrerUrl(referrerUrl, domain) || (source === 'direct' && referrerUrl !== '')) throw new TypeError('invalid analytics referrer URL');
  return { day, visitorHash, source, domain, searchTerm, referrerUrl };
}

function timedQuery(target, text, values = []) {
  return target.query({ text, values, query_timeout: QUERY_TIMEOUT_MS });
}

function createTrafficAnalyticsStore(pool, { detailLimit = 200, resultLimit = 100 } = {}) {
  if (!pool?.query || !pool?.connect) throw new TypeError('database pool is required');
  if (!Number.isInteger(detailLimit) || detailLimit < 0 || detailLimit > 1000) throw new TypeError('invalid analytics detail limit');
  if (!Number.isInteger(resultLimit) || resultLimit < 1 || resultLimit > 100) throw new TypeError('invalid analytics result limit');
  let lastPurgedDay = null;

  async function purgeOldVisitorHashes(day) {
    if (lastPurgedDay === day) return;
    await timedQuery(pool, 'DELETE FROM traffic_daily_visitors WHERE day < $1::date', [day]);
    lastPurgedDay = day;
  }

  return {
    async recordPageView(value) {
      const { day, visitorHash, source, domain, searchTerm, referrerUrl } = normalizeInput(value);
      const insertMarker = crypto.randomBytes(16).toString('hex');

      // Keep the high-frequency page-view counter outside the first-touch transaction,
      // so one slow referrer write cannot hold the day's counter row lock.
      await timedQuery(
        pool,
        `INSERT INTO traffic_daily (day, page_views)
         VALUES ($1::date, 1)
         ON CONFLICT (day) DO UPDATE SET page_views = traffic_daily.page_views + 1`,
        [day],
      );

      const client = await pool.connect();
      try {
        await timedQuery(client, 'BEGIN');
        const inserted = await timedQuery(
          client,
          `INSERT INTO traffic_daily_visitors
             (day, visitor_hash, insert_marker, source, domain, search_term, referrer_url)
           VALUES ($1::date, $2, $5, $3, $4, '', '')
           ON CONFLICT (day, visitor_hash) DO UPDATE
             SET visitor_hash = EXCLUDED.visitor_hash
             WHERE FALSE
           RETURNING insert_marker`,
          [day, visitorHash, source, domain, insertMarker],
        );
        if (inserted.rows.some((row) => row.insert_marker === insertMarker)) {
          if (searchTerm || referrerUrl) {
            const reservation = await timedQuery(
              client,
              `UPDATE traffic_daily
               SET detail_records = detail_records + 1
               WHERE day = $1::date AND detail_records < $2
               RETURNING detail_records`,
              [day, detailLimit],
            );
            if (reservation.rows.length > 0) {
              await timedQuery(
                client,
                `UPDATE traffic_daily_visitors
                 SET search_term = $3, referrer_url = $4
                 WHERE day = $1::date AND visitor_hash = $2`,
                [day, visitorHash, searchTerm, referrerUrl],
              );
            }
          }
          await timedQuery(
            client,
            `INSERT INTO traffic_daily_referrers (day, source, domain, visitors)
             VALUES ($1::date, $2, $3, 1)
             ON CONFLICT (day, source, domain)
             DO UPDATE SET visitors = traffic_daily_referrers.visitors + 1`,
            [day, source, domain],
          );
        }
        await timedQuery(client, 'COMMIT');
      } catch (error) {
        try { await timedQuery(client, 'ROLLBACK'); } catch { /* preserve the original error */ }
        throw error;
      } finally {
        client.release();
      }
      await purgeOldVisitorHashes(day);
    },

    async getDay(day) {
      if (!validDay(day)) throw new TypeError('invalid analytics day');
      const [aggregateResult, detailResult] = await Promise.all([
        timedQuery(
          pool,
          `WITH daily_stats AS (
             SELECT daily.page_views, COUNT(visitor.visitor_hash) AS unique_visitors
             FROM traffic_daily AS daily
             LEFT JOIN traffic_daily_visitors AS visitor ON visitor.day = daily.day
             WHERE daily.day = $1::date
             GROUP BY daily.page_views
           )
           SELECT stats.page_views, stats.unique_visitors,
             referrer.source, referrer.domain, referrer.visitors
           FROM daily_stats AS stats
           LEFT JOIN traffic_daily_referrers AS referrer ON referrer.day = $1::date
           ORDER BY referrer.visitors DESC, referrer.source ASC, referrer.domain ASC`,
          [day],
        ),
        timedQuery(
          pool,
          `SELECT source, domain, search_term, referrer_url,
             COUNT(visitor_hash) AS visitors
           FROM traffic_daily_visitors
           WHERE day = $1::date AND (search_term <> '' OR referrer_url <> '')
           GROUP BY source, domain, search_term, referrer_url
           ORDER BY visitors DESC, source ASC, domain ASC, search_term ASC, referrer_url ASC
           LIMIT $2`,
          [day, resultLimit],
        ),
      ]);
      const first = aggregateResult.rows[0] || { page_views: 0, unique_visitors: 0 };
      return {
        day,
        timeZone: 'Asia/Seoul',
        uniqueVisitors: safeCount(first.unique_visitors, 'uniqueVisitors'),
        pageViews: safeCount(first.page_views, 'pageViews'),
        referrers: aggregateResult.rows.filter((row) => row.source).map((row) => ({
          source: row.source,
          domain: row.domain || null,
          visitors: safeCount(row.visitors, 'referrer visitors'),
        })),
        referrerDetails: detailResult.rows.map((row) => ({
          source: row.source,
          domain: row.domain || null,
          visitors: safeCount(row.visitors, 'referrer detail visitors'),
          searchTerm: row.search_term || null,
          referrerUrl: row.referrer_url || null,
        })),
        referrerDetailLimit: resultLimit,
      };
    },

    async purgeBefore(day) {
      if (!validDay(day)) throw new TypeError('invalid analytics day');
      await purgeOldVisitorHashes(day);
    },
  };
}

module.exports = { createTrafficAnalyticsStore };
