#!/usr/bin/env node

const { runLocalImageBackfill } = require('../src/images/local-backfill-runner');

function safeError(error) {
  return {
    status: 'error',
    reason: error?.detectedFailureCode || error?.code || 'image_backfill_error',
    message: String(error?.message || 'image backfill failed').slice(0, 300),
  };
}

async function main(argv = process.argv.slice(2)) {
  const allowed = new Set(['--check']);
  const unknown = argv.filter((arg) => !allowed.has(arg));
  if (unknown.length) throw new TypeError(`unsupported argument: ${unknown[0]}`);
  const result = await runLocalImageBackfill({ checkOnly: argv.includes('--check') });
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), ...result })}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ timestamp: new Date().toISOString(), ...safeError(error) })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, safeError };
