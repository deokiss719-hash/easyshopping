const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');

const { migrate, createDealStore } = require('../src/deal-store');
const {
  FMKOREA_ENDPOINT,
  parseFmkoreaHotdealHtml,
  runFmkoreaCollector,
  readFmkoreaRuntime,
  startFmkoreaScheduler,
} = require('../src/fmkorea-collector');

const ROW = `<li class="li li_best2_pop0 li_best2_hotdeal0 li_best2_politics0">
  <div class="li">
    <a href="/1266587813"><img class="thumb" src="//image.fmkorea.com/classes/lazy/img/transparent.gif" data-original="//image.fmkorea.com/files/item.jpg?x=1&amp;y=2"></a>
    <h3 class="title"><a href="/1266587813" class="hotdeal_var8"><span class="ellipsis-target">제목 &amp; 특가</span></a></h3>
    <div class="hotdeal_info">
      <span>쇼핑몰: <a class="strong">알리익스프레스</a></span>
      <span>가격: <a class="strong">4,743원</a></span>
      <span>배송: <a class="strong">무료</a></span>
    </div>
    <div><span class="category"><a>생활/주방</a></span><span class="regdate">19:59</span></div>
  </div>
</li>`;

function response(body = `<ul>${ROW}</ul>`, overrides = {}) {
  return {
    ok: true,
    status: 200,
    url: FMKOREA_ENDPOINT,
    redirected: false,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'text/html; charset=UTF-8' : null) },
    text: async () => body,
    ...overrides,
  };
}

function leaseStore(overrides = {}) {
  return {
    async withFmkoreaCollectionLease(worker) { return worker(); },
    async upsert() {},
    async deleteBefore() { return 0; },
    ...overrides,
  };
}

function createManualTimeouts() {
  let nextId = 0;
  const callbacks = new Map();
  return {
    setTimeoutFn(callback, timeoutMs) {
      nextId += 1;
      callbacks.set(nextId, { callback, timeoutMs });
      return nextId;
    },
    clearTimeoutFn(id) { callbacks.delete(id); },
    expireRecorder(expectedTimeoutMs) {
      const entry = [...callbacks.entries()].find(([, value]) => value.timeoutMs === expectedTimeoutMs);
      assert.ok(entry, 'expected an active recorder timeout');
      callbacks.delete(entry[0]);
      entry[1].callback();
    },
  };
}

test('FMKorea 목록의 정확한 행만 파싱하고 엔티티, 이미지, 가격과 KST 자정 롤백을 정규화한다', () => {
  const extraClassRow = ROW.replace(
    'class="li li_best2_pop0 li_best2_hotdeal0 li_best2_politics0"',
    'class="li li_best2_pop0 li_best2_hotdeal0 li_best2_politics0 extra"',
  );
  const html = `<ul>${ROW}${extraClassRow}</ul>`;
  const deals = parseFmkoreaHotdealHtml(html, new Date('2026-09-12T15:05:00.000Z'));
  assert.equal(deals.length, 1);
  assert.deepEqual(deals[0], {
    source: 'fmkorea',
    sourceItemId: '1266587813',
    title: '제목 & 특가',
    originalUrl: 'https://www.fmkorea.com/1266587813',
    merchant: '알리익스프레스',
    priceText: '4,743원',
    priceAmount: 4743,
    currency: 'KRW',
    authoritativePrice: true,
    category: '기타',
    sourceCategory: '생활/주방',
    shipping: '무료',
    sourceImageUrl: 'https://image.fmkorea.com/files/item.jpg?x=1&y=2',
    imageUrl: 'https://image.fmkorea.com/files/item.jpg?x=1&y=2',
    imageStatus: 'ready',
    imageProvider: 'fmkorea-direct',
    publishedAt: '2026-09-12T10:59:00.000Z',
    rawHash: deals[0].rawHash,
  });
  assert.match(deals[0].rawHash, /^[a-f0-9]{64}$/);
});

test('FMKorea 파서는 잘못된 행만 개별 제외하고 비정규 ID와 외부 이미지를 허용하지 않는다', () => {
  const malformed = ROW.replaceAll('1266587813', '0');
  const wrongImage = ROW.replace(
    '//image.fmkorea.com/files/item.jpg',
    '//image.fmkorea.com.evil.example/files/item.jpg',
  );
  const deals = parseFmkoreaHotdealHtml(`<ul>${malformed}${wrongImage}${ROW}</ul>`, new Date('2026-09-12T11:00:00Z'));
  assert.equal(deals.length, 2);
  assert.equal(deals[0].imageUrl, null);
  assert.equal(deals[0].imageStatus, 'missing_merchant_url');
  assert.equal(deals[1].sourceItemId, '1266587813');
});

