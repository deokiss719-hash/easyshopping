'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

test('server always reads and mounts the Toss runtime/API before not-found handling', () => {
  assert.match(server, /readTossSharelinkRuntime/);
  assert.match(server, /runTossSharelinkCollector/);
  assert.match(server, /createTossRecommendationsRouter/);
  assert.match(server, /const tossRuntime = readTossSharelinkRuntime\(process\.env\)/);
  const routerAt = server.indexOf("app.use('/api/toss-recommendations'");
  const notFoundAt = server.indexOf('app.use(publicNotFound)');
  assert.ok(routerAt >= 0 && routerAt < notFoundAt);
});

test('Toss polling is independent, enabled-only, and has a Korean scheduler label', () => {
  assert.match(server, /if \(tossRuntime\.enabled\) \{[\s\S]*?startPollingCollector\(\{[\s\S]*?runTossSharelinkCollector/);
  assert.match(server, /intervalMs:\s*tossRuntime\.intervalMs/);
  assert.match(server, /label:\s*'토스쇼핑 쉐어링크 추천'/);
  assert.match(server, /if \(tossRuntime\.requested && !tossRuntime\.enabled\) \{[\s\S]*?console\.warn/);
});

test('environment example keeps Toss network access OFF with empty placeholders and approval/fixed-IP guidance', () => {
  assert.match(envExample, /^TOSS_SHARELINK_ENABLED=false$/m);
  for (const name of ['CLIENT_ID', 'CLIENT_SECRET', 'PUBLISHER_ID']) {
    assert.match(envExample, new RegExp(`^TOSS_SHARELINK_${name}=$`, 'm'));
  }
  assert.match(envExample, /승인/);
  assert.match(envExample, /고정.*IP/i);
  assert.doesNotMatch(envExample, /^TOSS_SHARELINK_(?:CLIENT_ID|CLIENT_SECRET|PUBLISHER_ID)=.+$/m);
});
