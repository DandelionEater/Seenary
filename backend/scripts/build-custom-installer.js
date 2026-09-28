const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const packageJson = require('../package.json');

const backendDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendDir, '..');
const releaseDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, 'release', packageJson.version);
const installerName = `Seenary-Setup-${packageJson.version}.exe`;
const installerPath = path.join(releaseDir, installerName);
const coreInstallerPath = path.join(
  releaseDir,
  `Seenary-Setup-${packageJson.version}.core.exe`,
);
const versionSourcePath = path.join(
  releaseDir,
  'SeenaryBootstrapperVersion.g.cs',
);
const compilerCandidates = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
];
const compiler = compilerCandidates.find((candidate) => fs.existsSync(candidate));
const frameworkAssemblies = {
  PresentationCore:
    'C:\\Windows\\Microsoft.NET\\assembly\\GAC_32\\PresentationCore\\v4.0_4.0.0.0__31bf3856ad364e35\\PresentationCore.dll',
  PresentationFramework:
    'C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL\\PresentationFramework\\v4.0_4.0.0.0__31bf3856ad364e35\\PresentationFramework.dll',
  WindowsBase:
    'C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL\\WindowsBase\\v4.0_4.0.0.0__31bf3856ad364e35\\WindowsBase.dll',
  SystemXaml:
    'C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL\\System.Xaml\\v4.0_4.0.0.0__b77a5c561934e089\\System.Xaml.dll',
};

if (process.platform !== 'win32') {
  console.error('The custom Seenary bootstrapper currently requires Windows.');
  process.exit(1);
}

if (!compiler) {
  console.error('The Windows .NET Framework C# compiler was not found.');
  process.exit(1);
}

if (!fs.existsSync(installerPath)) {
  console.error(`Core installer not found: ${installerPath}`);
  process.exit(1);
}

fs.renameSync(installerPath, coreInstallerPath);

const numericVersionParts = (packageJson.version.match(/\d+/g) || [])
  .slice(0, 3)
  .map(Number);
while (numericVersionParts.length < 3) {
  numericVersionParts.push(0);
}
const numericVersion = `${numericVersionParts.join('.')}.0`;
fs.writeFileSync(
  versionSourcePath,
  [
    'using System.Reflection;',
    `[assembly: AssemblyVersion("${numericVersion}")]`,
    `[assembly: AssemblyFileVersion("${numericVersion}")]`,
    `[assembly: AssemblyInformationalVersion("${packageJson.version}")]`,
    '',
  ].join('\r\n'),
);

const args = [
  '/nologo',
  '/target:winexe',
  '/platform:x64',
  `/out:${installerPath}`,
  `/win32icon:${path.join(backendDir, 'build', 'icon.ico')}`,
  `/reference:${frameworkAssemblies.PresentationCore}`,
  `/reference:${frameworkAssemblies.PresentationFramework}`,
  `/reference:${frameworkAssemblies.WindowsBase}`,
  `/reference:${frameworkAssemblies.SystemXaml}`,
  `/resource:${coreInstallerPath},Seenary.CoreInstaller`,
  `/resource:${path.join(backendDir, 'build', 'installer-art-source.png')},Seenary.InstallerArt`,
  `/resource:${path.join(backendDir, 'build', 'icon.png')},Seenary.AppIcon`,
  path.join(backendDir, 'installer', 'SeenaryBootstrapper.cs'),
  versionSourcePath,
];

const result = spawnSync(compiler, args, {
  cwd: backendDir,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.stdout) {
  process.stdout.write(result.stdout);
}
if (result.stderr) {
  process.stderr.write(result.stderr);
}
if (result.status !== 0) {
  if (result.error) {
    console.error(`Custom installer compiler failed: ${result.error.message}`);
  } else if (result.signal) {
    console.error(`Custom installer compiler stopped with signal ${result.signal}.`);
  } else {
    console.error(`Custom installer compiler exited with status ${result.status}.`);
  }
  fs.rmSync(versionSourcePath, { force: true });
  fs.renameSync(coreInstallerPath, installerPath);
  process.exit(result.status || 1);
}

fs.rmSync(versionSourcePath, { force: true });
fs.rmSync(coreInstallerPath, { force: true });

const { buildBlockMap } = require(
  path.join(
    backendDir,
    'node_modules',
    'app-builder-lib',
    'out',
    'targets',
    'blockmap',
    'blockmap.js',
  ),
);
const blockmapPath = `${installerPath}.blockmap`;

async function finalizeInstaller() {
  await buildBlockMap(installerPath, 'gzip', blockmapPath);

  const installer = fs.readFileSync(installerPath);
  const sha512 = crypto.createHash('sha512').update(installer).digest('base64');
  const size = installer.length;

  for (const name of ['dev.yml', 'beta.yml', 'alpha.yml', 'latest.yml']) {
    const metadataPath = path.join(releaseDir, name);
    if (!fs.existsSync(metadataPath)) {
      continue;
    }

    const current = fs.readFileSync(metadataPath, 'utf8');
    const next = current
      .replace(/(\n\s*sha512:\s*)[^\r\n]+/g, `$1${sha512}`)
      .replace(/(\n\s*size:\s*)\d+/g, `$1${size}`);
    fs.writeFileSync(metadataPath, next);
  }

  console.log(`Built custom Seenary installer: ${installerPath}`);
}

finalizeInstaller().catch((error) => {
  console.error(`Failed to finalize custom Seenary installer: ${error.message}`);
  process.exitCode = 1;
});
