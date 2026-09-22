const assert = require('node:assert/strict');
const { createStagingServer } = require('../atlas/stagingServer');
const { createAnalyticsReportHandler } = require('../atlas/analyticsReports');

async function main() {
  const previousMode = process.env.ATLAS_CLIENT_GATE_MODE; const previousMinimum = process.env.ATLAS_MIN_CLIENT_VERSION;
  process.env.ATLAS_CLIENT_GATE_MODE = 'enforce'; process.env.ATLAS_MIN_CLIENT_VERSION = '0.1.12-beta';
  const service = {
    register: async () => ({ ok: true, token: 'a'.repeat(64), user: { id: 'user' } }),
    login: async () => ({ ok: false }), getSession: async token => ({ authenticated: token === 'a'.repeat(64), user: token ? { id: 'user' } : null }), logout: async () => ({ ok: true }),
  };
  let popupBinding;
  const providers = {
    begin: async (provider, mode, token, binding, username) => {
      popupBinding = binding;
      assert.equal(provider, 'anilist'); assert.equal(mode, 'login'); assert.equal(token, undefined); assert.equal(username, 'PopupUser');
      return { ok: true, authorizationUrl: 'https://anilist.co/api/v2/oauth/authorize?state=' + 'b'.repeat(64) };
    },
    complete: async (provider, state, code, binding) => {
      assert.equal(provider, 'anilist'); assert.equal(state, 'b'.repeat(64)); assert.equal(code, 'provider-code'); assert.equal(binding, popupBinding);
      return { ok: true, token: 'c'.repeat(64), user: { id: 'cloud-user', username: 'PopupUser' } };
    },
  };
  const analytics = { report: async () => ({ generatedAt: '2026-09-22T12:00:00.000Z', overview: { days: 14, startDate: '2026-09-09', endDate: '2026-09-22', observedActiveAccounts: 2, registeredAccounts: 3, unavailable: false }, daily: [{ activityDate: '2026-09-22', dailyActiveUsers: 2 }], monthly: [{ month: '2026-09', monthlyActiveUsers: 2, averageActiveDays: 1, dauMau: 1, platformActiveDays: { windows: 2 }, versionActiveDays: { '0.2.1-beta': 2 } }] }) };
  const reportHandler = createAnalyticsReportHandler(analytics, { ANALYTICS_REPORT_USERNAME: 'reports', ANALYTICS_REPORT_PASSWORD: 'a-secure-report-password' });
  const server = createStagingServer(service, providers, null, null, null, null, { loopbackOnly: false, secureCookies: true,
    cookieName: 'seenary_sid', allowedOrigins: ['https://seenary.app'], analyticsReportHandler: reportHandler,
    healthCheck: async () => ({ ok: true, storage: { level: 'ok' } }) });
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
    const sessionCookie = registered.headers.get('set-cookie').split(';')[0];
    const emptyTextPreview = await fetch(`${origin}/rpc`, { method: 'POST', headers: { Origin: 'https://seenary.app', Cookie: sessionCookie, 'Content-Type': 'application/json', 'X-Seenary-Version': '0.1.12-beta' },
      body: JSON.stringify({ method: 'previewTextImport', args: ['', true, 'ANIME'] }) });
    assert.equal(emptyTextPreview.status, 200); assert.equal((await emptyTextPreview.json()).ok, false);
    const popupStart = await fetch(`${origin}/auth/anilist/start?username=PopupUser`, { redirect: 'manual', headers: { Accept: 'text/html' } });
    assert.equal(popupStart.status, 302); assert.match(popupStart.headers.get('set-cookie'), /^seenary_oauth_binding=/);
    const bindingCookie = popupStart.headers.get('set-cookie').split(';')[0];
    const callback = await fetch(`${origin}/auth/anilist/callback?state=${'b'.repeat(64)}&code=provider-code`, { headers: { Accept: 'text/html', Cookie: bindingCookie } });
    const callbackHtml = await callback.text();
    assert.match(callback.headers.get('content-type'), /^text\/html/); assert.match(callbackHtml, /seenary:provider-auth-complete/);
    assert.match(callback.headers.get('set-cookie'), /^seenary_sid=/); assert.doesNotMatch(callbackHtml, /"token"|cccccccc/);
    const reportUnauthorized = await fetch(`${origin}/reports`); assert.equal(reportUnauthorized.status, 401);
    assert.match(reportUnauthorized.headers.get('www-authenticate'), /Seenary Analytics/);
    const reportHeaders = { Authorization: `Basic ${Buffer.from('reports:a-secure-report-password').toString('base64')}` };
    const report = await fetch(`${origin}/reports`, { headers: reportHeaders }); const reportHtml = await report.text();
    assert.equal(report.status, 200); assert.match(report.headers.get('content-type'), /^text\/html/); assert.match(reportHtml, /Engagement reports/); assert.match(reportHtml, /Registered accounts/);
    const reportCsv = await fetch(`${origin}/reports/download/overview.csv`, { headers: reportHeaders });
    assert.equal(reportCsv.status, 200); assert.match(await reportCsv.text(), /total_registered_accounts/);
    console.log('PASS: hosted Atlas HTTP shell enforces origins and client versions, exposes safe health and protected reports, strips session tokens, emits secure cookies, and completes first-party popup authorization.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previousMode === undefined) delete process.env.ATLAS_CLIENT_GATE_MODE; else process.env.ATLAS_CLIENT_GATE_MODE = previousMode;
    if (previousMinimum === undefined) delete process.env.ATLAS_MIN_CLIENT_VERSION; else process.env.ATLAS_MIN_CLIENT_VERSION = previousMinimum;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
