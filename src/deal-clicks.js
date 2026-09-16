const express = require('express');
const { createHash, randomUUID } = require('node:crypto');
const { cookieVisitor, koreaDay, BOT_PATTERN } = require('./traffic-analytics');
const adminCookie = require('./admin/admin-traffic-cookie');
const TOSS_FRESHNESS_MS = 26 * 60 * 60 * 1000;
const SECTIONS = new Set(['all-deals', 'popular', 'latest', 'phone']);

function createDealClickStore(pool) {
  let purgedAt = 0;
  return {
    async record({ dealId, visitorHash, event = 'click', section = 'all-deals', now = new Date() }) {
      if (!/^[1-9]\d{0,15}$/.test(String(dealId)) || !/^[a-f0-9]{64}$/.test(visitorHash)) throw new TypeError('invalid click');
      if (!['click', 'impression'].includes(event) || !SECTIONS.has(section)) throw new TypeError('invalid event');
      const insertMarker = randomUUID();
      const day = koreaDay(now);
      const statement = event === 'click'
        ? `INSERT INTO deal_clicks (deal_id, visitor_hash, clicked_at, insert_marker)
        SELECT d.id, $2::text, $3::timestamptz, $5::text FROM deals d LEFT JOIN manual_deals m ON m.deal_id = d.id
        WHERE d.id = $1 AND d.is_ended = FALSE
          AND (d.source <> 'toss' OR d.last_seen_at >= $4)
          AND (d.source <> 'manual' OR m.is_published = TRUE)
        ON CONFLICT (deal_id, visitor_hash) DO NOTHING RETURNING insert_marker`
        : `INSERT INTO deal_impressions (day, deal_id, visitor_hash, section, seen_at)
        SELECT $5::date, d.id, $2::text, $6::text, $3::timestamptz FROM deals d LEFT JOIN manual_deals m ON m.deal_id = d.id
        WHERE d.id = $1 AND d.is_ended = FALSE
          AND (d.source <> 'toss' OR d.last_seen_at >= $4)
          AND (d.source <> 'manual' OR m.is_published = TRUE)
        ON CONFLICT (day, deal_id, visitor_hash, section) DO NOTHING RETURNING visitor_hash AS insert_marker`;
      const values = event === 'click'
        ? [dealId, visitorHash, now.toISOString(), new Date(now.getTime()-TOSS_FRESHNESS_MS).toISOString(), insertMarker]
        : [dealId, visitorHash, now.toISOString(), new Date(now.getTime()-TOSS_FRESHNESS_MS).toISOString(), day, section];
      const result = await pool.query(statement, values);
      const inserted = event === 'click'
        ? result.rows.some(row => row.insert_marker === insertMarker)
        : result.rows.length > 0;
      if (inserted) {
        await pool.query(`INSERT INTO deal_daily_metrics (day, deal_id, section, impressions, clicks)
          VALUES ($1::date,$2,$3,$4,$5)
          ON CONFLICT (day,deal_id,section) DO UPDATE SET
            impressions=deal_daily_metrics.impressions+EXCLUDED.impressions,
            clicks=deal_daily_metrics.clicks+EXCLUDED.clicks`,
        [day, dealId, section, event === 'impression' ? 1 : 0, event === 'click' ? 1 : 0]);
      }
      if (now.getTime() - purgedAt > 3600000) {
        await pool.query('DELETE FROM deal_clicks WHERE clicked_at < $1', [new Date(now.getTime()-48*3600000).toISOString()]);
        purgedAt = now.getTime();
      }
      return inserted;
    },
  };
}

function createDealClicksRouter({ store, secret, now = () => new Date() }) {
  const key = Buffer.from(String(secret || ''));
  if (key.length < 32) throw new TypeError('analytics secret is required');
  const router = express.Router();
  const rates = new Map();
  router.get('/meta-eligibility', (req, res) => {
    const agent = String(req.get('user-agent') || '');
    res.set('Cache-Control', 'no-store');
    return res.json({ eligible: Boolean(agent) && !BOT_PATTERN.test(agent)
      && !adminCookie.isValid(req.get('cookie'), key, now()) });
  });
  router.post('/', async (req, res) => {
    const at = now();
    const agent = String(req.get('user-agent') || '');
    let sameOrigin = false;
    try { sameOrigin = new URL(req.get('origin')).origin === `${req.protocol}://${req.get('host')}`; } catch {}
    if (!sameOrigin || !agent || BOT_PATTERN.test(agent) || /prefetch|prerender/i.test(req.get('purpose') || '')) return res.sendStatus(204);
    const body = req.body || {};
    const allowedKeys = new Set(['dealId', 'event', 'section', 'position']);
    if (Object.keys(body).some((key) => !allowedKeys.has(key))
        || !/^[1-9]\d{0,15}$/.test(String(body.dealId))
        || !['click', 'impression'].includes(body.event || 'click')
        || !SECTIONS.has(body.section || 'all-deals')
        || !Number.isInteger(body.position ?? 1) || (body.position ?? 1) < 1 || (body.position ?? 1) > 100) return res.sendStatus(400);
    const cookie = req.get('cookie');
    if (adminCookie.isValid(cookie, key, at)) return res.sendStatus(204);
    const day = koreaDay(at);
    const visitor = cookieVisitor(cookie, key, day);
    if (!visitor) return res.sendStatus(204);
    const visitorHash = createHash('sha256').update(`deal-click-v1\0${day}\0${visitor}`).digest('hex');
    for (const [id, value] of rates) if (at.getTime() - value.at > 60000) rates.delete(id);
    if (!rates.has(visitorHash) && rates.size >= 10000) return res.sendStatus(204);
    const rate = rates.get(visitorHash) || { at: at.getTime(), count: 0 };
    if (++rate.count > 30) return res.sendStatus(204);
    rates.set(visitorHash, rate);
    try { await store.record({ dealId: String(body.dealId), visitorHash, event: body.event || 'click', section: body.section || 'all-deals', now: at }); }
    catch { /* Tracking must never interrupt the original affiliate link. */ }
    return res.sendStatus(204);
  });
  return router;
}
module.exports = { createDealClickStore, createDealClicksRouter };
