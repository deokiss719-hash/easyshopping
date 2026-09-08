function startPollingCollector({
  collect,
  intervalMs,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  logger = console,
}) {
  if (typeof collect !== 'function') throw new TypeError('collect function is required');
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 60000) {
    throw new TypeError('intervalMs must be at least 60000');
  }

  let running = false;
  async function execute() {
    if (running) return null;
    running = true;
    try {
      const result = await collect();
      logger.info('핫딜 RSS 수집 완료', result);
      return result;
    } catch (error) {
      logger.error('핫딜 RSS 수집 실패', error);
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
