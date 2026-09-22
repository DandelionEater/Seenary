const crypto = require('node:crypto');

const PREFIX = '/reports';

function safeEqual(left, right) {
  const a = crypto.createHash('sha256').update(String(left)).digest();
  const b = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(a, b);
}

function credentials(env = process.env) {
  const username = String(env.ANALYTICS_REPORT_USERNAME || '').trim();
  const password = String(env.ANALYTICS_REPORT_PASSWORD || '');
  return { username, password, configured: Boolean(username && password.length >= 16) };
}

function authorized(req, value) {
  const header = String(req.headers.authorization || '');
  if (!value.configured || !header.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    return separator >= 0 && safeEqual(decoded.slice(0, separator), value.username)
      && safeEqual(decoded.slice(separator + 1), value.password);
  } catch { return false; }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function number(value, digits = 0) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(Number(value) || 0); }
function csvCell(value) { const text = String(value ?? ''); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function csv(columns, rows) { return `${[columns.join(','), ...rows.map(row => columns.map(key => csvCell(row[key])).join(','))].join('\n')}\n`; }

function reportCsv(report, name) {
  if (name === 'overview.csv') return csv(['window_days', 'window_start_date', 'window_end_date', 'observed_active_registered_accounts', 'total_registered_accounts'], [{
    window_days: report.overview.days, window_start_date: report.overview.startDate, window_end_date: report.overview.endDate,
    observed_active_registered_accounts: report.overview.unavailable ? 'unavailable' : report.overview.observedActiveAccounts,
    total_registered_accounts: report.overview.registeredAccounts,
  }]);
  if (name === 'daily.csv') return csv(['activity_date', 'daily_active_users'], report.daily.map(row => ({ activity_date: row.activityDate, daily_active_users: row.dailyActiveUsers })));
  if (name === 'monthly.csv') return csv(['activity_month', 'monthly_active_users', 'average_active_days', 'dau_mau'], report.monthly.map(row => ({
    activity_month: row.month, monthly_active_users: row.monthlyActiveUsers, average_active_days: Number(row.averageActiveDays || 0).toFixed(4), dau_mau: Number(row.dauMau || 0).toFixed(4),
  })));
  if (name === 'dimensions.csv') return csv(['activity_month', 'dimension', 'name', 'value'], report.monthly.flatMap(row => [
    ...Object.entries(row.platformActiveDays || {}).map(([key, value]) => ({ activity_month: row.month, dimension: 'platform_active_days', name: key, value })),
    ...Object.entries(row.versionActiveDays || {}).map(([key, value]) => ({ activity_month: row.month, dimension: 'version_active_days', name: key, value })),
  ]));
  return null;
}

function render(report) {
  const month = report.generatedAt.slice(0, 7); const date = report.generatedAt.slice(0, 10);
  const current = report.monthly.find(item => item.month === month) || { monthlyActiveUsers: 0, platformActiveDays: {}, versionActiveDays: {} };
  const today = report.daily.find(item => item.activityDate === date)?.dailyActiveUsers || 0;
  const rows = report.daily.slice(-14).reverse();
  const dimensions = values => Object.entries(values || {}).map(([key, value]) => `<li><span>${escapeHtml(key)}</span><strong>${number(value)}</strong></li>`).join('') || '<li class="muted">No activity recorded yet.</li>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Seenary engagement reports</title><style>
  :root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#09090b;color:#f4f4f5}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 85% 0,#241b3d 0,transparent 31rem),#09090b}main{width:min(1100px,calc(100% - 32px));margin:auto;padding:48px 0}header{display:flex;justify-content:space-between;align-items:end;gap:20px}h1{font-size:clamp(30px,5vw,46px);margin:8px 0}.eyebrow{color:#a78bfa;text-transform:uppercase;letter-spacing:.22em;font-size:12px;font-weight:700}.muted,small{color:#92929c}.downloads{display:flex;flex-wrap:wrap;gap:8px}.downloads a{color:#ddd6fe;text-decoration:none;border:1px solid #ffffff18;background:#ffffff0b;padding:10px 13px;border-radius:12px}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:28px}.card,.panel{border:1px solid #ffffff14;background:#ffffff08;border-radius:22px;padding:20px}.card span{color:#9999a3;font-size:12px}.card strong{display:block;font-size:32px;margin:10px 0}.grid{display:grid;grid-template-columns:1.2fr .8fr;gap:16px;margin-top:16px}.stack{display:grid;gap:16px}h2{font-size:17px;margin:0 0 16px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:10px;border-bottom:1px solid #ffffff0d;text-align:left}th:last-child,td:last-child{text-align:right}ul{list-style:none;margin:0;padding:0}li{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #ffffff0d}@media(max-width:800px){header{align-items:flex-start;flex-direction:column}.cards{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}}@media(max-width:480px){.cards{grid-template-columns:1fr}}
  </style></head><body><main><header><div><div class="eyebrow">Private analytics</div><h1>Engagement reports</h1><div class="muted">Anonymous aggregate signals · generated ${escapeHtml(report.generatedAt)}</div></div><nav class="downloads"><a href="/reports/download/overview.csv">Overview CSV</a><a href="/reports/download/daily.csv">Daily CSV</a><a href="/reports/download/monthly.csv">Monthly CSV</a><a href="/reports/download/dimensions.csv">Dimensions CSV</a></nav></header>
  <section class="cards"><article class="card"><span>Active accounts · ${number(report.overview.days)} days</span><strong>${report.overview.unavailable ? '—' : number(report.overview.observedActiveAccounts)}</strong><small>${escapeHtml(report.overview.startDate)} through ${escapeHtml(report.overview.endDate)}</small></article><article class="card"><span>Registered accounts</span><strong>${number(report.overview.registeredAccounts)}</strong><small>Current Seenary accounts</small></article><article class="card"><span>Active today</span><strong>${number(today)}</strong><small>UTC ${date}</small></article><article class="card"><span>Active this month</span><strong>${number(current.monthlyActiveUsers)}</strong><small>${month}</small></article></section>
  <section class="grid"><article class="panel"><h2>Recent daily activity</h2>${rows.length ? `<table><thead><tr><th>UTC date</th><th>Active users</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.activityDate)}</td><td>${number(row.dailyActiveUsers)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No activity recorded yet.</p>'}</article><div class="stack"><article class="panel"><h2>Platforms</h2><ul>${dimensions(current.platformActiveDays)}</ul></article><article class="panel"><h2>Versions</h2><ul>${dimensions(current.versionActiveDays)}</ul></article></div></section></main></body></html>`;
}

function send(res, status, type, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store, private', 'Content-Type': type, 'X-Robots-Tag': 'noindex, nofollow', ...headers }); res.end(body);
}

function createAnalyticsReportHandler(analytics, env = process.env) {
  return async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method !== 'GET' || !(url.pathname === PREFIX || url.pathname === `${PREFIX}/` || url.pathname.startsWith(`${PREFIX}/download/`))) return false;
    const login = credentials(env);
    if (!login.configured) { send(res, 404, 'text/plain; charset=utf-8', 'Not found.'); return true; }
    if (!authorized(req, login)) { send(res, 401, 'text/plain; charset=utf-8', 'Authentication required.', { 'WWW-Authenticate': 'Basic realm="Seenary Analytics", charset="UTF-8"' }); return true; }
    try {
      const report = await analytics.report(14);
      if (url.pathname === PREFIX || url.pathname === `${PREFIX}/`) {
        send(res, 200, 'text/html; charset=utf-8', render(report), { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" }); return true;
      }
      const name = url.pathname.slice(`${PREFIX}/download/`.length); const body = reportCsv(report, name);
      if (body === null) { send(res, 404, 'text/plain; charset=utf-8', 'Report not found.'); return true; }
      send(res, 200, 'text/csv; charset=utf-8', body, { 'Content-Disposition': `attachment; filename="seenary-${name}"` });
    } catch (error) { console.error('Analytics report error:', error); send(res, 500, 'text/plain; charset=utf-8', 'The analytics report could not be generated.'); }
    return true;
  };
}

module.exports = { createAnalyticsReportHandler, credentials, authorized, reportCsv, render };
