'use strict';
function paymentConfig(env = process.env) {
  const mode = env.SAJU_PAYMENT_MODE || 'demo';
  if (!['demo', 'test', 'live'].includes(mode)) throw Error('invalid saju payment mode');
  const clientKey = env.SAJU_TOSS_CLIENT_KEY || '',
    secretKey = env.SAJU_TOSS_SECRET_KEY || '';
  if (
    mode !== 'demo' &&
    (!clientKey.startsWith(`${mode}_ck_`) || !secretKey.startsWith(`${mode}_sk_`))
  )
    throw Error('saju payment key mode mismatch');
  return { mode, clientKey, secretKey };
}
function gateway(config, fetcher = fetch) {
  async function request(path, body, key) {
    const response = await fetcher('https://api.tosspayments.com/v1/payments' + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: 'Basic ' + Buffer.from(config.secretKey + ':').toString('base64'),
        'Content-Type': 'application/json',
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12000),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw Error('payment_response_unavailable');
    }
    if (!response.ok) {
      const error = new Error('payment_provider_error');
      error.providerCode = data.code;
      throw error;
    }
    return data;
  }
  return {
    lookup: (key) => request('/' + encodeURIComponent(key)),
    confirm: (order, key) =>
      request('/confirm', { paymentKey: key, orderId: order.id, amount: order.amount }, order.id),
    cancel: (order) =>
      request(
        '/' + encodeURIComponent(order.payment_key) + '/cancel',
        { cancelReason: '고객 환불 요청', cancelAmount: order.amount },
        'refund-' + order.id,
      ),
  };
}
function verified(payment, order, key) {
  return (
    payment?.paymentKey === key &&
    payment.orderId === order.id &&
    payment.totalAmount === order.amount &&
    payment.currency === 'KRW' &&
    payment.status === 'DONE' &&
    payment.balanceAmount === order.amount
  );
}
function createPayments(store, config, provider = gateway(config)) {
  async function locked(id, fn) {
    const db = await store.pool.connect();
    try {
      await db.query('BEGIN');
      const ref = (await db.query('SELECT report_id FROM saju_orders WHERE id=$1', [id])).rows[0];
      if (ref)
        await db.query('SELECT id FROM saju_reports WHERE id=$1 FOR UPDATE', [ref.report_id]);
      const order = (await db.query('SELECT * FROM saju_orders WHERE id=$1 FOR UPDATE', [id]))
        .rows[0];
      if (!order) throw new TypeError('주문을 찾을 수 없어요.');
      const result = await fn(db, order);
      await db.query('COMMIT');
      return result;
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    } finally {
      db.release();
    }
  }
  async function metric(db, event, mode) {
    await db.query(
      "INSERT INTO saju_events(day,event,mode,count) VALUES((NOW() AT TIME ZONE 'Asia/Seoul')::date,$1,$2,1) ON CONFLICT(day,event,mode) DO UPDATE SET count=saju_events.count+1",
      [event, mode],
    );
  }
  return {
    async confirm(id, key, amount) {
      // Persist the identity BEFORE calling the PSP, so a process crash remains recoverable.
      await locked(id, async (db, o) => {
        if (o.amount !== amount || o.mode !== config.mode)
          throw new TypeError('주문 금액 또는 결제 환경이 일치하지 않아요.');
        if (o.status === 'pending') {
          const active = (
            await db.query(
              'SELECT id FROM saju_reports WHERE id=$1 AND deleted_at IS NULL AND expires_at>NOW() FOR UPDATE',
              [o.report_id],
            )
          ).rows[0];
          if (!active) throw new TypeError('보고서가 만료되었어요.');
          await db.query("UPDATE saju_orders SET status='confirming',payment_key=$2 WHERE id=$1", [
            id,
            key,
          ]);
        }
      });
      return locked(id, async (db, o) => {
        if (o.amount !== amount || o.mode !== config.mode)
          throw new TypeError('주문 금액 또는 결제 환경이 일치하지 않아요.');
        if (['paid', 'refund_requested'].includes(o.status)) {
          if (o.payment_key !== key) throw new TypeError('이미 처리된 주문이에요.');
          return { status: o.status, reportId: o.report_id };
        }
        if (!['pending', 'confirming'].includes(o.status))
          throw new TypeError('승인할 수 없는 주문이에요.');
        if (o.payment_key && o.payment_key !== key)
          throw new TypeError('다른 결제 정보로 재요청할 수 없어요.');
        const accessible = (
          await db.query(
            'SELECT id FROM saju_reports WHERE id=$1 AND deleted_at IS NULL AND expires_at>NOW()',
            [o.report_id],
          )
        ).rows[0];
        let payment;
        if (config.mode === 'demo')
          payment = {
            paymentKey: key,
            orderId: o.id,
            totalAmount: o.amount,
            balanceAmount: o.amount,
            currency: 'KRW',
            status: 'DONE',
          };
        else {
          try {
            payment = await provider.lookup(key);
            if ((payment.status === 'IN_PROGRESS' || payment.status === 'READY') && accessible)
              payment = await provider.confirm(o, key);
          } catch (e) {
            // A missing lookup can still be a valid newly authenticated payment; never change the idempotency key.
            if (e.providerCode === 'NOT_FOUND_PAYMENT' && accessible) {
              try {
                payment = await provider.confirm(o, key);
              } catch {
                /* preserve uncertain state below */
              }
            }
          }
        }
        if (
          payment?.orderId === o.id &&
          payment.paymentKey === key &&
          ['ABORTED', 'EXPIRED', 'CANCELED'].includes(payment.status)
        ) {
          await db.query("UPDATE saju_orders SET status='failed' WHERE id=$1", [o.id]);
          return {
            status: 'failed',
            reportId: o.report_id,
            message: '결제가 취소되었거나 만료되었어요. 다시 결제할 수 있어요.',
          };
        }
        if (!verified(payment, o, key)) {
          await db.query("UPDATE saju_orders SET status='confirming',payment_key=$2 WHERE id=$1", [
            o.id,
            key,
          ]);
          return {
            status: 'confirming',
            message:
              '승인 상태를 확인 중이에요. 새 결제를 시작하지 말고 같은 주문의 승인 확인을 다시 눌러 주세요.',
          };
        }
        const active = (
          await db.query(
            'SELECT id FROM saju_reports WHERE id=$1 AND deleted_at IS NULL AND expires_at>NOW() FOR UPDATE',
            [o.report_id],
          )
        ).rows[0];
        if (!active) {
          await db.query(
            "UPDATE saju_orders SET status='refunding',paid_at=COALESCE(paid_at,NOW()) WHERE id=$1",
            [o.id],
          );
          return {
            status: 'refunding',
            message: '보고서 보관 기한이 지나 승인된 결제를 자동 환불 처리하고 있어요.',
          };
        }
        await db.query(
          "UPDATE saju_orders SET status='paid',payment_key=$2,paid_at=NOW() WHERE id=$1",
          [o.id, key],
        );
        await db.query(
          "UPDATE saju_reports SET paid=TRUE,expires_at=NOW()+INTERVAL '1 year' WHERE id=$1",
          [o.report_id],
        );
        await metric(db, 'paid', o.mode);
        return { status: 'paid', reportId: o.report_id };
      });
    },
    async refund(id) {
      await store.pool.query(
        "UPDATE saju_orders SET status='refunding' WHERE id=$1 AND status IN ('paid','refund_requested')",
        [id],
      );
      return locked(id, async (db, o) => {
        if (o.status === 'refunded') return { status: 'refunded' };
        if (!['paid', 'refund_requested', 'refunding'].includes(o.status))
          throw new TypeError('환불할 수 없는 주문 상태예요.');
        let payment;
        if (o.mode === 'demo')
          payment = {
            status: 'CANCELED',
            orderId: o.id,
            totalAmount: o.amount,
            paymentKey: o.payment_key,
            balanceAmount: 0,
          };
        else {
          if (o.mode !== config.mode)
            throw new TypeError('해당 주문과 같은 결제 환경의 키가 필요해요.');
          try {
            payment = await provider.lookup(o.payment_key);
            if (payment.status === 'DONE') payment = await provider.cancel(o);
          } catch {
            /* retain refunding for reconciliation */
          }
        }
        if (
          payment?.status !== 'CANCELED' ||
          payment.orderId !== o.id ||
          payment.totalAmount !== o.amount ||
          payment.balanceAmount !== 0 ||
          payment.paymentKey !== o.payment_key
        ) {
          await db.query("UPDATE saju_orders SET status='refunding' WHERE id=$1", [o.id]);
          return { status: 'refunding' };
        }
        await db.query("UPDATE saju_orders SET status='refunded',refunded_at=NOW() WHERE id=$1", [
          o.id,
        ]);
        await db.query('UPDATE saju_reports SET paid=FALSE WHERE id=$1', [o.report_id]);
        await metric(db, 'refund', o.mode);
        return { status: 'refunded' };
      });
    },
    async reconcile(id) {
      const o = await store.one('SELECT * FROM saju_orders WHERE id=$1', [id]);
      if (!o?.payment_key) return { status: o?.status };
      if (o.status === 'refunding') return this.refund(id);
      if (o.status === 'confirming') return this.confirm(id, o.payment_key, o.amount);
      if (['paid', 'refund_requested'].includes(o.status) && o.mode !== 'demo') {
        const p = await provider.lookup(o.payment_key);
        if (
          p.orderId === o.id &&
          p.totalAmount === o.amount &&
          p.status === 'CANCELED' &&
          p.balanceAmount === 0
        )
          return this.refund(id);
      }
      return { status: o.status };
    },
  };
}
module.exports = { paymentConfig, gateway, verified, createPayments };
