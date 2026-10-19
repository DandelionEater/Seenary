const assert = require('node:assert/strict');
const argon2 = require('argon2');
const { WorkerCollection } = require('./atlas-worker-smoke');
const { createAccountService } = require('../atlas/accounts');
const { createProviderService } = require('../atlas/providers');

async function main() {
  const repo = Object.fromEntries(['users', 'sessions', 'providerAccounts', 'oauthFlows', 'jobs', 'jobLocks', 'providerRefreshStates'].map(name => [name, new WorkerCollection()]));
  for (const collection of Object.values(repo)) collection.deleteMany = async query => {
    let deletedCount = 0;
    while ((await collection.deleteOne(query)).deletedCount) deletedCount++;
    return { deletedCount };
  };
  let transactions = 0;
  const client = { startSession: () => ({ withTransaction: async operation => { transactions++; return operation(); }, endSession: async () => {} }) };
  const accounts = await createAccountService(repo);
  const providers = createProviderService({ client, repo, accounts, cipher: {}, adapters: {} });
  const fresh = await accounts.register('FreshMAL', 'unavailable-generated-password');
  await repo.users.updateOne({ _id: fresh.user.id }, { $set: { local_credentials_confirmed: false } });
  await repo.providerAccounts.insertOne({ _id: 'mal-link', userId: fresh.user.id, provider: 'mal', providerUserId: '123', username: 'MAL user' });
  assert.equal((await providers.getLink(fresh.token, 'mal')).localCredentialsConfirmed, false);
  assert.equal((await providers.getLink(fresh.token, 'anilist')).localCredentialsConfirmed, false, 'password state is available even when that provider is not linked');
  assert.equal((await providers.unlink(fresh.token, 'mal', 'short', true)).ok, false);
  assert.equal((await providers.unlink(fresh.token, 'mal', 'wrong-password')).ok, false);
  assert.equal(await repo.providerAccounts.countDocuments({ userId: fresh.user.id }), 1);
  const before = transactions;
  assert.equal((await providers.unlink(fresh.token, 'mal', 'chosen-new-password', true)).ok, true);
  assert.equal(transactions, before + 1, 'setup and unlink use one transaction and one session');
  assert.equal(await repo.providerAccounts.countDocuments({ userId: fresh.user.id }), 0);
  assert.equal((await accounts.getSession(fresh.token)).authenticated, false, 'successful unlink revokes the previous session');
  const login = await accounts.login('FreshMAL', 'chosen-new-password');
  assert.equal(login.ok, true, 'provider-only account remains accessible with its new password');
  assert.equal((await providers.getLink(login.token, 'mal')).localCredentialsConfirmed, true);
  await repo.providerAccounts.insertOne({ _id: 'second-link', userId: fresh.user.id, provider: 'mal', providerUserId: '123', username: 'MAL user' });
  assert.equal((await providers.unlink(login.token, 'mal', 'replacement-password', true)).ok, false, 'setup mode cannot overwrite an existing password');
  assert.equal((await providers.unlink(login.token, 'mal', 'wrong-password')).ok, false);
  assert.equal((await providers.unlink(login.token, 'mal', 'chosen-new-password')).ok, true);
  assert.equal(await argon2.verify((await repo.users.findOne({ _id: fresh.user.id })).password_hash, 'chosen-new-password'), true, 'normal unlink preserves the existing password');
  console.log('PASS: provider-only password state, one-transaction password setup/unlink, session revocation, new-password login, and existing-password protection.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
