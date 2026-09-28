const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('native show/hide restores saved bindings, search focus, gaming pause and settings IPC', () => {
  const registered = new Map(), handlers = new Map();
  let settings = JSON.stringify({ hideShowEnabled: true, hideShowAccelerator: 'Control+Shift+Space' });
  const context = { module: { exports: {} }, console: { info() {}, warn() {} }, require(name) {
    if (name === 'fs') return { existsSync: () => true, readFileSync: () => settings,
      mkdirSync() {}, writeFileSync(_file, value) { settings = value; } };
    if (name === 'path') return path;
    if (name === './desktopEnvironment') return { isNativeWayland: () => false };
    if (name === 'electron') return { app: { getPath: () => '/synthetic-profile' },
      globalShortcut: { register(key, callback) { registered.set(key, callback); return true; },
        isRegistered: key => registered.has(key), unregister: key => registered.delete(key) },
      ipcMain: { listenerCount: () => 0, handle(name, callback) { handlers.set(name, callback); } } };
    throw Error(`Unexpected dependency: ${name}`);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../shortcuts.js'), 'utf8'), context);
  const api = context.module.exports;
  let visible = true, focused = false, searchFocused = false;
  const win = { isDestroyed: () => false, isVisible: () => visible, hide() { visible = false; },
    show() { visible = true; }, focus() { focused = true; },
    webContents: { send(channel) { searchFocused = channel === 'focus-search'; } } };
  api.registerShortcuts(win);
  registered.get('Control+Shift+Space')(); assert.equal(visible, false);
  registered.get('Control+Shift+Space')(); assert.equal(visible, true);
  assert.equal(focused, true); assert.equal(searchFocused, true);
  api.setGamingModeEnabled(win, true); assert.equal(registered.size, 0);
  api.setGamingModeEnabled(win, false); assert.equal(registered.size, 1);
  api.registerShortcutIpc(() => win);
  const status = handlers.get('shortcuts:get-hide-show')();
  assert.equal(status.enabled, true); assert.equal(status.registered, true);
  const updated = handlers.get('shortcuts:set-hide-show')({}, { enabled: true, accelerator: 'Alt+Space' });
  assert.equal(updated.ok, true); assert.equal(registered.has('Alt+Space'), true);
  handlers.get('shortcuts:set-recording-active')({}, true); assert.equal(registered.size, 0);
  handlers.get('shortcuts:set-recording-active')({}, false); assert.equal(registered.has('Alt+Space'), true);
});
