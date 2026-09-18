const crypto = require('node:crypto');
const { PREFIX } = require('./tokenCipher');

function readProviderData(filename) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    db.exec('BEGIN');
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Invalid SQLite source.');
    return { links: ['anilist', 'mal'].flatMap((provider) => db.prepare(`SELECT * FROM ${provider}_accounts ORDER BY id`).all().map((row) => ({ provider, row }))),
      settings: db.prepare('SELECT key, value FROM app_settings ORDER BY key').all() };
  } finally { db.close(); }
}

function timestamp(value) {
  if (value == null) return null;
  const parsed = new Date(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? value.replace(' ', 'T') + 'Z' : value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid timestamp.');
  return parsed;
}
const fingerprint = (data) => crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');

async function importProviderData({ client, repo, data, source, sourceCipher, targetCipher, apply = false, verify = false, refresh = false }) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(source || '')) throw new Error('Stable source name required.');
  const report = { mode: verify ? 'verify' : apply ? 'apply' : 'dry-run', links: data.links.length,
    settings: 0, ignoredLocalSettings: 0, ready: 0, imported: 0, refreshed: 0, unchanged: 0, verified: 0, conflicts: [] };
  const pending = [];
  const seenUsers = new Set();
  const seenIdentities = new Set();
  function decrypt(value) {
    if (!value) return null;
    return String(value).startsWith(PREFIX) ? sourceCipher.decrypt(value) : String(value);
  }
  for (const { provider, row } of data.links) {
    try {
      if (!['anilist', 'mal'].includes(provider) || !Number.isSafeInteger(row.user_id) || row.user_id <= 0
          || !Number.isSafeInteger(row[`${provider}_user_id`]) || row[`${provider}_user_id`] <= 0) throw new Error('Invalid provider identity.');
      const receiptId = JSON.stringify([source, provider, row.user_id]);
      const hash = fingerprint({ provider, row });
      const existingReceipt = await repo.providerMigrationReceipts.findOne({ _id: receiptId });
      if (existingReceipt && !verify) {
        if (existingReceipt.fingerprint === hash) { report.unchanged++; continue; }
        if (!refresh) throw new Error('Source changed since import.');
      }
      const user = await repo.users.findOne({ legacyKey: JSON.stringify([source, row.user_id]), status: { $ne: 'deleted' } });
      if (!user) throw new Error('Mapped account missing or deleted.');
      const providerUserId = String(row[`${provider}_user_id`]);
      const identity = `${provider}:${providerUserId}`;
      if (seenUsers.has(user._id) || seenIdentities.has(identity)) throw new Error('Duplicate active provider.');
      seenUsers.add(user._id); seenIdentities.add(identity);
      const access = decrypt(row.access_token);
      const refreshToken = decrypt(row.refresh_token);
      if (!access) throw new Error('Missing access token.');
      const document = { _id: crypto.randomUUID(), userId: user._id, provider, providerUserId,
        username: row[`${provider}_username`], originalUsername: row[`original_${provider}_username`],
        accessToken: targetCipher.encrypt(access), refreshToken: targetCipher.encrypt(refreshToken),
        expiresAt: row.token_expires_at == null ? null : timestamp(row.token_expires_at),
        createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at), lastImportAt: timestamp(row.last_import_at),
        revision: 0, needsReauthorization: false };
      if (!document.createdAt || !document.updatedAt || typeof document.username !== 'string' || !document.username || document.username.length > 100
          || typeof document.originalUsername !== 'string') throw new Error('Invalid provider fields.');
      const owner = await repo.providerAccounts.findOne({ $or: [{ userId: user._id }, { provider, providerUserId }] });
      if (verify) {
        if (!existingReceipt || existingReceipt.fingerprint !== hash || !owner) throw new Error('Missing import receipt or link.');
        for (const key of Object.keys(document).filter((key) => !['_id', 'revision', 'accessToken', 'refreshToken'].includes(key))) {
          if (JSON.stringify(owner[key]) !== JSON.stringify(document[key])) throw new Error('Imported field mismatch.');
        }
        if (targetCipher.decrypt(owner.accessToken) !== access || targetCipher.decrypt(owner.refreshToken) !== refreshToken) throw new Error('Token mismatch.');
        report.verified++; continue;
      }
      if (existingReceipt) {
        if (!owner || owner.userId !== user._id || owner.provider !== provider || owner.providerUserId !== providerUserId) throw new Error('Provider identity changed.');
        pending.push({ refresh: true, document: { ...document, _id: owner._id }, collection: repo.providerAccounts,
          receipt: { ...existingReceipt, fingerprint: hash, importedAt: new Date() }, previousFingerprint: existingReceipt.fingerprint });
        continue;
      }
      if (owner) throw new Error('Provider ownership conflict.');
      pending.push({ document, collection: repo.providerAccounts, receipt: { _id: receiptId, fingerprint: hash, userId: user._id, importedAt: new Date() } });
    } catch {
      report.conflicts.push({ provider, legacyUserId: row.user_id, reason: 'Check source fields, decryption key, account mapping, and ownership.' });
    }
  }
  for (const setting of data.settings) {
    const match = /^sync\.autoEnabled\.user\.(\d+)$/.exec(setting.key);
    if (!match) { report.ignoredLocalSettings++; continue; }
    report.settings++;
    const legacyId = Number(match[1]);
    const receiptId = JSON.stringify([source, 'autoSyncEnabled', legacyId]);
    const hash = fingerprint(setting);
    const user = await repo.users.findOne({ legacyKey: JSON.stringify([source, legacyId]), status: { $ne: 'deleted' } });
    const receipt = await repo.providerMigrationReceipts.findOne({ _id: receiptId });
    if (receipt && receipt.fingerprint === hash && !verify) { report.unchanged++; continue; }
    const existing = user ? await repo.accountSettings.findOne({ _id: user._id }) : null;
    if (!user || !['true', 'false'].includes(setting.value) || receipt && receipt.fingerprint !== hash || existing && !verify) {
      report.conflicts.push({ legacyUserId: legacyId, reason: 'Account setting conflict.' }); continue;
    }
    if (verify) {
      if (receipt && existing?.autoSyncEnabled === (setting.value === 'true')) report.verified++;
      else report.conflicts.push({ legacyUserId: legacyId, reason: 'Setting verification failed.' });
    } else pending.push({ collection: repo.accountSettings,
      document: { _id: user._id, autoSyncEnabled: setting.value === 'true', needsDeviceReconciliation: true },
      receipt: { _id: receiptId, fingerprint: hash, userId: user._id, importedAt: new Date() } });
  }
  report.ready = pending.length;
  if (apply && !verify && !report.conflicts.length) {
    for (const item of pending) {
      const session = client.startSession();
      try {
        const inserted = await session.withTransaction(async () => {
          const old = await repo.providerMigrationReceipts.findOne({ _id: item.receipt._id }, { session });
          if (old) {
            if (item.refresh && old.fingerprint === item.previousFingerprint) {
              const { _id, revision, ...fields } = item.document;
              const changed = await item.collection.updateOne({ _id, userId: item.receipt.userId }, { $set: fields, $inc: { revision: 1 } }, { session });
              if (!changed.matchedCount) throw new Error('Provider link changed during refresh.');
              const receipt = await repo.providerMigrationReceipts.replaceOne({ _id: item.receipt._id, fingerprint: item.previousFingerprint }, item.receipt, { session });
              if (!receipt.modifiedCount) throw new Error('Provider receipt changed during refresh.');
              return 'refreshed';
            }
            if (old.fingerprint !== item.receipt.fingerprint) throw new Error('Concurrent receipt conflict.');
            return false;
          }
          const current = await repo.users.updateOne({ _id: item.receipt.userId, status: { $ne: 'deleted' } }, { $inc: { lifecycleRevision: 1 } }, { session });
          if (!current.matchedCount) throw new Error('Mapped account disappeared.');
          await item.collection.insertOne(item.document, { session });
          await repo.providerMigrationReceipts.insertOne(item.receipt, { session });
          return true;
        });
        if (inserted === 'refreshed') report.refreshed++; else if (inserted) report.imported++; else report.unchanged++;
      } finally { await session.endSession(); }
    }
  }
  return report;
}
module.exports = { readProviderData, importProviderData };
