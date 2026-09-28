const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeLibrary, libraryMenu } = require('../trayLibrary');
test('tray clears personal titles when signed out and rejects invalid navigation targets', () => {
  assert.deepEqual(sanitizeLibrary({ signedIn: false, recent: [{ id: 1, type: 'ANIME', title: 'Private' }] }).recent, []);
  const state = sanitizeLibrary({ signedIn: true, watching: [{ id: '1', type: 'ANIME', title: 'bad' }, { id: -12, type: 'MANGA', title: 'Title\nwith controls' }], recent: [], continueWatching: { id: 0, type: 'ANIME', title: 'bad' } });
  assert.equal(state.watching.length, 1);
  assert.equal(state.watching[0].title, 'Titlewith controls');
  assert.equal(state.continueWatching, null);
  assert.deepEqual(libraryMenu(sanitizeLibrary(null), () => {}), []);
});
test('tray routes continue, watching and recent actions without adding accelerators', () => {
  const actions = [];
  const title = { id: 20954, type: 'ANIME', title: 'A Silent Voice' };
  const menu = libraryMenu(sanitizeLibrary({ signedIn: true, watching: [title], recent: [title], continueWatching: title }), action => actions.push(action));
  menu[0].click(); menu[1].submenu[0].click(); menu[2].submenu[0].click();
  assert.deepEqual(actions, [{ action: 'title', id: 20954, type: 'ANIME' }, { action: 'watching' }, { action: 'title', id: 20954, type: 'ANIME' }]);
  assert.equal(JSON.stringify(menu).includes('accelerator'), false);
});
