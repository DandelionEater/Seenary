const { calculateObjectSize } = require('bson');
function validateDeployment(env = process.env, mode = 'staging') {
  if (!['staging', 'production'].includes(mode)) throw new Error('Invalid deployment mode.');
  const required = ['MONGODB_URI', 'MONGODB_DATABASE', 'MONGODB_USERNAME', 'MONGODB_PASSWORD', 'TOKEN_ENCRYPTION_KEY',
    'ATLAS_BACKUP_ENCRYPTION_KEY', 'ANALYTICS_HMAC_SECRET', 'ATLAS_QUERY_CACHE_BYTE_BUDGET', 'ATLAS_TOTAL_STORAGE_BYTE_BUDGET',
    'ANILIST_CLIENT_ID', 'ANILIST_CLIENT_SECRET', 'MAL_CLIENT_ID', 'MAL_CLIENT_SECRET'];
  const missing = required.filter(name => !String(env[name] || '').trim() || /^<.*>$/.test(env[name]));
  const errors = [...missing.map(name => `missing:${name}`)];
  const bytes = name => { const value = Number(env[name]); if (!Number.isSafeInteger(value) || value <= 0) errors.push(`invalid:${name}`); };
  bytes('ATLAS_QUERY_CACHE_BYTE_BUDGET'); bytes('ATLAS_TOTAL_STORAGE_BYTE_BUDGET');
  if (String(env.TOKEN_ENCRYPTION_KEY) === String(env.ATLAS_BACKUP_ENCRYPTION_KEY)) errors.push('keys:not-separated');
  if (String(env.ANALYTICS_HMAC_SECRET || '').trim().length < 32) errors.push('invalid:ANALYTICS_HMAC_SECRET');
  if (mode === 'staging' && env.MONGODB_DATABASE !== 'seenary_staging') errors.push('database:not-staging');
  if (mode === 'production') {
    if (env.ATLAS_RUNTIME_MODE !== 'production') errors.push('runtime:not-production');
    if (env.MONGODB_DATABASE !== 'seenary') errors.push('database:not-production');
    let apiOrigin = null;
    try { const url = new URL(env.API_PUBLIC_ORIGIN); if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) errors.push('https:API_PUBLIC_ORIGIN'); else apiOrigin = url.origin; }
    catch { errors.push('invalid:API_PUBLIC_ORIGIN'); }
    for (const [name, pathname] of [['ANILIST_REDIRECT_URI', '/auth/anilist/callback'], ['MAL_REDIRECT_URI', '/auth/mal/callback']]) {
      try { const url = new URL(env[name]); if (url.protocol !== 'https:' || url.origin !== apiOrigin || url.pathname !== pathname || url.search || url.hash) errors.push(`callback:${name}`); }
      catch { errors.push(`invalid:${name}`); }
    }
    if (!String(env.WEB_ORIGINS || '').split(',').every(value => { try { const url = new URL(value.trim()); return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash; } catch { return false; } })) errors.push('https:WEB_ORIGINS');
  }
  return { ok: errors.length === 0, mode, checks: required.length + (mode === 'production' ? 4 : 1), errors: [...new Set(errors)].sort() };
}
async function healthReport(db, now = Date.now(), prefix = '') {
  await db.command({ ping: 1 });
  const [jobs, refresh, queries, stats] = await Promise.all([
    db.collection(prefix + 'jobs').find({}).toArray(), db.collection(prefix + 'providerRefreshStates').find({}).toArray(),
    db.collection(prefix + 'metadataQueries').find({}).toArray(), db.command({ dbStats: 1, scale: 1 }),
  ]);
  const counts = rows => Object.fromEntries([...rows.reduce((map, row) => map.set(row.status || row.lastOutcome || 'unknown', (map.get(row.status || row.lastOutcome || 'unknown') || 0) + 1), new Map())].sort());
  const queryBytes = queries.reduce((sum, row) => sum + calculateObjectSize(row), 0); const storageBytes = Number(stats.storageSize || 0) + Number(stats.indexSize || 0);
  const totalBudget = Number(process.env.ATLAS_TOTAL_STORAGE_BYTE_BUDGET || 0); const queryBudget = Number(process.env.ATLAS_QUERY_CACHE_BYTE_BUDGET || 0);
  const ratio = totalBudget > 0 ? storageBytes / totalBudget : null; const level = ratio == null ? 'unconfigured' : ratio >= .85 ? 'block' : ratio >= .75 ? 'action' : ratio >= .60 ? 'alert' : 'ok';
  return { ok: level !== 'block', checkedAt: new Date(now).toISOString(), jobs: counts(jobs), refresh: counts(refresh),
    overdueJobLeases: jobs.filter(row => row.status === 'running' && new Date(row.leaseUntil || 0).getTime() <= now).length,
    overdueRefreshLeases: refresh.filter(row => row.leaseUntil && new Date(row.leaseUntil).getTime() <= now).length,
    queryCache: { documents: queries.length, bytes: queryBytes, budgetBytes: queryBudget || null, overBudget: queryBudget > 0 && queryBytes > queryBudget },
    storage: { dataBytes: Number(stats.dataSize || 0), storageBytes, budgetBytes: totalBudget || null, level } };
}
module.exports = { validateDeployment, healthReport };
