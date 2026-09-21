const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const backendDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendDir, '..');
const { version } = require('../package.json');
const releaseDir = path.join(repoRoot, 'release', version);
const installerName = `Seenary-Setup-${version}.exe`;
const installerPath = path.join(releaseDir, installerName);
const blockmapPath = `${installerPath}.blockmap`;
const updatePath = path.join(releaseDir, 'latest.yml');
const bundledFrontendDir = path.join(releaseDir, 'win-unpacked', 'resources', 'frontend-dist');

function requireFile(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`Missing release artifact: ${path.relative(repoRoot, file)}`);
  }
}

requireFile(installerPath);
requireFile(blockmapPath);
requireFile(updatePath);
requireFile(path.join(bundledFrontendDir, 'index.html'));

const update = fs.readFileSync(updatePath, 'utf8');
const installer = fs.readFileSync(installerPath);
const sha512 = crypto.createHash('sha512').update(installer).digest('base64');
const expected = [
  `version: ${version}`,
  `url: ${installerName}`,
  `path: ${installerName}`,
  `sha512: ${sha512}`,
  `size: ${installer.length}`,
  `releaseName: Seenary ${version}`,
];
for (const value of expected) {
  if (!update.includes(value)) throw new Error(`Update metadata is missing: ${value}`);
}

const scripts = fs.readdirSync(path.join(bundledFrontendDir, 'assets'))
  .filter(name => /^index-.*\.js$/.test(name))
  .map(name => fs.readFileSync(path.join(bundledFrontendDir, 'assets', name), 'utf8'));
if (!scripts.some(source => source.includes('https://api.seenary.app'))) {
  throw new Error('Packaged frontend does not contain the production API endpoint.');
}
if (!scripts.some(source => source.includes('seenary-cloud-production'))) {
  throw new Error('Packaged frontend does not contain the production Atlas identity.');
}
if (scripts.some(source => source.includes('Atlas staging'))) {
  throw new Error('Packaged frontend still contains the consumer-facing Atlas staging label.');
}

console.log(JSON.stringify({
  version,
  installer: installerName,
  bytes: installer.length,
  sha256: crypto.createHash('sha256').update(installer).digest('hex'),
  blockmapBytes: fs.statSync(blockmapPath).size,
  productionEndpoint: 'https://api.seenary.app',
}, null, 2));
console.log('Release artifact checks passed.');
