// Run with Electron. Uses an in-memory browser partition and synthetic HTTP data only.
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Collection } = require('./atlas-metadata-smoke');
const { createMediaService } = require('../atlas/media');
const { createMetadataService } = require('../atlas/metadata');
const { createMalMetadataCache } = require('../atlas/malMetadataCache');
const { createMalImportService } = require('../atlas/malImport');
app.commandLine.appendSwitch('disable-gpu');
let api, web, win;
let account = 'alice';
const accountSettings = new Map();
let metadataClock = Date.now(), providerUnavailable = false, metadataCalls = 0;
const metadataRepo = { media: new Collection(), mediaRedirects: new Collection() };
const cachedMedia = createMediaService({}, metadataRepo);
const card = id => ({ id, type: 'ANIME', title: { romaji: `Metadata title ${id}` }, coverImage: { large: '' }, isAdult: false, status: 'FINISHED',
  description: 'Cached description', genres: [], staff: { edges: [] }, characters: { edges: [] }, relations: { edges: [] }, recommendations: { nodes: [] } });
const metadataQueries = new Collection();
const malCache = createMalMetadataCache({ media: cachedMedia, repo: metadataRepo, queries: metadataQueries, now: () => metadataClock, requestSpacingMs: 0,
  provider: { details: async (type, id) => ({ id, title: 'MAL fallback title', synopsis: 'MAL fallback description', genres: [],
    status: type === 'ANIME' ? 'finished_airing' : 'finished', num_episodes: 24, num_chapters: 40, num_volumes: 4, mean: 8.2 }) } });
const malImport = createMalImportService({ media: cachedMedia, repo: metadataRepo, now: () => metadataClock,
  provider: { collection: async () => ({ data: [{ node: { id: 99, title: 'MAL import title' },
    list_status: { status: 'completed', score: 0, comments: 'Private MAL note', num_episodes_watched: 12, num_chapters_read: 20, num_volumes_read: 2 } }] }) } });
const metadataService = createMetadataService({ media: cachedMedia, repo: metadataRepo, queries: metadataQueries, malCache, malImport, now: () => metadataClock, requestSpacingMs: 0,
  provider: { details: async (_type, id) => { metadataCalls++; if (providerUnavailable) throw new Error('Provider disabled'); return card(id); },
    search: async () => { metadataCalls++; if (providerUnavailable) throw new Error('Provider disabled'); return { anime: [card(1)], manga: [], characters: [], studios: [] }; },
    discover: async () => { metadataCalls++; if (providerUnavailable) throw new Error('Provider disabled'); return { anime: { trending: [card(1)], shelves: [] }, manga: { trending: [], shelves: [] } }; },
    shelf: async (id, page) => { metadataCalls++; if (providerUnavailable) throw new Error('Provider disabled'); return { id, title: 'Shelf', items: [card(1)], pageInfo: { currentPage: page, lastPage: page, hasNextPage: false } }; },
    studio: async (id, page) => { metadataCalls++; if (providerUnavailable) throw new Error('Provider disabled'); return { studio: { id, name: 'Studio Cache' }, items: [{ media: card(1) }], pageInfo: { currentPage: page, lastPage: page, hasNextPage: false } }; },
    person: async (kind, id) => { metadataCalls++; if (providerUnavailable) throw new Error('Provider disabled'); return { id, name: { full: `${kind} ${id}` }, description: 'Saved profile' }; },
    themes: async id => { metadataCalls++; if (providerUnavailable) throw new Error('Provider disabled'); return [{ id, title: 'Opening theme' }]; },
    artistAssociations: async slug => { metadataCalls++; if (providerUnavailable) throw new Error('Provider disabled'); return { artist: { id: 4, slug, name: 'Theme Artist' }, items: [{ anilistId: 1, artist: { id: 4 }, creditedAs: 'Theme Artist', song: { id: 2 }, theme: { id: 3 } }], pageInfo: { currentPage: 1, lastPage: 1, hasNextPage: false } }; },
    cards: async ids => { metadataCalls++; if (providerUnavailable) throw new Error('Provider disabled'); return ids.map(card); } } });
const entries = Object.fromEntries(['alice', 'bob'].map(id => [id, { mediaId: id, type: 'ANIME', revision: 1, deleted: false,
  status: 'watching', isFavorite: false, progress: 2, volumeProgress: 0, score: null, notes: null, startedAt: null, completedAt: null, repeatCount: 0, isRepeating: false }]));
