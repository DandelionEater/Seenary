const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const handlers = new Map();
const windows = [];
const listeners = new Map();
const app = new EventEmitter();
app.getVersion = () => '99.0.0'; // Electron's version when a development wrapper is launched.
let shown = false;
class Window extends EventEmitter {
  constructor(options) {
    super(); this.options = options; this.webContents = new EventEmitter();
    this.webContents.setWindowOpenHandler = () => {};
    this.webContents.send = (...args) => { if (args[0] === 'release-notice:data') this.payload = args; };
    windows.push(this);
  }
  getBounds() { return this.options; }
  setBounds(bounds) { this.options = { ...this.options, ...bounds }; }
  async loadFile() {}
  isDestroyed() { return false; }
  showInactive() { shown = true; }
  close() { this.emit('closed'); }
}
const main = { webContents: { send() {} }, isDestroyed: () => false,
  getBounds: () => ({ x: 200, y: 100, width: 900, height: 600 }) };
const fakeElectron = { app, BrowserWindow: Window,
  ipcMain: { handle: (name, fn) => handlers.set(name, fn), on: (name, fn) => listeners.set(name, fn) },
  screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) } };
const moduleObject = { exports: {} };
vm.runInNewContext(fs.readFileSync(require.resolve('../releaseNotifications'), 'utf8'), {
  module: moduleObject, __dirname: require('node:path').resolve(__dirname, '..'), URL,
  require: name => name === 'electron' ? fakeElectron : name === './package.json' ? { version: '0.2.5-dev' } : require(name),
  setTimeout: () => 1, clearTimeout() {}, setInterval: () => ({ unref() {} }), clearInterval() {},
});
moduleObject.exports.registerReleaseNotificationIpc(() => main);
(async () => {
  const show = handlers.get('release-notice:show');
  const notice = { id: 7, type: 'ANIME', title: 'A long title', message: 'Episode 3 airs soon.', preview: true };
  assert.equal((await show({ sender: {} }, notice)).ok, false);
  assert.equal(windows.length, 0);
  assert.equal((await show({ sender: main.webContents }, notice)).ok, true);
  const popup = windows[0];
  assert.equal(shown, false, "wait for content measurement before showing");
  listeners.get("release-notice:resize")({ sender: {} }, 160);
  assert.equal(shown, false, "only popup may resize itself");
  listeners.get("release-notice:resize")({ sender: popup.webContents }, 160);
  assert.equal(shown, true);
  assert.equal(popup.options.height, 160, "height fits content");
  assert.equal(popup.options.x + popup.options.width, 1904, 'right edge follows desktop work area, not main window');
  assert.equal(popup.options.y + popup.options.height, 1024, 'bottom edge stays above taskbar');
  assert.equal(popup.options.alwaysOnTop, true);
  assert.equal(popup.options.focusable, false);
  assert.equal(popup.options.skipTaskbar, true);
  assert.equal(popup.options.webPreferences.sandbox, true);
  assert.equal(popup.payload[1].title, notice.title);
  app.emit('before-quit');
  console.log('PASS: global desktop positioning, inactive always-on-top popup, dev-wrapper preview and IPC sender checks.');
})().catch(error => { console.error(error); process.exitCode = 1; });
