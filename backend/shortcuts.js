const fs = require('fs');
const path = require('path');
const { app, globalShortcut, ipcMain } = require('electron');
const { isNativeWayland } = require('./desktopEnvironment');

const DEFAULT_HIDE_SHOW_SHORTCUT = 'Control+Space';
const SETTINGS_FILE = 'desktop-shortcuts.json';

let activeHideShowAccelerator = null;
let gamingModeEnabled = false;
let shortcutRecordingActive = false;
let lastRegistrationSucceeded = null;

function isHideShowShortcutRegistered() {
  return Boolean(
    activeHideShowAccelerator && globalShortcut.isRegistered(activeHideShowAccelerator)
  );
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

function readShortcutSettings() {
  try {
    const settingsPath = getSettingsPath();

    if (!fs.existsSync(settingsPath)) {
      return {
        hideShowEnabled: true,
        hideShowAccelerator: DEFAULT_HIDE_SHOW_SHORTCUT,
      };
    }

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return {
      hideShowEnabled: settings.hideShowEnabled !== false,
      hideShowAccelerator:
        typeof settings.hideShowAccelerator === 'string' && settings.hideShowAccelerator.trim()
          ? settings.hideShowAccelerator.trim()
          : DEFAULT_HIDE_SHOW_SHORTCUT,
    };
  } catch {
    return {
      hideShowEnabled: true,
      hideShowAccelerator: DEFAULT_HIDE_SHOW_SHORTCUT,
    };
  }
}

function writeShortcutSettings(settings) {
  const settingsPath = getSettingsPath();
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function getHideShowShortcutSetting() {
  const settings = readShortcutSettings();

  if (isNativeWayland()) {
    return {
      ok: true,
      enabled: false,
      accelerator: settings.hideShowAccelerator,
      defaultAccelerator: DEFAULT_HIDE_SHOW_SHORTCUT,
      registrationMethod: 'unavailable',
      registered: false,
      message: 'Global hide/show shortcuts are unavailable on Wayland in this release.',
    };
  }

  const registrationPaused = gamingModeEnabled || shortcutRecordingActive;
  const registrationFailed =
    settings.hideShowEnabled && !registrationPaused && lastRegistrationSucceeded === false;

  return {
    ok: !registrationFailed,
    enabled: settings.hideShowEnabled,
    accelerator: settings.hideShowAccelerator,
    defaultAccelerator: DEFAULT_HIDE_SHOW_SHORTCUT,
    registrationMethod: 'native',
    registered:
      settings.hideShowEnabled && !registrationPaused
        ? isHideShowShortcutRegistered()
        : false,
    ...(registrationFailed
      ? {
          message: `Could not register ${settings.hideShowAccelerator}. It may be used by another app.`,
        }
      : {}),
  };
}

function normalizeAccelerator(value) {
  return String(value || '')
    .trim()
    .replace(/\s*\+\s*/g, '+');
}

function registerHideShowShortcut(win, accelerator) {
  const normalizedAccelerator = normalizeAccelerator(accelerator);

  if (!normalizedAccelerator) {
    console.warn('[shortcuts] Registration skipped because the accelerator is empty.');
    return false;
  }

  const accepted = globalShortcut.register(normalizedAccelerator, () => {
    console.info(`[shortcuts] Activated ${normalizedAccelerator}.`);

    if (win.isVisible()) {
      win.hide();
    } else {
      win.show();
      win.focus();

      win.webContents.send('focus-search');
    }
  });
  const registered = accepted && globalShortcut.isRegistered(normalizedAccelerator);

  if (registered) {
    activeHideShowAccelerator = normalizedAccelerator;
    console.info(
      `[shortcuts] Registered ${normalizedAccelerator} using the native shortcut API.`
    );
  } else if (accepted) {
    console.warn(
      `[shortcuts] ${normalizedAccelerator} was accepted but could not be confirmed as registered.`
    );
  } else {
    console.warn(`[shortcuts] Failed to register ${normalizedAccelerator}.`);
  }

  lastRegistrationSucceeded = registered;
  return registered;
}

function unregisterHideShowShortcut() {
  if (activeHideShowAccelerator) {
    globalShortcut.unregister(activeHideShowAccelerator);
    activeHideShowAccelerator = null;
  }
}

function registerShortcuts(win) {
  unregisterHideShowShortcut();

  if (isNativeWayland()) {
    lastRegistrationSucceeded = null;
    return;
  }

  const settings = readShortcutSettings();

  if (!settings.hideShowEnabled || gamingModeEnabled || shortcutRecordingActive) {
    lastRegistrationSucceeded = null;
    return;
  }

  registerHideShowShortcut(win, settings.hideShowAccelerator);
}

function setGamingModeEnabled(win, enabled) {
  gamingModeEnabled = Boolean(enabled);

  if (gamingModeEnabled) {
    unregisterHideShowShortcut();

    return {
      enabled: true,
      message: 'Gaming mode enabled. Hide/show shortcut paused.',
    };
  }

  registerShortcuts(win);

  return {
    enabled: false,
    message: 'Gaming mode disabled. Hide/show shortcut restored.',
  };
}

function getGamingModeEnabled() {
  return gamingModeEnabled;
}

function setShortcutRecordingActive(win, active) {
  if (isNativeWayland()) {
    shortcutRecordingActive = false;
    unregisterHideShowShortcut();
    return {
      ok: true,
      active: false,
    };
  }

  shortcutRecordingActive = Boolean(active);

  if (shortcutRecordingActive) {
    unregisterHideShowShortcut();
  } else {
    registerShortcuts(win);
  }

  return {
    ok: true,
    active: shortcutRecordingActive,
  };
}

function updateHideShowShortcutSetting(win, payload = {}) {
  const enabled = Boolean(payload.enabled);
  const accelerator = normalizeAccelerator(payload.accelerator || DEFAULT_HIDE_SHOW_SHORTCUT);

  if (isNativeWayland()) {
    shortcutRecordingActive = false;
    unregisterHideShowShortcut();
    return {
      ok: false,
      enabled: false,
      accelerator,
      registered: false,
      message: 'Global hide/show shortcuts are unavailable on Wayland in this release.',
    };
  }

  // Saving commits the recorder value. Clear this before registration so a delayed
  // focus/blur IPC cannot make a successful registration immediately look active
  // and then unregister it.
  shortcutRecordingActive = false;
  unregisterHideShowShortcut();

  if (!enabled) {
    lastRegistrationSucceeded = null;
    writeShortcutSettings({
      hideShowEnabled: false,
      hideShowAccelerator: accelerator,
    });

    return {
      ok: true,
      enabled: false,
      accelerator,
      registered: false,
      message: 'Hide/show shortcut disabled.',
    };
  }

  if (!accelerator) {
    return {
      ok: false,
      enabled: true,
      accelerator,
      registered: false,
      message: 'Enter a keyboard shortcut first.',
    };
  }

  const registered = registerHideShowShortcut(win, accelerator);

  if (!registered) {
    const current = readShortcutSettings();

    registerShortcuts(win);

    return {
      ok: false,
      enabled: current.hideShowEnabled,
      accelerator: current.hideShowAccelerator,
      registered: isHideShowShortcutRegistered(),
      message: `Could not register ${accelerator}. It may be used by another app.`,
    };
  }

  writeShortcutSettings({
    hideShowEnabled: true,
    hideShowAccelerator: accelerator,
  });

  if (gamingModeEnabled) {
    unregisterHideShowShortcut();
  }

  const remainsRegistered = isHideShowShortcutRegistered();

  return {
    ok: remainsRegistered || gamingModeEnabled,
    enabled: true,
    accelerator,
    registered: remainsRegistered,
    message: gamingModeEnabled
      ? `Hide/show shortcut set to ${accelerator}. Gaming mode is still pausing it.`
      : !remainsRegistered
        ? `Could not keep ${accelerator} registered. Try another shortcut.`
        : `Hide/show shortcut set to ${accelerator}.`,
  };
}

function registerShortcutIpc(getWindow) {
  if (ipcMain.listenerCount('shortcuts:get-hide-show') === 0) {
    ipcMain.handle('shortcuts:get-hide-show', () => getHideShowShortcutSetting());
  }

  if (ipcMain.listenerCount('shortcuts:set-hide-show') === 0) {
    ipcMain.handle('shortcuts:set-hide-show', (_event, payload) => {
      const win = getWindow();

      if (!win || win.isDestroyed()) {
        return {
          ok: false,
          message: 'Seenary window is not ready.',
        };
      }

      return updateHideShowShortcutSetting(win, payload);
    });
  }

  if (ipcMain.listenerCount('shortcuts:set-recording-active') === 0) {
    ipcMain.handle('shortcuts:set-recording-active', (_event, active) => {
      const win = getWindow();

      if (!win || win.isDestroyed()) {
        return {
          ok: false,
          active: false,
          message: 'Seenary window is not ready.',
        };
      }

      return setShortcutRecordingActive(win, active);
    });
  }
}

module.exports = {
  getGamingModeEnabled,
  registerShortcuts,
  registerShortcutIpc,
  setGamingModeEnabled,
};
