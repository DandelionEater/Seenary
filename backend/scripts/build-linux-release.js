const { spawnSync } = require('child_process');
const path = require('path');

const packageJson = require('../package.json');

const backendDir = path.resolve(__dirname, '..');
const releaseDir = path.resolve(backendDir, '..', 'release', packageJson.version, 'linux');
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
const linuxTargets = process.platform === 'linux' ? ['dir', 'AppImage', 'flatpak'] : ['dir'];

if (process.platform !== 'linux') {
  console.log(
    'AppImage and Flatpak creation require a Linux build host. Creating the unpacked Linux bundle only.'
  );
}

run(builderCommand, [
  '--linux',
  ...linuxTargets,
  '--x64',
  '--publish',
  'never',
  '--config.extraMetadata.seenaryBundledFrontend=true',
  `--config.directories.output=${path.relative(backendDir, releaseDir)}`,
]);
