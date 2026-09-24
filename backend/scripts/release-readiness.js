const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const backendDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendDir, '..');
const frontendDir = path.join(repoRoot, 'frontend');
const packageJson = require('../package.json');
const packageLock = require('../package-lock.json');
const frontendPackageJson = require('../../frontend/package.json');
const frontendPackageLock = require('../../frontend/package-lock.json');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const results = [];

function printHeading(label) {
  console.log(`\n=== ${label} ===`);
}

function pass(label, detail = '') {
  results.push({ status: 'PASS', label, detail });
  console.log(`PASS ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail) {
  results.push({ status: 'FAIL', label, detail });
  console.error(`FAIL ${label} — ${detail}`);
}

function warn(label, detail) {
  results.push({ status: 'WARN', label, detail });
  console.warn(`WARN ${label} — ${detail}`);
}

function runCommand(label, command, args, options = {}) {
  printHeading(label);
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    stdio: 'inherit',
    shell: options.shell ?? (process.platform === 'win32' && command.endsWith('.cmd')),
  });

  if (result.error) {
    fail(label, result.error.message);
    return false;
  }

  if (result.status !== 0) {
    fail(label, `exited with code ${result.status ?? 'unknown'}`);
    return false;
  }

  pass(label, `${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  return true;
}

function runNpm(label, args, cwd, options = {}) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return runCommand(label, process.execPath, [npmExecPath, ...args], { cwd, shell: false, ...options });
  }
  return runCommand(label, npmCommand, args, { cwd, ...options });
}

function listJavaScriptFiles(directory) {
  const ignoredDirectories = new Set([
    'node_modules',
    'dist',
    'release',
    '.electron-user-data',
    '.electron-crash-dumps',
  ]);
  const files = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listJavaScriptFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(entryPath);
  }

  return files.sort();
}

