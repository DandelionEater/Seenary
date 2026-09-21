const { spawnSync } = require('child_process');
const path = require('path');

const packageJson = require('../package.json');

const backendDir = path.resolve(__dirname, '..');
const releaseDir = path.resolve(backendDir, '..', 'release', packageJson.version);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const builderCommand = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: backendDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

run(npmCommand, ['run', 'build:frontend'], {
  env: {
    ...process.env,
    VITE_ATLAS_PRODUCTION: 'true',
    VITE_API_BASE_URL: 'https://api.seenary.app',
  },
});
run(process.execPath, ['scripts/build-custom-uninstaller.js'], { shell: false });
run(builderCommand, [
  '--win',
  'nsis',
  '--publish',
  'never',
  `--config.directories.output=${path.relative(backendDir, releaseDir)}`,
]);
run(process.execPath, ['scripts/build-custom-installer.js'], { shell: false });
run(process.execPath, ['scripts/write-release-notes.js', releaseDir], { shell: false });
