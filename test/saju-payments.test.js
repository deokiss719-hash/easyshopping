const { test } = require('node:test');
const assert = require('node:assert/strict');
const { testPool } = require('./helpers/saju-db');
const { createStore, token, encryption } = require('../src/saju/store');
const { createPayments, paymentConfig } = require('../src/saju/payments');
const key = 's'.repeat(64);
async function fixture(t, provider, mode = 'demo') {
  const pool = await testPool();
  t.after(() => pool.end());
  const store = await createStore(pool, key);
  const owner = token(),
    created = await store.create(
      { chart: { date: '1990-01-01' }, report: { text: 'private' } },
      owner,
    );
  const r = await store.authorized(created.id, owner);
  const order = await store.order(r, 6900, mode);
  return {
    pool,
    store,
    owner,
    created,
    r,
    order,
    payments: createPayments(store, { mode }, provider),
  };
}
test('encryption integrity and no plaintext birth details', () => {
  const c = encryption(key),
    v = { date: '1990-01-01' },
    encrypted = c.seal(v);
  assert.ok(!encrypted.includes(v.date));
  assert.deepEqual(c.open(encrypted), v);
  assert.throws(() => encryption('x'.repeat(64)).open(encrypted));
});
test('amount tampering never unlocks; duplicate concurrent confirmations count once', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.payments.confirm(f.order.id, 'demo_key', 1));
  let r = await f.store.authorized(f.r.id, f.owner);
  assert.equal(r.paid, false);
  const results = await Promise.all(
    Array.from({ length: 4 }, () => f.payments.confirm(f.order.id, 'demo_key', 6900)),
  );
  assert.ok(results.every((x) => x.status === 'paid'));
  r = await f.store.authorized(f.r.id, f.owner);
  assert.equal(r.paid, true);
  assert.equal((await f.store.one("SELECT count FROM saju_events WHERE event='paid'")).count, 1);
  await assert.rejects(f.payments.confirm(f.order.id, 'other', 6900));
});
test('PSP mismatch / network uncertainty stays locked then reconciliation recovers same order', async (t) => {
  let called = 0;
  const provider = {
    lookup: async () => {
      if (!called++) throw Error('timeout');
      return {
        paymentKey: 'provider-key',
        orderId: f.order.id,
        totalAmount: 6900,
        balanceAmount: 6900,
        currency: 'KRW',
        status: 'DONE',
      };
    },
  };
  const f = await fixture(t, provider, 'test');
  assert.equal((await f.payments.confirm(f.order.id, 'provider-key', 6900)).status, 'confirming');
  assert.equal((await f.store.authorized(f.r.id, f.owner)).paid, false);
  assert.equal((await f.payments.reconcile(f.order.id)).status, 'paid');
});
test('wrong PSP amount does not grant entitlement', async (t) => {
  const f = await fixture(
    t,
    {
      lookup: async () => ({
        status: 'DONE',
        orderId: f.order.id,
        paymentKey: 'k',
        totalAmount: 1,
        balanceAmount: 1,
        currency: 'KRW',
      }),
    },
    'test',
  );
  await f.payments.confirm(f.order.id, 'k', 6900);
  assert.equal((await f.store.authorized(f.r.id, f.owner)).paid, false);
});
test('refund is idempotent, revokes entitlement, counts once', async (t) => {
  const f = await fixture(t);
  await f.payments.confirm(f.order.id, 'k', 6900);
  await Promise.all([f.payments.refund(f.order.id), f.payments.refund(f.order.id)]);
  assert.equal((await f.store.authorized(f.r.id, f.owner)).paid, false);
  assert.equal((await f.store.one("SELECT count FROM saju_events WHERE event='refund'")).count, 1);
});
test('private link one-use, recovery rotates sessions, unauthorized denied, deletion revokes all', async (t) => {
  const f = await fixture(t);
  assert.equal(await f.store.authorized(f.r.id, 'stranger'), undefined);
  const a = await f.store.recover(f.created.link, true);
  assert.ok(a);
  assert.equal(await f.store.recover(f.created.link, true), null);
  const b = await f.store.recover(f.created.recovery, false);
  assert.ok(b);
  assert.equal(await f.store.authorized(f.r.id, '', a.session), undefined);
  assert.ok(await f.store.authorized(f.r.id, '', b.session));
  await f.store.erase(f.r.id);
  assert.equal(await f.store.recover(f.created.recovery, false), null);
  assert.equal(
    (await f.store.one('SELECT payload FROM saju_reports WHERE id=$1', [f.r.id])).payload,
    null,
  );
});
test('expiry cleanup and rate limits enforce retention', async (t) => {
  const f = await fixture(t);
  await f.pool.query("UPDATE saju_reports SET expires_at=NOW()-INTERVAL '1 day' WHERE id=$1", [
    f.r.id,
  ]);
  assert.equal(await f.store.authorized(f.r.id, f.owner), undefined);
  await f.store.purge();
  assert.equal(
    (await f.store.one('SELECT payload FROM saju_reports WHERE id=$1', [f.r.id])).payload,
    null,
  );
  assert.equal(await f.store.limit('test', 1, 60), true);
  assert.equal(await f.store.limit('test', 1, 60), false);
});
test('price changes do not mutate a checkout; one open order per report', async (t) => {
  const f = await fixture(t);
  const next = await f.store.order(f.r, 9900, 'demo');
  assert.equal(next.id, f.order.id);
  assert.equal(next.amount, 6900);
});
test('test/live key mismatches fail closed', () => {
  assert.equal(paymentConfig({}).mode, 'demo');
  assert.throws(() =>
    paymentConfig({
      SAJU_PAYMENT_MODE: 'live',
      SAJU_TOSS_CLIENT_KEY: 'test_ck_a',
      SAJU_TOSS_SECRET_KEY: 'test_sk_b',
    }),
  );
});