function runSyntaxChecks(files) {
  printHeading('Backend JavaScript syntax');
  const startedAt = Date.now();
  const failures = [];

  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: false,
    });
    if (result.status !== 0 || result.error) {
      failures.push({
        file: path.relative(repoRoot, file),
        message: result.error?.message || result.stderr?.trim() || `exit ${result.status}`,
      });
    }
  }

  if (failures.length) {
    for (const failure of failures) console.error(`${failure.file}: ${failure.message}`);
    fail('Backend JavaScript syntax', `${failures.length} of ${files.length} files failed`);
    return;
  }

  pass(
    'Backend JavaScript syntax',
    `${files.length} files in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
  );
}

function parseVersion(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/);
  return match
    ? { raw: version, parts: match.slice(1, 4).map(Number), prerelease: match[4] || '' }
    : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left.parts[index] !== right.parts[index]) return left.parts[index] - right.parts[index];
  }
  if (!left.prerelease && right.prerelease) return 1;
  if (left.prerelease && !right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

function findTargetRelease() {
  const requestedIndex = process.argv.indexOf('--target');
  const requested = requestedIndex >= 0 ? process.argv[requestedIndex + 1] : null;
  if (requested) return requested;

  const versions = fs
    .readdirSync(repoRoot)
    .map((name) => name.match(/^release-notes-(.+)\.md$/)?.[1])
    .filter(Boolean)
    .map(parseVersion)
    .filter(Boolean)
    .sort(compareVersions);
  return versions.at(-1)?.raw || packageJson.version;
}

function checkReleaseContract() {
  printHeading('Release contract');
  const targetVersion = findTargetRelease();
  const notesPath = path.join(repoRoot, `release-notes-${targetVersion}.md`);

  if (packageJson.version === targetVersion) {
    pass('Package version', targetVersion);
  } else {
    fail('Package version', `backend/package.json is ${packageJson.version}; target release is ${targetVersion}`);
  }

  const lockedVersion = packageLock.packages?.['']?.version;
  if (packageLock.version === packageJson.version && lockedVersion === packageJson.version) {
    pass('Lockfile version', packageJson.version);
  } else {
    fail(
      'Lockfile version',
      `package-lock root=${packageLock.version}, package entry=${lockedVersion}, package=${packageJson.version}`
    );
  }

  const frontendLockedVersion = frontendPackageLock.packages?.['']?.version;
  if (
    frontendPackageJson.version === '0.0.0' &&
    frontendPackageLock.version === '0.0.0' &&
    frontendLockedVersion === '0.0.0'
  ) {
    pass('Frontend package version', 'release-neutral; display version comes from backend/package.json');
  } else {
    fail(
      'Frontend package version',
      'frontend package and lockfile must remain 0.0.0; Seenary releases use backend/package.json'
    );
  }

  if (!fs.existsSync(notesPath)) {
    fail('Release notes', `missing ${path.basename(notesPath)}`);
  } else {
    const notes = fs.readFileSync(notesPath, 'utf8');
    const expectedTag = `Tag: \`v${targetVersion}\``;
    if (!notes.includes(expectedTag)) fail('Release notes tag', `expected ${expectedTag}`);
    else pass('Release notes tag', `v${targetVersion}`);
    if (!notes.includes('## New and improved') || !notes.includes('## Reliability and fixes')) {
      fail('Release notes sections', 'expected New and improved plus Reliability and fixes');
    } else {
      pass('Release notes sections');
    }
  }

  const build = packageJson.build || {};
  const configuredFiles = Array.isArray(build.files) ? build.files : [];
  const missingFiles = configuredFiles
    .filter((file) => !file.includes('*'))
    .filter((file) => !fs.existsSync(path.join(backendDir, file)));
  if (missingFiles.length) fail('Desktop packaging inputs', `missing: ${missingFiles.join(', ')}`);
  else pass('Desktop packaging inputs', `${configuredFiles.length} configured files found`);

  const desktopMainSource = fs.readFileSync(path.join(backendDir, 'desktop-main.js'), 'utf8');
  const electronImport = desktopMainSource.match(
    /const\s*\{([^}]+)\}\s*=\s*require\(['"]electron['"]\)/
  );
  const importsIpcMain = electronImport?.[1]
    .split(',')
    .map((name) => name.trim())
    .includes('ipcMain');
  if (desktopMainSource.includes('ipcMain.') && !importsIpcMain) {
    fail('Desktop IPC bootstrap', 'desktop-main.js uses ipcMain without importing it from Electron');
  } else {
    pass('Desktop IPC bootstrap', 'Electron IPC dependency is available at startup');
  }

  const updateProvider = build.publish?.[0];
  if (
    updateProvider?.provider === 'github' &&
    updateProvider.owner === 'DandelionEater' &&
    updateProvider.repo === 'Seenary' &&
    updateProvider.private === false &&
    updateProvider.tagNamePrefix === 'v'
  ) {
    pass('Updater provider', 'GitHub Releases: DandelionEater/Seenary');
  } else {
    fail(
      'Updater provider',
      'electron-builder must use the public GitHub repository DandelionEater/Seenary'
    );
  }
}

function runDataSmoke(mode) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `seenary-release-${mode}-`));
  const databasePath = path.join(tempRoot, 'media.sqlite');

  try {
    const electronBinary = require('electron');
    return runCommand(
      `${mode === 'fresh' ? 'Fresh data/auth' : 'Legacy migration'} smoke test`,
      electronBinary,
      [path.join(__dirname, 'release-data-smoke.js'), mode],
      {
        cwd: backendDir,
        shell: false,
        env: {
          ...process.env,
          DATABASE_PATH: databasePath,
          ELECTRON_RUN_AS_NODE: '1',
        },
      }
    );
  } finally {
    const resolvedTempRoot = path.resolve(tempRoot);
    const resolvedOsTemp = path.resolve(os.tmpdir());
    if (
      resolvedTempRoot.startsWith(`${resolvedOsTemp}${path.sep}`) &&
      path.basename(resolvedTempRoot).startsWith(`seenary-release-${mode}-`)
    ) {
      fs.rmSync(resolvedTempRoot, { recursive: true, force: true });
    }
  }
}

