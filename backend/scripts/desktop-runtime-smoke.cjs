// Electron runtime check using synthetic data, an isolated profile, and loopback HTTP only.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
app.disableHardwareAcceleration();
let server, win, releaseRefresh;
let blocked = false, failing = false, changes = 0;
const entry = { mediaId: 'title1', type: 'ANIME', revision: 1, status: 'watching', isFavorite: false, progress: 1,
  volumeProgress: 0, score: null, notes: 'PRIVATE_NOTE_SENTINEL', startedAt: null, completedAt: null, repeatCount: 0, isRepeating: false, deleted: false };
const evaluate = code => win.webContents.executeJavaScript(code);
const waitUntil = async check => { const end = Date.now() + 10000; while (!await check()) { if (Date.now() > end) throw new Error('Runtime check timed out'); await new Promise(resolve => setTimeout(resolve, 20)); } };
const output = path.resolve(__dirname, '../node_modules/.cache/desktop-runtime');
async function main() {
  await app.whenReady();
  server = http.createServer(async (req, res) => {
    if (req.url !== '/rpc') {
      res.setHeader('Content-Type', req.url === '/harness.js' ? 'text/javascript' : 'text/html');
      res.end(req.url === '/harness.js' ? fs.readFileSync(path.join(output, 'harness.js')) : '<script src="/harness.js"></script>'); return;
    }
    let text = ''; for await (const chunk of req) text += chunk;
    const { method } = JSON.parse(text);
    let result;
    if (method === 'getSession') result = { authenticated: true, user: { id: 'alice', username: 'PRIVATE_USERNAME_SENTINEL' } };
    else if (method === 'getLibrarySnapshot') result = { ok: true, entries: [entry], changeCursor: 'cursor' };
    else if (method === 'getLibraryMedia') result = { ok: true, media: [{ _id: 'title1', type: 'ANIME', anilistId: 1, metadata: { title_english: 'PRIVATE_TITLE_SENTINEL' } }] };
    else if (method === 'getLibraryChanges') {
      changes++;
      if (blocked) await new Promise(resolve => { releaseRefresh = resolve; });
      if (failing) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, code: 'PROVIDER_UNAVAILABLE' })); return; }
      result = { ok: true, changes: [{ entry }], nextCursor: 'cursor', hasMore: false };
    }
    else if (method === 'getAccountSettings') result = { ok: true, settings: { autoSyncEnabled: false } };
    else if (method === 'getProviderAccount') result = { ok: true, account: null };
    else result = { ok: true };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const frontend = path.resolve(__dirname, '../../frontend');
  const { build } = await import(pathToFileURL(path.join(frontend, 'node_modules/vite/dist/node/index.js')));
  await build({ root: frontend, configFile: false, logLevel: 'error', define: {
    'process.env.NODE_ENV': JSON.stringify('production'), __APP_VERSION__: JSON.stringify('runtime-test'),
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(origin), 'import.meta.env.VITE_ATLAS_PRODUCTION': JSON.stringify('false'),
  }, build: { outDir: output, emptyOutDir: true, lib: { entry: path.join(frontend, 'scripts/desktop-runtime-harness.ts'), formats: ['iife'], name: 'DesktopTest', fileName: () => 'harness.js' } } });
  win = new BrowserWindow({ show: false, webPreferences: { partition: `desktop-smoke-${Date.now()}`, nodeIntegration: false, contextIsolation: true } });
  await win.loadURL(origin);
  await evaluate(`desktopTest.installAtlasRenderer({}); window.desktopDiagnostics = { getInfo: async () => ({platform:'win32',profileWritable:true,token:'PRIVATE_TOKEN_SENTINEL',username:'PRIVATE_USERNAME_SENTINEL'}) }; window.realClock=Date.now; window.clockOffset=0; Date.now=()=>realClock()+clockOffset; null;`);
  await evaluate('window.api.getSession()');
  assert.equal((await evaluate('window.api.getMyList()')).entries.length, 1);
  blocked = true;
  await evaluate('window.clockOffset=61000');
  const first = await evaluate('window.api.getMyList()');
  assert.equal(first.entries[0].progress, 1);
  await waitUntil(() => Boolean(releaseRefresh));
  const cached = await evaluate(`Promise.race([Promise.all([window.api.getMyList(),window.api.getMyMangaList()]),new Promise((_,reject)=>setTimeout(()=>reject(Error('Cached library waited for network')),500))])`);
  assert.equal(cached[0].entries.length, 1); assert.equal(cached[1].entries.length, 0);
  entry.progress = 2; blocked = false; releaseRefresh(); releaseRefresh = null;
  await waitUntil(async () => (await evaluate('window.api.getMyList()')).entries[0].progress === 2);
  await evaluate('window.api.saveMyListEntry(1,{isFavorite:true})');
  failing = true; const before = changes;
  await evaluate('window.clockOffset=122000');
  assert.equal((await evaluate('window.api.getMyList()')).entries[0].is_favorite, true);
  await waitUntil(() => changes > before); await new Promise(resolve => setTimeout(resolve, 50));
  const offline = await evaluate('window.api.getMyList()');
  assert.equal(offline.entries[0].is_favorite, true); assert.equal(offline.entries[0].cloud_pending, true);
  await evaluate(`desktopTest.recordDiagnosticError('pull:anilist','PROVIDER_HTTP_429',429,'fetch-manga'); desktopTest.recordDiagnosticError('invalid PRIVATE_NOTE_SENTINEL','PRIVATE_TOKEN_SENTINEL with spaces');`);
  const report = await evaluate('desktopTest.collectDiagnostics()');
  assert.equal(report.storage.indexedDatabase, 'available'); assert.equal(report.desktop.profileWritable, true);
  assert.ok(report.recentErrors.some(item => item.phase === 'fetch-manga' && item.status === 429));
  assert.equal(JSON.stringify(report).includes('PRIVATE_'), false, 'report omits all private fixture values');
  const cssFile = fs.readdirSync(path.join(frontend, 'dist/assets')).find(name => /^index-.*\.css$/.test(name));
  const css = fs.readFileSync(path.join(frontend, 'dist/assets', cssFile), 'utf8');
  await evaluate(`{const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);desktopTest.mountGlows();} null;`);
  await waitUntil(async () => await evaluate('document.querySelectorAll(".media-details-glow").length > 0'));
  const coverage = await evaluate(`{const rect=document.querySelector('.accent-glow-layer').getBoundingClientRect();({left:rect.left,right:rect.right,width:document.querySelector('[data-global-scroll-root]').clientWidth});}`);
  assert.ok(coverage.left <= 1 && coverage.right >= coverage.width - 1, 'glows extend beyond the narrow content column');
  await evaluate(`document.querySelector('[data-global-scroll-root]').scrollTop=50000; null;`);
  await waitUntil(async () => await evaluate(`Array.from(document.querySelectorAll('.media-details-glow')).some(el=>parseFloat(el.style.top)>49000)`));
  const density = await evaluate(`Array.from(document.querySelectorAll('.media-details-glow')).map(el=>parseFloat(el.style.top))`);
  assert.ok(density.length <= 7 && density.some(top => top >= 50000 && top < 50700), 'long pages maintain nearby glows with bounded layer count');
  console.log('PASS: full-width glow coverage and bounded, consistent density halfway through a 100,000px page.');
  console.log('PASS: cached anime/manga reads during blocked refresh, refreshed progress, durable pending favorites after failure, storage health and credential-free diagnostic report.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { releaseRefresh?.(); win?.destroy(); server?.close(); app.exit(process.exitCode || 0); });
