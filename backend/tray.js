const { Tray, Menu, app, ipcMain } = require('electron');
const path = require('path');
const { sanitizeLibrary, libraryMenu } = require('./trayLibrary');

let tray;
let activeWindow;
let library = sanitizeLibrary(null);
let refreshMenu;
let listening = false;

function setupTray(win, options = {}) {
  activeWindow = win;
  if (!listening) {
    listening = true;
    ipcMain.on('tray:library-state', (event, value) => {
      if (!activeWindow || activeWindow.isDestroyed() || event.sender !== activeWindow.webContents) return;
      library = sanitizeLibrary(value); refreshMenu?.();
    });
  }
  const navigate = action => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show(); win.focus(); win.webContents.send('tray:navigate', action);
  };
  const iconPath = path.join(__dirname, 'tray.png');

  if (!tray) {
    tray = new Tray(iconPath);
  }

  function refreshContextMenu() {
    const contextMenu = Menu.buildFromTemplate([
      ...libraryMenu(library, navigate),
      {
        label: 'Show / Hide',
        click: () => {
          win.isVisible() ? win.hide() : win.show();
        },
      },
      ...(options.onToggleGamingMode
        ? [
            {
              label: Boolean(options.isGamingModeEnabled?.())
                ? 'Gaming mode: On'
                : 'Gaming mode: Off',
              click: () => {
                options.onToggleGamingMode(!Boolean(options.isGamingModeEnabled?.()));
                refreshContextMenu();
              },
            },
          ]
        : []),
      ...(options.onCheckForUpdates
        ? [
            {
              label: 'Check for Updates',
              click: () => {
                options.onCheckForUpdates();
              },
            },
          ]
        : []),
      {
        type: 'separator',
      },
      {
        label: 'Exit',
        click: () => {
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);
  }

  tray.setToolTip('Seenary');
  refreshMenu = refreshContextMenu;
  refreshContextMenu();

  tray.removeAllListeners('click');
  tray.on('click', () => {
    win.isVisible() ? win.hide() : win.show();
  });
}

module.exports = { setupTray };
