const test = require('node:test');
const assert = require('node:assert/strict');

const { startPollingCollector } = require('../src/polling-collector');

function createManualTimeouts() {
  let nextId = 0;
  const callbacks = new Map();
  return {
    setTimeoutFn(callback, timeoutMs) {
      nextId += 1;
      callbacks.set(nextId, { callback, timeoutMs });
      return nextId;
    },
    clearTimeoutFn(id) {
      callbacks.delete(id);
    },
    expireNext(expectedTimeoutMs) {
      const next = callbacks.entries().next();
      assert.equal(next.done, false, 'expected an active recorder timeout');
      const [id, { callback, timeoutMs }] = next.value;
      assert.equal(timeoutMs, expectedTimeoutMs);
      callbacks.delete(id);
      callback();
    },
  };
}

async function waitForImmediate() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('시작 즉시 한 번 수집하고 지정된 간격으로 반복한다', async () => {
  let calls = 0;
  let scheduled;
  let scheduledMs;
  let clearedId;

  const polling = startPollingCollector({
    collect: async () => {
      calls += 1;
      return { fetched: 2, stored: 2 };
    },
    intervalMs: 600000,
    setIntervalFn(fn, ms) {
      scheduled = fn;
      scheduledMs = ms;
      return 'timer-1';
    },
    clearIntervalFn(id) {
      clearedId = id;
    },
    logger: { info() {}, error() {} },
  });

  await polling.firstRun;
  assert.equal(calls, 1);
  assert.equal(scheduledMs, 600000);

  await scheduled();
  assert.equal(calls, 2);

  polling.stop();
  assert.equal(clearedId, 'timer-1');
});

test('이전 수집이 끝나지 않았으면 다음 실행을 겹치지 않는다', async () => {
  let calls = 0;
  let release;
  let scheduled;
  const waiting = new Promise((resolve) => { release = resolve; });

  const polling = startPollingCollector({
    collect: async () => {
      calls += 1;
      await waiting;
      return { fetched: 1, stored: 1 };
    },
    intervalMs: 600000,
    setIntervalFn(fn) {
      scheduled = fn;
      return 'timer-2';
    },
    clearIntervalFn() {},
    logger: { info() {}, error() {} },
  });

  await Promise.resolve();
  await scheduled();
  assert.equal(calls, 1);
  release();
  await polling.firstRun;
  polling.stop();
});

test('수집 시작과 성공 건수를 관측 저장소에 기록한다', async () => {
  const events = [];
  const polling = startPollingCollector({
    collect: async () => ({ fetched: 4, stored: 3 }),
    intervalMs: 600000,
    runRecorder: {
      async start() { events.push(['start']); return 'run-1'; },
      async succeed(id, counts) { events.push(['succeed', id, counts]); },
      async fail() { events.push(['fail']); },
    },
    setIntervalFn() { return 'timer'; },
    clearIntervalFn() {},
    logger: { info() {}, error() {} },
  });

  await polling.firstRun;
  assert.deepEqual(events, [
    ['start'],
    ['succeed', 'run-1', { fetched: 4, stored: 3 }],
  ]);
  polling.stop();
});

test('수집 실패를 원문 오류 없이 관측 저장소에 기록한다', async () => {
  const events = [];
  const polling = startPollingCollector({
    collect: async () => { throw new Error('secret upstream response'); },
    intervalMs: 600000,
    runRecorder: {
      async start() { return 'run-2'; },
      async succeed() { events.push(['succeed']); },
      async fail(id) { events.push(['fail', id]); },
    },
    setIntervalFn() { return 'timer'; },
    clearIntervalFn() {},
    logger: { info() {}, error() {} },
  });

  assert.equal(await polling.firstRun, null);
  assert.deepEqual(events, [['fail', 'run-2']]);
  polling.stop();
});

test('관측 저장소 시작 실패가 실제 수집을 막지 않는다', async () => {
  let collected = 0;
  const polling = startPollingCollector({
    collect: async () => { collected += 1; return { fetched: 2, stored: 1 }; },
    intervalMs: 600000,
    runRecorder: {
      async start() { throw new Error('recorder unavailable'); },
      async succeed() { throw new Error('must not run without an id'); },
      async fail() { throw new Error('must not run without an id'); },
    },
    setIntervalFn() { return 'timer'; }, clearIntervalFn() {},
    logger: { info() {}, error() {} },
  });
  assert.deepEqual(await polling.firstRun, { fetched: 2, stored: 1 });
  assert.equal(collected, 1);
  polling.stop();
});

