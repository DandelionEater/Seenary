const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const localRequire = createRequire(require.resolve('../anilist'));
const source = fs.readFileSync(require.resolve('../anilist'), 'utf8');
async function scenario({ slowConnections = false, failTitles = false, failTags = false, tag = 'Yandere' } = {}) {
  delete require.cache[require.resolve('../searchTaxonomy')];
  const calls = [];
  const output = { exports: {} };
  const media = id => ({ id, type: 'ANIME', isAdult: false });
  const fetch = async (_url, options) => {
    const { query } = JSON.parse(options.body);
    calls.push(query);
    let data;
    if (query.includes('GenreCollection')) data = { GenreCollection: ['Romance'], MediaTagCollection: [{ name: 'Yandere', isAdult: false }] };
    else if (query.includes('characterPage:')) {
      assert.ok(!query.includes('mediaPage:'), 'connections must be separate');
      if (slowConnections) await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('Timeout'), { name: 'AbortError' })), { once: true }));
      data = { characterPage: { characters: [] }, studioPage: { studios: [] } };
    } else if (query.includes('mediaPage:')) {
      if (failTitles) throw new Error('Title provider failed');
      data = { mediaPage: { media: [media(1)] } };
    } else {
      if (failTags) throw new Error('Tag provider failed');
      data = { tagANIME: { media: [media(2)] } };
    }
    return { ok: true, json: async () => ({ data }) };
  };
  vm.runInNewContext(source, { module: output, require: name => name === 'node-fetch' ? fetch : localRequire(name), AbortController, URL, Buffer, console,
    setTimeout: (fn, ms) => setTimeout(fn, ms === 1200 ? 10 : Math.min(ms, 80)), clearTimeout });
  return { result: await output.exports.searchMedia(tag), calls };
}
(async () => {
  const slow = await scenario({ slowConnections: true });
  assert.deepEqual(Array.from(slow.result.anime, item => item.id), [1]);
  assert.deepEqual(Array.from(slow.result.tags, item => item.id), [2]);
  assert.equal(slow.result.genres.length,0);
  assert.ok(slow.result.warnings.some(w => w.message.includes('skipped')));
  const titlesFailed = await scenario({ failTitles: true });
  assert.deepEqual(Array.from(titlesFailed.result.tags, item => item.id), [2]);
  assert.equal(titlesFailed.calls.filter(q => q.includes('mediaPage:')).length, 1, 'no interactive retry loop');
  const tagsFailed = await scenario({ failTags: true });
  assert.deepEqual(Array.from(tagsFailed.result.anime, item => item.id), [1]);
  assert.ok(tagsFailed.result.warnings.some(w => w.message.includes('Genre and tag')));
  await assert.rejects(scenario({ failTitles: true, failTags: true }));
  await assert.rejects(scenario({ failTitles: true, tag: 'Unknown' }));
  console.log('PASS: slow connections do not block core results, partial successes survive, failed searches report errors, and interactive retries are bounded.');
})().catch(error => { console.error(error); process.exitCode = 1; });
