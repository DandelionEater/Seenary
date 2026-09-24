const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const CONFIG_VERSION = 2;
const CONFIG_FILE = 'seenary-config.json';
const CONFIG_BACKUP_FILE = 'seenary-config.backup.json';
const LAYOUT_KEYS = new Set([
  'personalLayoutOrder',
  'mangaPersonalLayoutOrder',
  'discoverLayoutOrder',
  'myListSectionOrder',
  'mangaMyListSectionOrder',
]);
const GRID_LAYOUT_KEYS = new Set(['personalGridLayout', 'mangaPersonalGridLayout']);
const GRID_WIDGET_IDS = new Set(['spotlight', 'account', 'stats', 'activity', 'continue', 'planned', 'sinceLiked']);

function getConfigPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function getBackupPath() {
  return path.join(app.getPath('userData'), CONFIG_BACKUP_FILE);
}

function createEmptyConfig() {
  return { version: CONFIG_VERSION, users: {} };
}

function normalizeOrder(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  const order = value
    .filter((item) => typeof item === 'string' && item.length > 0 && item.length <= 100)
    .slice(0, 100);

  return [...new Set(order)];
}

function normalizeUserLayouts(value) {
  const layouts = {};

  for (const key of LAYOUT_KEYS) {
    const order = normalizeOrder(value?.[key]);
    if (order) {
      layouts[key] = order;
    }
  }

  for (const key of GRID_LAYOUT_KEYS) {
    const layout = normalizeGridLayout(value?.[key]);
    if (layout) layouts[key] = layout;
  }

  return layouts;
}

function normalizeGridLayout(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const layout = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
        || !GRID_WIDGET_IDS.has(candidate.id) || seen.has(candidate.id)
        || !Number.isInteger(candidate.columns) || candidate.columns < 1 || candidate.columns > 12
        || !Number.isInteger(candidate.rows) || candidate.rows < 1 || candidate.rows > 20
        || candidate.orientation != null && !['horizontal', 'vertical'].includes(candidate.orientation)) continue;
    seen.add(candidate.id);
    layout.push({ id: candidate.id, columns: candidate.columns, rows: candidate.rows,
      ...(candidate.orientation ? { orientation: candidate.orientation } : {}) });
  }
  return layout.length ? layout : null;
}

function normalizeConfig(value) {
  const users = {};

  if (value?.users && typeof value.users === 'object') {
    for (const [userId, layouts] of Object.entries(value.users)) {
      if (/^-?[1-9]\d*$/.test(userId)) {
        users[userId] = normalizeUserLayouts(layouts);
      }
    }
  }

  return { version: CONFIG_VERSION, users };
}

function readJsonFile(filePath) {
  return normalizeConfig(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function readConfig() {
  try {
    return readJsonFile(getConfigPath());
  } catch {
    try {
      return readJsonFile(getBackupPath());
    } catch {
      return createEmptyConfig();
    }
  }
}

function writeConfig(config) {
  const configPath = getConfigPath();
  const backupPath = getBackupPath();
  const normalized = normalizeConfig(config);

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    if (fs.existsSync(configPath)) {
      fs.copyFileSync(configPath, backupPath);
    }

    fs.writeFileSync(configPath, JSON.stringify(normalized, null, 2), {
      encoding: 'utf8',
      flush: true,
    });

    return { ok: true, config: normalized };
  } catch (error) {
    console.warn('Failed to save Seenary configuration:', error);
    return { ok: false, config: normalized, message: 'Failed to save desktop configuration.' };
  }
}

function normalizeUserId(value) {
  const userId = Number(value);
  return Number.isSafeInteger(userId) && userId !== 0 ? String(userId) : null;
}

function getLayoutOrders(userIdValue) {
  const userId = normalizeUserId(userIdValue);

  if (!userId) {
    return { ok: false, message: 'A valid Seenary user is required.' };
  }

  const config = readConfig();
  const hadUser = Object.prototype.hasOwnProperty.call(config.users, userId);
  const layouts = normalizeUserLayouts(config.users[userId]);

  if (!hadUser) {
    config.users[userId] = layouts;
    const result = writeConfig(config);
    if (!result.ok) return result;
  }

  return { ok: true, ...layouts };
}

function setLayoutOrders(userIdValue, payload) {
  const userId = normalizeUserId(userIdValue);

  if (!userId || !payload || typeof payload !== 'object') {
    return { ok: false, message: 'Valid layout configuration is required.' };
  }

  const config = readConfig();
  const current = normalizeUserLayouts(config.users[userId]);

  for (const key of LAYOUT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    const order = normalizeOrder(payload[key]);
    if (!order) {
      return { ok: false, message: `Invalid ${key}.` };
    }
    current[key] = order;
  }
  for (const key of GRID_LAYOUT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    const layout = normalizeGridLayout(payload[key]);
    if (!layout) return { ok: false, message: `Invalid ${key}.` };
    current[key] = layout;
  }

  config.users[userId] = current;
  const result = writeConfig(config);
  return result.ok ? { ok: true, ...current } : result;
}

function deleteLayoutOrders(userIdValue) {
  const userId = normalizeUserId(userIdValue);
  if (!userId) return { ok: false, message: 'A valid Seenary user is required.' };

  const config = readConfig();
  if (!Object.prototype.hasOwnProperty.call(config.users, userId)) return { ok: true };
  delete config.users[userId];
  const result = writeConfig(config);
  return result.ok ? { ok: true } : result;
}

function registerLayoutConfigIpc() {
  ipcMain.handle('layout-config:get', (_event, userId) => getLayoutOrders(userId));
  ipcMain.on('layout-config:set', (event, userId, payload) => {
    event.returnValue = setLayoutOrders(userId, payload);
  });
  ipcMain.handle('layout-config:delete', (_event, userId) => deleteLayoutOrders(userId));
}

module.exports = { registerLayoutConfigIpc, deleteLayoutOrders };
