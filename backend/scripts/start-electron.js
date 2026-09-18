const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const electron = require('electron');

const packageRoot = path.resolve(__dirname, '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const isUpdatePreview = process.argv.includes('--preview-update');
if (isUpdatePreview) {
  env.SEENARY_PREVIEW_UPDATE_DIALOG = '1';
  env.SEENARY_USE_BUNDLED_FRONTEND = '1';
}

const userDataDir = path.join(
  packageRoot,
  isUpdatePreview ? '.electron-update-preview' : '.electron-user-data',
);
const logPath = path.join(userDataDir, 'electron-dev.log');
const mainPath = path.join(packageRoot, 'scripts', 'electron-main-wrapper.js');
const nativeModuleProbe = "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.prepare('SELECT 1').get(); db.close(); process.stdout.write('ok')";
const args = [
  '--disable-crash-reporter',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--no-sandbox',
  `--user-data-dir=${userDataDir}`,
  mainPath,
];

function probeElectronNativeModules() {
  return spawnSync(electron, ['-e', nativeModuleProbe], {
    cwd: packageRoot,
    env: {
      ...env,
      ELECTRON_RUN_AS_NODE: '1',
    },
    encoding: 'utf8',
    windowsHide: true,
  });
}

function ensureElectronNativeModules() {
  const initialProbe = probeElectronNativeModules();
  if (initialProbe.status === 0) {
    return;
  }

  console.log('Native modules do not match Electron; rebuilding them now...');
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const rebuild = spawnSync(npmCommand, ['run', 'rebuild:electron'], {
    cwd: packageRoot,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    windowsHide: true,
  });

  if (rebuild.status !== 0 || rebuild.error) {
    console.error(
      rebuild.error?.message ||
        `Electron native-module rebuild failed with status ${rebuild.status ?? 'unknown'}.`,
    );
    process.exit(rebuild.status || 1);
  }

  const rebuiltProbe = probeElectronNativeModules();
  if (rebuiltProbe.status !== 0) {
    process.stderr.write(rebuiltProbe.stderr || 'Electron could not load the rebuilt modules.\n');
    process.exit(rebuiltProbe.status || 1);
  }
}

ensureElectronNativeModules();
fs.mkdirSync(userDataDir, { recursive: true });
const logStream = fs.createWriteStream(logPath, { flags: 'a' });

const child = spawn(electron, args, {
  cwd: packageRoot,
  env,
  stdio: ['inherit', 'inherit', 'pipe'],
  windowsHide: false,
});

child.stderr.pipe(logStream);

child.on('exit', (code, signal) => {
  logStream.end();

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
