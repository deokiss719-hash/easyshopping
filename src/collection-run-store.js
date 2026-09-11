function normalizeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function createCollectionRunStore(pool, source, { queryTimeoutMs = 2000 } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('pool is required');
  const normalizedSource = String(source || '').trim();
  if (!/^[a-z0-9_-]{1,64}$/i.test(normalizedSource)) throw new TypeError('source is invalid');
  if (!Number.isSafeInteger(queryTimeoutMs) || queryTimeoutMs < 1) {
    throw new TypeError('queryTimeoutMs must be a positive integer');
  }

  return {
    async start() {
      const result = await pool.query({
        text: `INSERT INTO collection_runs (source, status)
         VALUES ($1, 'running')
         RETURNING id`,
        values: [normalizedSource],
        query_timeout: queryTimeoutMs,
      });
      return String(result.rows[0].id);
    },

    async succeed(id, result = {}) {
      await pool.query({
        text: `UPDATE collection_runs
         SET status = 'succeeded', finished_at = CURRENT_TIMESTAMP,
             fetched_count = $1, upserted_count = $2, error_message = NULL
         WHERE id = $3`,
        values: [normalizeCount(result.fetched), normalizeCount(result.stored), String(id)],
        query_timeout: queryTimeoutMs,
      });
    },

    async fail(id) {
      await pool.query({
        text: `UPDATE collection_runs
         SET status = 'failed', finished_at = CURRENT_TIMESTAMP,
             error_message = $1
         WHERE id = $2`,
        values: ['collector_failed', String(id)],
        query_timeout: queryTimeoutMs,
      });
    },

    async getStatus({ timeoutMs = 2000 } = {}) {
      const result = await pool.query({
        text: `SELECT
          (SELECT status FROM collection_runs
           WHERE source = $1 ORDER BY started_at DESC, id DESC LIMIT 1) AS latest_status,
          (SELECT finished_at FROM collection_runs
           WHERE source = $1 AND status = 'succeeded' AND finished_at IS NOT NULL
           ORDER BY finished_at DESC, id DESC LIMIT 1) AS last_success_at`,
        values: [normalizedSource],
        query_timeout: timeoutMs,
      });
      const row = result.rows[0] || {};
      const lastSuccessAt = row.last_success_at == null
        ? null
        : new Date(row.last_success_at).toISOString();
      return { latestStatus: row.latest_status ?? null, lastSuccessAt };
    },
  };
}

module.exports = { createCollectionRunStore };
