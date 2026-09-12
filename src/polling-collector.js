function startPollingCollector({
  collect,
  intervalMs,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  logger = console,
  runRecorder = null,
  recorderTimeoutMs = 2000,
  label = '핫딜 RSS',
}) {
  if (typeof collect !== 'function') throw new TypeError('collect function is required');
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 60000) {
    throw new TypeError('intervalMs must be at least 60000');
  }
  if (!Number.isSafeInteger(recorderTimeoutMs) || recorderTimeoutMs < 1) {
    throw new TypeError('recorderTimeoutMs must be a positive integer');
  }

  let running = false;
  async function record(method, ...args) {
    if (!runRecorder || typeof runRecorder[method] !== 'function') return null;
    let timeoutId;
    try {
      return await Promise.race([
        Promise.resolve().then(() => runRecorder[method](...args)),
        new Promise((resolve) => {
          timeoutId = setTimeoutFn(() => resolve(null), recorderTimeoutMs);
        }),
      ]);
    } catch {
      return null;
    } finally {
      if (timeoutId !== undefined) clearTimeoutFn(timeoutId);
    }
  }

  async function execute() {
    if (running) return null;
    running = true;
    const runId = await record('start');
    try {
      const result = await collect();
      if (runId != null) await record('succeed', runId, result);
      logger.info(`${label} 수집 완료`, result);
      return result;
    } catch {
      if (runId != null) await record('fail', runId);
      logger.error(`${label} 수집 실패`, { reason: 'collector_failed' });
      return null;
    } finally {
      running = false;
    }
  }

  const firstRun = execute();
  const timer = setIntervalFn(execute, intervalMs);

  return {
    firstRun,
    stop() {
      clearIntervalFn(timer);
    },
  };
}

module.exports = { startPollingCollector };
