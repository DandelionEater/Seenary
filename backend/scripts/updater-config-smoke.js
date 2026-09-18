const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const backendDir = path.resolve(__dirname, '..');
const packageJson = require('../package.json');
const updaterSource = fs.readFileSync(path.join(backendDir, 'updater.js'), 'utf8');
const windowsBuildSource = fs.readFileSync(
  path.join(backendDir, 'scripts', 'build-release.js'),
  'utf8'
);
const linuxBuildSource = fs.readFileSync(
  path.join(backendDir, 'scripts', 'build-linux-release.js'),
  'utf8'
);
const provider = packageJson.build?.publish?.[0];
const windowsArtifactName = packageJson.build?.win?.artifactName;

assert.deepEqual(provider, {
  provider: 'github',
  owner: 'DandelionEater',
  repo: 'Seenary',
  private: false,
  tagNamePrefix: 'v',
});
assert.equal(
  windowsArtifactName,
  '${productName}-Setup-${version}.${ext}',
  'The Windows artifact name must remain GitHub-safe and match update metadata.'
);
for (const [label, source] of [
  ['Windows', windowsBuildSource],
  ['Linux', linuxBuildSource],
]) {
  assert.match(
    source,
    /['"]--publish['"]\s*,\s*['"]never['"]/,
    `${label} packaging must not publish before the coordinated release job.`
  );
}

function exerciseUpdater(version, platform = 'win32') {
  let downloadCalls = 0;
  const autoUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    disableDifferentialDownload: false,
    allowPrerelease: null,
    on() {},
    checkForUpdates() {
      return Promise.resolve();
    },
    downloadUpdate() {
      downloadCalls += 1;
      return Promise.resolve([]);
    },
    setFeedURL() {
      throw new Error('The packaged app-update.yml should configure the GitHub provider.');
    },
  };
  const app = {
    isPackaged: true,
    getVersion: () => version,
  };
  const module = { exports: {} };
  const timer = { unref() {} };
  const handlers = new Map();
  const context = {
    require(id) {
      if (id === 'electron') {
        return {
          app,
          ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
          shell: { openExternal() { return Promise.resolve(); } },
        };
      }
      if (id === 'electron-updater') {
        return { autoUpdater };
      }
      throw new Error(`Unexpected updater dependency: ${id}`);
    },
    module,
    exports: module.exports,
    console,
    process: { platform },
    setTimeout: () => timer,
    clearTimeout() {},
    setInterval: () => timer,
    clearInterval() {},
  };

  vm.runInNewContext(updaterSource, context, { filename: 'updater.js' });
  module.exports.setupAutoUpdates({
    isDestroyed: () => false,
    webContents: { send() {} },
  });

  return { autoUpdater, handlers, getDownloadCalls: () => downloadCalls };
}

const betaEnvironment = exerciseUpdater('0.1.9-beta');
const { autoUpdater: betaUpdater } = betaEnvironment;
assert.equal(betaUpdater.allowPrerelease, true);
assert.equal(betaUpdater.autoDownload, false);
assert.equal(betaUpdater.autoInstallOnAppQuit, false);
assert.equal(betaUpdater.disableDifferentialDownload, true);

const { autoUpdater: stableUpdater } = exerciseUpdater('0.2.0');
assert.equal(stableUpdater.allowPrerelease, false);

const linuxUpdater = exerciseUpdater('0.1.9-beta', 'linux');
const linuxState = linuxUpdater.handlers.get('updater:get-state')();
assert.equal(typeof linuxUpdater.handlers.get('updater:check'), 'function');
assert.equal(linuxState.available, false);
assert.equal(linuxState.manualDownload, true);
assert.match(updaterSource, /api\.github\.com\/repos\/DandelionEater\/Seenary\/releases/);
assert.match(updaterSource, /https:\/\/seenary\.app/);

Promise.all([
  betaEnvironment.handlers.get('updater:download')(),
  betaEnvironment.handlers.get('updater:download')(),
])
  .then((results) => {
    assert.equal(betaEnvironment.getDownloadCalls(), 1);
    assert.equal(results.length, 2);
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, true);
    console.log('GitHub updater configuration checks passed.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
