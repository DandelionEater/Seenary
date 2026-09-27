const test = require('node:test');
const assert = require('node:assert/strict');
const { createProviderService } = require('../atlas/providers');

function fixture(state) {
  return createProviderService({
    accounts: { getAuthenticatedUser: async token => token ? { _id: token } : null },
    repo: {
      providerAccounts: { findOne: async query => query.userId === 'alice' && query.provider === 'anilist' ? { _id: 'alice-link' } : null },
      providerRefreshStates: { findOne: async () => state },
    },
  });
}

test('pull status exposes retry diagnostics without exposing the stored record', async () => {
  const retryAt = new Date(Date.now() + 60000);
  const service = fixture({ lastOutcome: 'retry', lastErrorCode: 'PROVIDER_BUDGET', attempts: 2,
    nextAttemptAt: retryAt, manualRequestedAt: new Date(), leaseOwner: 'private-worker', privateData: 'private' });
  const result = await service.inboundSyncStatus('alice', 'anilist');
  assert.equal(result.ok, true);
  assert.equal(result.sync.lastErrorCode, 'PROVIDER_BUDGET');
  assert.equal(result.sync.attempts, 2);
  assert.equal(result.sync.nextAttemptAt, retryAt);
  assert.equal(result.sync.progress.stage, 'queued');
  assert.equal(result.sync.running, false);
  assert.equal('leaseOwner' in result.sync, false);
  assert.equal('privateData' in result.sync, false);
});

test('pull status remains authenticated and account scoped', async () => {
  const service = fixture({ lastErrorCode: 'PROVIDER_BUDGET' });
  assert.equal((await service.inboundSyncStatus(null, 'anilist')).ok, false);
  assert.equal((await service.inboundSyncStatus('bob', 'anilist')).ok, false);
  assert.equal((await service.inboundSyncStatus('alice', 'invalid')).ok, false);
});

test('pull status defaults missing diagnostics and rejects unsafe error strings', async () => {
  const state = {};
  const service = fixture(state);
  const initial = await service.inboundSyncStatus('alice', 'anilist');
  assert.equal(initial.sync.lastErrorCode, null);
  assert.equal(initial.sync.nextAttemptAt, null);
  assert.equal(initial.sync.attempts, 0);
  state.lastErrorCode = 'sensitive error text\nwith details';
  assert.equal((await service.inboundSyncStatus('alice', 'anilist')).sync.lastErrorCode, null);
});
