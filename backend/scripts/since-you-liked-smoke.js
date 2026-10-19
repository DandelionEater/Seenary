const assert = require('node:assert/strict');
const { Collection } = require('./atlas-metadata-smoke');
const { createSinceYouLikedService } = require('../atlas/sinceYouLiked');
const { createStagingServer } = require('../atlas/stagingServer');
const { exportAccountData, eraseAccountData } = require('../atlas/accountData');

// Evaluate the Mongo expressions used by the service against synthetic records.
function expression(value, row) {
  if (typeof value === 'string' && value.startsWith('$')) return row[value.slice(1)];
  if (!value || typeof value !== 'object') return value;
  if (value.$eq) { const [a, b] = value.$eq.map(item => expression(item, row)); return a === b; }
  if (value.$cond) return expression(value.$cond[expression(value.$cond[0], row) ? 1 : 2], row);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expression(item, row)]));
}
class FeedbackCollection extends Collection {
  aggregate(pipeline) {
    return { toArray: async () => {
      const rows = await this.find(pipeline[0].$match).toArray();
      const group = pipeline[1].$group;
      const groups = new Map();
      for (const row of rows) {
        const id = expression(group._id, row); const key = JSON.stringify(id);
        const result = groups.get(key) ?? { _id: id };
        for (const [field, operation] of Object.entries(group)) {
          if (field !== '_id') result[field] = (result[field] ?? 0) + expression(operation.$sum, row);
        }
        groups.set(key, result);
      }
      return [...groups.values()];
    } };
  }
  async deleteMany(query) {
    const matches = await this.find(query).toArray();
    for (const row of matches) await this.deleteOne({ _id: row._id });
    return { deletedCount: matches.length };
  }
}
function fixture() {
  const repo = { sinceYouLikedFeedback: new FeedbackCollection(), sinceYouLikedHidden: new FeedbackCollection() };
  const accounts = {
    getAuthenticatedUser: async token => token && token !== 'invalid' ? { _id: token, username: token } : null,
    getSession: async token => ({ authenticated: Boolean(token && token !== 'invalid'), user: { id: token } }),
  };
  return { repo, accounts, service: createSinceYouLikedService({ repo, accounts, env: {} }) };
}
async function main() {
  const { repo, accounts, service } = fixture();
  const pair = { mediaType: 'ANIME', sourceMediaId: 1, recommendedMediaId: 10 };
  const request = { mediaType: 'ANIME', pairs: [pair, { sourceMediaId: 2, recommendedMediaId: 10 }] };
  const state = user => service.state(user, request);
  assert.equal((await service.feedback(null, { ...pair, feedback: 'like' })).ok, false);
  for (const invalid of [{ sourceMediaId: 0 }, { recommendedMediaId: 1 }, { sourceMediaId: {} }, { feedback: 'hide' }, { mediaType: 'BOOK' }]) {
    assert.equal((await service.feedback('alice', { ...pair, feedback: 'like', ...invalid })).ok, false);
  }
  assert.equal((await service.state('alice', { ...request, pairs: Array(81).fill(pair) })).ok, false);
  assert.equal((await service.state('alice', null)).ok, false);
  assert.equal((await service.hide('alice', { mediaType: 'ANIME', mediaId: 10, hidden: 'yes' })).ok, false);
  await service.feedback('alice', { ...pair, feedback: 'like', userId: 'bob' });
  assert.equal(repo.sinceYouLikedFeedback.rows[0].userId, 'alice', 'identity belongs to the session');
  const createdAt = repo.sinceYouLikedFeedback.rows[0].createdAt;
  await service.feedback('alice', { ...pair, feedback: 'like' });
  assert.equal(repo.sinceYouLikedFeedback.rows.length, 1, 'repeated clicks are idempotent');
  assert.equal((await state('bob')).pairs[0].feedbackAdjustment, 2, 'feedback adjusts everyone’s pair score');
  assert.equal((await state('bob')).pairs[0].sinceYouLikedFeedback, null, 'another user’s reaction stays private');
  assert.equal((await state('bob')).pairs[1].feedbackAdjustment, 0, 'other source relationships are unaffected');
  await service.feedback('alice', { ...pair, feedback: 'dislike' });
  assert.equal(repo.sinceYouLikedFeedback.rows.length, 1);
  assert.deepEqual(repo.sinceYouLikedFeedback.rows[0].createdAt, createdAt);
  assert.equal((await state('alice')).pairs[0].feedbackAdjustment, -2);
  assert.equal((await state('alice')).pairs[0].sinceYouLikedFeedback, 'dislike');
  await service.feedback('bob', { ...pair, feedback: 'like' });
  assert.equal((await state('alice')).pairs[0].feedbackAdjustment, 0);
  await service.hide('alice', { mediaType: 'ANIME', mediaId: 10, hidden: true });
  assert.deepEqual((await state('alice')).hiddenMediaIds, [10]);
  assert.deepEqual((await state('bob')).hiddenMediaIds, []);
  assert.equal((await state('alice')).pairs[0].feedbackAdjustment, 0, 'hiding never affects global weights');
  assert.deepEqual((await service.state('alice', { ...request, mediaType: 'MANGA' })).hiddenMediaIds, []);
  assert.equal((await service.state('alice', { ...request, mediaType: 'MANGA' })).pairs[0].feedbackAdjustment, 0);
  await service.hide('alice', { mediaType: 'ANIME', mediaId: 10, hidden: false });
  assert.deepEqual((await state('alice')).hiddenMediaIds, []);
  await service.feedback('alice', { ...pair, feedback: null });
  assert.equal((await state('alice')).pairs[0].sinceYouLikedFeedback, null);
  assert.equal((await state('bob')).pairs[0].feedbackAdjustment, 2);
  for (let i = 0; i < 10; i++) await service.feedback(`voter${i}`, { ...pair, feedback: 'like' });
  assert.equal((await state('alice')).pairs[0].feedbackAdjustment, 10, 'aggregate influence is bounded');
  const tuned = createSinceYouLikedService({ repo, accounts, env: { SINCE_LIKED_LIKE_WEIGHT: '0.1', SINCE_LIKED_MAX_ADJUSTMENT: '3' } });
  assert.equal((await tuned.state('alice', request)).pairs[0].feedbackAdjustment, 1.1);
  const restarted = createSinceYouLikedService({ repo, accounts, env: {} });
  assert.equal((await restarted.state('bob', request)).pairs[0].sinceYouLikedFeedback, 'like', 'reactions survive service restart');
  const exported = await exportAccountData(repo, { _id: 'bob', username: 'bob' });
  assert.equal(exported.data.sinceYouLikedFeedback.length, 1);
  await eraseAccountData(repo, 'bob');
  assert.equal((await state('bob')).pairs[0].sinceYouLikedFeedback, null);
  assert.equal(repo.sinceYouLikedFeedback.rows.length, 10, 'deletion retains other accounts’ votes');

  const server = createStagingServer(accounts, null, null, null, null, null, { recommendations: service });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const rpc = (method, payload, expectedUserId = 'alice') => fetch(`http://127.0.0.1:${server.address().port}/rpc`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'seenary_atlas_staging=alice' },
      body: JSON.stringify({ method, args: [payload], expectedUserId }),
    });
    assert.equal((await rpc('setSinceYouLikedFeedback', { ...pair, feedback: 'like' }, 'bob')).status, 409);
    assert.equal((await (await rpc('setSinceYouLikedFeedback', { ...pair, feedback: 'dislike' })).json()).ok, true);
    assert.equal((await (await rpc('getSinceYouLikedState', request)).json()).pairs[0].sinceYouLikedFeedback, 'dislike');
    assert.equal((await (await rpc('setSinceYouLikedHidden', { mediaType: 'ANIME', mediaId: 10, hidden: true })).json()).ok, true);
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('PASS: pair-scoped shared scoring, account-only hiding, replace/clear/undo, bounds, validation, persistence, export/deletion, and authenticated RPC routes.');
}
module.exports = { fixture };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
