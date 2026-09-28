const { ipcMain } = require('electron');
let gamingModeEnabled = false;
// Preserve IPC compatibility without registering any native keyboard actions.
function shortcutState() {
  return { ok: true, supported: false, enabled: false, accelerator: '', registered: false,
    gamingModeEnabled, message: 'Keyboard actions are reserved for Search.' };
}
function registerShortcuts() {}
function getGamingModeEnabled() { return gamingModeEnabled; }
function setGamingModeEnabled(_win, enabled) {
  gamingModeEnabled = Boolean(enabled);
  return { enabled: gamingModeEnabled, message: gamingModeEnabled ? 'Gaming mode enabled.' : 'Gaming mode disabled.' };
}
function registerShortcutIpc() {
  if (ipcMain.listenerCount('shortcuts:get-hide-show') === 0)
    ipcMain.handle('shortcuts:get-hide-show', shortcutState);
  if (ipcMain.listenerCount('shortcuts:set-hide-show') === 0)
    ipcMain.handle('shortcuts:set-hide-show', () => ({ ...shortcutState(), ok: false }));
  if (ipcMain.listenerCount('shortcuts:set-recording-active') === 0)
    ipcMain.handle('shortcuts:set-recording-active', () => ({ ok: true, active: false }));
}
module.exports = { getGamingModeEnabled, registerShortcuts, registerShortcutIpc, setGamingModeEnabled };
