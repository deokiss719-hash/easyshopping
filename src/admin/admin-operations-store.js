const SOURCES = ['ppomppu', 'fmkorea', 'ruliweb', 'toss'];

function koreaDayStartIso(now = new Date()) {
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const shifted = new Date(now.getTime() + kstOffsetMs);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(),
  ) - kstOffsetMs).toISOString();
}

function createAdminOperationsStore(pool) {
  return {
    async getStatus() {
      const todayStart = koreaDayStartIso();
      const [sources, runs, snapshots] = await Promise.all([
        pool.query(`SELECT d.source, MAX(d.last_seen_at) last_seen_at,
          SUM(CASE WHEN d.first_seen_at >= $1 THEN 1 ELSE 0 END) new_today,
          SUM(CASE WHEN d.is_ended=FALSE AND m.deal_id IS NULL THEN 1 ELSE 0 END)
            + SUM(CASE WHEN d.is_ended=FALSE AND m.deal_id IS NOT NULL AND m.is_hidden=FALSE AND m.is_ended=FALSE THEN 1 ELSE 0 END) active_count,
          SUM(CASE WHEN d.is_ended=FALSE AND m.deal_id IS NULL
            AND d.image_url IS NULL AND (d.source <> 'toss' OR d.source_image_url IS NULL) THEN 1 ELSE 0 END)
            + SUM(CASE WHEN d.is_ended=FALSE AND m.deal_id IS NOT NULL AND m.is_hidden=FALSE AND m.is_ended=FALSE
              AND d.image_url IS NULL AND (d.source <> 'toss' OR d.source_image_url IS NULL) THEN 1 ELSE 0 END) missing_images
          FROM deals d LEFT JOIN deal_moderation m ON m.deal_id=d.id GROUP BY d.source`, [todayStart]),
        pool.query(`SELECT DISTINCT ON (source) source,status,started_at,finished_at,fetched_count,upserted_count
          FROM collection_runs ORDER BY source,started_at DESC,id DESC`),
        pool.query('SELECT name,payload,reported_at FROM automation_status'),
      ]);
      return { checkedAt: new Date().toISOString(), sources: SOURCES.map((source) => ({ source,
        ...(sources.rows.find((row) => row.source === source) || {}),
        latestRun: runs.rows.find((row) => row.source === source) || null,
      })), snapshots: snapshots.rows };
    },
    async listProducts({ q = '', source = '', status = '', page = '1' } = {}) {
      if (typeof q !== 'string' || q.length > 100 || (source && !SOURCES.includes(source))
        || !['', 'hidden', 'ended', 'missing-image', 'active'].includes(status)
        || !/^\d+$/.test(String(page)) || Number(page) < 1 || Number(page) > 10000) throw new TypeError('상품 조회 조건을 확인해 주세요.');
      const conditions = ["d.source IN ('ppomppu','fmkorea','ruliweb','toss')"];
      const values = [];
      if (q.trim()) { values.push(q.trim()); conditions.push(`STRPOS(LOWER(d.title), LOWER($${values.length})) > 0`); }
      if (source) { values.push(source); conditions.push(`d.source=$${values.length}`); }
      if (status === 'hidden') conditions.push('m.is_hidden=TRUE');
      if (status === 'ended') conditions.push('(d.is_ended=TRUE OR m.is_ended=TRUE)');
      if (status === 'active') conditions.push("d.is_ended=FALSE AND COALESCE(m.is_hidden,FALSE)=FALSE AND COALESCE(m.is_ended,FALSE)=FALSE AND (d.source <> 'toss' OR d.last_seen_at >= CURRENT_TIMESTAMP - INTERVAL '26 hours')");
      if (status === 'missing-image') conditions.push("d.image_url IS NULL AND (d.source <> 'toss' OR d.source_image_url IS NULL)");
      const from = `FROM deals d LEFT JOIN deal_moderation m ON m.deal_id=d.id WHERE ${conditions.join(' AND ')}`;
      const count = await pool.query(`SELECT COUNT(*) count ${from}`, values);
      const result = await pool.query(`SELECT d.id,d.title,d.source,d.price_amount,d.image_status,d.image_url,d.source_image_url,
        d.is_ended AS source_ended,d.last_seen_at,d.first_seen_at,COALESCE(m.is_hidden,FALSE) is_hidden,COALESCE(m.is_ended,FALSE) admin_ended
        ${from} ORDER BY d.first_seen_at DESC,d.id DESC LIMIT 30 OFFSET $${values.length + 1}`, [...values, (Number(page) - 1) * 30]);
      return { page: Number(page), total: Number(count.rows[0].count), size: 30, products: result.rows };
    },
    async moderate(id, { action } = {}) {
      if (!/^\d+$/.test(String(id)) || !['hide','unhide','end','restore'].includes(action)) throw new TypeError('상품 변경 요청이 올바르지 않아요.');
      const column = ['hide','unhide'].includes(action) ? 'is_hidden' : 'is_ended';
      const value = ['hide','end'].includes(action);
      const result = await pool.query(`INSERT INTO deal_moderation (deal_id,${column})
        SELECT id,$2 FROM deals WHERE id=$1 AND source IN ('ppomppu','fmkorea','ruliweb','toss')
        ON CONFLICT(deal_id) DO UPDATE SET ${column}=EXCLUDED.${column},updated_at=CURRENT_TIMESTAMP RETURNING *`, [id, value]);
      return result.rows[0] || null;
    },
  };
}
module.exports = { createAdminOperationsStore };
