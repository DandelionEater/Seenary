require('../env');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { connectStaging, reportError } = require('../atlas/connection');
const { setupAccounts, createAccountService, tokenHash } = require('../atlas/accounts');
const { setupProviders } = require('../atlas/providerSchema');
const { createTokenCipher } = require('../atlas/tokenCipher');
const { createProviderService } = require('../atlas/providers');
const { createProviderAdapters } = require('../atlas/providerAdapters');
const { readProviderData, importProviderData } = require('../atlas/importProviders');
const { createStagingServer } = require('../atlas/stagingServer');

async function main() {
  const connection = await connectStaging();
  const prefix = `batch1_test_${crypto.randomBytes(10).toString('hex')}_`;
  const key = crypto.randomBytes(32).toString('base64');
  const cipher = createTokenCipher(key);
  const sourceCipher = createTokenCipher(crypto.randomBytes(32).toString('base64'));
  const binding = crypto.randomBytes(32).toString('hex');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'seenary-provider-'));
  const filename = path.join(temp, 'source.sqlite');
  let server;
  try {
    const accounts = await createAccountService(await setupAccounts(connection.db, prefix));
    const repo = await setupProviders(connection.db, prefix);
    await setupProviders(connection.db, prefix);
    let refreshCalls = 0;
    let pendingRefresh = null;
    const adapters = Object.fromEntries(['anilist', 'mal'].map((provider) => [provider, {
      authorize: (state, verifier) => `https://mock.invalid/?state=${state}&verifier=${verifier || ''}`,
      exchange: async (code) => ({ access_token: `${provider}:${code}`, refresh_token: provider === 'mal' ? 'refresh-original' : undefined, expires_in: 3600 }),
      viewer: async (token) => ({ id: Number(token.split(':')[1]), name: 'ProviderUser' }),
      refresh: async () => { refreshCalls++; if (pendingRefresh) await pendingRefresh; return { access_token: 'mal:202', refresh_token: 'refresh-rotated', expires_in: 7200 }; },
    }]));
    const providers = createProviderService({ client: connection.client, repo, accounts, cipher, adapters });
    async function authorize(provider, mode, token, id, username) {
      const begin = await providers.begin(provider, mode, token, binding, username);
      assert.equal(begin.ok, true);
      const state = new URL(begin.authorizationUrl).searchParams.get('state');
      return providers.complete(provider, state, String(id), binding);
    }
    const alice = await accounts.register('ProviderAlice', 'alice-password');
    const bob = await accounts.register('ProviderBob', 'bob-password');
    const start = await providers.begin('anilist', 'link', alice.token, binding);
    const state = new URL(start.authorizationUrl).searchParams.get('state');
    assert.equal((await providers.complete('anilist', state, '101', 'a'.repeat(64))).ok, false, 'browser binding');
    assert.equal((await providers.complete('mal', state, '101', binding)).ok, false, 'provider binding');
    assert.equal((await providers.complete('anilist', state, '101', binding)).ok, true);
    assert.equal((await providers.complete('anilist', state, '101', binding)).ok, false, 'one-use state');
    assert.equal((await authorize('anilist', 'link', bob.token, 101)).ok, false, 'cross-account takeover rejected');
    assert.equal((await authorize('mal', 'link', alice.token, 102)).ok, true, 'AniList and MAL may be linked together');
    assert.equal(await repo.providerAccounts.countDocuments({ userId: alice.user.id }), 2);
    const login = await authorize('anilist', 'login', null, 101);
    assert.equal(login.user.id, alice.user.id, 'provider login returns mapped owner');
    assert.equal((await accounts.getSession(login.token)).authenticated, true);
    const expired = await providers.begin('mal', 'link', bob.token, binding);
    const expiredState = new URL(expired.authorizationUrl).searchParams.get('state');
    await repo.oauthFlows.updateOne({ _id: tokenHash(expiredState) }, { $set: { expiresAt: new Date(0) } });
    assert.equal((await providers.complete('mal', expiredState, '202', binding)).ok, false);
    const logoutFlow = await providers.begin('mal', 'link', bob.token, binding);
    await accounts.logout(bob.token);
    assert.equal((await providers.complete('mal', new URL(logoutFlow.authorizationUrl).searchParams.get('state'), '202', binding)).ok, false);
    bob.token = (await accounts.login('ProviderBob', 'bob-password')).token;
    assert.equal((await authorize('mal', 'link', bob.token, 202)).ok, true);
    const stored = await repo.providerAccounts.findOne({ userId: bob.user.id });
    assert(stored.accessToken.startsWith('seenary:v1:'));
    assert.equal(createTokenCipher(key).decrypt(stored.accessToken), 'mal:202', 'restart decryption');
    assert.throws(() => sourceCipher.decrypt(stored.accessToken), 'wrong key rejected');
    const payload = await providers.getLink(bob.token);
    assert.equal(JSON.stringify(payload).includes('accessToken'), false);
    assert.equal((await providers.refresh(bob.token)).ok, true);
    assert.equal(cipher.decrypt((await repo.providerAccounts.findOne({ userId: bob.user.id })).refreshToken), 'refresh-rotated');
    assert.equal((await providers.refresh(alice.token)).ok, false, 'AL requires reauthorization');
    const pendingSignup = await authorize('mal', 'login', null, 303);
    assert.equal(pendingSignup.needsUsername, true, 'new provider identity requests a Seenary username after authorization');
    assert.equal((await providers.completeSignup('mal', pendingSignup.signupToken, 'ProviderOnly', 'a'.repeat(64))).ok, false, 'signup continuation is browser-bound');
    assert.equal((await providers.completeSignup('mal', pendingSignup.signupToken, 'ProviderAlice', binding)).ok, false, 'taken username keeps signup available for correction');
    const newUser = await providers.completeSignup('mal', pendingSignup.signupToken, 'ProviderOnly', binding);
    assert.equal(newUser.ok, true);
    assert.equal(newUser.user.local_credentials_confirmed, false);
    assert.equal((await providers.unlink(newUser.token, 'mal', 'anything')).ok, false);
    assert.equal((await providers.setLocalPassword(newUser.token, 'new-local-password')).ok, true);
    assert.equal((await accounts.getSession(newUser.token)).authenticated, false);
    assert.equal((await accounts.login('ProviderOnly', 'new-local-password')).ok, true);
    assert.equal((await providers.settings(alice.token)).settings.needsDeviceReconciliation, true);
    assert.equal((await providers.settings(alice.token, { autoSyncEnabled: true })).settings.autoSyncEnabled, true);
    assert.equal((await providers.settings(bob.token)).settings.autoSyncEnabled, false);
    assert.equal((await providers.settings(alice.token, { userId: bob.user.id, autoSyncEnabled: true })).ok, false);

    let release;
    pendingRefresh = new Promise((resolve) => { release = resolve; });
    const refreshBefore = refreshCalls;
    const inFlight = providers.refresh(bob.token);
    for (let i = 0; i < 100 && refreshCalls === refreshBefore; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(refreshCalls, refreshBefore + 1);
    assert.equal((await providers.refresh(bob.token)).ok, false, 'shared refresh lease');
    await repo.jobs.insertOne({ userId: bob.user.id, provider: 'mal', status: 'pending' });
    assert.equal((await providers.unlink(bob.token, 'mal', 'bob-password')).ok, true);
    release(); pendingRefresh = null;
    assert.equal((await inFlight).ok, false, 'refresh cannot restore unlinked credentials');
    assert.equal(await repo.providerAccounts.countDocuments({ userId: bob.user.id }), 0);
    assert.equal((await repo.jobs.findOne({ userId: bob.user.id })).status, 'cancelled');
    console.log('PASS: provider login/signup/link, ownership, state binding/replay/expiry, encryption, refresh rotation/lease/unlink race, settings.');

    const legacy = await accounts.register('LegacyProvider', 'legacy-password');
    await repo.users.updateOne({ _id: legacy.user.id }, { $set: { legacyKey: JSON.stringify(['fixture', 9]) } });
    const sqlite = new DatabaseSync(filename);
    sqlite.exec('CREATE TABLE anilist_accounts (id INTEGER, user_id INTEGER, anilist_user_id INTEGER, anilist_username TEXT, original_anilist_username TEXT, access_token TEXT, created_at TEXT, updated_at TEXT, last_import_at TEXT); CREATE TABLE mal_accounts (id INTEGER, user_id INTEGER, mal_user_id INTEGER, mal_username TEXT, original_mal_username TEXT, access_token TEXT, refresh_token TEXT, token_expires_at INTEGER, created_at TEXT, updated_at TEXT, last_import_at TEXT); CREATE TABLE app_settings (key TEXT, value TEXT)');
    sqlite.prepare('INSERT INTO mal_accounts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(1, 9, 909, 'LegacyMAL', 'OriginalMAL', sourceCipher.encrypt('original-access'), sourceCipher.encrypt('original-refresh'), 1800000000000, '2026-01-01 00:00:00', '2026-01-02 00:00:00', null);
    sqlite.exec("INSERT INTO app_settings VALUES ('sync.autoEnabled.user.9','true'), ('preferences.themeAccent','blue')");
    sqlite.close();
    const before = fs.readFileSync(filename);
    const data = readProviderData(filename);
    const options = { client: connection.client, repo, data, source: 'fixture', sourceCipher, targetCipher: cipher };
    assert.equal((await importProviderData({ ...options, sourceCipher: cipher, apply: true })).conflicts.length, 1);
    assert.equal(await repo.providerAccounts.countDocuments({ userId: legacy.user.id }), 0);
    assert.equal((await importProviderData(options)).ready, 2);
    assert.equal(await repo.providerMigrationReceipts.countDocuments(), 0);
    assert.equal((await importProviderData({ ...options, apply: true })).imported, 2);
    assert.equal((await importProviderData({ ...options, verify: true })).verified, 2);
    assert.equal((await importProviderData({ ...options, apply: true })).unchanged, 2);
    assert.deepEqual(fs.readFileSync(filename), before);
    assert.equal((await providers.unlink(legacy.token, 'mal', 'legacy-password')).ok, true);
    assert.equal((await importProviderData({ ...options, apply: true })).unchanged, 2);
    assert.equal(await repo.providerAccounts.countDocuments({ userId: legacy.user.id }), 0, 'rerun cannot restore unlinked tokens');
    const legacyLogin = await accounts.login('LegacyProvider', 'legacy-password');
    await repo.jobs.insertOne({ userId: legacy.user.id, provider: 'mal', status: 'running' });
    assert.equal((await providers.deleteAccount(legacyLogin.token, 'LegacyProvider', 'wrong-password')).ok, false);
    assert.equal((await providers.deleteAccount(legacyLogin.token, 'LegacyProvider', 'legacy-password')).ok, true);
    assert.equal((await accounts.getSession(legacyLogin.token)).authenticated, false);
    assert.equal((await accounts.login('LegacyProvider', 'legacy-password')).ok, false);
    assert.equal((await repo.users.findOne({ _id: legacy.user.id })).status, 'deleted');
    assert.equal(await repo.accountSettings.countDocuments({ _id: legacy.user.id }), 0);
    assert.equal(await repo.jobs.countDocuments({ userId: legacy.user.id }), 0, 'account deletion removes private job payloads');
    const afterDeletion = await importProviderData({ ...options, apply: true });
    assert.equal(afterDeletion.conflicts.length, 2, 'deleted account blocks provider/settings re-import without retaining private receipts');
    assert.equal(await repo.providerAccounts.countDocuments({ userId: legacy.user.id }), 0);
    console.log('PASS: encrypted SQLite import, wrong-key preflight, transaction receipts, repeat verification, unlink/deletion non-resurrection.');

    server = createStagingServer(accounts, providers);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const rpc = (method, args, cookie = '') => fetch(base + '/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ method, args }) });
    const beginResponse = await rpc('beginProviderLogin', ['anilist', 'HttpProvider']);
    const browserCookie = beginResponse.headers.get('set-cookie').split(';')[0];
    const beginBody = await beginResponse.json();
    const httpState = new URL(beginBody.authorizationUrl).searchParams.get('state');
    const callback = await fetch(base + `/auth/anilist/callback?state=${httpState}&code=707`, { headers: { Cookie: browserCookie } });
    const httpUser = await callback.json();
    assert.equal(httpUser.ok, true);
    assert.equal('token' in httpUser, false);
    const httpCookie = callback.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await rpc('getProviderAccount', [], httpCookie)).json()).account.provider, 'anilist');
    assert.equal((await (await rpc('getProviderAccount', [])).json()).ok, false);
    const popupStart = await fetch(base + '/auth/mal/start?username=HttpPopup', { redirect: 'manual', headers: { Accept: 'text/html' } });
    assert.equal(popupStart.status, 302);
    const popupBinding = popupStart.headers.get('set-cookie').split(';')[0];
    const popupState = new URL(popupStart.headers.get('location')).searchParams.get('state');
    const popupCallback = await fetch(base + `/auth/mal/callback?state=${popupState}&code=708`, { headers: { Cookie: popupBinding, Accept: 'text/html' } });
    const popupHtml = await popupCallback.text();
    assert.match(popupCallback.headers.get('content-type'), /^text\/html/);
    assert.match(popupHtml, /seenary:provider-auth-complete/);
    assert.match(popupHtml, /HttpPopup/);
    assert.doesNotMatch(popupHtml, /accessToken|refreshToken|"token"/);
    const requests = [];
    const realAdapters = createProviderAdapters({ ANILIST_CLIENT_ID: 'test', ANILIST_CLIENT_SECRET: 'fake-secret', MAL_CLIENT_ID: 'test',
      ATLAS_ANILIST_REDIRECT_URI: base + '/auth/anilist/callback', ATLAS_MAL_REDIRECT_URI: base + '/auth/mal/callback' }, async (url, options) => {
      requests.push({ url, options }); return { ok: true, json: async () => ({ access_token: 'fake-access' }) };
    });
    assert.equal(new URL(realAdapters.mal.authorize('state', 'verifier')).searchParams.get('code_challenge_method'), 'plain');
    await realAdapters.mal.exchange('code', 'verifier');
    assert.equal(new URLSearchParams(requests.at(-1).options.body).get('code_verifier'), 'verifier');
    await realAdapters.anilist.exchange('code');
    assert.equal(JSON.parse(requests.at(-1).options.body).redirect_uri, base + '/auth/anilist/callback');
    console.log('PASS: HTTP provider callbacks/cookies, safe responses, and real adapter request construction with mock transport.');
  } finally {
    if (server) await new Promise((resolve) => { server.close(resolve); server.closeIdleConnections(); });
    try {
      for (const suffix of ['users', 'sessions', 'providerAccounts', 'oauthFlows', 'accountSettings', 'providerMigrationReceipts', 'jobs']) {
        await connection.db.collection(prefix + suffix).drop().catch((error) => { if (error.code !== 26) throw error; });
      }
    } finally { await connection.close(); }
    if (fs.existsSync(filename)) fs.unlinkSync(filename);
    fs.rmdirSync(temp);
  }
}
main().catch((error) => {
  if (error.code === 'ERR_ASSERTION') console.error(`Provider assertion failed at ${String(error.stack).split('\n')[1]?.trim()}`);
  else reportError(error);
  process.exitCode = 1;
});
