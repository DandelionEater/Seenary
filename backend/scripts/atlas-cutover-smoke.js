const assert = require('node:assert/strict');
const { parseVersion, compareVersions, evaluateClient } = require('../atlas/clientGate');
const { accountFields } = require('../atlas/importAccounts');
const { changedPaths } = require('./atlas-cutover-diff');

assert.deepEqual(parseVersion('0.1.12-beta'), { parts: [0, 1, 12], prerelease: 'beta' });
assert.equal(parseVersion('latest'), null);
assert.equal(compareVersions('0.1.12', '0.1.12-beta'), 1);
assert.equal(compareVersions('0.1.12-beta.2', '0.1.12-beta.1'), 1);
assert.equal(compareVersions('0.1.11', '0.1.12-beta'), -1);
assert.deepEqual(evaluateClient('', {}), { allowed: true, mode: 'off' });
assert.equal(evaluateClient('', { ATLAS_CLIENT_GATE_MODE: 'observe', ATLAS_MIN_CLIENT_VERSION: '0.1.12-beta' }).allowed, true);
assert.equal(evaluateClient('', { ATLAS_CLIENT_GATE_MODE: 'observe', ATLAS_MIN_CLIENT_VERSION: '0.1.12-beta' }).compatible, false);
assert.equal(evaluateClient('0.1.11', { ATLAS_CLIENT_GATE_MODE: 'enforce', ATLAS_MIN_CLIENT_VERSION: '0.1.12-beta' }).allowed, false);
assert.equal(evaluateClient('0.1.12-beta', { ATLAS_CLIENT_GATE_MODE: 'enforce', ATLAS_MIN_CLIENT_VERSION: '0.1.12-beta' }).allowed, true);
assert.equal(evaluateClient('0.2.0', { ATLAS_CLIENT_GATE_MODE: 'enforce', ATLAS_MIN_CLIENT_VERSION: '0.1.12-beta' }).allowed, true);
assert.throws(() => evaluateClient('0.2.0', { ATLAS_CLIENT_GATE_MODE: 'enforce' }), /semantic version/);
assert.deepEqual(changedPaths({ a: 1, private: { token: 'old' } }, { a: 1, private: { token: 'new' } }), ['private.token']);
assert.deepEqual(Object.keys(accountFields({ username: 'a', username_normalized: 'a', password_hash: 'hash', local_credentials_confirmed: true,
  tutorial_dismissed: false, created_at: new Date(0), updated_at: new Date(0), last_login_at: null })),
['username', 'username_normalized', 'password_hash', 'local_credentials_confirmed', 'tutorial_dismissed', 'created_at', 'updated_at', 'last_login_at']);
console.log('PASS: cutover client gate is off by default, supports observe mode, and rejects missing or older clients only when explicitly enforced.');