test('가격은 명시적인 원화 형식과 정확한 무료만 숫자로 변환한다', () => {
  const priceRows = [
    ['4743', 4743],
    ['4,743원', 4743],
    ['무료', 0],
    ['US$ 12.99', null],
    ['4,74원', null],
    ['1,000원 / 2,000원', null],
    ['약 4,743원', null],
  ].map(([price], index) => ROW
    .replaceAll('1266587813', String(1266587813 + index))
    .replace('4,743원', price)).join('');
  const deals = parseFmkoreaHotdealHtml(`<ul>${priceRows}</ul>`, new Date('2026-09-12T11:00:00Z'));
  assert.equal(deals.length, 7);
  assert.deepEqual(deals.map(({ priceText, priceAmount, currency }) => [priceText, priceAmount, currency]), [
    ['4743', 4743, 'KRW'],
    ['4,743원', 4743, 'KRW'],
    ['무료', 0, 'KRW'],
    ['US$ 12.99', null, null],
    ['4,74원', null, null],
    ['1,000원 / 2,000원', null, null],
    ['약 4,743원', null, null],
  ]);
  assert.equal(deals[3].authoritativePrice, true);
});

test('collector는 정확한 첫 페이지를 정직한 헤더와 수동 redirect/timeout으로 한 번만 요청하고 저장·72시간 보존을 수행한다', async () => {
  const calls = [];
  const upserts = [];
  const deletions = [];
  const now = new Date('2026-09-12T12:00:00.000Z');
  const result = await runFmkoreaCollector({
    fetchImpl: async (...args) => { calls.push(args); return response(); },
    now: () => now,
    store: leaseStore({
      async upsert(deal) { upserts.push(deal); },
      async deleteBefore(...args) { deletions.push(args); return 3; },
    }),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], FMKOREA_ENDPOINT);
  assert.equal(calls[0][1].redirect, 'manual');
  assert.equal(calls[0][1].headers['User-Agent'], 'EasyHotDeal/1.0 (+https://easyshoopping.com)');
  assert.match(calls[0][1].headers.Accept, /text\/html/);
  assert.ok(calls[0][1].signal);
  assert.equal(upserts.length, 1);
  assert.deepEqual(deletions, [['fmkorea', new Date(now.getTime() - 72 * 60 * 60 * 1000)]]);
  assert.deepEqual(result, { fetched: 1, stored: 1, deleted: 3 });
});

test('HTTP 200 challenge는 body를 노출하지 않는 명시적 block 분류로 전달되고 DB를 변경하지 않는다', async () => {
  const writes = [];
  const secretBody = '<html><title>Just a moment...</title><div>challenge secret-token</div></html>';
  await assert.rejects(() => runFmkoreaCollector({
    store: leaseStore({
      async upsert() { writes.push('upsert'); },
      async deleteBefore() { writes.push('retention'); return 0; },
    }),
    fetchImpl: async () => response(secretBody),
  }), (error) => {
    assert.equal(error.blocked, true);
    assert.equal('body' in error, false);
    assert.doesNotMatch(error.message, /secret-token/);
    return true;
  });
  assert.deepEqual(writes, []);
});

test('일반 목록 마크업 drift는 block으로 오분류하지 않고 DB를 변경하지 않는다', async () => {
  const writes = [];
  await assert.rejects(() => runFmkoreaCollector({
    store: leaseStore({
      async upsert() { writes.push('upsert'); },
      async deleteBefore() { writes.push('retention'); return 0; },
    }),
    fetchImpl: async () => response(`<ul>${ROW.replace('li_best2_hotdeal0', 'li_best2_hotdeal-new')}</ul>`),
  }), (error) => {
    assert.equal(error.blocked, undefined);
    assert.match(error.message, /recognizable non-empty snapshot/i);
    return true;
  });
  assert.deepEqual(writes, []);
});

test('FMKorea 수집 lease 경합 패자는 요청과 DB 변경 없이 skipped를 반환한다', async () => {
  let fetched = false;
  let written = false;
  const result = await runFmkoreaCollector({
    store: {
      async withFmkoreaCollectionLease() { return null; },
      async upsert() { written = true; },
      async deleteBefore() { written = true; },
    },
    fetchImpl: async () => { fetched = true; return response(); },
  });
  assert.deepEqual(result, { skipped: 'lease-unavailable', fetched: 0, stored: 0, deleted: 0 });
  assert.equal(fetched, false);
  assert.equal(written, false);
});

