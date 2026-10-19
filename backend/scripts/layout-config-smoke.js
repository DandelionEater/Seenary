const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'seenary-layout-config-'));
const handlers = new Map();
const synchronousHandlers = new Map();
const moduleValue = { exports: {} };
const source = fs.readFileSync(path.resolve(__dirname, '..', 'layoutConfig.js'), 'utf8');

try {
  vm.runInNewContext(source, {
    require(id) {
      if (id === 'electron') return {
        app: { getPath(name) { assert.equal(name, 'userData'); return temporaryDirectory; } },
        ipcMain: {
          handle(channel, handler) { handlers.set(channel, handler); },
          on(channel, handler) { synchronousHandlers.set(channel, handler); },
        },
      };
      return require(id);
    },
    module: moduleValue,
    exports: moduleValue.exports,
    console,
  }, { filename: 'layoutConfig.js' });

  moduleValue.exports.registerLayoutConfigIpc();
  const set = (userId, payload) => {
    const event = {};
    synchronousHandlers.get('layout-config:set')(event, userId, payload);
    return event.returnValue;
  };
  const grid = [
    { id: 'spotlight', columns: 7, rows: 6 },
    { id: 'sinceLiked', columns: 12, rows: 10, orientation: 'horizontal' },
  ];
  assert.equal(set(-1, { personalGridLayout: grid }).ok, true, 'Atlas preference IDs must be accepted');
  const loaded = handlers.get('layout-config:get')(null, -1);
  assert.equal(loaded.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.personalGridLayout)), grid);

  const configPath = path.join(temporaryDirectory, 'seenary-config.json');
  const stored = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(stored.version, 2);
  assert.deepEqual(stored.users['-1'].personalGridLayout, grid);
  assert.equal(set(-1, { personalGridLayout: [{ id: 'spotlight', columns: 99, rows: 1 }] }).ok, false,
    'Invalid geometry must not replace the saved layout');
  assert.deepEqual(
    JSON.parse(JSON.stringify(handlers.get('layout-config:get')(null, -1).personalGridLayout)),
    grid
  );

  assert.equal(set(-1, { mangaPersonalGridLayout: [{ id: 'account', columns: 5, rows: 6 }] }).ok, true);
  const customizedGrid = [
    { id: 'planned', columns: 1, rows: 1, orientation: 'vertical', hidden: true },
    { id: 'activity', columns: 3, rows: 25 },
    { id: 'sinceLiked', columns: 1, rows: 1, hidden: true },
  ];
  assert.equal(set(-1, { personalGridLayout: customizedGrid }).ok, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')).users['-1'].personalGridLayout,
    customizedGrid, 'The ordering file must preserve hidden shelves, order, and custom dimensions');
  assert.deepEqual(JSON.parse(JSON.stringify(handlers.get('layout-config:get')(null, -1).personalGridLayout)),
    customizedGrid, 'Reloading must preserve removed shelves');
  const restoredGrid = customizedGrid.map(({ hidden, ...item }) => item);
  assert.equal(set(-1, { personalGridLayout: restoredGrid }).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(handlers.get('layout-config:get')(null, -1).personalGridLayout)),
    restoredGrid, 'Re-added shelves must retain their order and dimensions');
  assert.deepEqual(JSON.parse(JSON.stringify(handlers.get('layout-config:get')(null, -1).mangaPersonalGridLayout)),
    [{ id: 'account', columns: 5, rows: 6 }], 'Anime edits must preserve the manga layout');
  const discoverGrid = [{ id: 'trending', columns: 1, rows: 1 }, { id: 'popular-anime', columns: 7, rows: 30 }];
  assert.equal(set(-1, { discoverGridLayout: discoverGrid, discoverLayoutOrder: ['popular-anime', 'trending'] }).ok, true);
  const discoverLoaded = handlers.get('layout-config:get')(null, -1);
  assert.deepEqual(JSON.parse(JSON.stringify(discoverLoaded.discoverGridLayout)), discoverGrid,
    'Discover must reload 1x1 sizes and heights beyond the old limit');
  assert.deepEqual(JSON.parse(JSON.stringify(discoverLoaded.discoverLayoutOrder)), ['popular-anime', 'trending']);
  assert.equal(set(-1, { discoverHiddenSections: ['trending', 'popular-anime'] }).ok, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')).users['-1'].discoverHiddenSections,
    ['trending', 'popular-anime'], 'Removed Discover shelves must be stored in the ordering file');
  const hiddenDiscover = handlers.get('layout-config:get')(null, -1);
  assert.deepEqual(JSON.parse(JSON.stringify(hiddenDiscover.discoverHiddenSections)), ['trending', 'popular-anime']);
  assert.deepEqual(JSON.parse(JSON.stringify(hiddenDiscover.discoverGridLayout)), discoverGrid,
    'Removing shelves must preserve their custom sizes');
  assert.deepEqual(JSON.parse(JSON.stringify(hiddenDiscover.discoverLayoutOrder)), ['popular-anime', 'trending'],
    'Removing shelves must preserve their positions');
  assert.equal(set(-1, { discoverHiddenSections: [] }).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(handlers.get('layout-config:get')(null, -1).discoverHiddenSections)), [],
    'Re-adding all Discover shelves must persist across reloads');
  assert.equal(set(-1, { discoverGridLayout: [{ id: 'trending', columns: 13, rows: 1 }] }).ok, false);
  assert.equal(set(-1, { discoverGridLayout: [] }).ok, true, 'Reset must clear saved Discover sizes');
  assert.deepEqual(JSON.parse(JSON.stringify(handlers.get('layout-config:get')(null, -1).discoverGridLayout)), []);
  assert.equal(fs.existsSync(path.join(temporaryDirectory, 'seenary-config.backup.json')), true,
    'Updating the JSON configuration must retain its previous version as a backup');
  console.log('Desktop JSON layout configuration checks passed.');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
