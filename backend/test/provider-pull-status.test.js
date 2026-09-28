const test = require('node:test');
const assert = require('node:assert/strict');
const { createProviderService } = require('../atlas/providers');
const { createProviderInbound } = require('../atlas/providerInbound');

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
  const service = fixture({ lastOutcome: 'retry', lastErrorCode: 'PROVIDER_HTTP_429', lastErrorStatus: 429, lastErrorPhase: 'fetch-manga', attempts: 2,
    nextAttemptAt: retryAt, manualRequestedAt: new Date(), leaseOwner: 'private-worker', privateData: 'private' });
  const result = await service.inboundSyncStatus('alice', 'anilist');
  assert.equal(result.ok, true);
  assert.equal(result.sync.lastErrorCode, 'PROVIDER_HTTP_429');
  assert.equal(result.sync.lastErrorStatus, 429);
  assert.equal(result.sync.lastErrorPhase, 'fetch-manga');
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
  assert.equal(initial.sync.lastErrorStatus, null);
  assert.equal(initial.sync.lastErrorPhase, null);
  assert.equal(initial.sync.nextAttemptAt, null);
  assert.equal(initial.sync.attempts, 0);
  state.lastErrorCode = 'sensitive error text\nwith details';
  state.lastErrorPhase = 'private error message';
  state.lastErrorStatus = 999;
  assert.equal((await service.inboundSyncStatus('alice', 'anilist')).sync.lastErrorCode, null);
  assert.equal((await service.inboundSyncStatus('alice', 'anilist')).sync.lastErrorPhase, null);
  assert.equal((await service.inboundSyncStatus('alice', 'anilist')).sync.lastErrorStatus, null);
});

for (const status of [401, 429, 503, undefined]) {
  test(`worker records the failed collection phase and HTTP status ${status}`, async () => {
    const state = { _id: 'link', userId: 'alice', provider: 'anilist', manualRequestedAt: new Date(), attempts: 0 };
    const link = { _id: 'link', userId: 'alice', provider: 'anilist', providerUserId: '123', accessToken: 'encrypted' };
    let recorded;
    const worker = createProviderInbound({
      repo: {
        providerRefreshStates: {
          findOne: async () => state,
          updateOne: async (_, update) => { if (update.$set?.lastOutcome) recorded = update.$set; return {}; },
        },
        providerAccounts: { findOne: async () => link },
        accountSettings: { findOne: async () => ({}) },
        providerBudgets: { findOne: async () => null, insertOne: async () => ({}) },
      },
      spacing: { anilist: 0, mal: 0 },
      cipher: { decrypt: () => 'private-token' },
      adapters: { pull: async (_, token, type) => {
        assert.equal(token, 'private-token');
        if (type === 'ANIME') return { lists: [] };
        throw Object.assign(new Error('private response body'), { status });
      } },
    });
    assert.equal((await worker.refresh({ owner: 'test-owner', state })).status, 'retry');
    assert.equal(recorded.lastErrorPhase, 'fetch-manga');
    assert.equal(recorded.lastErrorStatus, status ?? null);
    assert.equal(recorded.lastErrorCode, status ? `PROVIDER_HTTP_${status}` : 'PROVIDER_UNAVAILABLE');
    assert.equal(JSON.stringify(recorded).includes('private'), false);
  });
}

test('explicit pull requeues an idle failed manual job without losing its history', async () => {
  const original = new Date(Date.now() - 3600000);
  const state = { _id: 'link', revision: 4, manualRequestedAt: original, lastOutcome: 'retry', attempts: 144,
    nextAttemptAt: new Date(Date.now() + 3600000) };
  let update;
  const service = createProviderService({
    accounts: { getAuthenticatedUser: async () => ({ _id: 'alice' }) },
    repo: { providerAccounts: { findOne: async () => ({ _id: 'link' }) },
      providerRefreshStates: { findOne: async () => state, updateOne: async (query, value) => {
        update = { query, value }; Object.assign(state, value.$set); return { modifiedCount: 1 };
      } } },
  });
  const reply = await service.requestInboundSync('alice', 'anilist');
  assert.equal(reply.retryQueued, true);
  assert.equal(reply.requestedAt, original);
  assert.equal(update.query.revision, 4);
  assert.ok(update.query.$or);
  assert.ok(state.nextAttemptAt.getTime() <= Date.now());
  assert.equal(state.attempts, 144);
  assert.equal((await service.requestInboundSync('alice', 'anilist')).alreadyQueued, true, 'repeated clicks are throttled');
});

test('explicit retry preserves active leases and provider rate-limit backoff', async () => {
  for (const fields of [{ leaseUntil: new Date(Date.now() + 60000) }, { lastErrorStatus: 429 }]) {
    const state = { revision: 1, manualRequestedAt: new Date(), lastOutcome: 'retry', ...fields };
    const service = createProviderService({
      accounts: { getAuthenticatedUser: async () => ({ _id: 'alice' }) },
      repo: { providerAccounts: { findOne: async () => ({ _id: 'link' }) },
        providerRefreshStates: { findOne: async () => state, updateOne: async () => assert.fail('must preserve backoff or active lease') } },
    });
    assert.equal((await service.requestInboundSync('alice', 'anilist')).alreadyQueued, true);
  }
});
