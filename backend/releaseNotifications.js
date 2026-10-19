const path = require('node:path');

function validateNotice(value) {
  if (!value || !Number.isSafeInteger(value.id) || value.id < 0 || !['ANIME', 'MANGA'].includes(value.type)
      || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 600
      || typeof value.message !== 'string' || value.message.length > 400) return null;
  let cover = null;
  try { const url = new URL(value.cover); if (url.protocol === 'https:' && !url.username && !url.password) cover = url.href; } catch { /* Cover is optional. */ }
  return { id: value.id, type: value.type, title: value.title, message: value.message, cover, preview: value.preview === true };
}

function registerReleaseNotificationIpc(getMainWindow) {
  const { app, BrowserWindow, ipcMain, screen } = require('electron');
  let popup = null; let timer = null; let notice = null;
  function close(animate = false) {
    if (timer) clearTimeout(timer);
    timer = null; notice = null;
    const previous = popup; popup = null;
    if (previous && !previous.isDestroyed()) {
      if (animate) {
        previous.webContents.send('release-notice:fade-out');
        setTimeout(() => { if (!previous.isDestroyed()) previous.close(); }, 200);
      } else previous.close();
    }
  }
  const fromMain = event => { const main = getMainWindow(); return main && !main.isDestroyed() && event.sender === main.webContents; };
  ipcMain.handle('release-notice:show', async (event, value) => {
    if (!fromMain(event)) return { ok: false };
    const checked = validateNotice(value);
    if (!checked || (checked.preview && !require('./package.json').version.endsWith('-dev'))) return { ok: false };
    close(); notice = checked;
    const main = getMainWindow();
    const area = screen.getDisplayMatching(main.getBounds()).workArea;
    const width = Math.min(410, area.width - 24); const height = Math.min(235, area.height - 24);
    const win = new BrowserWindow({ width, height, x: area.x + area.width - width - 16, y: area.y + area.height - height - 16,
      show: false, frame: false, transparent: true, resizable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true,
      webPreferences: { preload: path.join(__dirname, 'release-notification-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    popup = win;
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.on('closed', () => { if (popup === win) { popup = null; notice = null; if (timer) clearTimeout(timer); timer = null; } });
    try {
      await win.loadFile(path.join(__dirname, 'release-notification.html'));
      if (popup !== win || win.isDestroyed()) return { ok: true };
      win.webContents.send('release-notice:data', checked);
      return { ok: true };
    } catch { if (popup === win) close(); return { ok: false }; }
  });
  ipcMain.handle('release-notice:clear', event => { if (fromMain(event)) close(); return { ok: true }; });
  ipcMain.on('release-notice:resize', (event, requestedHeight) => {
    if (!popup || popup.isDestroyed() || event.sender !== popup.webContents || !Number.isFinite(requestedHeight)) return;
    const bounds = popup.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const height = Math.max(80, Math.min(Math.ceil(requestedHeight), area.height - 24));
    popup.setBounds({ ...bounds, height, y: area.y + area.height - height - 16 });
    popup.showInactive();
    popup.webContents.send('release-notice:visible');
    if (!timer) timer = setTimeout(() => close(true), 10000);
  });
  ipcMain.on('release-notice:dismiss', event => { if (popup && event.sender === popup.webContents) close(true); });
  ipcMain.on('release-notice:open', event => {
    if (!popup || event.sender !== popup.webContents) return;
    const selected = notice; const main = getMainWindow(); close(true);
    if (!selected?.id || !main || main.isDestroyed()) return;
    if (main.isMinimized()) main.restore(); main.show(); main.focus();
    main.webContents.send('release-notice:navigate', { id: selected.id, type: selected.type });
  });
  const heartbeat = setInterval(() => { const main = getMainWindow(); if (main && !main.isDestroyed()) main.webContents.send('release-notice:tick'); }, 30000);
  heartbeat.unref();
  app.on('before-quit', () => { clearInterval(heartbeat); close(); });
}
module.exports = { registerReleaseNotificationIpc, validateNotice };
