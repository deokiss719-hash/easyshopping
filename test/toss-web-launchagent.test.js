const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPlist, SCHEDULE_HOUR, SCHEDULE_MINUTE } = require('../scripts/manage-toss-web-launchagent');
test('Toss web scheduler runs shortly after the daily quota reset without Kakao commands or secrets', () => {
 const xml=buildPlist({projectDir:'/tmp/project & test',nodeBinary:'/opt/homebrew/bin/node',logDir:'/tmp/logs'});
 assert.equal(SCHEDULE_HOUR,0);
 assert.equal(SCHEDULE_MINUTE,10);
 assert.match(xml,/<key>StartCalendarInterval<\/key><dict><key>Hour<\/key><integer>0<\/integer><key>Minute<\/key><integer>10<\/integer><\/dict>/);
 assert.doesNotMatch(xml,/StartInterval/);
 assert.match(xml,/com.easyhotdeal.toss-web-sync/);
 assert.match(xml,/run-toss-web-sync.sh/);
 assert.match(xml,/<string>--apply<\/string>/);
 assert.match(xml,/project &amp; test/);
 assert.doesNotMatch(xml,/run-kakao|ACCESS_KEY|SECRET_KEY|DATABASE_URL/);
});
