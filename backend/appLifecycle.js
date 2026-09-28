const { app, ipcMain, session } = require('electron');

let isRegistered = false;

function registerAppLifecycleIpc() {
  if (isRegistered) return;
  isRegistered = true;

  ipcMain.on('app:quit', () => {
    app.quit();
  });

  ipcMain.on('app:restart', () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle('app:diagnostics', () => {
    let profileWritable = false;
    try { require('node:fs').accessSync(app.getPath('userData'), require('node:fs').constants.W_OK); profileWritable = true; } catch { /* No paths or raw exceptions in reports. */ }
    return { platform: process.platform, architecture: process.arch, appVersion: app.getVersion(),
      electronVersion: process.versions.electron, chromiumVersion: process.versions.chrome, packaged: app.isPackaged, profileWritable };
  });

  ipcMain.handle('app:repair-caches', async () => {
    try {
      const desktopSession = session.defaultSession;
      await desktopSession.clearCache();
      if (typeof desktopSession.clearCodeCaches === 'function') {
        await desktopSession.clearCodeCaches({});
      }
      await desktopSession.clearStorageData({
        storages: ['cachestorage', 'serviceworkers'],
      });
      return { ok: true, clearedWebCache: true };
    } catch (error) {
      console.error('Failed to repair desktop caches:', error);
      return {
        ok: false,
        clearedWebCache: false,
        message: error?.message || 'Seenary could not clear the desktop web cache.',
      };
    }
  });
}

module.exports = { registerAppLifecycleIpc };
