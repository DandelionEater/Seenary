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
  assert.equal(fs.existsSync(path.join(temporaryDirectory, 'seenary-config.backup.json')), true,
    'Updating the JSON configuration must retain its previous version as a backup');
  console.log('Desktop JSON layout configuration checks passed.');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