test('FMKorea 요청부터 저장과 retention까지 하나의 수집 lease 안에서 실행한다', async () => {
  const events = [];
  await runFmkoreaCollector({
    store: leaseStore({
      async withFmkoreaCollectionLease(worker) {
        events.push('lease-start');
        const result = await worker();
        events.push('lease-end');
        return result;
      },
      async upsert() { events.push('upsert'); },
      async deleteBefore() { events.push('retention'); return 0; },
    }),
    fetchImpl: async () => { events.push('fetch'); return response(); },
  });
  assert.deepEqual(events, ['lease-start', 'fetch', 'upsert', 'retention', 'lease-end']);
});

test('collector는 redirect, 비 HTML, 과대 body를 거부하고 추가 요청하지 않는다', async () => {
  for (const bad of [
    response('', { ok: false, status: 302, headers: { get: () => 'https://evil.example/' } }),
    response('json', { headers: { get: () => 'application/json' } }),
    response('x'.repeat(2 * 1024 * 1024 + 1)),
  ]) {
    let count = 0;
    await assert.rejects(() => runFmkoreaCollector({
      store: leaseStore(),
      fetchImpl: async () => { count += 1; return bad; },
    }));
    assert.equal(count, 1);
  }
});

test('FMKorea runtime은 기본 OFF이고 true일 때 20분 미만 설정을 거부한다', () => {
  assert.deepEqual(readFmkoreaRuntime({}), { enabled: false, intervalMs: 1200000, timeoutMs: 10000 });
  assert.equal(readFmkoreaRuntime({ FMKOREA_ENABLED: 'true' }).enabled, true);
  assert.throws(() => readFmkoreaRuntime({ FMKOREA_ENABLED: 'true', FMKOREA_POLL_INTERVAL_MS: '1199999' }), /at least 1200000/);
  assert.equal(readFmkoreaRuntime({ FMKOREA_ENABLED: 'false', FMKOREA_POLL_INTERVAL_MS: '1' }).intervalMs, 1200000);
  assert.deepEqual(readFmkoreaRuntime({
    FMKOREA_ENABLED: 'false',
    FMKOREA_POLL_INTERVAL_MS: 'not-a-number',
    FMKOREA_REQUEST_TIMEOUT_MS: 'also-invalid',
  }), { enabled: false, intervalMs: 1200000, timeoutMs: 10000 });
});

test('관측 recorder가 응답하지 않아도 deadline 뒤 수집하고 다음 실행을 예약한다', async () => {
  const timeouts = createManualTimeouts();
  const scheduled = [];
  let collected = 0;
  const scheduler = startFmkoreaScheduler({
    collect: async () => { collected += 1; return { fetched: 1, stored: 1 }; },
    intervalMs: 1200000,
    recorderTimeoutMs: 25,
    setTimeoutFn(fn, delay) {
      if (delay === 25) return timeouts.setTimeoutFn(fn, delay);
      scheduled.push({ fn, delay });
      return `schedule-${scheduled.length}`;
    },
    clearTimeoutFn: timeouts.clearTimeoutFn,
    runRecorder: { start: () => new Promise(() => {}) },
    random: () => 0,
    logger: { info() {}, error() {} },
  });
  assert.equal(collected, 0);
  timeouts.expireRecorder(25);
  assert.deepEqual(await scheduler.firstRun, { fetched: 1, stored: 1 });
  assert.equal(collected, 1);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 1200000);
  scheduler.stop();
});

test('관측 성공 기록이 응답하지 않아도 deadline 뒤 다음 실행을 예약한다', async () => {
  const timeouts = createManualTimeouts();
  const scheduled = [];
  const scheduler = startFmkoreaScheduler({
    collect: async () => ({ fetched: 1, stored: 1 }),
    intervalMs: 1200000,
    recorderTimeoutMs: 25,
    setTimeoutFn(fn, delay) {
      if (delay === 25) return timeouts.setTimeoutFn(fn, delay);
      scheduled.push({ fn, delay });
      return `schedule-${scheduled.length}`;
    },
    clearTimeoutFn: timeouts.clearTimeoutFn,
    runRecorder: {
      async start() { return 'run-1'; },
      succeed: () => new Promise(() => {}),
    },
    random: () => 0,
    logger: { info() {}, error() {} },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduled.length, 0);
  timeouts.expireRecorder(25);
  assert.deepEqual(await scheduler.firstRun, { fetched: 1, stored: 1 });
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 1200000);
  scheduler.stop();
});

