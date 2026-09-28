// Run with Electron. Uses a separate profile; never opens or modifies the user's library.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { setupBundledFrontend } = require('../bundledFrontend');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'seenary-diagnostic-'));
const reportPath = process.env.SEENARY_DIAGNOSTIC_REPORT || path.join(profile, 'report.json');
app.setPath('userData', profile);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
process.env.SEENARY_USE_BUNDLED_FRONTEND = '1';
let win;
const report = { platform: process.platform, electron: process.versions.electron, profile, results: {} };
async function main() {
  await app.whenReady();
  await setupBundledFrontend();
  win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await win.loadURL('https://web.seenary.app');
  report.results.storage = await win.webContents.executeJavaScript(`(async () => {
    try {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('seenary-diagnostic', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('probe');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('probe', 'readwrite');
        tx.objectStore('probe').put('diagnostic-only', 'test');
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
      db.close(); return { ok: true };
    } catch (error) { return { ok: false, name: error.name, message: error.message }; }
  })()`);
  report.results.rpc = await win.webContents.executeJavaScript(`(async () => {
    try {
      const response = await fetch('https://api.seenary.app/rpc', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'getSession', args: [] }), signal: AbortSignal.timeout(15000)
      });
      const data = await response.json();
      return { transportOk: true, status: response.status, authenticated: Boolean(data.authenticated) };
    } catch (error) { return { transportOk: false, name: error.name, message: error.message }; }
  })()`);
}
main().catch(error => { report.error = error.message; }).finally(() => {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  win?.destroy(); app.quit();
});