const receipts = new Map();
const media = id => ({ _id: id, type: 'ANIME', anilistId: id === 'alice' ? 1 : 2, metadata: { title_english: `${id} title` } });
const root = path.resolve(__dirname, '../../frontend/dist');
const evaluate = script => win.webContents.executeJavaScript(script);
async function until(script) {
  for (let i = 0; i < 150; i++) { if (await evaluate(`Boolean(${script})`)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  const diagnostic = await evaluate(`JSON.stringify({ text: document.body.textContent.slice(0, 500), buttons: Array.from(document.querySelectorAll('button')).slice(0, 20).map(button => ({ label: button.getAttribute('aria-label'), text: button.textContent, disabled: button.disabled })) })`);
  throw new Error(`Timed out: ${script}; ${diagnostic}`);
}
async function main() {
  await app.whenReady();
  api = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Seenary-Version');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'GET' && req.url.startsWith('/auth/anilist/start')) {
      account = 'providerAlice';
      entries.providerAlice = { ...entries.alice, mediaId: 'providerAlice' };
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><script>window.opener.postMessage({type:'seenary:provider-auth-complete',provider:'anilist',result:{ok:true,user:{id:'providerAlice',username:'PopupUser',tutorial_dismissed:false}}},'http://localhost:5173');window.close()</script>`);
      return;
    }
    let text = ''; for await (const chunk of req) text += chunk;
    const { method, args, expectedUserId } = JSON.parse(text);
    let result;
    if (expectedUserId && expectedUserId !== account) { res.writeHead(409); res.end(JSON.stringify({ ok: false, code: 'ACCOUNT_CHANGED' })); return; }
    if (method === 'getSession') result = { authenticated: Boolean(account), user: account ? { id: account, username: account } : null };
    else if (method === 'register') {
      account = args[0];
      entries[account] ??= { ...entries.alice, mediaId: account, revision: 1, isFavorite: false };
      result = { ok: true, user: { id: account, username: account, tutorial_dismissed: false } };
    }
    else if (method === 'login') { account = args[0]; result = { ok: true, user: { id: account, username: account, tutorial_dismissed: false } }; }
    else if (method === 'logout') { account = null; result = { ok: true }; }
    else if (method === 'getAccountSettings') result = { ok: true, settings: { autoSyncEnabled: false, needsDeviceReconciliation: false,
      analyticsConsentDecided: accountSettings.has(account), analyticsEnabled: accountSettings.get(account) === true } };
    else if (method === 'setAnalyticsConsent') { accountSettings.set(account, args[0]); result = { ok: true, enabled: args[0] }; }
    else if (method === 'exportAccountData') result = { ok: true, export: { format: 'seenary.account-export', version: 1, account: { id: account, username: account }, data: { libraryEntries: [entries[account]] } } };
    else if (method === 'deleteAccount') {
      result = args[0] === account && args[1] === 'test-password' ? { ok: true, message: 'Account deleted.' } : { ok: false, message: 'Confirm your username and Seenary password.' };
      if (result.ok) account = null;
    }
    else if (method === 'previewMalImport') result = await metadataService.previewMalImport(args[0]);
    else if (method === 'previewTextImport' || method === 'previewPdfImport') result = { ok: true, message: 'Matched one title.', preview: { totalFound: 1,
      groups: [{ status: 'completed', mediaType: args[2] === 'MANGA' ? 'MANGA' : 'ANIME', items: [{ animeId: 7, mangaId: args[2] === 'MANGA' ? 7 : undefined,
        mediaType: args[2] === 'MANGA' ? 'MANGA' : 'ANIME', status: 'completed', progress: 12, volumeProgress: 2, score: null, notes: null,
        title: { romaji: 'Text import title' }, media: { id: 7, type: args[2] === 'MANGA' ? 'MANGA' : 'ANIME', title: { romaji: 'Text import title' } } }] }] } };
    else if (method === 'getMediaDetails') result = await metadataService.details(args[0], args[1]);
    else if (method === 'getAnimeDetails') result = await metadataService.details('ANIME', args[0]);
    else if (['searchMedia', 'getDiscoverMedia', 'getDiscoverShelfAnime', 'getStudioMedia', 'getArtistMedia', 'getCharacterDetails', 'getStaffDetails', 'getAnimeThemeMusic'].includes(method)) result = await metadataService.query(method, args);
    else if (method === 'previewAniListImport') result = { ok: true, username: args[0], preview: { totalFound: 2, groups: ['ANIME', 'MANGA'].map((type, index) => ({ status: 'watching', mediaType: type,
      items: [{ animeId: index + 1, mediaType: type, status: 'watching', progress: 8, volumeProgress: 2, isRepeating: true, notes: 'Private imported note',
        media: { id: index + 1, type, title: { romaji: 'Import title' }, coverImage: { large: '' } } }] })) } };
    else if (method === 'getLibrarySnapshot') result = { ok: true, entries: [entries[account]], changeCursor: 'cursor' };
    else if (method === 'getLibraryChanges') result = { ok: true, changes: [{ entry: entries[account] }], nextCursor: 'cursor', hasMore: false };
    else if (method === 'getLibraryMedia') result = { ok: true, media: args[0].map(media) };
    else if (method === 'getLibraryEntry') result = { ok: true, entry: entries[account] };
    else if (method === 'mutateLibraryEntry') {
      const request = args[0];
      if (receipts.has(request.operationId)) result = receipts.get(request.operationId);
      else if (request.expectedRevision !== entries[account].revision) result = { ok: false, code: 'REVISION_CONFLICT', current: entries[account] };
      else {
        entries[account] = { ...entries[account], ...request.patch, deleted: request.action === 'delete', revision: entries[account].revision + 1 };
        result = { ok: true, entry: entries[account] }; receipts.set(request.operationId, result);
      }
    } else result = { ok: false, code: 'UNEXPECTED_METHOD' };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
  });
  web = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const filename = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[path.extname(filename)] || 'application/octet-stream';
    if (!fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', mime); fs.createReadStream(filename).pipe(res);
  });
  await new Promise((resolve, reject) => { api.once('error', reject); api.listen(3001, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => { web.once('error', reject); web.listen(5173, '127.0.0.1', resolve); });
  win = new BrowserWindow({ show: false, webPreferences: { partition: `cloud-smoke-${Date.now()}`, nodeIntegration: false, contextIsolation: true } });
  await win.loadURL('http://localhost:5173/?atlasReview=1');
  await until(`document.querySelector('[aria-label="Favorite alice title"]') && !document.querySelector('[aria-label="Favorite alice title"]').disabled`);
  await evaluate(`document.querySelector('[aria-label="Favorite alice title"]').click()`);
  await until(`document.body.textContent.includes('1 pending cloud edits')`);
  assert.equal(entries.alice.isFavorite, false, 'favorite is queued before network delivery');
  win.reload();
  await until(`document.querySelector('[aria-label="Unfavorite alice title"]') && !document.querySelector('[aria-label="Unfavorite alice title"]').disabled`);
  assert.equal(entries.alice.isFavorite, true, 'reload recovers and delivers durable queue');
  await evaluate(`document.querySelector('[aria-label="Unfavorite alice title"]').click()`);
  await until(`document.body.textContent.includes('1 pending cloud edits')`);
  account = 'bob'; win.reload();
  await until(`document.querySelector('[aria-label="Favorite bob title"]') && !document.querySelector('[aria-label="Favorite bob title"]').disabled`);
  assert.equal(await evaluate(`document.querySelector('.cloud-entries').textContent.includes('alice title')`), false);
  assert.equal(entries.alice.isFavorite, true, 'switching accounts does not send the previous account queue');
  account = 'alice'; win.reload();
  await until(`document.querySelector('[aria-label="Favorite alice title"]') && !document.querySelector('[aria-label="Favorite alice title"]').disabled`);
  assert.equal(entries.alice.isFavorite, false);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Edit').click()`);
  await until(`document.querySelector('[aria-label="Edit personal entry"]')`);
  assert.equal(await evaluate(`document.querySelector('textarea[name="notes"]').maxLength`), 10000);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Cancel').click()`);
  await win.loadURL('http://localhost:5173/');
  await until(`Boolean(window.api) && document.body.textContent.includes('Cloud saves')`);
  const session = await evaluate(`window.api.getSession()`);
  assert.equal(session.user.cloudUserId, 'alice');
  assert.equal((await evaluate(`window.api.logout()`)).ok, true);
  assert.equal((await evaluate(`window.api.getSession()`)).authenticated, false);
  const localLogin = await evaluate(`window.api.login('alice', 'test-password')`);
  assert.equal(localLogin.ok, true); assert.equal(localLogin.user.cloudUserId, 'alice');
  const localRegistration = await evaluate(`window.api.register('browserNew', 'test-password')`);
  assert.equal(localRegistration.ok, true); assert.equal(localRegistration.user.cloudUserId, 'browserNew');
  await evaluate(`window.api.login('alice', 'test-password')`);
  const popupLogin = await evaluate(`window.api.startAniListLogin('PopupUser')`);
  assert.equal(popupLogin.ok, true); assert.equal(popupLogin.user.cloudUserId, 'providerAlice');
  account = 'alice'; await evaluate(`window.api.getSession()`);
  assert(session.user.id < 0, 'numeric preference alias stays separate from cloud identity');
  const rendered = await evaluate(`window.api.getMyList()`);
  assert.equal(rendered.entries[0].anime_id, 1);
  assert.equal(rendered.entries[0].seenary_id, 'alice');
  assert.equal(rendered.entries[0].is_favorite, false);
  assert.equal((await evaluate(`window.api.cacheMinimalAnime({id:1,title:{userPreferred:'Cached title'},coverImage:{large:'cover'},recommendations:{nodes:[{id:2}]}})`)).ok, true);
  const cachedRow = (await evaluate(`window.api.getMyList()`)).entries[0];
  assert.equal(cachedRow.title_preferred, 'Cached title');
  assert.equal(cachedRow.recommendations[0].id, 2);
  await evaluate(`window.api.getMyListEntry(1)`);
  assert.equal((await evaluate(`window.api.saveMyListEntry(1, {isFavorite: true})`)).ok, true);
  assert.equal((await evaluate(`window.api.getMyList()`)).entries[0].is_favorite, true);
  assert.equal((await evaluate(`window.api.runSyncNow()`)).ok, true);
  assert.equal(entries.alice.isFavorite, true);
  await evaluate(`window.api.getMyListEntry(1)`);
  entries.alice = { ...entries.alice, notes: 'Other device note', revision: entries.alice.revision + 1 };
  assert.equal((await evaluate(`window.api.saveMyListEntry(1, {notes:'This device note'})`)).ok, true);
  const conflictedSync = await evaluate(`window.api.runSyncNow()`);
  assert.equal(conflictedSync.failed, 1);
  const conflictedRow = (await evaluate(`window.api.getMyList()`)).entries[0];
  assert.equal(conflictedRow.cloud_conflict, 'REVISION_CONFLICT');
  assert.equal((await evaluate(`window.api.resolveMyListConflict(1, 'device')`)).ok, true);
  assert.equal(entries.alice.notes, 'This device note');
  assert.equal((await evaluate(`window.api.getMyList()`)).entries[0].cloud_conflict, null);
  const exported = await evaluate(`window.api.exportLocalBackup()`);
  assert.equal(exported.userId, 'alice');
  assert.equal(exported.state.entries.alice.isFavorite, true);
  await evaluate(`window.api.updateSettings({themeAccent:'rose'})`);
  assert.equal((await evaluate(`window.api.getSettings()`)).themeAccent, 'rose');
  account = 'bob';
  const bobSession = await evaluate(`window.api.getSession()`);
  assert.notEqual(bobSession.user.id, session.user.id);
  assert.equal((await evaluate(`window.api.getMyList()`)).entries[0].seenary_id, 'bob');
  assert.notEqual((await evaluate(`window.api.getSettings()`)).themeAccent, 'rose', 'preferences stay account-scoped');
  assert.equal((await evaluate(`window.api.clearMyList({queueProviderDeletion:false})`)).ok, false);
  assert.equal((await evaluate(`window.api.getMyList()`)).entries.length, 1, 'device-only clearing cannot silently become a cloud deletion');
  assert.equal((await evaluate(`window.api.clearMyList()`)).removedCount, 1);
  assert.equal((await evaluate(`window.api.getMyList()`)).entries.length, 0, 'bulk deletion has an immediate pending overlay');
  assert.equal((await evaluate(`window.api.runSyncNow()`)).ok, true);
  assert.equal(entries.bob.deleted, true);
  assert.equal(entries.alice.deleted, false);
  assert.equal((await evaluate(`window.api.previewAniListImport('ExampleUser')`)).preview.totalFound, 2);
  const importResult = await evaluate(`window.api.importAniList('ExampleUser', ['watching'], ['MANGA:2'])`);
  assert.equal(importResult.ok, true); assert.equal(importResult.summary.prepared, 1);
  const staged = (await evaluate(`window.api.exportLocalBackup()`)).state;
  assert.equal(staged.candidates.length, 1); assert.equal(staged.candidates[0].type, 'MANGA');
  assert.equal(staged.candidates[0].patch.notes, 'Private imported note');
  assert.equal(staged.candidates[0].patch.isFavorite, undefined, 'import cannot erase Seenary favorites');
  assert.equal(staged.pending.length, 0, 'selection prepares review, not an immediate upload');
  assert.equal((await evaluate(`window.api.importAniList('ExampleUser', [], [], {signal: AbortSignal.abort()})`)).cancelled, true);
  const liveDetails = await evaluate(`window.api.getAnimeDetails(1)`);
  assert.equal(liveDetails.title.romaji, 'Metadata title 1');
  assert.equal(liveDetails.cache.stale, false);
  await evaluate(`window.api.searchMedia('Metadata', true)`);
  await evaluate(`window.api.getDiscoverMedia(true)`);
  assert.equal((await evaluate(`window.api.getDiscoverShelfAnime('trending', 1, true, 'ANIME')`)).items.length, 1);
  assert.equal((await evaluate(`window.api.getStudioMedia(7, 1, true)`)).studio.name, 'Studio Cache');
  assert.equal((await evaluate(`window.api.getArtistMedia('theme-artist', 1, true)`)).items.length, 1);
  assert.equal((await evaluate(`window.api.getCharacterDetails(4)`)).name.full, 'character 4');
  assert.equal((await evaluate(`window.api.getStaffDetails(5)`)).name.full, 'staff 5');
  assert.equal((await evaluate(`window.api.getAnimeThemeMusic(1, ['Metadata title 1'])`)).length, 1);
  metadataClock += 8 * 24 * 3600000; providerUnavailable = true;
  const staleDetails = await evaluate(`window.api.getAnimeDetails(1)`);
  assert.equal(staleDetails.cache.stale, true); assert.equal(staleDetails.seenaryId, liveDetails.seenaryId);
  const staleSearch = await evaluate(`window.api.searchMedia('Metadata', true)`);
  assert.equal(staleSearch.anime.length, 1); assert(staleSearch.warnings.length);
  const staleDiscovery = await evaluate(`window.api.getDiscoverMedia(true)`);
  assert.equal(staleDiscovery.cache.stale, true);
  assert.match((await evaluate(`window.api.getStudioMedia(7, 1, true)`)).warning, /saved studio/i);
  assert.match((await evaluate(`window.api.getArtistMedia('theme-artist', 1, true)`)).warning, /saved cache/i);
  assert.match((await evaluate(`window.api.getCharacterDetails(4)`)).warning, /saved profile/i);
  const cachedThemes = await evaluate(`window.api.getAnimeThemeMusic(1, ['Metadata title 1'])`);
  assert.equal(cachedThemes.length, 1, 'theme music survives provider outage from cache'); assert.equal(cachedThemes[0].cache.stale, true);
  const fallbackSearch = await evaluate(`window.api.searchMedia('title', true)`);
  assert.equal(fallbackSearch.anime[0].id, 1);
  const beforeBackoff = metadataCalls;
  await evaluate(`window.api.getAnimeDetails(1)`);
  assert.equal(metadataCalls, beforeBackoff, 'renderer retries respect cache backoff');
  await metadataRepo.media.updateOne({ _id: liveDetails.seenaryId }, { $set: { malId: 1 } });
  const malFallback = await evaluate(`window.api.getAnimeDetails(1)`);
  assert.equal(malFallback.cache.provider, 'mal'); assert.equal(malFallback.description, 'MAL fallback description');
  assert.equal(malFallback.seenaryId, liveDetails.seenaryId);
  const malOnly = await evaluate(`window.api.getMediaDetails('MANGA', -2)`);
  assert.equal(malOnly.id, -2); assert.equal(malOnly.chapters, 40);
  assert.equal(malOnly.providerMetrics.mal.mean, 8.2); assert.equal(malOnly.averageScore, undefined);
  metadataClock += 6 * 60000; providerUnavailable = false;
  const alRecovered = await evaluate(`window.api.getAnimeDetails(1)`);
  assert.equal(alRecovered.description, 'Cached description'); assert.equal(alRecovered.cache.provider, 'anilist');
  assert.equal(alRecovered.seenaryId, liveDetails.seenaryId);
  account = 'alice'; await evaluate(`window.api.getSession()`);
  // Same username as AL verifies provider-specific preview isolation.
  await evaluate(`window.api.previewAniListImport('ExampleUser')`);
  assert.equal((await evaluate(`window.api.previewMalImport('ExampleUser')`)).preview.totalFound, 2);
  assert.equal((await evaluate(`window.api.importMal('ExampleUser', [], [], {signal: AbortSignal.abort()})`)).cancelled, true);
  assert.equal((await evaluate(`window.api.importMal('ExampleUser', ['completed'], ['MANGA:-99'])`)).summary.prepared, 1);
  const malStaged = (await evaluate(`window.api.exportLocalBackup()`)).state;
  assert.equal(malStaged.candidates.length, 1); assert.equal(malStaged.candidates[0].provider, 'mal');
  assert.equal(malStaged.candidates[0].providerId, 99); assert.equal(malStaged.candidates[0].patch.notes, 'Private MAL note');
  assert.equal(malStaged.candidates[0].patch.score, 0); assert.equal(malStaged.candidates[0].patch.isFavorite, undefined);
  assert.equal(malStaged.pending.length, 0, 'MAL selection only stages review');
  await evaluate(`window.api.register('fileImporter', 'test-password')`);
  assert.equal((await evaluate(`window.api.previewTextImport('Text import title', true, 'ANIME')`)).preview.totalFound, 1);
  assert.equal((await evaluate(`window.api.previewPdfImport('synthetic-base64', true, 'MANGA')`)).preview.groups[0].mediaType, 'MANGA');
  assert.equal((await evaluate(`window.api.importTextList([{animeId:7,mediaType:'ANIME',status:'completed',progress:12,score:null,notes:null,title:{romaji:'Text import title'},media:{id:7,type:'ANIME',title:{romaji:'Text import title'}}}], ['ANIME:7'])`)).summary.prepared, 1);
  const beforeRepair = (await evaluate(`window.api.exportLocalBackup()`)).state;
  assert.equal(beforeRepair.candidates.length, 1);
  assert.equal((await evaluate(`window.api.repairCachedData()`)).ok, true);
  const afterRepair = (await evaluate(`window.api.exportLocalBackup()`)).state;
  assert.equal(afterRepair.candidates.length, 1, 'cache repair preserves resumable import review');
  assert.equal(afterRepair.entries.fileImporter.mediaId, 'fileImporter', 'cache repair preserves the library');
  await evaluate(`window.api.updateSettings({shareAnonymousUsageStatistics:true,analyticsConsentDecided:true})`);
  assert.equal((await evaluate(`window.api.getSettings()`)).shareAnonymousUsageStatistics, true, 'account analytics consent is read back from Atlas');
  const accountExport = await evaluate(`window.api.exportAccountData()`);
  assert.equal(accountExport.export.format, 'seenary.account-export');
  assert.equal(JSON.stringify(accountExport).includes('test-password'), false, 'account export contains no credentials');
  assert.equal((await evaluate(`window.api.deleteAccount('fileImporter', 'wrong-password')`)).ok, false);
  assert.equal((await evaluate(`window.api.deleteAccount('fileImporter', 'test-password')`)).ok, true);
  assert.equal((await evaluate(`window.api.getSession()`)).authenticated, false, 'successful deletion clears the renderer session');
  console.log('PASS: hidden Chromium renderer, IndexedDB queue/reload, favorite acknowledgement, account switching/isolation, and entry editor.');
}
const resultPath = path.resolve(__dirname, '../node_modules/.cache/atlas-client-browser-result.json');
fs.mkdirSync(path.dirname(resultPath), { recursive: true });
fs.writeFileSync(resultPath, JSON.stringify({ status: 'running' }));
main().then(() => {
  fs.writeFileSync(resultPath, JSON.stringify({ status: 'passed', checks: ['Chromium renderer', 'IndexedDB queue and reload', 'local login/register/logout/session restoration', 'provider popup login', 'favorites', 'account isolation', 'entry editor', 'normal-editor revision conflict and rebase', 'full renderer API', 'cloud backup', 'preference aliases', 'AniList import selection and review', 'import cancellation', 'real cache service provider-outage flow', 'saved-catalog fallback', 'retry backoff', 'MAL fallback and AniList recovery', 'MAL-only manga details', 'MAL import preview, cancellation, selection and private review', 'text/PDF import staging', 'cache repair preserves resumable review', 'account-scoped analytics consent', 'privacy export', 'password-verified deletion and local cleanup', 'discovery/studio/artist/person/theme cache fallback'] }));
  app.exit(0);
}).catch(error => {
  fs.writeFileSync(resultPath, JSON.stringify({ status: 'failed', error: error.message }));
  console.error(error.message); app.exit(1);
});
