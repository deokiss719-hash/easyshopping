#!/usr/bin/env node
const { DatabaseSync } = require('node:sqlite');
const { Pool } = require('pg');
const DEFAULT_DB_PATH = require('node:path').join(require('node:os').homedir(), 'Library', 'Application Support', 'EasyHotDeal', 'kakao-auto.sqlite');
const { createTossSharelinkClient } = require('../src/toss-sharelink-client');
const { syncTossWeb } = require('../src/toss-web-sync');

async function main(args = process.argv.slice(2), env = process.env) {
  if (args.length !== 1 || !['--dry-run', '--apply'].includes(args[0])) {
    throw new Error('Usage: sync-toss-web.js --dry-run|--apply');
  }
  const dryRun = args[0] === '--dry-run';
  if (!dryRun && !env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  // No createFileTokenCache: preview does not modify the production token cache.
  const tossClient = createTossSharelinkClient({ accessKey: env.TOSS_SHARELINK_ACCESS_KEY,
    secretKey: env.TOSS_SHARELINK_SECRET_KEY, publisherId: env.TOSS_SHARELINK_MEMBER_ID });
  const db = new DatabaseSync(env.KAKAO_AUTO_DB_PATH || DEFAULT_DB_PATH, { readOnly: true });
  const pool = dryRun ? null : new Pool({ connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 10000, statement_timeout: 30000 });
  try {
    const result = await syncTossWeb({ db, pool, tossClient, dryRun });
    // Do not print connection strings, credentials, confirmation proofs, or messages.
    if (dryRun && env.TOSS_WEB_PREVIEW_PATH) {
      require('node:fs').writeFileSync(env.TOSS_WEB_PREVIEW_PATH, JSON.stringify(result), { mode: 0o600 });
    }
    const { deals, ...summary } = result;
    console.log(JSON.stringify({ ...summary, ...(deals ? { products: deals.map(({ sourceItemId, title, priceAmount }) => ({ sourceItemId, title, priceAmount })) } : {}) }));
    return result;
  } finally { db.close(); if (pool) await pool.end(); }
}
const SAFE_FAILURE_CODES = new Set(['toss_transport_malformed', 'toss_transport_error', 'toss_api_rate_limited',
  'toss_api_unavailable', 'toss_api_rejected', 'toss_api_malformed', 'toss_api_unsuccessful',
  'toss_oauth_malformed', 'toss_link_malformed', 'toss_link_invalid_url']);
function safeFailureCode(error) {
  return SAFE_FAILURE_CODES.has(error?.code) ? error.code : 'unknown';
}
if (require.main === module) main().catch((error) => {
  console.error(JSON.stringify({ status: 'error', reason: 'toss_web_sync_failed', code: safeFailureCode(error) }));
  process.exitCode = 1;
});
module.exports = { main, safeFailureCode };
