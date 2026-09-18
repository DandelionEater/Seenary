require('../env');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const argon2 = require('argon2');
const { connectStaging, reportError } = require('../atlas/connection');
const { setupAccounts, createAccountService, tokenHash } = require('../atlas/accounts');
const { importAccounts, readSqliteAccounts } = require('../atlas/importAccounts');
const { createStagingServer } = require('../atlas/stagingServer');

async function main() {
  const connection = await connectStaging();
  const prefix = `batch1_test_${crypto.randomBytes(10).toString('hex')}_`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'seenary-accounts-'));
  const fixture = path.join(temp, 'source.sqlite');
  let server;
  try {
    const repo = await setupAccounts(connection.db, prefix);
    await setupAccounts(connection.db, prefix);
    const service = await createAccountService(repo);
    assert.equal((await service.register('x', 'short')).ok, false);
    const attempts = await Promise.all([service.register('Alice', 'password-one'), service.register('ALICE', 'password-two')]);
    assert.equal(attempts.filter((result) => result.ok).length, 1, 'concurrent normalized usernames must be unique');
    const winner = attempts.find((result) => result.ok);
    const originalPassword = attempts[0].ok ? 'password-one' : 'password-two';
    assert.equal((await service.getSession(winner.token)).user.id, winner.user.id);
    assert.equal('password_hash' in winner.user, false);
    assert.equal(await repo.sessions.countDocuments({ _id: winner.token }), 0, 'raw token is never stored');
    assert.equal((await service.login('alice', 'wrong-password')).ok, false);
    assert.equal((await service.login('missing', 'wrong-password')).ok, false);
    const second = await service.login('alice', originalPassword);
    assert.equal(second.ok, true);
    await service.logout(winner.token);
    assert.equal((await service.getSession(winner.token)).authenticated, false);
    assert.equal((await service.getSession(second.token)).authenticated, true);
    assert.equal((await service.changePassword(second.token, 'wrong-password', 'password-three')).ok, false);
    assert.equal((await service.changePassword(second.token, originalPassword, 'password-three')).ok, true);
    assert.equal((await service.getSession(second.token)).authenticated, false, 'password change revokes old sessions');
    assert.equal((await service.login('alice', originalPassword)).ok, false);
    const third = await service.login('alice', 'password-three');
    assert.equal(third.ok, true);
    await repo.sessions.updateOne({ _id: tokenHash(third.token) }, { $set: { expiresAt: new Date(0) } });
    assert.equal((await service.getSession(third.token)).authenticated, false, 'expiry enforced before TTL deletion');
    assert.equal((await service.getSession('invalid')).authenticated, false);
    await assert.rejects(repo.users.insertOne({ _id: 'invalid' }), (error) => error.code === 121);
    const sessionIndexes = await repo.sessions.indexes();
    assert(sessionIndexes.some((index) => index.expireAfterSeconds === 0));

    const hash = await argon2.hash('import-password', { type: argon2.argon2id });
    const sqlite = new DatabaseSync(fixture);
    sqlite.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, username_normalized TEXT, password_hash TEXT, local_credentials_confirmed INTEGER, tutorial_dismissed INTEGER, created_at TEXT, updated_at TEXT, last_login_at TEXT)');
    sqlite.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(7, 'Imported', 'imported', hash, null, 1, '2026-01-02 03:04:05', '2026-01-02 03:04:05', null);
    sqlite.close();
    const before = fs.readFileSync(fixture);
    const rows = readSqliteAccounts(fixture);
    assert.deepEqual(fs.readFileSync(fixture), before, 'SQLite source must remain unchanged');
    assert.throws(() => readSqliteAccounts(path.join(temp, 'missing.sqlite')));
    const count = await repo.users.countDocuments();
    const dry = await importAccounts(repo, rows, 'fixture');
    assert.equal(dry.ready, 1);
    assert.equal(await repo.users.countDocuments(), count, 'dry run makes no writes');
    const first = await importAccounts(repo, rows, 'fixture', true);
    assert.equal(first.imported, 1);
    const saved = await repo.users.findOne({ legacyKey: JSON.stringify(['fixture', 7]) });
    assert.equal(saved.password_hash, hash);
    assert.equal(saved.local_credentials_confirmed, null);
    assert.equal(saved.tutorial_dismissed, true);
    assert.equal(saved.created_at.toISOString(), '2026-01-02T03:04:05.000Z');
    assert.equal((await importAccounts(repo, rows, 'fixture', true)).unchanged, 1);
    const importedLogin = await service.login('Imported', 'import-password');
    assert.equal(importedLogin.ok, true);
    const restartedService = await createAccountService(repo);
    assert.equal((await restartedService.getSession(importedLogin.token)).user.id, saved._id, 'sessions survive service restart');
    await service.changePassword(importedLogin.token, 'import-password', 'new-import-password');
    assert.equal((await importAccounts(repo, rows, 'fixture', true)).unchanged, 1);
    assert.equal((await service.login('Imported', 'new-import-password')).ok, true, 'rerun must not overwrite cloud password');
    const conflicts = await importAccounts(repo, [{ ...rows[0], username: 'Renamed', username_normalized: 'renamed' }], 'fixture', true);
    assert.equal(conflicts.conflicts[0].reason, 'source-changed-since-import');
    assert.equal((await importAccounts(repo, rows, 'different-source', true)).conflicts.length, 1);
    assert.equal((await importAccounts(repo, [{ ...rows[0], password_hash: 'invalid' }], 'invalid', true)).conflicts.length, 1);
    const interrupted = [{ ...rows[0], id: 8, username: 'Resume', username_normalized: 'resume' }];
    assert.equal((await importAccounts(repo, interrupted, 'fixture', true)).imported, 1);
    assert.equal((await importAccounts(repo, [...rows, ...interrupted], 'fixture', true)).unchanged, 2);
    console.log('PASS: schemas, unique registration, authentication, expiry/revocation, restart, read-only import, dry run, rerun, conflicts, resume.');

    server = createStagingServer(service);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/rpc`;
    async function rpc(method, args = [], cookie, extra = {}) {
      return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: JSON.stringify({ method, args }) });
    }
    const response = await rpc('register', ['HttpUser', 'http-password']);
    assert.equal(response.status, 200);
    const publicResult = await response.json();
    assert.equal(publicResult.ok, true);
    assert.equal('token' in publicResult, false);
    const cookie = response.headers.get('set-cookie');
    assert(cookie.includes('HttpOnly') && cookie.includes('SameSite=Strict'));
    const sessionCookie = cookie.split(';')[0];
    assert.equal((await (await rpc('getSession', [], sessionCookie)).json()).authenticated, true);
    assert.equal((await (await rpc('getSession')).json()).authenticated, false);
    assert.equal((await rpc('register', [], undefined, { Origin: 'https://example.com' })).status, 403);
    assert.equal((await rpc('deleteAccount', [], sessionCookie)).status, 404);
    await rpc('logout', [], sessionCookie);
    assert.equal((await (await rpc('getSession', [], sessionCookie)).json()).authenticated, false);
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 415);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
    assert.equal((await rpc('login', ['x'.repeat(9000)])).status, 413);
    let last;
    for (let i = 0; i < 21; i++) last = await rpc('login', ['bad', 'short']);
    assert.equal(last.status, 429);
    console.log('PASS: HTTP cookies, session isolation, logout, method boundaries, origin checks, request limits, auth throttling.');
  } finally {
    if (server) await new Promise((resolve) => { server.close(resolve); server.closeIdleConnections(); });
    // Only the two uniquely named collections created by this run are removed.
    for (const suffix of ['users', 'sessions']) {
      await connection.db.collection(`${prefix}${suffix}`).drop().catch((error) => { if (error.code !== 26) throw error; });
    }
    await connection.close();
    if (fs.existsSync(fixture)) fs.unlinkSync(fixture);
    fs.rmdirSync(temp);
  }
}

main().catch((error) => {
  if (error.code === 'ERR_ASSERTION') console.error(`Account check assertion failed at ${String(error.stack).split('\n')[1]?.trim()}`);
  else reportError(error);
  process.exitCode = 1;
});