test('재귀 scheduler는 성공 jitter, 403/429 지수 backoff, Retry-After 상한, stop과 무중첩을 보장한다', async () => {
  const timers = [];
  const pending = [];
  let calls = 0;
  const scheduler = startFmkoreaScheduler({
    collect: async () => {
      calls += 1;
      if (calls === 1) return { fetched: 1, stored: 1 };
      if (calls === 2) throw Object.assign(new Error('blocked'), { status: 429, retryAfterMs: 2 * 60 * 60 * 1000 });
      return new Promise((resolve) => pending.push(resolve));
    },
    intervalMs: 1200000,
    random: () => 0.5,
    setTimeoutFn(fn, delay) { timers.push({ fn, delay, cleared: false }); return timers.length - 1; },
    clearTimeoutFn(id) { timers[id].cleared = true; },
    logger: { info() {}, error() {} },
  });
  await scheduler.firstRun;
  assert.equal(timers[0].delay, 1260000);
  await timers[0].fn();
  assert.equal(timers[1].delay, 2 * 60 * 60 * 1000);
  const running = timers[1].fn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 3);
  assert.equal(timers.length, 2);
  scheduler.stop();
  pending[0]({ fetched: 0, stored: 0 });
  await running;
  assert.equal(timers.length, 2);
});

test('scheduler는 HTTP 200 block 분류를 1h→2h→4h→8h→16h→24h 상한으로 증가시킨다', async () => {
  const timers = [];
  let fetchCalls = 0;
  const scheduler = startFmkoreaScheduler({
    collect: () => runFmkoreaCollector({
      store: leaseStore(),
      fetchImpl: async () => {
        fetchCalls += 1;
        return response('<html><title>Just a moment...</title><div>challenge</div></html>');
      },
    }),
    intervalMs: 1200000,
    setTimeoutFn(fn, delay) { timers.push({ fn, delay }); return timers.length - 1; },
    clearTimeoutFn() {},
    logger: { info() {}, error() {} },
  });
  await scheduler.firstRun;
  for (let index = 0; index < 6; index += 1) await timers[index].fn();
  assert.deepEqual(timers.map(({ delay }) => delay), [1, 2, 4, 8, 16, 24, 24].map((hours) => hours * 60 * 60 * 1000));
  assert.equal(fetchCalls, 7);
  scheduler.stop();
});

test('scheduler는 HTTP 430을 block으로 분류해 지수 backoff를 증가시킨다', async () => {
  const timers = [];
  const scheduler = startFmkoreaScheduler({
    collect: () => runFmkoreaCollector({
      store: leaseStore(),
      fetchImpl: async () => response('', { ok: false, status: 430 }),
    }),
    intervalMs: 1200000,
    setTimeoutFn(fn, delay) { timers.push({ fn, delay }); return timers.length - 1; },
    clearTimeoutFn() {},
    logger: { info() {}, error() {} },
  });
  await scheduler.firstRun;
  await timers[0].fn();
  assert.deepEqual(timers.map(({ delay }) => delay), [1, 2].map((hours) => hours * 60 * 60 * 1000));
  scheduler.stop();
});

test('scheduler는 일반 markup drift를 고정 safe retry로 처리하고 block backoff를 증가시키지 않는다', async () => {
  const timers = [];
  let calls = 0;
  const scheduler = startFmkoreaScheduler({
    collect: async () => {
      calls += 1;
      if (calls === 1 || calls === 3) throw Object.assign(new TypeError('FMKorea block page'), { blocked: true });
      throw new TypeError('FMKorea response is not a recognizable non-empty snapshot');
    },
    intervalMs: 1200000,
    setTimeoutFn(fn, delay) { timers.push({ fn, delay }); return timers.length - 1; },
    clearTimeoutFn() {},
    logger: { info() {}, error() {} },
  });
  await scheduler.firstRun;
  await timers[0].fn();
  await timers[1].fn();
  assert.deepEqual(timers.map(({ delay }) => delay), [1, 1, 1].map((hours) => hours * 60 * 60 * 1000));
  scheduler.stop();
});

test('DealStore retention은 FMKorea 72시간 경계 이전 행만 삭제한다', async () => {
  const memoryDb = newDb();
  const { Pool } = memoryDb.adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  const store = createDealStore(pool);
  for (const [id, publishedAt] of [['old', '2026-09-09T11:59:59Z'], ['edge', '2026-09-09T12:00:00Z'], ['new', '2026-09-09T12:00:01Z']]) {
    await store.upsert({ source: 'fmkorea', sourceItemId: id, title: id, originalUrl: `https://www.fmkorea.com/${id}`, publishedAt });
  }
  assert.equal(await store.deleteBefore('fmkorea', new Date('2026-09-09T12:00:00Z')), 2);
  assert.deepEqual((await store.list({ source: 'fmkorea' })).items.map((deal) => deal.sourceItemId), ['new']);
  await pool.end();
});
