const express = require('express');
const { randomBytes } = require('node:crypto');
const STATUSES = ['new', 'consulting', 'reserved', 'completed', 'absent', 'closed'];
function normalize(input = {}) {
  const text = (key, max) => { const value = String(input[key] || '').trim(); if (value.length > max) throw new TypeError('입력 내용이 너무 길어요.'); return value; };
  const model = text('model', 300), carrier = text('carrier', 20), changeType = text('changeType', 20), method = text('method', 10);
  const customerName = text('customerName', 100);
  if (!customerName) throw new TypeError('고객 이름을 입력해 주세요.');
  const phone = text('phone', 30).replace(/[-\s]/g, ''), preferredTime = text('preferredTime', 100);
  if (!model || !['SKT','KT','LG U+','알뜰폰','모름'].includes(carrier) || !['번호이동','기기변경','상담 후 결정'].includes(changeType) || !['phone','kakao'].includes(method)) throw new TypeError('기종과 상담 조건을 확인해 주세요.');
  if (input.privacyConsent !== true) throw new TypeError('상담을 위한 개인정보 수집·이용에 동의해 주세요.');
  if (!/^01[016789]\d{7,8}$/.test(phone) || (method === 'phone' && !preferredTime)) throw new TypeError('연락처와 통화 가능한 시간을 확인해 주세요.');
  return { customerName, model, carrier, changeType, method, phone, preferredTime: method === 'phone' ? preferredTime : '' };
}
function createPhoneStore(pool) {
  return {
    async create(input) {
      const v = normalize(input), id = 'P' + randomBytes(8).toString('hex').toUpperCase();
      await pool.query('INSERT INTO phone_inquiries(id,model,carrier,change_type,method,phone,preferred_time,customer_name,consent_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id,v.model,v.carrier,v.changeType,v.method,v.phone,v.preferredTime,v.customerName,'2026-09-23']);
      return { id };
    },
    async list() { return (await pool.query('SELECT * FROM phone_inquiries ORDER BY created_at DESC LIMIT 500')).rows; },
    async update(id, input = {}) {
      if (!STATUSES.includes(input.status) || typeof input.note !== 'string' || input.note.length > 2000) throw new TypeError('상태와 상담 메모를 확인해 주세요.');
      return (await pool.query('UPDATE phone_inquiries SET status=$1,admin_note=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3 RETURNING *', [input.status,input.note,id])).rows[0];
    },
    async remove(id) { return (await pool.query('DELETE FROM phone_inquiries WHERE id=$1 RETURNING id',[id])).rows[0]; },
    async purge() { await pool.query("DELETE FROM phone_inquiries WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '90 days'"); },
  };
}
function createPhoneRouter({ store, adminStore, auth }) {
  const router = express.Router();
  const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(e => e instanceof TypeError ? res.status(400).json({message:e.message}) : next(e));
  const recent = new Map();
  router.post('/api/phone-inquiries', wrap(async (req,res) => {
    if (req.get('sec-fetch-site') === 'cross-site' || (req.get('origin') && req.get('origin') !== `${req.protocol}://${req.get('host')}`)) return res.sendStatus(403);
    if (req.body?.website) return res.status(400).json({message:'입력 내용을 확인해 주세요.'});
    const now = Date.now(); for (const [key,time] of recent) if (now-time > 60000) recent.delete(key);
    if (recent.has(req.ip)) return res.status(429).json({message:'이미 접수했거나 요청이 너무 빨라요. 잠시 후 다시 시도해 주세요.'});
    const input = normalize(req.body);
    if (input.method === 'kakao' && !(await adminStore.getSettings()).phone_consultation_url) return res.status(400).json({message:'현재 전화 상담으로 접수할 수 있어요.'});
    recent.set(req.ip, now);
    try { res.status(201).json(await store.create(req.body)); } catch(e) { recent.delete(req.ip); throw e; }
  }));
  if (auth) {
    router.get('/api/admin/phone-inquiries', auth.requireAuth, wrap(async (_req,res) => { res.set('Cache-Control','no-store'); res.json({inquiries:await store.list()}); }));
    router.patch('/api/admin/phone-inquiries/:id', auth.requireAuth, auth.requireMutationProtection, wrap(async (req,res) => { const row=await store.update(req.params.id,req.body); row ? res.json(row) : res.sendStatus(404); }));
    router.delete('/api/admin/phone-inquiries/:id', auth.requireAuth, auth.requireMutationProtection, wrap(async (req,res) => { const row=await store.remove(req.params.id); row ? res.sendStatus(204) : res.sendStatus(404); }));
  }
  return router;
}
module.exports = { normalize, createPhoneStore, createPhoneRouter };
