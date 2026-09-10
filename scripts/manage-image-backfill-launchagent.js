#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const LABEL = 'com.easyhotdeal.image-backfill';
const INTERVAL_SECONDS = 15 * 60;

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function buildLaunchAgentPlist({ projectDir, nodeBinary, stdoutPath, stderrPath }) {
  const values = { projectDir, nodeBinary, stdoutPath, stderrPath };
  for (const [name, value] of Object.entries(values)) {
    if (!path.isAbsolute(value)) throw new TypeError(`${name} must be an absolute path`);
  }
  const runner = path.join(projectDir, 'ops/macos/run-image-backfill.sh');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(runner)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(projectDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>EASYHOTDEAL_PROJECT_DIR</key>
    <string>${xmlEscape(projectDir)}</string>
    <key>EASYHOTDEAL_NODE_BINARY</key>
    <string>${xmlEscape(nodeBinary)}</string>
    <key>IMAGE_BACKFILL_LIMIT</key>
    <string>15</string>
    <key>IMAGE_REQUEST_INTERVAL_MS</key>
    <string>5000</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartInterval</key>
  <integer>${INTERVAL_SECONDS}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>60</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderrPath)}</string>
</dict>
</plist>
`;
}

function pathsForHome(home = os.homedir()) {
  const logsDir = path.join(home, 'Library/Logs/EasyHotDeal');
  return {
    plistPath: path.join(home, 'Library/LaunchAgents', `${LABEL}.plist`),
    logsDir,
    stdoutPath: path.join(logsDir, 'image-backfill.log'),
    stderrPath: path.join(logsDir, 'image-backfill.error.log'),
  };
}

function launchctl(args, { allowFailure = false } = {}) {
  try {
    return execFileSync('/bin/launchctl', args, { encoding: 'utf8', stdio: allowFailure ? 'pipe' : 'inherit' });
  } catch (error) {
    if (allowFailure) return '';
    throw error;
  }
}

function install({ projectDir = path.resolve(__dirname, '..'), home = os.homedir(), uid = process.getuid() } = {}) {
  const paths = pathsForHome(home);
  const runner = path.join(projectDir, 'ops/macos/run-image-backfill.sh');
  if (!fs.existsSync(runner)) throw new Error(`runner not found: ${runner}`);
  fs.mkdirSync(path.dirname(paths.plistPath), { recursive: true, mode: 0o700 });
  fs.mkdirSync(paths.logsDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(runner, 0o700);
  const plist = buildLaunchAgentPlist({
    projectDir,
    nodeBinary: process.execPath,
    stdoutPath: paths.stdoutPath,
    stderrPath: paths.stderrPath,
  });
  fs.writeFileSync(paths.plistPath, plist, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(paths.plistPath, 0o600);
  const domain = `gui/${uid}`;
  launchctl(['bootout', domain, paths.plistPath], { allowFailure: true });
  launchctl(['bootstrap', domain, paths.plistPath]);
  return { status: 'installed', label: LABEL, intervalSeconds: INTERVAL_SECONDS, ...paths };
}

function uninstall({ home = os.homedir(), uid = process.getuid() } = {}) {
  const paths = pathsForHome(home);
  launchctl(['bootout', `gui/${uid}`, paths.plistPath], { allowFailure: true });
  fs.rmSync(paths.plistPath, { force: true });
  return { status: 'uninstalled', label: LABEL, plistPath: paths.plistPath };
}

function status({ uid = process.getuid() } = {}) {
  const output = launchctl(['print', `gui/${uid}/${LABEL}`], { allowFailure: true });
  return { status: output ? 'loaded' : 'not_loaded', label: LABEL };
}

function main(argv = process.argv.slice(2)) {
  const action = argv[0] || 'status';
  let result;
  if (action === 'install') result = install();
  else if (action === 'uninstall') result = uninstall();
  else if (action === 'status') result = status();
  else throw new TypeError('usage: node scripts/manage-image-backfill-launchagent.js {install|status|uninstall}');
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'error', message: String(error.message).slice(0, 300) })}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  LABEL,
  INTERVAL_SECONDS,
  buildLaunchAgentPlist,
  pathsForHome,
  install,
  uninstall,
  status,
  main,
};
