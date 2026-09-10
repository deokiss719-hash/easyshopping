const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  LABEL,
  INTERVAL_SECONDS,
  buildLaunchAgentPlist,
  pathsForHome,
} = require('../scripts/manage-image-backfill-launchagent');

const projectDir = path.resolve(__dirname, '..');
const packageJson = require('../package.json');

test('LaunchAgent는 15분 주기·로그인 실행·절대 경로만 기록하고 자격증명을 포함하지 않는다', () => {
  const plist = buildLaunchAgentPlist({
    projectDir,
    nodeBinary: process.execPath,
    stdoutPath: '/Users/example/Library/Logs/EasyHotDeal/image-backfill.log',
    stderrPath: '/Users/example/Library/Logs/EasyHotDeal/image-backfill.error.log',
  });

  assert.equal(INTERVAL_SECONDS, 900);
  assert.match(plist, new RegExp(`<string>${LABEL}</string>`));
  assert.match(plist, /<key>StartInterval<\/key>\s*<integer>900<\/integer>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /run-image-backfill\.sh/);
  assert.match(plist, /EASYHOTDEAL_NODE_BINARY/);
  assert.doesNotMatch(plist, /DATABASE_URL|R2_SECRET_ACCESS_KEY|R2_ACCESS_KEY_ID/);
});

test('LaunchAgent 경로는 사용자 Library 아래에만 생성된다', () => {
  const paths = pathsForHome('/Users/example');
  assert.equal(paths.plistPath, `/Users/example/Library/LaunchAgents/${LABEL}.plist`);
  assert.equal(paths.logsDir, '/Users/example/Library/Logs/EasyHotDeal');
});

test('Keychain wrapper는 전용 service/account를 읽고 전체 앱 접근 옵션을 사용하지 않는다', () => {
  const runner = fs.readFileSync(path.join(projectDir, 'ops/macos/run-image-backfill.sh'), 'utf8');
  const configure = fs.readFileSync(path.join(projectDir, 'ops/macos/configure-image-backfill-keychain.sh'), 'utf8');

  assert.match(runner, /security find-generic-password -s "\$SERVICE" -a "\$key" -w/);
  assert.match(configure, /security add-generic-password/);
  assert.match(configure, /-T \/usr\/bin\/security/);
  assert.doesNotMatch(configure, /(^|\s)-A(\s|$)/m);
  assert.doesNotMatch(runner, /\.env/);
});

test('공개 npm 배치는 Keychain wrapper를 거치며 수동 실행 경로와 인자를 제한한다', () => {
  const runnerPath = path.join(projectDir, 'ops/macos/run-image-backfill.sh');
  const configurePath = path.join(projectDir, 'ops/macos/configure-image-backfill-keychain.sh');
  const runner = fs.readFileSync(runnerPath, 'utf8');

  assert.equal(packageJson.scripts['image:backfill'], 'ops/macos/run-image-backfill.sh');
  assert.equal(packageJson.scripts['image:backfill:check'], 'ops/macos/run-image-backfill.sh --check');
  assert.match(packageJson.scripts['image:backfill:keychain:configure'], /configure-image-backfill-keychain\.sh configure$/);
  assert.match(packageJson.scripts['image:backfill:keychain:status'], /configure-image-backfill-keychain\.sh status$/);
  assert.match(runner, /PROJECT_DIR="\$\{EASYHOTDEAL_PROJECT_DIR:-\$\{SCRIPT_DIR:h:h\}\}"/);
  assert.match(runner, /EASYHOTDEAL_NODE_BINARY:-\$\(command -v node/);
  assert.match(runner, /scripts\/run-local-image-backfill\.js "\$@"/);
  assert.equal(fs.statSync(runnerPath).mode & 0o111, 0o111);
  assert.equal(fs.statSync(configurePath).mode & 0o111, 0o111);
});

test('plist 빌더는 상대 경로를 거부한다', () => {
  assert.throws(() => buildLaunchAgentPlist({
    projectDir: '.',
    nodeBinary: process.execPath,
    stdoutPath: '/tmp/out.log',
    stderrPath: '/tmp/error.log',
  }), /projectDir must be an absolute path/);
});
