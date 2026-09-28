const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { version } = require('../package.json');

const resources = path.resolve(process.argv[2] || path.join(__dirname, '../../release', version, 'win-unpacked/resources'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(require('electron'), [
  path.join(__dirname, 'packaged-startup-smoke.cjs'), resources,
  '--disable-gpu', '--disable-software-rasterizer',
], { env, stdio: 'inherit', windowsHide: true, timeout: 25000 });
if (result.error) console.error(result.error.message);
process.exitCode = result.status === 0 && !result.error ? 0 : 1;
