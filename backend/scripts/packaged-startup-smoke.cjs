// Hidden boot check against the actual packaged ASAR; never uses the user's profile.
const electron = require('electron');
const { app } = electron;
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const assert = require('node:assert/strict');
const resources = path.resolve(process.argv[2]);
const archive = path.join(resources, 'app.asar');
if (!fs.existsSync(archive)) throw new Error('Packaged ASAR is missing.');
const profiles = path.resolve(__dirname, '../node_modules/.cache/startup-profiles');
fs.mkdirSync(profiles, {recursive:true});
app.setPath('userData', fs.mkdtempSync(path.join(profiles, 'audit-')));
app.disableHardwareAcceleration();
Object.defineProperty(app, 'isPackaged', {value:true});
Object.defineProperty(process, 'resourcesPath', {value:resources});
const NativeWindow = electron.BrowserWindow;
class HiddenWindow extends NativeWindow {
  constructor(options) { super({...options,show:false}); }
  show() {}
}
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request === 'electron') return {...electron,BrowserWindow:HiddenWindow};
  return originalLoad.call(this, request, ...args);
};
let server, finished = false;
function finish(error) {
  if (finished) return; finished=true;
  if (error) console.error(error);
  else console.log('PASS: packaged desktop main boots, packaged preload initializes, diagnostics IPC responds, and removed shortcuts remain disabled.');
  server?.close(); app.exit(error ? 1 : 0);
}
process.on('uncaughtException',finish);
process.on('unhandledRejection',finish);
setTimeout(()=>finish(Error('Packaged startup timed out.')),15000);
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('render-process-gone',()=>finish(Error('Packaged renderer crashed.')));
  win.webContents.on('preload-error',(_event,_file,error)=>finish(error));
  win.webContents.once('did-finish-load',async()=>{
    try {
      const report=await win.webContents.executeJavaScript('window.desktopDiagnostics.getInfo()');
      assert.equal(report.packaged,true); assert.equal(report.profileWritable,true);
      const shortcut=await win.webContents.executeJavaScript('window.desktopShortcuts.getHideShowShortcut()');
      assert.equal(shortcut.enabled,false);
      assert.equal(await win.webContents.executeJavaScript('typeof window.desktopLibrary.update'), 'function');
      setTimeout(()=>finish(),500);
    } catch(error) {finish(error);}
  });
});
server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Isolated packaged boot check</title>');});
server.listen(0,'127.0.0.1',()=>{
  process.env.SEENARY_APP_URL='http://127.0.0.1:'+server.address().port;
  require(path.join(archive,'desktop-main.js'));
});
