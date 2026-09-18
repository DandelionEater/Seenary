const assert = require('node:assert/strict');
const { createStagingServer } = require('../atlas/stagingServer');

async function main() {
  const previousMode = process.env.ATLAS_CLIENT_GATE_MODE; const previousMinimum = process.env.ATLAS_MIN_CLIENT_VERSION;
  process.env.ATLAS_CLIENT_GATE_MODE = 'enforce'; process.env.ATLAS_MIN_CLIENT_VERSION = '0.1.12-beta';
  const service = {
    register: async () => ({ ok: true, token: 'a'.repeat(64), user: { id: 'user' } }),
    login: async () => ({ ok: false }), getSession: async () => ({ authenticated: false }), logout: async () => ({ ok: true }),
  };
  const server = createStagingServer(service, null, null, null, null, null, { loopbackOnly: false, secureCookies: true,
    cookieName: 'seenary_sid', allowedOrigins: ['https://seenary.app'], healthCheck: async () => ({ ok: true, storage: { level: 'ok' } }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${origin}/health`); assert.equal(health.status, 200); assert.equal((await health.json()).storage.level, 'ok');
    const blockedOrigin = await fetch(`${origin}/rpc`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json', 'X-Seenary-Version': '0.1.12-beta' }, body: JSON.stringify({ method: 'getSession', args: [] }) });
    assert.equal(blockedOrigin.status, 403);
    const old = await fetch(`${origin}/rpc`, { method: 'POST', headers: { Origin: 'https://seenary.app', 'Content-Type': 'application/json', 'X-Seenary-Version': '0.1.11' }, body: JSON.stringify({ method: 'getSession', args: [] }) });
    assert.equal(old.status, 426); assert.equal((await old.json()).minimumVersion, '0.1.12-beta');
    const preflight = await fetch(`${origin}/rpc`, { method: 'OPTIONS', headers: { Origin: 'https://seenary.app' } });
    assert.equal(preflight.status, 204); assert.match(preflight.headers.get('access-control-allow-headers'), /X-Seenary-Version/i);
    const registered = await fetch(`${origin}/rpc`, { method: 'POST', headers: { Origin: 'https://seenary.app', 'Content-Type': 'application/json', 'X-Seenary-Version': '0.1.12-beta' }, body: JSON.stringify({ method: 'register', args: ['user', 'password'] }) });
    assert.equal(registered.status, 200); assert.match(registered.headers.get('set-cookie'), /^seenary_sid=/); assert.match(registered.headers.get('set-cookie'), /; Secure/);
    assert.equal(registered.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
    assert.equal((await registered.json()).token, undefined);
    console.log('PASS: hosted Atlas HTTP shell enforces origins and client versions, exposes safe health, strips session tokens, and emits secure cookies/security headers.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previousMode === undefined) delete process.env.ATLAS_CLIENT_GATE_MODE; else process.env.ATLAS_CLIENT_GATE_MODE = previousMode;
    if (previousMinimum === undefined) delete process.env.ATLAS_MIN_CLIENT_VERSION; else process.env.ATLAS_MIN_CLIENT_VERSION = previousMinimum;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