function runSecuritySmoke() {
  const electronBinary = require('electron');
  return runCommand(
    'Security smoke test',
    electronBinary,
    [path.join(__dirname, 'security-smoke.js')],
    {
      cwd: backendDir,
      shell: false,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
      },
    }
  );
}

function printManualChecks() {
  printHeading('Manual release checks still required');
  const checks = [
    'Clean install and upgrade from the previous published 0.1.x installer, including updater restart.',
    'Live AniList and MyAnimeList OAuth, public imports, pulls, retries, mapping conflicts, and failure recovery.',
    'Large mixed Anime/Manga libraries, unknown totals, one-shots, novels, rereads, and duplicate numeric IDs.',
    'Every My List layout/density, compact windows, keyboard flows, adult filtering, artwork inspection, and back navigation.',
    'Screen-reader labels, focus order, loading/empty/error states, persistence across restart, and backup/restore review.',
    'Built installer, blockmap, and update metadata verification before publishing to GitHub Releases.',
  ];
  checks.forEach((check, index) => console.log(`${index + 1}. ${check}`));
}

function main() {
  console.log(`Seenary automated release-readiness pass (${new Date().toISOString()})`);
  checkReleaseContract();

  const javascriptFiles = listJavaScriptFiles(backendDir);
  runSyntaxChecks(javascriptFiles);

  runCommand(
    'GitHub updater configuration',
    process.execPath,
    [path.join(__dirname, 'updater-config-smoke.js')],
    { cwd: backendDir, shell: false }
  );
  runCommand(
    'AnimeThemes mapper smoke test',
    process.execPath,
    [path.join(__dirname, 'animethemes-mapper-smoke.js')],
    { cwd: backendDir, shell: false }
  );
  runCommand(
    'MyAnimeList pipeline smoke test',
    process.execPath,
    [path.join(__dirname, 'mal-pipeline-smoke.js')],
    { cwd: backendDir, shell: false }
  );
  runCommand(
    'Cache maintenance smoke test',
    process.execPath,
    [path.join(__dirname, 'cache-maintenance-smoke.js')],
    { cwd: backendDir, shell: false }
  );
  runCommand(
    'Details cache fallback smoke test',
    require('electron'),
    [path.join(__dirname, 'details-cache-smoke.js')],
    {
      cwd: backendDir,
      shell: false,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
      },
    }
  );
  runCommand(
    'Engagement analytics smoke test',
    require('electron'),
    [path.join(__dirname, 'engagement-analytics-smoke.js')],
    {
      cwd: backendDir,
      shell: false,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
      },
    }
  );
  runNpm('Frontend lint', ['run', 'lint'], frontendDir);
  runNpm('Frontend production build', ['run', 'build'], frontendDir, {
    env: {
      ...process.env,
      VITE_ATLAS_PRODUCTION: 'true',
      VITE_API_BASE_URL: 'https://api.seenary.app',
    },
  });
  runDataSmoke('fresh');
  runDataSmoke('legacy');
  runSecuritySmoke();
  runCommand('Whitespace and patch integrity', 'git', ['diff', '--check'], { shell: false });

  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (status.status === 0 && status.stdout.trim()) {
    warn('Working tree', 'tracked changes are present; commit intentionally before tagging');
  } else if (status.status === 0) {
    pass('Working tree', 'clean');
  } else {
    warn('Working tree', 'could not inspect Git status');
  }

  printManualChecks();
  printHeading('Summary');
  const passed = results.filter((result) => result.status === 'PASS').length;
  const failed = results.filter((result) => result.status === 'FAIL').length;
  const warned = results.filter((result) => result.status === 'WARN').length;
  console.log(`${passed} passed, ${failed} failed, ${warned} warning${warned === 1 ? '' : 's'}.`);

  if (failed) {
    console.error('Automated release readiness FAILED. Resolve the failures before packaging.');
    process.exit(1);
  }

  console.log('Automated release readiness PASSED. Complete the manual checks before publishing.');
}

main();
