const assert = require('node:assert/strict');
const { createAccountService, tokenHash } = require('../atlas/accounts');
const { createStagingServer } = require('../atlas/stagingServer');

async function main() {
  const token = 'a'.repeat(64);
  const user = { _id: 'user', authVersion: 1, username: 'Tester' };
  let record;
  let revokeDuringUpdate = false;
  const reset = () => { record = { _id: tokenHash(token), userId: user._id, authVersion: 1,
    expiresAt: new Date(Date.now() + 60000) }; };
  const matches = query => record && record._id === query._id && record.expiresAt > query.expiresAt.$gt
    && (query.authVersion === undefined || record.authVersion === query.authVersion);
  const repo = {
    users: { findOne: async query => query.authVersion === user.authVersion && user.status !== 'deleted' ? user : null },
    sessions: {
      findOne: async query => matches(query) ? { ...record } : null,
      updateOne: async (query, update) => {
        if (revokeDuringUpdate) record = null;
        if (!matches(query)) return { matchedCount: 0 };
        record.expiresAt = new Date(Math.max(record.expiresAt, update.$max.expiresAt));
        return { matchedCount: 1 };
      },
      deleteOne: async () => { record = null; },
    },
  };
  const service = await createAccountService(repo);
  reset();
  const originalExpiry = record.expiresAt.getTime();
  assert.equal((await service.getSession(token)).authenticated, true);
  assert.equal(record.expiresAt.getTime(), originalExpiry, 'passive checks must not renew');
  assert.equal((await service.renewSession(token)).ok, true);
  assert(record.expiresAt.getTime() >= Date.now() + 7 * 86400000 - 1000);
  record.expiresAt = new Date(Date.now() + 10 * 86400000);
  const longerExpiry = record.expiresAt.getTime();
  await service.renewSession(token);
  assert.equal(record.expiresAt.getTime(), longerExpiry, 'renewal must not shorten expiry');
  record.expiresAt = new Date(0);
  assert.equal((await service.renewSession(token)).ok, false);
  reset(); user.authVersion = 2;
  assert.equal((await service.renewSession(token)).ok, false, 'password revocation');
  user.authVersion = 1; user.status = 'deleted';
  assert.equal((await service.renewSession(token)).ok, false);
  delete user.status;
  reset(); revokeDuringUpdate = true;
  assert.equal((await service.renewSession(token)).ok, false, 'concurrent logout');
  revokeDuringUpdate = false;
  assert.equal((await service.renewSession('invalid')).ok, false);

  const server = createStagingServer(service, null, null, null, null, null,
    { secureCookies: true, cookieName: 'seenary_sid' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const rpc = (method, expectedUserId) => fetch(`http://127.0.0.1:${server.address().port}/rpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `seenary_sid=${token}` },
    body: JSON.stringify({ method, args: [], ...(expectedUserId ? { expectedUserId } : {}) }),
  });
  try {
    reset();
    const expiry = record.expiresAt.getTime();
    for (let index = 0; index < 3; index++) {
      const response = await rpc('getSession');
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal((await response.json()).authenticated, true);
    }
    assert.equal(record.expiresAt.getTime(), expiry, 'startup/polling cannot extend session');
    const renewed = await rpc('renewSession', user._id);
    assert.equal(renewed.status, 200);
    assert.deepEqual(await renewed.json(), { ok: true });
    const cookie = renewed.headers.get('set-cookie');
    for (const attribute of [`seenary_sid=${token}`, 'Max-Age=604800', 'HttpOnly', 'Secure', 'SameSite=Strict']) assert(cookie.includes(attribute));
    const beforeMismatch = record.expiresAt.getTime();
    assert.equal((await rpc('renewSession', 'other-user')).status, 409);
    assert.equal(record.expiresAt.getTime(), beforeMismatch);
    record.expiresAt = new Date(0);
    const expired = await rpc('renewSession');
    assert.equal(expired.status, 401);
    assert.equal(expired.headers.get('set-cookie'), null);
    reset();
    const logout = await rpc('logout');
    assert(logout.headers.get('set-cookie').includes('Max-Age=0'));
    assert.equal((await rpc('renewSession')).status, 401);
    console.log('PASS: input-only renewal contract, expiry/cookie alignment, passive checks, revocation, account isolation.');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
