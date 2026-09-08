const test = require('node:test');
const assert = require('node:assert/strict');

const { startPollingCollector } = require('../src/polling-collector');

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
