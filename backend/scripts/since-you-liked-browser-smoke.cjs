// Hidden Chromium, synthetic accounts and local HTTP only.
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { fixture } = require('./since-you-liked-smoke');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
const assets = path.resolve(__dirname, '../../frontend/node_modules/.cache/since-liked-fixture');
const results = path.resolve(__dirname, '../node_modules/.cache/since-liked-browser');
fs.mkdirSync(results, { recursive: true });
app.setPath('userData', path.join(results, 'profile'));
let server, win, account = 'alice', failWrite = false, writes = 0;
const { service, repo } = fixture();
const evaluate = script => win.webContents.executeJavaScript(script);
async function until(script) {
  for (let i = 0; i < 100; i++) { if (await evaluate(script)) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error(`Timed out: ${script}`);
}
const source = (type = 'ANIME') => [{ anime_id: 1, title_english: 'Spice and Wolf', status: 'completed', is_favorite: 1, score: 9,
  recommendations: [10, 11, 12, 13, 14, 15].map(id => ({ rating: 100 - id, mediaRecommendation: { id, type, title: { english: `Recommendation ${id}` },
    description: 'A recommendation based on this particular favorite.', format: type === 'MANGA' ? 'MANGA' : 'TV', episodes: 12, averageScore: 80 } })) }];
const button = prefix => `Array.from(document.querySelectorAll('.since-liked-controls button')).find(b => b.getAttribute('aria-label').startsWith(${JSON.stringify(prefix)}))`;
async function click(prefix) { await evaluate(`${button(prefix)}.click()`); }
async function render(type = 'ANIME') {
  await evaluate(`window.renderFixture(${JSON.stringify(source(type))}, ${JSON.stringify(type)}, ${JSON.stringify(account)})`);
  await until(`!!document.querySelector('.since-liked-controls')`);
}
async function main() {
  await app.whenReady();
  server = http.createServer(async (req, res) => {
    if (req.url === '/rpc') {
      let body = ''; for await (const chunk of req) body += chunk;
      const { method, payload } = JSON.parse(body);
      const activeAccount = account;
      let result;
      if (method === 'state' || method === 'preferences') result = await service[method](activeAccount, payload);
      else {
        writes++;
        await new Promise(resolve => setTimeout(resolve, 150));
        result = failWrite ? { ok: false, message: 'Synthetic save failure. Try again.' } : await service[method](activeAccount, payload);
      }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result)); return;
    }
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(assets, 'fixture.js'))); return; }
    if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(fs.readFileSync(path.join(assets, fs.readdirSync(assets).find(name => name.endsWith('.css'))))); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body style="background:#101010;color:white;--app-accent:#a78bfa;--app-accent-soft:#a78bfa22"><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  win = new BrowserWindow({ show: false, width: 1280, height: 700, webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
  win.webContents.on('console-message', (_event, _level, message) => { if (String(message).includes('Error')) console.error(message); });
  const url = `http://127.0.0.1:${server.address().port}`;
  async function initialize() {
    await win.loadURL(url); await until('window.fixtureReady === true');
    await evaluate(`
      window.library = new Set();
      window.libraryWrites = 0;
      const rpc = (method, payload) => fetch('/rpc', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,payload})}).then(r=>r.json());
      window.api = {
        getRecommendationPreferences: payload => rpc('preferences',payload).then(reply => ({...reply,items:reply.items?.map(item => ({...item,media:{id:item.mediaId,title:{english:'Title '+item.mediaId,native:'Native'+item.mediaId}},source:item.sourceMediaId?{id:item.sourceMediaId,title:{native:'Native'+item.sourceMediaId}}:null}))})),
        getSinceYouLikedState: payload => rpc('state',payload),
        setSinceYouLikedFeedback: payload => rpc('feedback',payload),
        setSinceYouLikedHidden: payload => rpc('hide',payload),
        getMyListEntry: async id => ({ok:true,entry:window.library.has('ANIME:'+id)?{status:'watching',progress:5}:null}),
        getMyMangaListEntry: async id => ({ok:true,entry:window.library.has('MANGA:'+id)?{status:'reading',progress:5}:null}),
        saveMyListEntry: async (id,payload) => {window.libraryWrites++;window.lastSave=payload;window.library.add('ANIME:'+id);return {ok:true};},
        saveMyMangaListEntry: async (id,payload) => {window.libraryWrites++;window.lastSave=payload;window.library.add('MANGA:'+id);return {ok:true};},
      };
      void 0;
    `);
  }
  await initialize(); await render();
  const scoring = await evaluate(`(() => {
    const entries = ${JSON.stringify(source())};
    const options = {favoriteSourcesOnly:true,mediaType:'ANIME'};
    const baseline = window.scoreRecommendations(entries,'english',options);
    const boosted = window.scoreRecommendations(entries,'english',{...options,feedback:{'1:15':{feedbackAdjustment:10}}});
    const hidden = window.scoreRecommendations(entries,'english',{...options,hiddenIds:new Set([10,11,12,13,14])});
    const inLibrary = window.scoreRecommendations([...entries,{anime_id:10,status:'planned'}],'english',options);
    for (const row of entries[0].recommendations) delete row.mediaRecommendation.type;
    const legacy = window.scoreRecommendations(entries,'english',options);
    const otherSource = {...entries[0],anime_id:2,title_english:'Another favorite'};
    const shifted = window.scoreRecommendations([...entries,otherSource],'english',{...options,feedback:{'1:10':{feedbackAdjustment:-2}}});
    return {baseline:baseline[0].animeId,boosted:boosted[0].animeId,hidden:hidden[0].animeId,
      inLibrary:inLibrary.map(item=>item.animeId),legacy:legacy[0].animeId,
      shiftedSource:shifted.find(item=>item.animeId===10)?.source.animeId};
  })()`);
  assert.deepEqual(scoring, { baseline: 10, boosted: 15, hidden: 15, inLibrary: [10], legacy: 10, shiftedSource: 2 });
  const bounds = await evaluate(`JSON.stringify(document.querySelector('.since-liked-actions').getBoundingClientRect())`);
  const rect = await evaluate(`({x:document.querySelector('.since-liked-card').getBoundingClientRect().x+20,y:document.querySelector('.since-liked-card').getBoundingClientRect().y+20})`);
  await evaluate(`window.transitionSamples = []; window.sampleTransition = true;
    function sample() {
      const tags = document.querySelector('.since-liked-tags');
      const actions = [...document.querySelectorAll('.since-liked-action')];
      window.transitionSamples.push({tags:Number(getComputedStyle(tags).opacity), buttons:Math.max(...actions.map(action=>Number(getComputedStyle(action).opacity)))});
      if (window.sampleTransition) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample); void 0;`);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(rect.x), y: Math.round(rect.y) });
  await until(`[...document.querySelectorAll('.since-liked-action')].every(action => getComputedStyle(action).opacity === '1')`);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
  await until(`getComputedStyle(document.querySelector('.since-liked-tags')).opacity === '1'`);
  await evaluate('window.sampleTransition = false');
  assert.equal(await evaluate('window.transitionSamples.some(frame => frame.tags > 0.03 && frame.buttons > 0.03)'), false, 'tags and controls never visibly overlap during entry or exit');
  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(rect.x), y: Math.round(rect.y) });
  await until(`[...document.querySelectorAll('.since-liked-action')].every(action => getComputedStyle(action).opacity === '1')`);
  assert.equal(await evaluate(`JSON.stringify(document.querySelector('.since-liked-actions').getBoundingClientRect())`), bounds, 'hover never changes layout');
  const beforeReaction = await evaluate("document.querySelector('.since-liked-card h3').textContent");
  await click('Like');
  await until("document.querySelector('.since-liked-card h3').textContent !== " + JSON.stringify(beforeReaction));
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(repo.sinceYouLikedFeedback.rows[0].feedback, 'like');
  await initialize(); await render();
  assert.notEqual(await evaluate("document.querySelector('.since-liked-card h3').textContent"), beforeReaction, 'reacted title stays replaced after reload');
  await click('Dislike');
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(repo.sinceYouLikedFeedback.rows.some(row => row.feedback === 'dislike'), true);
  failWrite = true;
  await click('Like'); await until(`!!document.querySelector('[role="alert"]')`);
  assert.equal(await evaluate(`${button('Like')}.getAttribute('aria-pressed')`), 'false', 'failed reaction rolls back');
  failWrite = false;
  const hiddenTitle = await evaluate(`document.querySelector('.since-liked-card h3').textContent`);
  await click('Not Interested');
  await until(`document.querySelector('.since-liked-card h3').textContent !== ${JSON.stringify(hiddenTitle)}`);
  await until(`!!document.querySelector('[role="status"] button') && !document.querySelector('[role="status"] button').disabled`);
  assert.equal(repo.sinceYouLikedHidden.rows.length, 1);
  await initialize(); await render();
  assert.notEqual(await evaluate(`document.querySelector('.since-liked-card h3').textContent`), hiddenTitle, 'hidden choice survives reload');
  await click('Not Interested'); await until(`!document.querySelector('[role="status"] button').disabled`);
  await evaluate(`document.querySelector('[role="status"] button').click()`);
  await until(`!document.querySelector('[role="status"] button')`);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(repo.sinceYouLikedHidden.rows.length, 1, 'undo restores only the latest hidden title');
  const beforeAdd = await evaluate(`document.querySelector('.since-liked-card h3').textContent`);
  await click('Add to Library');
  await until(`${button('In Library')}?.disabled === true`);
  assert.equal(await evaluate(`document.querySelector('.since-liked-card h3').textContent`), beforeAdd, 'adding retains the suggestion');
  assert.equal(await evaluate('window.libraryWrites'), 1);
  assert.deepEqual(await evaluate('window.lastSave'), { status: 'planned' });
  const existingId = Number(beforeAdd.split(' ').at(-1));
  await initialize(); await evaluate("window.library.add('ANIME:" + existingId + "')"); await render();
  await click('Add to Library'); await until(`${button('In Library')}?.disabled === true`);
  assert.equal(await evaluate('window.libraryWrites'), 0, 'adding an existing entry never resets progress');
  account = 'bob'; await render();
  assert.equal(await evaluate(`${button('Like')}.getAttribute('aria-pressed')`), 'false');
  const bobTitle = await evaluate(`document.querySelector('.since-liked-card h3').textContent`);
  assert.equal(bobTitle, 'Recommendation 10', 'hidden and reacted titles are account-only');
  failWrite = true;
  await click('Not Interested'); await until(`!!document.querySelector('[role="alert"]')`);
  assert.equal(await evaluate(`document.querySelector('.since-liked-card h3').textContent`), bobTitle, 'failed hiding restores the removed card');
  failWrite = false;
  await render('MANGA'); await click('Not Interested'); await until(`!document.querySelector('[role="status"] button').disabled`);
  assert.equal(repo.sinceYouLikedHidden.rows.some(row => row.userId === 'bob' && row.mediaType === 'MANGA'), true);
  await render('ANIME');
  assert.equal(await evaluate(`document.querySelector('.since-liked-card h3').textContent`), bobTitle, 'manga hiding does not hide anime');
  await evaluate(`${button('Like')}.focus()`);
  await until(`getComputedStyle(document.querySelector('.since-liked-controls')).opacity === '1'`);
  fs.writeFileSync(path.join(results, 'desktop.png'), (await win.webContents.capturePage()).toPNG());
  win.setSize(390, 844);
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await evaluate('document.activeElement.blur()');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'narrow layout does not overflow');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.since-liked-controls')).opacity`), '1', 'touch actions remain visible without hover or focus');
  fs.writeFileSync(path.join(results, 'narrow.png'), (await win.webContents.capturePage()).toPNG());
  assert.equal(await evaluate('window.openedMedia === undefined'), true, 'feedback never opens title navigation');
  account = 'alice';
  await service.hide('alice', {mediaType:'ANIME',mediaId:999,hidden:true});
  await service.feedback('alice', {mediaType:'MANGA',sourceMediaId:1,recommendedMediaId:777,feedback:'dislike'});
  await evaluate('window.renderPreferences()');
  await until("document.body.textContent.includes('Native999')");
  const hiddenCount = await evaluate('window.preferenceCounts.hidden');
  await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Restore' && b.parentElement.textContent.includes('Native999')).click()");
  await until("window.preferenceCounts.hidden === " + (hiddenCount-1));
  assert.equal(repo.sinceYouLikedHidden.rows.some(row=>row.userId==='alice'&&row.mediaId===999),false);
  await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().startsWith('Dislikes')).click()");
  await until("document.body.textContent.includes('Native777')");
  assert.equal(await evaluate("document.body.textContent.includes('Because you liked: Native1')"),true,'preferred language applies to source and suggestion');
  const dislikeCount = await evaluate('window.preferenceCounts.dislikes');
  await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Remove dislike' && b.parentElement.textContent.includes('Native777')).click()");
  await until("window.preferenceCounts.dislikes === " + (dislikeCount-1));
  assert.equal(repo.sinceYouLikedFeedback.rows.some(row=>row.userId==='alice'&&row.recommendedMediaId===777),false);
  console.log('PASS: recommendation preference tabs, native titles, source pair context, restore/remove actions and live counts.');
  await evaluate("window.api.getDiscoverGenres = () => new Promise(resolve => { window.resolveGenres = resolve; }); window.renderGenres()");
  await until("typeof window.resolveGenres === 'function'");
  assert.equal(await evaluate("document.querySelector('[role=group]').getBoundingClientRect().height"),34,'genres initially occupy one row');
  await evaluate("window.resolveGenres(['Action','Adventure','Comedy','Drama','Fantasy','Mystery','Romance','Sci-Fi','Slice of Life','Horror','Mahou Shoujo','Mecha','Music','Psychological','Sports','Supernatural','Thriller','Ecchi','Hentai'])");
  await until("document.body.textContent.includes('Show all (18)')");
  assert.equal(await evaluate("document.querySelector('[role=group]').textContent.includes('Hentai')"),false);
  await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.startsWith('Show all')).click()");
  await until("document.querySelector('[role=group]').getBoundingClientRect().height > 34");
  await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Horror').click()");
  assert.equal(await evaluate('window.selectedGenre'),'Horror');
  await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.startsWith('Show less')).click()");
  await until("document.querySelector('[role=group]').getBoundingClientRect().height === 34");
  console.log('PASS: progressive genre list, one-row cap, expansion/collapse, genre clicks and adult filtering.');

  await evaluate("window.api.getDiscoverTags = async () => ['Time Travel','Space','Mystery']; window.selectedShelf = undefined; window.renderBrowse()");
  await until("document.body.textContent.includes('Time Travel')");
  assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.getAttribute('aria-label')==='Year: All years')"),true,'year defaults to All years');
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('[role=group]')).map(node=>node.getAttribute('aria-label'))"),['Genre shortcuts','Tag shortcuts'],'genres precede tags in combined form');
  assert.equal(await evaluate("Array.from(document.querySelectorAll('[role=group] button')).filter(b=>b.textContent==='All'&&b.getAttribute('aria-pressed')==='true').length"),2);
  async function taxClick(index,text) { await evaluate("Array.from(document.querySelectorAll('[role=group]')["+index+"].querySelectorAll('button')).find(b=>b.textContent==="+JSON.stringify(text)+").click()"); }
  await evaluate("document.querySelectorAll('[role=group]')[0].parentElement.querySelector('button[aria-expanded]').click()");
  await taxClick(0,'Action'); await taxClick(0,'Drama');
  await taxClick(1,'Space'); await taxClick(1,'Time Travel');
  await evaluate("Array.from(document.querySelectorAll('div[aria-label]')).find(node=>node.getAttribute('aria-label')==='Tags match rule').querySelectorAll('button')[1].click()");
  await until("Array.from(document.querySelectorAll('[role=group]')[0].querySelectorAll('button')).filter(b=>b.getAttribute('aria-pressed')==='true').length === 2");
  assert.equal(await evaluate('window.selectedShelf === undefined'),true,'selection waits for Browse');
  async function submitFilters() {
    await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Browse').click()");
    const shelf=await evaluate('window.selectedShelf');
    return JSON.parse(Buffer.from(shelf.id.slice(14),'base64url').toString('utf8'));
  }
  let selected=await submitFilters();
  assert.deepEqual(selected.genres,['Action','Drama']);assert.deepEqual(selected.tags,['Space','Time Travel']);
  assert.equal(selected.genreMode,'all');assert.equal(selected.tagMode,'any');assert.deepEqual(selected.years,[]);
  async function searchTaxonomy(kind, value) {
    await evaluate("{ const input = Array.from(document.querySelectorAll('input')).find(node => node.getAttribute('aria-label') === " + JSON.stringify('Search ' + kind) + "); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, " + JSON.stringify(value) + "); input.dispatchEvent(new Event('input', { bubbles: true })); }");
  }
  await searchTaxonomy('tags','sPa');
  await until("document.querySelectorAll('[role=group]')[1].textContent === 'AllSpace'");
  await searchTaxonomy('genres','hOr');
  await until("document.querySelectorAll('[role=group]')[0].textContent === 'AllHorror'");
  await evaluate("document.querySelectorAll('[role=group]')[0].parentElement.querySelector('button[aria-expanded]').click()");
  assert.equal(await evaluate("Array.from(document.querySelectorAll('input')).find(node=>node.getAttribute('aria-label')==='Search genres').value"),'hOr','collapse preserves search');
  selected=await submitFilters();
  assert.deepEqual(selected.genres,['Action','Drama']);assert.deepEqual(selected.tags,['Space','Time Travel'],'search preserves selections');
  await searchTaxonomy('tags','no matching title');
  await until("document.body.textContent.includes('No matching tags.')");
  await searchTaxonomy('tags','');await searchTaxonomy('genres','');
  await until("document.querySelectorAll('[role=group]')[0].textContent.includes('Action')");
  await taxClick(0,'All');selected=await submitFilters();
  assert.deepEqual(selected.genres,[]);assert.equal(selected.tags.length,2,'All clears only its own group');
  await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='Year: All years').click()");
  await evaluate("Array.from(document.querySelector('[role=dialog]').querySelectorAll('button')).find(b=>b.textContent==='2024').click()");
  await evaluate("Array.from(document.querySelector('[role=dialog]').querySelectorAll('button')).find(b=>b.textContent.startsWith('Done')).click()");
  selected=await submitFilters();assert.deepEqual(selected.years,[2024]);
  await evaluate("window.renderBrowse('MANGA')");
  await until("document.body.textContent.includes('Find your next manga')");
  await taxClick(1,'Space');selected=await submitFilters();
  assert.deepEqual(selected.tags,['Space']);assert.deepEqual(selected.years,[]);assert.equal(selected.season,'any');
  await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='Publication year: All years').click()");
  await evaluate("Array.from(document.querySelector('[role=dialog]').querySelectorAll('button')).find(b=>b.textContent==='2024').click()");
  await evaluate("Array.from(document.querySelector('[role=dialog]').querySelectorAll('button')).find(b=>b.textContent.startsWith('Done')).click()");
  await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='Publishing status: All statuses').click()");
  await evaluate("Array.from(document.querySelector('[role=dialog]').querySelectorAll('button')).find(b=>b.textContent==='Finished publishing').click()");
  selected=await submitFilters();assert.deepEqual(selected.years,[2024]);assert.equal(selected.status,'FINISHED');assert.deepEqual(selected.tags,['Space']);
  console.log('PASS: combined Browse form, genres above tags, independent all/any rules, multi-selection, All defaults, years and manga.');
  assert.ok(writes > 0);
  console.log('PASS: real React cards, hover layout, keyboard access, optimistic persistence/reload, rollback, replacement, undo, library add, and account/medium isolation.');
}
main().then(() => {
  fs.writeFileSync(path.join(results, 'result.json'), JSON.stringify({ status: 'passed' }));
  win?.destroy(); server?.close(); app.exit(0);
}).catch(error => {
  fs.writeFileSync(path.join(results, 'result.json'), JSON.stringify({ status: 'failed', error: error.stack }));
  console.error(error); win?.destroy(); server?.close(); app.exit(1);
});
