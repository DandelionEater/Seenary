// Run only on a disposable Windows CI runner: this exercises real NSIS registry writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { version } = require('../package.json');
if (process.platform !== 'win32' || process.env.CI !== 'true') throw new Error('Real installer tests require a disposable Windows CI runner.');
const root = path.resolve(__dirname, '../node_modules/.cache/installed-startup');
const destination = path.join(root, 'Seenary Test Install');
const profile = path.join(root, 'isolated-profile');
const installer = path.resolve(__dirname, '../../release', version, `Seenary-Setup-${version}.exe`);
const previous = process.argv[2] && path.resolve(process.argv[2]);
fs.mkdirSync(profile, { recursive: true });
const env = { ...process.env, SEENARY_USE_BUNDLED_FRONTEND: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SEENARY_APP_URL;
function run(file, args) {
  const result = spawnSync(file, args, { env, windowsHide: true, timeout: 180000, encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.ok([0, 3010].includes(result.status), `${path.basename(file)} exited ${result.status}: ${result.stderr}`);
}
function install(file) { assert.ok(fs.existsSync(file), `Missing installer: ${file}`); run(file, ['/S', '/currentuser', '/D=' + destination]); }
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function evaluate(url, expression) {
  const socket = new WebSocket(url);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Installed renderer did not respond.')), 5000);
      socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
      socket.onerror = () => { clearTimeout(timer); reject(Error('Installed renderer connection failed.')); };
      socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        clearTimeout(timer);
        if (message.error || message.result?.exceptionDetails) reject(Error(JSON.stringify(message.error || message.result.exceptionDetails)));
        else resolve(message.result.result.value);
      };
    });
  } finally { socket.close(); }
}
async function launch(label) {
  const executable = path.join(destination, 'Seenary.exe');
  assert.ok(fs.existsSync(executable), 'Installer did not create Seenary.exe.');
  const port = await freePort();
  const child = spawn(executable, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run'], { env, windowsHide: true, stdio: 'ignore' });
  let launchError;
  child.on('error', error => { launchError = error; });
  try {
    const deadline = Date.now() + 30000;
    let report;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      assert.equal(child.exitCode, null, 'Installed executable exited before renderer startup.');
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = targets.find(target => target.type === 'page' && target.url.startsWith('https://web.seenary.app'));
        if (page) report = await evaluate(page.webSocketDebuggerUrl, `(async () => {
          if (!window.desktopDiagnostics || !document.getElementById('root')?.children.length) return null;
          const diagnostics = await window.desktopDiagnostics.getInfo();
          return { packaged: diagnostics.packaged, writable: diagnostics.profileWritable, version: diagnostics.appVersion, text: document.body.innerText.length, notifications: typeof window.desktopReleaseNotifications };
        })()`);
        if (report) break;
      } catch (error) { launchError = child.exitCode !== null ? error : null; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(report, 'Installed executable did not render its bundled frontend and initialize preload IPC within 30 seconds.');
    assert.equal(report.packaged, true); assert.equal(report.writable, true); assert.ok(report.text > 20);
    assert.equal(report.version, version, 'Installed executable must run the release version.');
    console.log(`PASS: ${label}; real installed executable, bundled React frontend and preload IPC initialized.`);
    fs.writeFileSync(path.join(root, label + '.json'), JSON.stringify(report, null, 2));
  } finally {
    if (child.pid && child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  }
}
(async () => {
  install(installer);
  await launch('fresh-install');
  if (!previous) throw new Error('Previous installer is required to validate upgrade startup.');
  run(path.join(destination, '.seenary-uninstall-core.exe'), ['/S', '/KEEP_APP_DATA', '_?=' + destination]);
  install(previous);
  const sentinel = path.join(profile, 'upgrade-preservation.txt');
  fs.writeFileSync(sentinel, 'preserve this profile');
  install(installer);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve this profile');
  await launch('upgrade-install');
})().catch(error => {
  fs.writeFileSync(path.join(root, 'failure.json'), JSON.stringify({ error: error.stack }, null, 2));
  console.error(error); process.exitCode = 1;
});
