const assert = require('node:assert/strict');
const { WorkerCollection } = require('./atlas-worker-smoke');
const { createAccountService } = require('../atlas/accounts');
const { createStagingServer } = require('../atlas/stagingServer');

async function main() {
  const repo = { users: new WorkerCollection(), sessions: new WorkerCollection() };
  const accounts = await createAccountService(repo);
  const alice = await accounts.register('TutorialAlice', 'alice-password');
  const bob = await accounts.register('TutorialBob', 'bob-password');
  assert.equal(alice.user.tutorial_dismissed, false);
  assert.equal((await accounts.setTutorialDismissed('invalid', true)).ok, false);
  assert.equal((await accounts.setTutorialDismissed(alice.token, 'false')).ok, false);
  assert.equal((await accounts.setTutorialDismissed(alice.token, true)).user.tutorial_dismissed, true);
  const restarted = await createAccountService(repo);
  assert.equal((await restarted.getSession(alice.token)).user.tutorial_dismissed, true, 'dismissal survives service restart');
  const newLogin = await restarted.login('TutorialAlice', 'alice-password');
  assert.equal(newLogin.user.tutorial_dismissed, true, 'dismissal survives signing in again');
  assert.equal((await restarted.getSession(bob.token)).user.tutorial_dismissed, false, 'dismissal is account scoped');
  const server = createStagingServer(restarted);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = (dismissed, expectedUserId = alice.user.id) => fetch(`${origin}/rpc`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json',
        Cookie: `seenary_atlas_staging=${newLogin.token}`, 'X-Seenary-Version': require('../package.json').version },
      body: JSON.stringify({ method: 'setTutorialDismissed', args: [dismissed], expectedUserId }),
    });
    const replay = await request(false);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).user.tutorial_dismissed, false, 'Settings replay persists false through HTTP');
    assert.equal((await request(true, bob.user.id)).status, 409, 'stale or switched account cannot change another account');
    assert.equal((await restarted.getSession(newLogin.token)).user.tutorial_dismissed, false);
    assert.equal((await (await request(true)).json()).user.tutorial_dismissed, true);
  } finally { await new Promise(resolve => server.close(resolve)); }
  await restarted.logout(newLogin.token);
  assert.equal((await restarted.setTutorialDismissed(newLogin.token, false)).ok, false, 'logged-out session cannot reset preference');
  console.log('PASS: tutorial dismissal across restart/login, explicit replay, validation, HTTP persistence, account isolation, and revoked sessions.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
