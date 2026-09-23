const { contextBridge, ipcRenderer } = require('electron');

function getSystemLocaleInfo() {
  try {
    return ipcRenderer.sendSync('system-locale:get');
  } catch {
    return { locale: null, locales: [] };
  }
}

contextBridge.exposeInMainWorld('desktopUpdater', {
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  onUpdateAvailable: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('updater:update-available', handler);
    return () => ipcRenderer.removeListener('updater:update-available', handler);
  },
  onUpdateDownloading: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('updater:downloading', handler);
    return () => ipcRenderer.removeListener('updater:downloading', handler);
  },
  onUpdateDownloaded: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('updater:update-downloaded', handler);
    return () => ipcRenderer.removeListener('updater:update-downloaded', handler);
  },
  onUpdateError: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('updater:error', handler);
    return () => ipcRenderer.removeListener('updater:error', handler);
  },
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  remindLater: () => ipcRenderer.invoke('updater:remind-later'),
  getState: () => ipcRenderer.invoke('updater:get-state'),
});

contextBridge.exposeInMainWorld('desktopShortcuts', {
  getHideShowShortcut: () => ipcRenderer.invoke('shortcuts:get-hide-show'),
  setHideShowShortcut: (payload) => ipcRenderer.invoke('shortcuts:set-hide-show', payload),
  setShortcutRecordingActive: (active) =>
    ipcRenderer.invoke('shortcuts:set-recording-active', active),
});

contextBridge.exposeInMainWorld('desktopStartup', {
  getStartupSetting: () => ipcRenderer.invoke('startup:get'),
  setStartupSetting: (enabled) => ipcRenderer.invoke('startup:set', enabled),
});

contextBridge.exposeInMainWorld('desktopEnvironment', {
  getInfo: () => ipcRenderer.invoke('desktop-environment:get'),
});

contextBridge.exposeInMainWorld('desktopExternal', {
  open: (url) => ipcRenderer.invoke('external:open', url),
});

contextBridge.exposeInMainWorld('desktopWindow', {
  closeApp: () => ipcRenderer.send('app:quit'),
  onFocusSearch: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('focus-search', handler);
    return () => ipcRenderer.removeListener('focus-search', handler);
  },
  getWindowState: () => ipcRenderer.invoke('window-state:get'),
  setWindowPreset: (preset) => ipcRenderer.invoke('window-state:set-preset', preset),
  setCustomBounds: (bounds) => ipcRenderer.invoke('window-state:set-custom-bounds', bounds),
  onWindowStateChanged: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('window-state:changed', handler);
    return () => ipcRenderer.removeListener('window-state:changed', handler);
  },
});

contextBridge.exposeInMainWorld('desktopMaintenance', {
  repairCaches: () => ipcRenderer.invoke('app:repair-caches'),
  restartApp: () => ipcRenderer.send('app:restart'),
});

contextBridge.exposeInMainWorld('desktopConfig', {
  getLayoutOrders: (userId) => ipcRenderer.invoke('layout-config:get', userId),
  setLayoutOrders: (userId, layouts) =>
    ipcRenderer.sendSync('layout-config:set', userId, layouts),
  deleteLayoutOrders: (userId) => ipcRenderer.invoke('layout-config:delete', userId),
});

contextBridge.exposeInMainWorld('systemLocale', getSystemLocaleInfo());