test('관측 저장소 성공 기록 실패가 성공한 수집을 실패로 바꾸지 않는다', async () => {
  const logEvents = [];
  const polling = startPollingCollector({
    collect: async () => ({ fetched: 3, stored: 3 }),
    intervalMs: 600000,
    runRecorder: {
      async start() { return 'run-3'; },
      async succeed() { throw new Error('recorder unavailable'); },
      async fail() { throw new Error('must not mark collection failed'); },
    },
    setIntervalFn() { return 'timer'; }, clearIntervalFn() {},
    logger: {
      info(...args) { logEvents.push(['info', ...args]); },
      error(...args) { logEvents.push(['error', ...args]); },
    },
  });
  assert.deepEqual(await polling.firstRun, { fetched: 3, stored: 3 });
  assert.equal(logEvents.some(([level]) => level === 'error'), false);
  polling.stop();
});

test('관측 저장소 실패 기록 오류도 실제 수집 실패 처리에 영향을 주지 않는다', async () => {
  const polling = startPollingCollector({
    collect: async () => { throw new Error('upstream failed'); },
    intervalMs: 600000,
    runRecorder: {
      async start() { return 'run-4'; }, async succeed() {},
      async fail() { throw new Error('recorder unavailable'); },
    },
    setIntervalFn() { return 'timer'; }, clearIntervalFn() {},
    logger: { info() {}, error() {} },
  });
  assert.equal(await polling.firstRun, null);
  polling.stop();
});

test('관측 저장소 시작이 응답하지 않아도 제한 시간 뒤 수집을 시작한다', async () => {
  const timeouts = createManualTimeouts();
  let collected = 0;
  const polling = startPollingCollector({
    collect: async () => { collected += 1; return { fetched: 1, stored: 1 }; },
    intervalMs: 600000,
    recorderTimeoutMs: 25,
    setTimeoutFn: timeouts.setTimeoutFn,
    clearTimeoutFn: timeouts.clearTimeoutFn,
    runRecorder: { start: () => new Promise(() => {}) },
    setIntervalFn() { return 'timer'; }, clearIntervalFn() {},
    logger: { info() {}, error() {} },
  });

  assert.equal(collected, 0);
  timeouts.expireNext(25);
  assert.deepEqual(await polling.firstRun, { fetched: 1, stored: 1 });
  assert.equal(collected, 1);
  polling.stop();
});

test('관측 저장소 성공 기록이 응답하지 않아도 실행을 반환하고 다음 수집을 허용한다', async () => {
  const timeouts = createManualTimeouts();
  let collected = 0;
  let scheduled;
  const polling = startPollingCollector({
    collect: async () => { collected += 1; return { fetched: 1, stored: 1 }; },
    intervalMs: 600000,
    recorderTimeoutMs: 25,
    setTimeoutFn: timeouts.setTimeoutFn,
    clearTimeoutFn: timeouts.clearTimeoutFn,
    runRecorder: {
      async start() { return `run-${collected + 1}`; },
      succeed: () => new Promise(() => {}),
    },
    setIntervalFn(fn) { scheduled = fn; return 'timer'; }, clearIntervalFn() {},
    logger: { info() {}, error() {} },
  });

  await waitForImmediate();
  timeouts.expireNext(25);
  assert.deepEqual(await polling.firstRun, { fetched: 1, stored: 1 });

  const secondRun = scheduled();
  await waitForImmediate();
  timeouts.expireNext(25);
  assert.deepEqual(await secondRun, { fetched: 1, stored: 1 });
  assert.equal(collected, 2);
  polling.stop();
});

test('관측 저장소 실패 기록이 응답하지 않아도 실행을 반환하고 다음 수집을 허용한다', async () => {
  const timeouts = createManualTimeouts();
  let collected = 0;
  let scheduled;
  const polling = startPollingCollector({
    collect: async () => { collected += 1; throw new Error('private upstream detail'); },
    intervalMs: 600000,
    recorderTimeoutMs: 25,
    setTimeoutFn: timeouts.setTimeoutFn,
    clearTimeoutFn: timeouts.clearTimeoutFn,
    runRecorder: {
      async start() { return `run-${collected + 1}`; },
      fail: () => new Promise(() => {}),
    },
    setIntervalFn(fn) { scheduled = fn; return 'timer'; }, clearIntervalFn() {},
    logger: { info() {}, error() {} },
  });

  await waitForImmediate();
  timeouts.expireNext(25);
  assert.equal(await polling.firstRun, null);

  const secondRun = scheduled();
  await waitForImmediate();
  timeouts.expireNext(25);
  assert.equal(await secondRun, null);
  assert.equal(collected, 2);
  polling.stop();
});
