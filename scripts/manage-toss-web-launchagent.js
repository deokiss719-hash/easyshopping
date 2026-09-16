#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const LABEL = 'com.easyhotdeal.toss-web-sync';
const INTERVAL_SECONDS = 5400;
const escape = (s) => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
function buildPlist({ projectDir, nodeBinary, logDir }) {
  for (const value of [projectDir, nodeBinary, logDir]) if (!path.isAbsolute(value)) throw new TypeError('Absolute paths required');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>${escape(path.join(projectDir,'ops/macos/run-toss-web-sync.sh'))}</string><string>--apply</string></array>
<key>WorkingDirectory</key><string>${escape(projectDir)}</string>
<key>EnvironmentVariables</key><dict><key>EASYHOTDEAL_PROJECT_DIR</key><string>${escape(projectDir)}</string><key>EASYHOTDEAL_NODE_BINARY</key><string>${escape(nodeBinary)}</string><key>USER</key><string>${escape(os.userInfo().username)}</string></dict>
<key>StartInterval</key><integer>${INTERVAL_SECONDS}</integer>
<key>RunAtLoad</key><true/>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${escape(path.join(logDir,'toss-web-sync.log'))}</string>
<key>StandardErrorPath</key><string>${escape(path.join(logDir,'toss-web-sync.error.log'))}</string>
</dict></plist>\n`;
}
function install() {
  const projectDir = path.resolve(__dirname,'..');
  const logDir = path.join(os.homedir(),'Library/Logs/EasyHotDeal');
  const plist = path.join(os.homedir(),'Library/LaunchAgents',`${LABEL}.plist`);
  // Existing job updates should be deliberate, rather than silently replacing its setup.
  if (fs.existsSync(plist)) throw new Error('Job already installed; inspect existing job before replacing it');
  fs.mkdirSync(logDir,{recursive:true,mode:0o700});
  fs.mkdirSync(path.dirname(plist),{recursive:true,mode:0o700});
  fs.writeFileSync(plist,buildPlist({projectDir,nodeBinary:process.execPath,logDir}),{mode:0o600,flag:'wx'});
  execFileSync('/usr/bin/plutil',['-lint',plist],{stdio:'pipe'});
  execFileSync('/bin/launchctl',['bootstrap',`gui/${process.getuid()}`,plist],{stdio:'pipe'});
  return {status:'installed',label:LABEL,intervalSeconds:INTERVAL_SECONDS};
}
if(require.main===module){
 try {
  if(process.argv[2]!=='install') throw new Error('Usage: manage-toss-web-launchagent.js install');
  console.log(JSON.stringify(install()));
 } catch {console.error('{"status":"error","reason":"toss_web_agent_install_failed"}');process.exitCode=1;}
}
module.exports={buildPlist,install,LABEL,INTERVAL_SECONDS};
