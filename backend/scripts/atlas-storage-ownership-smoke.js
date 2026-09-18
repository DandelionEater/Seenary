const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TABLE_OWNERSHIP, SQLITE_CALLERS, RUNTIME_BOUNDARIES } = require('../atlas/storageOwnership');

const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const files = fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isFile() && item.name.endsWith('.js')).map(item => item.name);
const importsDb = text => /require\(['"]\.\/db['"]\)/.test(text);
const actualCallers = files.filter(file => importsDb(source(file))).sort();
assert.deepEqual(actualCallers, [...SQLITE_CALLERS].sort(), 'direct SQLite caller set changed; assign or retire its data domain explicitly');

const tableSources = [source('db.js'), source('engagementAnalytics.js')].join('\n');
const actualTables = [...tableSources.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_]+)/gi)].map(match => match[1]);
const uniqueTables = [...new Set(actualTables)].sort();
assert.deepEqual(uniqueTables, Object.keys(TABLE_OWNERSHIP).sort(), 'SQLite table set changed without an ownership record');

for (const [table, record] of Object.entries(TABLE_OWNERSHIP)) {
  assert(/^[a-z][a-z0-9-]+$/.test(record.domain), `${table} needs a stable domain`);
  assert.equal(record.legacy, 'sqlite');
  assert(record.cutover, `${table} needs a retirement checkpoint`);
}
assert.equal(RUNTIME_BOUNDARIES.atlasStaging.authority, 'atlas');

const atlasFiles = [];
function walk(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) walk(full);
    else if (item.name.endsWith('.js')) atlasFiles.push(full);
  }
}
walk(path.join(root, 'atlas'));
for (const file of atlasFiles) {
  const text = fs.readFileSync(file, 'utf8');
  assert(!/require\(['"]\.\.\/db['"]\)/.test(text), `${path.relative(root, file)} crosses from Atlas into SQLite`);
  assert(!/better-sqlite3/.test(text), `${path.relative(root, file)} opens SQLite directly`);
}

const staging = source('atlas/stagingServer.js');
for (const legacy of ['./auth', './lists', './sync', './backup']) assert(!staging.includes(`require('${legacy}')`), `Atlas staging imports legacy ${legacy}`);
console.log(`PASS: ${uniqueTables.length} SQLite tables have owners, ${actualCallers.length} direct callers are frozen, and the Atlas runtime has no SQLite dependency.`);
