const assert = require('node:assert/strict');
const argon2 = require('argon2');
const { createRecoveryService, createRecoveryMailer } = require('../atlas/recovery');
const { createStagingServer } = require('../atlas/stagingServer');

// Isolated collection adapter: no database credentials or real email delivery.
function matches(row, query) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$or') return expected.some(q => matches(row, q));
    const actual = key.split('.').reduce((v, part) => v?.[part], row);
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) return Object.entries(expected).every(([op, value]) => {
      if (op === '$exists') return (actual !== undefined) === value;
      if (op === '$ne') return actual !== value;
      if (op === '$lt') return actual < value;
      if (op === '$lte') return actual <= value;
      if (op === '$gt') return actual > value;
      throw Error(`Unsupported test operator ${op}`);
    });
    return actual === expected;
  });
}
async function main() {
  const rows = [{ _id: 'alice', authVersion: 0, local_credentials_confirmed: true, password_hash: await argon2.hash('original-password') }];
  const users = {
    async findOne(query) { return structuredClone(rows.find(row => matches(row, query)) || null); },
    async findOneAndUpdate(query, update) {
      const before = await this.findOne(query);
      if (!before) return null;
      const result = await this.updateOne(query, update);
      return result.modifiedCount ? this.findOne({ _id: before._id }) : null;
    },
    async updateOne(query, update) {
      const row = rows.find(row => matches(row, query));
      if (!row) return { modifiedCount: 0 };
      if (update.$set?.recoveryEmail && rows.some(other => other !== row && other.recoveryEmail === update.$set.recoveryEmail)) throw Object.assign(Error('duplicate'), { code: 11000 });
      Object.assign(row, update.$set);
      for (const key of Object.keys(update.$unset || {})) delete row[key];
      for (const [key, amount] of Object.entries(update.$inc || {})) { const parts = key.split('.'); const last = parts.pop(); const target = parts.reduce((v, part) => v[part], row); target[last] += amount; }
      return { modifiedCount: 1 };
    },
  };
  const sessions = { aliceSession: { id: 'alice', version: 0 } };
  const accounts = { async getAuthenticatedUser(token) {
    const session = sessions[token];
    return session ? users.findOne({ _id: session.id, authVersion: session.version, status: { $ne: 'deleted' } }) : null;
  } };
  const sent = [];
  const mailer = { configured: true, async send(email, kind, token) { sent.push({ email, kind, token }); } };
  const service = createRecoveryService({ users }, accounts, mailer);
  rows[0].local_credentials_confirmed = false;
  assert.equal((await service.setRecoveryEmail('aliceSession', 'alice@example.com', '')).needsLocalPassword, true, 'provider-only accounts must set a password before adding email');
  assert.equal(sent.length, 0);
  rows[0].local_credentials_confirmed = true;
  assert.equal((await service.setRecoveryEmail('missing', 'alice@example.com', 'original-password')).ok, false);
  assert.equal((await service.setRecoveryEmail('aliceSession', 'alice@example.com', 'wrong-password')).ok, false);
  assert.equal((await service.setRecoveryEmail('aliceSession', ' Alice@Example.com ', 'original-password')).ok, true);
  assert.equal(rows[0].recoveryEmail, undefined, 'unverified email cannot recover an account');
  assert.notEqual(rows[0].recoveryPending.hash, sent[0].token, 'raw tokens are never stored');
  assert.match(sent[0].token, /^\d{6}$/, 'email contains a six-digit code');
  assert.equal(await argon2.verify(rows[0].recoveryPending.codeHash, sent[0].token), true, 'verification code is stored as an Argon2 hash');
  assert.equal((await service.verifyRecoveryEmailCode('missing', sent[0].token)).ok, false, 'code requires its authenticated account');
  await service.requestPasswordReset('alice@example.com');
  assert.equal(sent.length, 1, 'unverified address receives no reset');
  assert.equal((await service.verifyRecoveryEmailCode('aliceSession', sent[0].token)).ok, true);
  assert.equal((await service.verifyRecoveryEmailCode('aliceSession', sent[0].token)).ok, false, 'verification is single use');
  const known = await service.requestPasswordReset('alice@example.com');
  assert.deepEqual(await service.requestPasswordReset('unknown@example.com'), known, 'do not enumerate accounts');
  assert.equal(sent.length, 2);
  await service.requestPasswordReset('alice@example.com');
  assert.equal(sent.length, 2, 'per-account email cooldown');
  assert.equal((await service.resetPassword(sent[1].token, 'short')).ok, false);
  const resets = await Promise.all([service.resetPassword(sent[1].token, 'replacement-password'), service.resetPassword(sent[1].token, 'other-password')]);
  assert.equal(resets.filter(r => r.ok).length, 1, 'only one concurrent redemption succeeds');
  assert.equal(await accounts.getAuthenticatedUser('aliceSession'), null, 'password reset revokes sessions');
  assert.equal(rows[0].passwordReset, undefined);
  assert.equal(await argon2.verify(rows[0].password_hash, 'original-password'), false);
  sessions.aliceSession.version = rows[0].authVersion;
  delete rows[0].resetSentAt;
  await service.requestPasswordReset('alice@example.com');
  rows[0].passwordReset.expiresAt = new Date(0);
  assert.equal((await service.resetPassword(sent.at(-1).token, 'new-password')).ok, false, 'expired token');
  delete rows[0].resetSentAt;
  await service.requestPasswordReset('alice@example.com');
  rows[0].authVersion++;
  assert.equal((await service.resetPassword(sent.at(-1).token, 'new-password')).ok, false, 'revoked token');
  sessions.aliceSession.version = rows[0].authVersion;
  delete rows[0].recoverySentAt;
  const currentPassword = resets[0].ok ? 'replacement-password' : 'other-password';
  await service.setRecoveryEmail('aliceSession', 'replacement@example.com', currentPassword);
  assert.equal(rows[0].recoveryEmail, 'alice@example.com', 'keep verified address while replacement is pending');
  rows[0].status = 'deleted';
  assert.equal((await service.verifyRecoveryEmailCode('aliceSession', sent.at(-1).token)).ok, false, 'deleted account');
  const unavailable = createRecoveryService({ users }, accounts, { configured: false });
  assert.equal((await unavailable.requestPasswordReset('alice@example.com')).ok, false);
  assert.equal(createRecoveryMailer({}).configured, false);
  rows.push({ _id: 'bob', authVersion: 0, local_credentials_confirmed: true, password_hash: await argon2.hash('bob-password') });
  sessions.bobSession = { id: 'bob', version: 0 };
  assert.equal((await service.setRecoveryEmail('bobSession', 'bob@example.com', 'bob-password')).ok, true);
  const bobCode = sent.at(-1).token;
  assert.equal((await service.resendRecoveryEmailCode('bobSession')).ok, false, 'resend cooldown is enforced on the server');
  const wrong = String((Number(bobCode) + 1) % 1000000).padStart(6, '0');
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await service.verifyRecoveryEmailCode('bobSession', wrong)).ok, false);
  assert.equal((await service.verifyRecoveryEmailCode('bobSession', bobCode)).ok, false, 'correct code is blocked after five incorrect attempts');
  const previousChallenge = rows[1].recoveryPending.hash;
  rows[1].recoverySentAt = new Date(0);
  assert.equal((await service.resendRecoveryEmailCode('bobSession')).ok, true);
  assert.notEqual(rows[1].recoveryPending.hash, previousChallenge, 'resend replaces the previous challenge');
  assert.equal(rows[1].recoveryPending.attempts, 0);
  const concurrent = await Promise.all([service.verifyRecoveryEmailCode('bobSession', sent.at(-1).token), service.verifyRecoveryEmailCode('bobSession', sent.at(-1).token)]);
  assert.equal(concurrent.filter(reply => reply.ok).length, 1, 'code redemption is atomically single-use');
  rows[1].recoverySentAt = new Date(0);
  await service.setRecoveryEmail('bobSession', 'replacement@example.com', 'bob-password');
  rows[1].recoveryPending.expiresAt = new Date(0);
  assert.equal((await service.verifyRecoveryEmailCode('bobSession', sent.at(-1).token)).ok, false, 'expired code rejected');
  assert.equal((await service.resendRecoveryEmailCode('bobSession')).ok, false, 'expired challenge requires password confirmation again');
  assert.equal(rows[1].recoveryEmail, 'bob@example.com', 'unverified replacement never displaces the active email');
  assert.throws(() => createRecoveryMailer({ RESEND_API_KEY: 'test', RECOVERY_EMAIL_FROM: 'test', RECOVERY_APP_URL: 'http://example.com' }));
  const originalFetch = global.fetch;
  let delivered;
  global.fetch = async (url, options) => { delivered = { url, options, body: JSON.parse(options.body) }; return { ok: true }; };
  try {
    const sender = createRecoveryMailer({ RESEND_API_KEY: 'test-key', RECOVERY_EMAIL_FROM: 'Seenary <accounts@example.com>', RECOVERY_APP_URL: 'https://example.com/' });
    await sender.send('alice@example.com', 'reset', 'test-token');
    assert.equal(delivered.url, 'https://api.resend.com/emails');
    assert.deepEqual(delivered.body.to, ['alice@example.com']);
    assert.match(delivered.body.text, /https:\/\/example.com\/#recovery=reset&token=test-token/);
    await sender.send('alice@example.com', 'verify', '123456');
    assert.match(delivered.body.html, /123456/);
    assert.match(delivered.body.html, /mailto:support@seenary.app/);
    assert.match(delivered.body.text, /safely ignore/);
    assert.match(delivered.body.text, /10 minutes/);
    assert.equal(delivered.body.text.includes('#recovery='), false, 'verification email uses a code instead of a link');
    global.fetch = async () => ({ ok: false });
    await assert.rejects(sender.send('alice@example.com', 'reset', 'test-token'), /delivery failed/);
  } finally { global.fetch = originalFetch; }

  const server = createStagingServer({ ...service, getSession: async () => ({ authenticated: false }) }, null, null, null, null, null, { authLimit: 2 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const rpc = (method, args, extra = {}, requestOrigin = origin) => fetch(`${origin}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: requestOrigin, 'X-Seenary-Version': require('../package.json').version }, body: JSON.stringify({ method, args, ...extra }) });
    assert.equal((await rpc('requestPasswordReset', ['unknown@example.com'], {}, 'https://untrusted.example')).status, 403);
    const publicStatus = await (await rpc('getRecoveryEmail', [])).json();
    assert.equal(publicStatus.configured, true);
    assert.equal(publicStatus.email, undefined, 'public capabilities do not disclose email');
    const reply = await rpc('requestPasswordReset', ['unknown@example.com']);
    assert.equal(reply.status, 200);
    assert.deepEqual(await reply.json(), known);
    assert.equal((await rpc('resetPassword', ['bad-token', 'valid-password'])).status, 200);
    assert.equal((await rpc('verifyRecoveryEmailCode', ['123456'])).status, 429, 'code verification is rate limited');
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('Password recovery smoke passed: ownership, verification, hashed tokens, cooldown, non-enumeration, expiry, atomic single-use, revocation, deletion, configuration.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
