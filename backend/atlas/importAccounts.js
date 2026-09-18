const crypto = require('node:crypto');
const { normalize } = require('./accounts');

function date(value, nullable = false) {
  if (value == null && nullable) return null;
  if (typeof value !== 'string') throw new Error('Missing legacy date.');
  const parsed = new Date(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? value.replace(' ', 'T') + 'Z' : value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid legacy date.');
  return parsed;
}

function convertAccount(row, source) {
  if (!Number.isSafeInteger(row.id) || row.id < 1
      || typeof row.username !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(row.username)
      || row.username_normalized !== normalize(row.username)
      || typeof row.password_hash !== 'string' || !/^\$argon2(?:id|i|d)\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/.test(row.password_hash)
      || ![0, 1, null, undefined].includes(row.local_credentials_confirmed)
      || ![0, 1].includes(row.tutorial_dismissed)) throw new Error('Invalid legacy account.');
  const account = {
    username: row.username, username_normalized: row.username_normalized, password_hash: row.password_hash,
    local_credentials_confirmed: row.local_credentials_confirmed == null ? null : Boolean(row.local_credentials_confirmed),
    tutorial_dismissed: Boolean(row.tutorial_dismissed), created_at: date(row.created_at),
    updated_at: date(row.updated_at), last_login_at: date(row.last_login_at, true),
  };
  return { _id: crypto.randomUUID(), ...account, authVersion: 0, schemaVersion: 1,
    legacyKey: JSON.stringify([source, row.id]), legacy: { source, userId: row.id },
    sourceFingerprint: crypto.createHash('sha256').update(JSON.stringify(account)).digest('hex') };
}

async function importAccounts(repo, rows, source, apply = false, verify = false, refresh = false) {
  if (typeof source !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(source)) throw new Error('A stable source name is required.');
  const report = { mode: verify ? 'verify' : refresh ? 'refresh' : apply ? 'apply' : 'dry-run', total: rows.length, ready: 0, imported: 0, refreshed: 0, unchanged: 0, verified: 0, conflicts: [] };
  const pending = [];
  const updates = [];
  const seenIds = new Set();
  const seenNames = new Set();
  for (const row of rows) {
    let document;
    try { document = convertAccount(row, source); } catch {
      report.conflicts.push({ legacyId: Number.isSafeInteger(row.id) ? row.id : null, reason: 'invalid-source-row' });
      continue;
    }
    if (seenIds.has(row.id) || seenNames.has(document.username_normalized)) {
      report.conflicts.push({ legacyId: row.id, reason: 'duplicate-source-identity' });
      continue;
    }
    seenIds.add(row.id);
    seenNames.add(document.username_normalized);
    const blocked = await repo.users.findOne({ status: 'deleted', migrationBlockHash: crypto.createHash('sha256').update(document.legacyKey).digest('hex') });
    if (blocked) { report.unchanged++; continue; }
    const existing = await repo.users.findOne({ legacyKey: document.legacyKey });
    if (existing) {
      if (existing.sourceFingerprint !== document.sourceFingerprint && refresh) {
        const owner = await repo.users.findOne({ username_normalized: document.username_normalized });
        if (owner && owner._id !== existing._id) report.conflicts.push({ legacyId: row.id, reason: 'username-owned-by-another-account' });
        else updates.push({ existing, document });
      } else if (existing.sourceFingerprint !== document.sourceFingerprint) report.conflicts.push({ legacyId: row.id, reason: 'source-changed-since-import' });
      else if (verify) {
        const exact = Object.entries(accountFields(document)).every(([key, value]) => JSON.stringify(existing[key]) === JSON.stringify(value));
        if (exact && existing.status !== 'deleted') report.verified++;
        else report.conflicts.push({ legacyId: row.id, reason: 'imported-account-field-mismatch' });
      } else report.unchanged++;
      continue;
    }
    if (verify) { report.conflicts.push({ legacyId: row.id, reason: 'missing-imported-account' }); continue; }
    if (await repo.users.findOne({ username_normalized: document.username_normalized })) {
      report.conflicts.push({ legacyId: row.id, reason: 'username-owned-by-another-account' });
      continue;
    }
    pending.push(document);
  }
  report.ready = pending.length + updates.length;
  // Preflight all rows first. Conflicts never overwrite an Atlas account.
  if (apply && !report.conflicts.length) {
    for (const document of pending) {
      try {
        await repo.users.insertOne(document);
        report.imported++;
      } catch (error) {
        if (error.code !== 11000) throw error;
        const existing = await repo.users.findOne({ legacyKey: document.legacyKey });
        if (existing?.sourceFingerprint === document.sourceFingerprint) report.unchanged++;
        else report.conflicts.push({ legacyId: document.legacy.userId, reason: 'concurrent-identity-conflict' });
      }
    }
    for (const { existing, document } of updates) {
      const passwordChanged = existing.password_hash !== document.password_hash;
      const result = await repo.users.updateOne({ _id: existing._id, sourceFingerprint: existing.sourceFingerprint, status: { $ne: 'deleted' } }, {
        $set: { ...accountFields(document), sourceFingerprint: document.sourceFingerprint, legacy: document.legacy },
        ...(passwordChanged ? { $inc: { authVersion: 1 } } : {}),
      });
      if (!result.modifiedCount) throw new Error('Account changed during refresh; rerun rehearsal.');
      report.refreshed++;
    }
  }
  return report;
}

function accountFields(document) {
  return Object.fromEntries(['username', 'username_normalized', 'password_hash', 'local_credentials_confirmed', 'tutorial_dismissed',
    'created_at', 'updated_at', 'last_login_at'].map(key => [key, document[key]]));
}

function readSqliteAccounts(filename) {
  // Do not require db.js: importing it creates tables and starts the live SQLite path.
  // Migration tooling uses Node 24's SQLite reader, independent of Electron's native ABI.
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    db.exec('BEGIN');
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Invalid SQLite source.');
    return db.prepare('SELECT * FROM users ORDER BY id').all();
  } finally { db.close(); }
}

module.exports = { convertAccount, importAccounts, readSqliteAccounts, accountFields };
