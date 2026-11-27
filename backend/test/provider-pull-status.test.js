const test = require('node:test');
const assert = require('node:assert/strict');
const { createProviderService } = require('../atlas/providers');
const { createProviderInbound } = require('../atlas/providerInbound');

test('MyAnimeList pagination stops on cycles, endless empty pages, and cancellation', async () => {
  const fetchPath = require.resolve('node-fetch');
  const malPath = require.resolve('../mal');
  const originalFetch = require(fetchPath);
  const originalMal = require.cache[malPath];
  let calls = 0;
  let repeat = true;
  let mal;
  try {
    require.cache[fetchPath].exports = async () => {
      calls++;
      return { ok: true, status: 200, json: async () => ({
        data: [], paging: { next: `https://api.myanimelist.net/v2/users/@me/animelist?offset=${repeat ? 100 : calls * 100}` },
      }) };
    };
    delete require.cache[malPath];
    mal = require(malPath);
  } finally {
    require.cache[fetchPath].exports = originalFetch;
    if (originalMal) require.cache[malPath] = originalMal;
    else delete require.cache[malPath];
  }

  await assert.rejects(mal.getViewerAnimeList('token'), { code: 'MAL_PAGINATION_LIMIT' });
  assert.equal(calls, 2);
  calls = 0;
  repeat = false;
  await assert.rejects(mal.getViewerMangaList('token'), { code: 'MAL_PAGINATION_LIMIT' });
  assert.equal(calls, 1000);
  calls = 0;
  await assert.rejects(mal.getViewerAnimeList('token', { checkActive: async () => {
    if (calls > 0) throw Object.assign(new Error('Pull cancelled'), { code: 'PULL_CANCELLED' });
  } }), { code: 'PULL_CANCELLED' });
  assert.equal(calls, 1);
});

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

test('a successful pull with a leftover request is idle and can be started again', async () => {
  const state = { lastOutcome: 'success', lastSuccessAt: new Date(Date.now() - 1000),
    manualRequestedAt: new Date(Date.now() - 5000), progress: { stage: 'starting' } };
  const status = (await fixture(state).inboundSyncStatus('alice', 'anilist')).sync;
  assert.equal(status.requestedAt, null);
  assert.equal(status.progress, null);
  state.manualRequestedAt = new Date();
  assert.equal((await fixture(state).inboundSyncStatus('alice', 'anilist')).sync.requestedAt, state.manualRequestedAt);
});

test('an empty MyAnimeList account completes its first pull within the shared request budget', async () => {
  let clock = 10000;
  let budget;
  let completion;
  const calls = [];
  const state = { _id: 'link', userId: 'alice', provider: 'mal', manualRequestedAt: new Date(clock) };
  const link = { _id: 'link', userId: 'alice', provider: 'mal', revision: 1, accessToken: 'encrypted' };
  const worker = createProviderInbound({
    repo: {
      providerRefreshStates: {
        findOne: async () => state,
        updateOne: async (_, update) => { if (update.$set.lastOutcome) completion = update; return { matchedCount: 1 }; },
      },
      providerAccounts: { findOne: async () => link },
      accountSettings: { findOne: async () => null },
      providerBudgets: {
        findOne: async () => budget,
        insertOne: async (record) => { budget = record; },
        findOneAndUpdate: async (_, update) => Object.assign(budget, update.$set),
      },
    },
    cipher: { decrypt: () => 'token' },
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    adapters: { pull: async (_, __, type) => { calls.push([type, clock]); return { data: [] }; } },
  });
  assert.deepEqual(await worker.refresh({ owner: 'test-owner', state }), {
    status: 'succeeded', counts: { applied: 0, skipped: 0, review: 0 },
  });
  assert.deepEqual(calls, [['ANIME', 10000], ['MANGA', 11000]]);
  assert.equal(completion.$set.lastOutcome, 'success');
  assert.equal(completion.$unset.manualRequestedAt, '');
  assert.equal(completion.$unset.leaseUntil, '');
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
    assert.equal((await worker.refresh({ owner: 'test-owner', state })).status, status === 401 ? 'failed' : 'retry');
    assert.equal(recorded.lastOutcome, status === 401 ? 'reauthorization-required' : 'retry');
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
