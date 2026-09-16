const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPlist, INTERVAL_SECONDS } = require('../scripts/manage-toss-web-launchagent');
test('Toss web scheduler is a separate daily job without Kakao send commands or embedded secrets', () => {
 const xml=buildPlist({projectDir:'/tmp/project & test',nodeBinary:'/opt/homebrew/bin/node',logDir:'/tmp/logs'});
 assert.equal(INTERVAL_SECONDS,86400);
 assert.match(xml,/com.easyhotdeal.toss-web-sync/);
 assert.match(xml,/run-toss-web-sync.sh/);
 assert.match(xml,/<string>--apply<\/string>/);
 assert.match(xml,/project &amp; test/);
 assert.doesNotMatch(xml,/run-kakao|ACCESS_KEY|SECRET_KEY|DATABASE_URL/);
});
