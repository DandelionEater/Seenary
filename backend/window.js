const { app, BrowserWindow } = require('electron');
const path = require('path');
const { attachWindowState, getInitialWindowOptions } = require('./windowState');

function createWindow() {
  const debugWindow = !app.isPackaged && process.env.ELECTRON_DEBUG_WINDOW === '1';
  const iconPath = path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  const initialWindowOptions = getInitialWindowOptions();
  const win = new BrowserWindow({
    ...initialWindowOptions,

    minWidth: 900,
    minHeight: 600,

    frame: debugWindow,
    transparent: !debugWindow,
    backgroundColor: debugWindow ? '#111111' : '#00000000',

    resizable: true,
    hasShadow: true,
    icon: iconPath,

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  attachWindowState(win);

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, 'frontend-dist', 'index.html'));
  } else {
    const rendererUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173';
    win.loadURL(rendererUrl);
  }

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(`Renderer failed to load ${validatedUrl}: ${errorCode} ${errorDescription}`);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process gone:', details);
  });

  win.webContents.on('did-create-window', (childWindow) => {
    childWindow.setIcon(iconPath);
  });


  return win;
}

module.exports = { createWindow };
