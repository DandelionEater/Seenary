const { app, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');

const UPDATE_CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000;
const STARTUP_CHECK_DELAY_MS = 10 * 1000;
const UPDATE_DIALOG_PREVIEW = process.env?.SEENARY_PREVIEW_UPDATE_DIALOG === '1';
const GITHUB_RELEASES_API = 'https://api.github.com/repos/DandelionEater/Seenary/releases?per_page=20';
const MANUAL_DOWNLOAD_URL = 'https://seenary.app';

let checkTimer = null;
let startupCheckTimer = null;
let isChecking = false;
let isDownloading = false;
let activeWindow = null;
let latestUpdateInfo = null;
let downloadedUpdateInfo = null;
let handlersRegistered = false;
let updaterEventsRegistered = false;
let activeCheckPromise = null;
let activeDownloadPromise = null;

function isAutoUpdateAvailable() {
  return process.platform !== 'linux';
}

function isManualUpdatePlatform() {
  return process.platform === 'linux';
}

function setupAutoUpdates(win) {
  activeWindow = win;
  registerUpdaterIpc();

  if (UPDATE_DIALOG_PREVIEW) {
    latestUpdateInfo = normalizeUpdateInfo({
      version: '0.1.9-beta',
      releaseName: 'Seenary 0.1.9 Beta',
      releaseNotes: [
        'A new Seenary update is ready.',
        '',
        '- Smoother desktop updates through GitHub Releases',
        '- Visual refinements and reliability improvements',
      ].join('\n'),
      releaseDate: new Date().toISOString(),
    });
    return;
  }

  if (!app.isPackaged) {
    return;
  }

  if (isManualUpdatePlatform()) {
    scheduleStartupCheck();
    scheduleRecurringChecks();
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  // Seenary wraps Electron Builder's NSIS output in its own bootstrapper. The
  // installed updater cache therefore contains the inner installer, while the
  // published blockmap describes the outer bootstrapper. A differential update
  // can download most of the installer before failing validation and falling
  // back to a second, full download, so use one verified full transfer instead.
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.allowPrerelease = app.getVersion().includes('-');
  registerUpdaterEvents();

  scheduleStartupCheck();
  scheduleRecurringChecks();
}

function registerUpdaterEvents() {
  if (updaterEventsRegistered) {
    return;
  }

  updaterEventsRegistered = true;

  autoUpdater.on('checking-for-update', () => {
    isChecking = true;
  });

  autoUpdater.on('update-not-available', () => {
    isChecking = false;
  });

  autoUpdater.on('update-available', (info) => {
    isChecking = false;
    latestUpdateInfo = normalizeUpdateInfo(info);

    if (isDownloading) {
      return;
    }

    sendToRenderer('updater:update-available', latestUpdateInfo);
  });

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('updater:downloading', {
      percent: Math.round(progress.percent || 0),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    isDownloading = false;
    downloadedUpdateInfo = normalizeUpdateInfo(info);
    sendToRenderer('updater:update-downloaded', downloadedUpdateInfo);
  });

  autoUpdater.on('error', (error) => {
    handleUpdateError(error);
  });
}

function scheduleStartupCheck() {
  if (startupCheckTimer) {
    clearTimeout(startupCheckTimer);
  }

  startupCheckTimer = setTimeout(() => {
    startupCheckTimer = null;
    checkForUpdates();
  }, STARTUP_CHECK_DELAY_MS);
  startupCheckTimer.unref?.();
}

function scheduleRecurringChecks() {
  if (checkTimer) {
    return;
  }

  checkTimer = setInterval(() => {
    checkForUpdates();
  }, UPDATE_CHECK_INTERVAL_MS);
  checkTimer.unref?.();
}

function checkForUpdates(win = null) {
  if (!app.isPackaged || isDownloading) {
    return Promise.resolve({
      ok: false,
      message: !app.isPackaged
        ? 'Update checks are available after installing the desktop app.'
        : 'An update is already downloading.',
    });
  }

  activeWindow = win || activeWindow;
  if (activeCheckPromise) return activeCheckPromise;

  if (isManualUpdatePlatform()) {
    activeCheckPromise = checkGitHubForManualUpdate()
      .then((info) => ({ ok: true, updateAvailable: Boolean(info), info }))
      .catch((error) => {
        handleUpdateError(error);
        return { ok: false, message: error.message || 'Seenary could not check for updates.' };
      })
      .finally(() => {
        activeCheckPromise = null;
      });
    return activeCheckPromise;
  }

  activeCheckPromise = autoUpdater
    .checkForUpdates()
    .then((result) => ({
      ok: true,
      updateAvailable: result?.isUpdateAvailable === true,
      info: result?.updateInfo ? normalizeUpdateInfo(result.updateInfo) : null,
    }))
    .catch((error) => {
      handleUpdateError(error);
      return { ok: false, message: error.message || 'Seenary could not check for updates.' };
    })
    .finally(() => {
      activeCheckPromise = null;
    });
  return activeCheckPromise;
}

function registerUpdaterIpc() {
  if (handlersRegistered) {
    return;
  }

  handlersRegistered = true;

  ipcMain.handle('updater:check', () => checkForUpdates(activeWindow));

  ipcMain.handle('updater:download', async () => {
    if (UPDATE_DIALOG_PREVIEW) {
      return {
        ok: false,
        message: 'This is an update-dialog preview; no update will be downloaded.',
      };
    }

    if (isManualUpdatePlatform()) {
      await shell.openExternal(MANUAL_DOWNLOAD_URL);
      return { ok: true, manual: true };
    }

    if (!app.isPackaged || !isAutoUpdateAvailable()) {
      return {
        ok: false,
        message: isAutoUpdateAvailable()
          ? 'Seenary updates are available after installing the desktop app.'
          : 'Automatic updates are not enabled in this first Linux test build.',
      };
    }

    if (downloadedUpdateInfo) {
      return { ok: true, downloaded: true };
    }

    if (activeDownloadPromise) {
      return activeDownloadPromise;
    }

    isDownloading = true;
    sendToRenderer('updater:downloading', { percent: 0 });

    activeDownloadPromise = autoUpdater
      .downloadUpdate()
      .then(() => ({ ok: true }))
      .catch((error) => {
        handleUpdateError(error);
        return {
          ok: false,
          message: error.message || 'Seenary could not download the update.',
        };
      })
      .finally(() => {
        activeDownloadPromise = null;
      });

    return activeDownloadPromise;
  });

  ipcMain.handle('updater:install', () => {
    if (!app.isPackaged || !downloadedUpdateInfo) {
      return { ok: false };
    }

    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  });

  ipcMain.handle('updater:remind-later', () => {
    return { ok: true };
  });

  ipcMain.handle('updater:get-state', () => getUpdateState());
}

function sendToRenderer(channel, payload) {
  const target = activeWindow && !activeWindow.isDestroyed() ? activeWindow : null;

  if (!target) {
    return;
  }

  target.webContents.send(channel, payload);
}

function normalizeUpdateInfo(info = {}) {
  return {
    version: info.version || '',
    releaseName: info.releaseName || `Seenary ${info.version || ''}`.trim(),
    releaseNotes: normalizeReleaseNotes(info.releaseNotes),
    releaseDate: info.releaseDate || null,
    manualDownload: info.manualDownload === true,
    manualDownloadUrl: info.manualDownloadUrl || null,
  };
}

async function checkGitHubForManualUpdate() {
  isChecking = true;

  try {
    const response = await fetch(GITHUB_RELEASES_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Seenary/${app.getVersion()}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub update check failed with status ${response.status}.`);
    }

    const releases = await response.json();
    const release = selectNewerRelease(releases, app.getVersion());
    isChecking = false;

    if (!release) return null;

    latestUpdateInfo = normalizeUpdateInfo({
      version: normalizeVersion(release.tag_name),
      releaseName: release.name || `Seenary ${normalizeVersion(release.tag_name)}`,
      releaseNotes: release.body || '',
      releaseDate: release.published_at || release.created_at || null,
      manualDownload: true,
      manualDownloadUrl: MANUAL_DOWNLOAD_URL,
    });
    sendToRenderer('updater:update-available', latestUpdateInfo);
    return latestUpdateInfo;
  } catch (error) {
    isChecking = false;
    throw error;
  }
}

function selectNewerRelease(releases, currentVersion) {
  const allowPrerelease = String(currentVersion).includes('-');
  return (Array.isArray(releases) ? releases : [])
    .filter((release) => release && !release.draft && (allowPrerelease || !release.prerelease))
    .filter((release) => compareVersions(normalizeVersion(release.tag_name), currentVersion) > 0)
    .sort((left, right) =>
      compareVersions(normalizeVersion(right.tag_name), normalizeVersion(left.tag_name))
    )[0] || null;
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function compareVersions(left, right) {
  const parse = (value) => {
    const match = normalizeVersion(value).match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
    if (!match) return null;
    return {
      core: match.slice(1, 4).map(Number),
      prerelease: match[4] ? match[4].split('.') : [],
    };
  };
  const leftVersion = parse(left);
  const rightVersion = parse(right);
  if (!leftVersion || !rightVersion) return 0;

  for (let index = 0; index < 3; index += 1) {
    if (leftVersion.core[index] !== rightVersion.core[index]) {
      return leftVersion.core[index] > rightVersion.core[index] ? 1 : -1;
    }
  }
  if (!leftVersion.prerelease.length || !rightVersion.prerelease.length) {
    if (leftVersion.prerelease.length === rightVersion.prerelease.length) return 0;
    return leftVersion.prerelease.length ? -1 : 1;
  }

  const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === rightPart) continue;
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber ? 1 : -1;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

function normalizeReleaseNotes(releaseNotes) {
  if (Array.isArray(releaseNotes)) {
    return releaseNotes
      .map((note) => {
        if (typeof note === 'string') {
          return note;
        }

        return note?.note || note?.text || '';
      })
      .filter(Boolean)
      .join('\n');
  }

  return typeof releaseNotes === 'string' ? releaseNotes : '';
}

function handleUpdateError(error) {
  isChecking = false;
  isDownloading = false;
  console.error('Auto update error:', error);
  sendToRenderer('updater:error', {
    message: error.message || 'Seenary could not check for updates.',
  });
}

function stopAutoUpdates() {
  if (startupCheckTimer) {
    clearTimeout(startupCheckTimer);
    startupCheckTimer = null;
  }

  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

function getUpdateState() {
  return {
    ok: true,
    available: isAutoUpdateAvailable(),
    manualDownload: isManualUpdatePlatform(),
    checking: isChecking,
    downloading: isDownloading,
    intervalMs: UPDATE_CHECK_INTERVAL_MS,
    availableUpdate: latestUpdateInfo,
    downloadedUpdate: downloadedUpdateInfo,
  };
}

module.exports = {
  setupAutoUpdates,
  checkForUpdates,
  isAutoUpdateAvailable,
  stopAutoUpdates,
};
