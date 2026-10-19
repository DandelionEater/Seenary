const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { WorkerCollection } = require('./atlas-worker-smoke');
const { createAccountService } = require('../atlas/accounts');
const { createProviderService } = require('../atlas/providers');
const { createProviderInbound } = require('../atlas/providerInbound');
const { createTokenCipher } = require('../atlas/tokenCipher');

async function scenario(provider, chooseUsernameFirst) {
  const names = ['users', 'sessions', 'providerAccounts', 'oauthFlows', 'accountSettings', 'jobs', 'jobLocks', 'providerRefreshStates', 'providerBudgets', 'media', 'libraryEntries', 'libraryChanges', 'libraryState'];
  const repo = Object.fromEntries(names.map(name => [name, new WorkerCollection()]));
  for (const collection of Object.values(repo)) {
    const update = collection.findOneAndUpdate.bind(collection);
    collection.findOneAndUpdate = async (query, patch, options = {}) => {
      const before = options.returnDocument === 'before' ? await collection.findOne(query) : null;
      const after = await update(query, patch, options);
      return options.returnDocument === 'before' ? before : after;
    };
    collection.findOneAndDelete = async query => { const row = await collection.findOne(query); if (row) await collection.deleteOne(query); return row; };
    collection.replaceOne = async (query, replacement) => { await collection.deleteOne(query); return collection.insertOne(replacement); };
  }
  const client = { startSession: () => ({ withTransaction: operation => operation(), endSession: async () => {} }) };
  const accounts = await createAccountService(repo);
  const cipher = createTokenCipher(Buffer.alloc(32, 9).toString('base64'));
  const adapter = { authorize: state => `https://provider.invalid/?state=${state}`,
    exchange: async () => ({ access_token: 'test-token', expires_in: 3600 }), viewer: async () => ({ id: 123, name: 'ProviderUser' }) };
  const providers = createProviderService({ client, repo, accounts, cipher, adapters: { [provider]: adapter } });
  const binding = 'a'.repeat(64);
  async function authorize(username) {
    const started = await providers.begin(provider, 'login', null, binding, username);
    return providers.complete(provider, new URL(started.authorizationUrl).searchParams.get('state'), 'test-code', binding);
  }
  const authorized = await authorize(chooseUsernameFirst ? 'FreshProvider' : undefined);
  const signup = chooseUsernameFirst ? authorized : await providers.completeSignup(provider, authorized.signupToken, 'FreshProvider', binding);
  assert.equal(signup.ok, true);
  const link = await repo.providerAccounts.findOne({ userId: signup.user.id });
  const queued = await repo.providerRefreshStates.findOne({ _id: link._id });
  assert(queued?.manualRequestedAt instanceof Date, 'signup queues a one-time pull in both signup paths');
  assert.notEqual((await repo.accountSettings.findOne({ _id: signup.user.id }))?.autoSyncEnabled, true, 'initial import does not opt into ongoing automatic sync');
  let calls = 0;
  const media = { ensure: async (type, source, id) => {
    const key = source === 'anilist' ? 'anilistId' : 'malId';
    const existing = await repo.media.findOne({ type, [key]: id });
    if (existing) return existing;
    const document = { _id: crypto.randomUUID(), type, [key]: id };
    await repo.media.insertOne(document); return document;
  } };
  const inbound = createProviderInbound({ client, repo, cipher, media, spacing: { anilist: 0, mal: 0 }, adapters: {
    mapMal: async () => [], pull: async (_provider, _token, type) => {
      calls++;
      return provider === 'anilist' ? { lists: [{ entries: [{ status: 'CURRENT', progress: 3, media: { id: type === 'ANIME' ? 11 : 22 } }] }] }
        : { data: [{ node: { id: type === 'ANIME' ? 11 : 22 }, list_status: { status: type === 'ANIME' ? 'watching' : 'reading', num_episodes_watched: 3, num_chapters_read: 3 } }] };
    },
  } });
  const pulled = await inbound.runOnce(1);
  assert.equal(pulled.results[0].status, 'succeeded');
  assert.equal(await repo.libraryEntries.countDocuments({ userId: signup.user.id, type: 'ANIME' }), 1);
  assert.equal(await repo.libraryEntries.countDocuments({ userId: signup.user.id, type: 'MANGA' }), 1);
  assert.equal((await repo.providerRefreshStates.findOne({ _id: link._id })).manualRequestedAt, undefined, 'initial request is consumed');
  await authorize();
  assert.equal((await repo.providerRefreshStates.findOne({ _id: link._id })).manualRequestedAt, undefined, 'ordinary sign-in does not requeue the initial import');
  await inbound.runOnce(1);
  assert.equal(calls, 2, 'automatic sync remains disabled after the first import');
}
async function main() {
  for (const provider of ['anilist', 'mal']) for (const first of [false, true]) await scenario(provider, first);
  console.log('PASS: AniList/MAL signup in both flows imports anime and manga once, preserves auto-sync preference, and does not requeue on login.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
