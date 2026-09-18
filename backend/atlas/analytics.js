const crypto = require('node:crypto');
const DAILY_RETENTION_DAYS = 45;
const ALLOWED_PLATFORMS = new Set(['windows', 'linux', 'macos', 'web', 'unknown']);
const utcDate = (now = new Date()) => new Date(now).toISOString().slice(0, 10);
const utcMonth = now => utcDate(now).slice(0, 7);
function secret(value = process.env.ANALYTICS_HMAC_SECRET) { const text = String(value || '').trim(); return text.length >= 32 ? text : null; }
function monthlyKey(userId, month, value) {
  const key = secret(value); if (!key || typeof userId !== 'string' || !userId || !/^\d{4}-\d{2}$/.test(month)) return null;
  return crypto.createHmac('sha256', key).update(`${month}:${userId}`).digest('base64url');
}
function platform(value) { const item = String(value || '').trim().toLowerCase(); if (['win', 'win32'].includes(item)) return 'windows';
  if (['mac', 'darwin'].includes(item)) return 'macos'; return ALLOWED_PLATFORMS.has(item) ? item : 'unknown'; }
function version(value) { const item = String(value || '').trim(); return /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(item) ? item : 'unknown'; }
function aggregate(month, rows) {
  const days = new Map(); const count = select => Object.fromEntries([...rows.reduce((map, row) => map.set(select(row), (map.get(select(row)) || 0) + 1), new Map())]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  for (const row of rows) { const set = days.get(row.monthlyKey) || new Set(); set.add(row.activityDate); days.set(row.monthlyKey, set); }
  const active = [...days.values()].map(set => set.size); const dailyActiveUsers = count(row => row.activityDate);
  const latest = Object.keys(dailyActiveUsers).sort().at(-1); const mau = active.length;
  return { month, monthlyActiveUsers: mau, dailyActiveUsers, dauMau: mau ? dailyActiveUsers[latest] / mau : 0,
    averageActiveDays: mau ? active.reduce((sum, item) => sum + item, 0) / mau : 0,
    activeDayRanges: { oneDay: active.filter(n => n === 1).length, twoToThreeDays: active.filter(n => n >= 2 && n <= 3).length,
      fourToSevenDays: active.filter(n => n >= 4 && n <= 7).length, eightToFourteenDays: active.filter(n => n >= 8 && n <= 14).length,
      fifteenPlusDays: active.filter(n => n >= 15).length }, platformActiveDays: count(row => row.platform), versionActiveDays: count(row => row.appVersion) };
}
async function setupAnalytics(db, prefix = '') {
  if (prefix && !/^batch1_test_[a-f0-9]+_$/.test(prefix)) throw new Error('Invalid test prefix.');
  const daily = db.collection(prefix + 'analyticsDaily'); const monthly = db.collection(prefix + 'analyticsMonthly');
  for (const [collection, schema] of [[daily, { required: ['_id', 'activityDate', 'activityMonth', 'monthlyKey', 'platform', 'appVersion', 'createdAt'], properties: {
    _id: { bsonType: 'string' }, activityDate: { bsonType: 'string' }, activityMonth: { bsonType: 'string' }, monthlyKey: { bsonType: 'string' },
    platform: { enum: [...ALLOWED_PLATFORMS] }, appVersion: { bsonType: 'string' }, createdAt: { bsonType: 'date' } } }],
  [monthly, { required: ['_id', 'aggregate', 'finalizedAt'], properties: { _id: { bsonType: 'string' }, aggregate: { bsonType: 'object' }, finalizedAt: { bsonType: 'date' } } }]]) {
    const validator = { $jsonSchema: { bsonType: 'object', ...schema } };
    try { await db.createCollection(collection.collectionName, { validator, validationLevel: 'strict', validationAction: 'error' }); }
    catch (error) { if (error.code !== 48) throw error; const existing = await db.listCollections({ name: collection.collectionName }).next();
      if (JSON.stringify(existing?.options?.validator) !== JSON.stringify(validator)) throw new Error('Analytics schema requires explicit migration.'); }
  }
  await daily.createIndex({ activityMonth: 1, activityDate: 1 }); await daily.createIndex({ monthlyKey: 1 });
  return { analyticsDaily: daily, analyticsMonthly: monthly };
}
function createAnalyticsService({ repo, accounts, now = () => new Date(), analyticsSecret = process.env.ANALYTICS_HMAC_SECRET }) {
  const key = secret(analyticsSecret);
  async function removeUser(userId) {
    if (!key) return 0; const months = [...new Set((await repo.analyticsDaily.find({}).toArray()).map(row => row.activityMonth))];
    const result = await repo.analyticsDaily.deleteMany({ monthlyKey: { $in: months.map(month => monthlyKey(userId, month, key)) } }); return result.deletedCount;
  }
  return {
    removeUser,
    async consent(token, enabled) {
      const user = await accounts.getAuthenticatedUser(token); if (!user || typeof enabled !== 'boolean') return { ok: false };
      await repo.accountSettings.updateOne({ _id: user._id }, { $set: { analyticsConsentDecided: true, analyticsEnabled: enabled, analyticsUpdatedAt: new Date(now()) },
        $setOnInsert: { autoSyncEnabled: false, needsDeviceReconciliation: true } }, { upsert: true });
      const removed = enabled ? 0 : await removeUser(user._id); return { ok: true, enabled, removed };
    },
    async record(token, payload = {}) {
      const user = await accounts.getAuthenticatedUser(token); if (!user) return { ok: false, recorded: false };
      const settings = await repo.accountSettings.findOne({ _id: user._id });
      if (settings?.analyticsEnabled !== true || !key) return { ok: true, recorded: false, disabled: !key, consentRequired: settings?.analyticsEnabled !== true };
      const date = utcDate(now()); const month = date.slice(0, 7); const identity = monthlyKey(user._id, month, key);
      try { await repo.analyticsDaily.insertOne({ _id: `${date}:${identity}`, activityDate: date, activityMonth: month, monthlyKey: identity,
        platform: platform(payload.platform), appVersion: version(payload.appVersion), createdAt: new Date(now()) });
        return { ok: true, recorded: true, activityDate: date };
      } catch (error) { if (error.code !== 11000) throw error; return { ok: true, recorded: false, duplicate: true, activityDate: date }; }
    },
    async finalize() {
      const current = utcMonth(now()); const rows = await repo.analyticsDaily.find({ activityMonth: { $lt: current } }).toArray();
      const months = [...new Set(rows.map(row => row.activityMonth))].sort(); let finalized = 0;
      for (const month of months) { try { await repo.analyticsMonthly.insertOne({ _id: month, aggregate: aggregate(month, rows.filter(row => row.activityMonth === month)), finalizedAt: new Date(now()) }); finalized++; }
        catch (error) { if (error.code !== 11000) throw error; } }
      const cutoff = new Date(now()); cutoff.setUTCDate(cutoff.getUTCDate() - DAILY_RETENTION_DAYS); const cutoffDate = utcDate(cutoff);
      const finalizedMonths = (await repo.analyticsMonthly.find({}).toArray()).map(row => row._id);
      const pruned = await repo.analyticsDaily.deleteMany({ activityDate: { $lt: cutoffDate }, activityMonth: { $in: finalizedMonths } });
      return { finalized, pruned: pruned.deletedCount };
    },
    async report(days = 14) {
      const end = new Date(now()); const start = new Date(end); start.setUTCDate(start.getUTCDate() - Math.max(1, Math.min(366, days)) + 1);
      const startDate = utcDate(start); const endDate = utcDate(end); const recent = await repo.analyticsDaily.find({ activityDate: { $gte: startDate, $lte: endDate } }).toArray();
      const users = await repo.users.find({ status: { $ne: 'deleted' } }).toArray(); const observed = new Set(recent.map(row => `${row.activityMonth}:${row.monthlyKey}`));
      const observedActiveAccounts = key ? users.filter(user => [...new Set(recent.map(row => row.activityMonth))]
        .some(month => observed.has(`${month}:${monthlyKey(user._id, month, key)}`))).length : 0;
      const finalized = (await repo.analyticsMonthly.find({}).sort({ _id: 1 }).toArray()).map(row => row.aggregate);
      const currentMonth = endDate.slice(0, 7); const currentRows = await repo.analyticsDaily.find({ activityMonth: currentMonth }).toArray();
      return { generatedAt: new Date(now()).toISOString(), overview: { days, startDate, endDate,
        observedActiveAccounts, registeredAccounts: users.length, unavailable: !key },
      daily: Object.entries(aggregate(endDate.slice(0, 7), recent).dailyActiveUsers).map(([activityDate, dailyActiveUsers]) => ({ activityDate, dailyActiveUsers })),
      monthly: [...finalized.filter(item => item.month !== currentMonth), aggregate(currentMonth, currentRows)] };
    },
  };
}
module.exports = { setupAnalytics, createAnalyticsService, monthlyKey, aggregate, platform, version, DAILY_RETENTION_DAYS };
