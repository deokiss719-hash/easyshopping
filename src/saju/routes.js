'use strict';
const express = require('express');
const path = require('node:path');
const { calculate, ZONES } = require('./calculator');
const { generate } = require('./report');
const { token } = require('./store');
const { createPayments, paymentConfig } = require('./payments');
const { freeOffer } = require('./offer');
const ROOT = path.join(__dirname, '../../public/saju');
function createSajuRouter({ store, auth, env = process.env, provider }) {
  const router = express.Router(),
    config = paymentConfig(env),
    payments = createPayments(store, config, provider);
  const seller = {
    name: env.SAJU_SELLER_NAME || '',
    representative: env.SAJU_SELLER_REPRESENTATIVE || '',
    registration: env.SAJU_SELLER_REGISTRATION || '',
    commerce: env.SAJU_SELLER_COMMERCE || '',
    address: env.SAJU_SELLER_ADDRESS || '',
    contact: env.SAJU_SELLER_CONTACT || '',
  };
  const beta = env.SAJU_ACCESS_MODE !== 'paid';
  const sellerReady = Object.values(seller).every(Boolean);
  const base = env.SAJU_PUBLIC_ORIGIN || 'https://easyshoopping.com';
  const cookie = (res, name, value, seconds) =>
    res.append(
      'Set-Cookie',
      `${name}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${seconds}${base.startsWith('https:') ? '; Secure' : ''}`,
    );
  const cookies = (req) =>
    Object.fromEntries(
      String(req.headers.cookie || '')
        .split(';')
        .map((s) => s.trim().split('=')),
    );
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const protect = (req, res, next) => {
    if (['GET', 'HEAD'].includes(req.method)) return next();
    if (req.get('origin') !== base || req.get('X-Saju-Request') !== '1')
      return res.status(403).json({ error: '요청 출처를 확인할 수 없어요.' });
    next();
  };
  router.use(['/saju', '/api/saju', '/api/admin/saju'], (req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self' https://js.tosspayments.com; connect-src 'self' https://*.tosspayments.com; frame-src https://*.tosspayments.com https://*.toss.im; img-src 'self' data: https://*.tosspayments.com; style-src 'self'; form-action 'self' https://*.tosspayments.com; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
    });
    next();
  });
  router.get(['/saju', '/saju/', '/saju/success', '/saju/fail', '/saju/recover'], (_req, res) =>
    res.sendFile(path.join(ROOT, 'index.html')),
  );
  router.get('/saju/fonts/NanumMyeongjo-Regular.ttf', (_req, res) =>
    res.sendFile(path.join(ROOT, 'fonts', 'NanumMyeongjo-Regular.ttf')),
  );
  router.get('/saju/method', (_req, res) => res.sendFile(path.join(ROOT, 'method.html')));
  router.get(
    '/saju/admin',
    auth?.requireAuth || ((_req, res) => res.sendStatus(401)),
    (_req, res) => res.sendFile(path.join(ROOT, 'admin.html')),
  );
  router.get('/saju/:asset', (req, res, next) =>
    ['app.js', 'style.css', 'admin.js', 'reading-motion.js', 'payment-options.js'].includes(req.params.asset)
      ? res.sendFile(path.join(ROOT, req.params.asset))
      : next(),
  );
  router.use(
    '/api/saju',
    protect,
    wrap(async (req, res, next) => {
      if (!(await store.limit('all:' + req.ip, 200, 600)))
        return res.status(429).json({ error: '요청이 많아요. 잠시 후 다시 시도해 주세요.' });
      next();
    }),
  );
  router.get(
    '/api/saju/config',
    wrap(async (req, res) => {
      let owner = cookies(req).saju_owner;
      if (!/^[\w-]{43}$/.test(owner || '')) {
        owner = token();
      }
      cookie(res, 'saju_owner', owner, 3600);
      const s = await store.settings();
      res.json({
        price: beta ? null : s.price,
        accessMode: beta ? 'beta' : 'paid',
        freeSections: s.free_sections,
        version: s.report_version,
        mode: config.mode,
        clientKey: config.clientKey,
        canPay: !beta && (config.mode !== 'live' || (s.sales_enabled && sellerReady)),
        seller,
        zones: ZONES,
      });
    }),
  );
  router.post(
    '/api/saju/events',
    wrap(async (req, res) => {
      if (!['visit', 'input_start'].includes(req.body?.event)) return res.sendStatus(400);
      if (await store.limit(`event:${req.ip}:${req.body.event}`, 8, 600))
        await store.event(req.body.event, config.mode);
      res.sendStatus(204);
    }),
  );
  router.post(
    '/api/saju/reports',
    wrap(async (req, res) => {
      const owner = cookies(req).saju_owner;
      if (!/^[\w-]{43}$/.test(owner || '') || req.body?.consent !== true)
        throw new TypeError('개인정보 처리 안내를 확인해 주세요.');
      if (!(await store.limit('calculate:' + req.ip, 12, 3600)))
        return res.status(429).json({ error: '한 시간에 12회까지 분석할 수 있어요.' });
      const settings = await store.settings(),
        chart = calculate(req.body),
        report = generate(chart, settings.report_version);
      const result = await store.create({ chart, report }, owner, { betaAccess: beta });
      await store.event('input_complete', config.mode);
      res.status(201).json({ ...result, link: base + '/saju/recover#' + result.link });
    }),
  );
  async function authorize(req) {
    const c = cookies(req);
    const r = await store.authorized(req.params.id, c.saju_owner, c.saju_view);
    if (!r) {
      const e = new TypeError(
        '보고서가 만료되었거나 접근 권한이 없어요. 복구 코드를 이용해 주세요.',
      );
      e.status = 404;
      throw e;
    }
    return r;
  }
  router.get(
    '/api/saju/reports/:id',
    wrap(async (req, res) => {
      const r = await authorize(req),
        { chart, report } = store.crypt.open(r.payload),
        settings = await store.settings();
      const order = await store.one(
        'SELECT id,amount,mode,status,paid_at,refund_requested_at FROM saju_orders WHERE report_id=$1 ORDER BY created_at DESC LIMIT 1',
        [r.id],
      );
      if (!r.paid && (await store.limit('preview:' + r.id, 1, 86400)))
        await store.event('preview', config.mode);
      res.json({
        id: r.id,
        paid: r.paid,
        fullAccess: beta || r.beta_access || r.paid,
        accessMode: (beta || r.beta_access) ? 'beta' : 'paid',
        name: chart.input.name,
        expiresAt: r.expires_at,
        order,
        chart: {
          version: chart.version,
          solarDate: chart.solarDate,
          pillars: chart.pillars,
          elements: chart.elements,
          yinYang: chart.yinYang,
          visibleCount: chart.visibleCount,
          warnings: chart.warnings,
        },
        report: (beta || r.beta_access || r.paid) ? report : freeOffer(report, chart, settings.free_sections),
      });
    }),
  );
  router.post(
    '/api/saju/recover',
    wrap(async (req, res) => {
      if (!(await store.limit('recover:' + req.ip, 5, 900)))
        return res.status(429).json({ error: '복구 시도가 많아요. 15분 후 다시 시도해 주세요.' });
      if (!/^[\w-]{43}$/.test(req.body?.code || ''))
        throw new TypeError('조회 링크 또는 복구 코드를 확인해 주세요.');
      const r = await store.recover(req.body.code, req.body.isLink === true);
      if (!r)
        return res
          .status(404)
          .json({ error: '만료되었거나 이미 사용한 링크예요. 복구 코드를 이용해 주세요.' });
      cookie(res, 'saju_view', r.session, 3600);
      res.json({ id: r.id, link: base + '/saju/recover#' + r.link });
    }),
  );
  router.post(
    '/api/saju/reports/:id/link',
    wrap(async (req, res) => {
      await authorize(req);
      res.json({ link: base + '/saju/recover#' + (await store.reissue(req.params.id)) });
    }),
  );
  router.delete(
    '/api/saju/reports/:id',
    wrap(async (req, res) => {
      await authorize(req);
      await store.erase(req.params.id);
      res.sendStatus(204);
    }),
  );
  router.post(
    '/api/saju/reports/:id/orders',
    wrap(async (req, res) => {
      if (beta) return res.status(409).json({error:'전체 무료 베타에서는 주문을 만들지 않습니다.'});
      const r = await authorize(req),
        s = await store.settings();
      if (r.beta_access) return res.status(409).json({error:'무료 베타로 발급된 보고서는 결제하지 않아도 열람할 수 있어요.'});
      if (req.body?.terms !== true || req.body?.recoverySaved !== true)
        throw new TypeError('가격·환불·복구 안내 확인과 복구 코드 저장이 필요해요.');
      if (config.mode === 'live' && (!s.sales_enabled || !sellerReady))
        return res.status(503).json({ error: '실결제 판매 준비 중이에요.' });
      const o = await store.order(r, s.price, config.mode);
      await store.event('checkout', config.mode);
      res.json({
        id: o.id,
        amount: o.amount,
        status: o.status,
        mode: o.mode,
        clientKey: config.clientKey,
        successUrl: base + '/saju/success',
        failUrl: base + '/saju/fail',
      });
    }),
  );
  async function orderAuth(req) {
    const o = await store.one('SELECT * FROM saju_orders WHERE id=$1', [req.params.order]);
    if (!o) throw new TypeError('주문을 찾을 수 없어요.');
    req.params.id = o.report_id;
    await authorize(req);
    return o;
  }
  router.post(
    '/api/saju/orders/:order/confirm',
    wrap(async (req, res) => {
      if (beta) return res.status(409).json({error:'전체 무료 베타에서는 구매 승인을 진행하지 않습니다.'});
      const o = await orderAuth(req);
      const key = config.mode === 'demo' ? 'demo_' + o.id : req.body.paymentKey;
      if (typeof key !== 'string' || key.length > 200 || !key)
        throw new TypeError('결제 정보를 확인해 주세요.');
      res.json(await payments.confirm(o.id, key, req.body.amount));
    }),
  );
  router.post(
    '/api/saju/orders/:order/recheck',
    wrap(async (req, res) => {
      const o = await orderAuth(req);
      res.json(await payments.reconcile(o.id));
    }),
  );
  router.post(
    '/api/saju/orders/:order/fail',
    wrap(async (req, res) => {
      const o = await orderAuth(req);
      await store.pool.query(
        "UPDATE saju_orders SET status='failed' WHERE id=$1 AND status='pending' AND payment_key IS NULL",
        [o.id],
      );
      res.json({ reportId: o.report_id });
    }),
  );
  router.post(
    '/api/saju/orders/:order/refund',
    wrap(async (req, res) => {
      const o = await orderAuth(req);
      if (!['paid', 'refund_requested', 'refunding', 'refunded'].includes(o.status))
        throw new TypeError('결제 완료 주문만 환불 신청할 수 있어요.');
      await store.pool.query(
        "UPDATE saju_orders SET status='refund_requested',refund_requested_at=NOW() WHERE id=$1 AND status='paid'",
        [o.id],
      );
      if (o.paid_at && Date.now() - new Date(o.paid_at).getTime() <= 7 * 86400000)
        return res.json(await payments.refund(o.id));
      res.json({ status: 'refund_requested' });
    }),
  );
  // A webhook is only a hint. Query the PSP using server credentials before changing entitlement.
  router.post(
    '/saju/payment-webhook',
    wrap(async (req, res) => {
      const key = req.body?.data?.paymentKey;
      if (typeof key !== 'string' || key.length > 200) return res.sendStatus(400);
      if (!(await store.limit('webhook:' + req.ip, 30, 60))) return res.sendStatus(429);
      const o = await store.one('SELECT id FROM saju_orders WHERE payment_key=$1', [key]);
      if (o) await payments.reconcile(o.id);
      res.sendStatus(204);
    }),
  );
  if (auth) {
    router.use('/api/admin/saju', auth.requireAuth);
    router.get(
      '/api/admin/saju',
      wrap(async (_req, res) => res.json({ ...(await store.dashboard()), mode: config.mode, accessMode: beta ? 'beta' : 'paid' })),
    );
    router.patch(
      '/api/admin/saju/settings',
      auth.requireMutationProtection,
      wrap(async (req, res) => res.json(await store.updateSettings(req.body))),
    );
    router.post(
      '/api/admin/saju/orders/:order/refund',
      auth.requireMutationProtection,
      wrap(async (req, res) => res.json(await payments.refund(req.params.order))),
    );
    router.post(
      '/api/admin/saju/orders/:order/recheck',
      auth.requireMutationProtection,
      wrap(async (req, res) => res.json(await payments.reconcile(req.params.order))),
    );
  }
  router.use(['/saju', '/api/saju', '/api/admin/saju'], (_req, res) =>
    res.status(404).json({ error: 'not_found' }),
  );
  router.use((error, _req, res, _next) => {
    res
      .status(error instanceof TypeError ? error.status || 422 : 503)
      .json({
        error:
          error instanceof TypeError
            ? error.message
            : '처리를 완료하지 못했어요. 잠시 후 같은 화면에서 다시 시도해 주세요.',
      });
  });
  return { router, payments };
}
module.exports = { createSajuRouter };
