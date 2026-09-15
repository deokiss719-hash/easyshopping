const express = require('express');
const { createHash, randomUUID } = require('node:crypto');
const { cookieVisitor, koreaDay, BOT_PATTERN } = require('./traffic-analytics');
const adminCookie = require('./admin/admin-traffic-cookie');

function createDealClickStore(pool) {
  let purgedAt = 0;
  return {
    async record({ dealId, visitorHash, now = new Date() }) {
      if (!/^[1-9]\d{0,15}$/.test(String(dealId)) || !/^[a-f0-9]{64}$/.test(visitorHash)) throw new TypeError('invalid click');
      const insertMarker = randomUUID();
      const result = await pool.query(`INSERT INTO deal_clicks (deal_id, visitor_hash, clicked_at, insert_marker)
        SELECT d.id, $2::text, $3::timestamptz, $5::text FROM deals d LEFT JOIN manual_deals m ON m.deal_id = d.id
        WHERE d.id = $1 AND d.is_ended = FALSE
          AND (d.source <> 'toss' OR d.last_seen_at >= $4)
          AND (d.source <> 'manual' OR m.is_published = TRUE)
        ON CONFLICT (deal_id, visitor_hash) DO NOTHING RETURNING insert_marker`,
      [dealId, visitorHash, now.toISOString(), new Date(now.getTime()-1800000).toISOString(), insertMarker]);
      if (now.getTime() - purgedAt > 3600000) {
        await pool.query('DELETE FROM deal_clicks WHERE clicked_at < $1', [new Date(now.getTime()-48*3600000).toISOString()]);
        purgedAt = now.getTime();
      }
      return result.rows.some(row => row.insert_marker === insertMarker);
    },
  };
}

function createDealClicksRouter({ store, secret, now = () => new Date() }) {
  const key = Buffer.from(String(secret || ''));
  if (key.length < 32) throw new TypeError('analytics secret is required');
  const router = express.Router();
  const rates = new Map();
  router.post('/', async (req, res) => {
    const at = now();
    const agent = String(req.get('user-agent') || '');
    let sameOrigin = false;
    try { sameOrigin = new URL(req.get('origin')).origin === `${req.protocol}://${req.get('host')}`; } catch {}
    if (!sameOrigin || !agent || BOT_PATTERN.test(agent) || /prefetch|prerender/i.test(req.get('purpose') || '')) return res.sendStatus(204);
    if (!req.body || Object.keys(req.body).length !== 1 || !/^[1-9]\d{0,15}$/.test(String(req.body.dealId))) return res.sendStatus(400);
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
    try { await store.record({ dealId: String(req.body.dealId), visitorHash, now: at }); }
    catch { /* Tracking must never interrupt the original affiliate link. */ }
    return res.sendStatus(204);
  });
  return router;
}
module.exports = { createDealClickStore, createDealClicksRouter };
