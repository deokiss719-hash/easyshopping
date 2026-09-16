const express = require('express');
const { createHash } = require('node:crypto');
const { cookieVisitor, koreaDay, BOT_PATTERN } = require('./traffic-analytics');
const adminCookie = require('./admin/admin-traffic-cookie');

const PLACEMENTS = new Set(['hero', 'middle', 'mobile']);
const EVENTS = new Set(['impression', 'click']);

function createCtaEventStore(pool) {
  return {
    async record({ day, visitorHash, placement, event }) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^[a-f0-9]{64}$/.test(visitorHash)
          || !PLACEMENTS.has(placement) || !EVENTS.has(event)) throw new TypeError('invalid CTA event');
      const result = await pool.query(`INSERT INTO cta_daily_events (day,visitor_hash,placement,event)
        VALUES ($1::date,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING visitor_hash`,
      [day, visitorHash, placement, event]);
      return result.rows.length > 0;
    },
  };
}

function createCtaEventsRouter({ store, secret, now = () => new Date() }) {
  const key = Buffer.from(String(secret || ''));
  if (!store?.record || key.length < 32) throw new TypeError('CTA analytics configuration is required');
  const router = express.Router();
  router.post('/', async (req, res) => {
    const at = now();
    const agent = String(req.get('user-agent') || '');
    let sameOrigin = false;
    try { sameOrigin = new URL(req.get('origin')).origin === `${req.protocol}://${req.get('host')}`; } catch {}
    const { placement, event } = req.body || {};
    if (!sameOrigin || !agent || BOT_PATTERN.test(agent) || !PLACEMENTS.has(placement) || !EVENTS.has(event)) return res.sendStatus(204);
    if (adminCookie.isValid(req.get('cookie'), key, at)) return res.sendStatus(204);
    const day = koreaDay(at);
    const visitor = cookieVisitor(req.get('cookie'), key, day);
    if (!visitor) return res.sendStatus(204);
    const visitorHash = createHash('sha256').update(`cta-event-v1\0${day}\0${visitor}`).digest('hex');
    try { await store.record({ day, visitorHash, placement, event }); } catch { return res.sendStatus(204); }
    return res.sendStatus(204);
  });
  return router;
}

module.exports = { createCtaEventStore, createCtaEventsRouter };
