const assert = require('node:assert/strict');
const { searchTaxonomy } = require('../searchTaxonomy');
let lookups = 0;
const queries = [];
async function request(query, variables) {
 if (query.includes('GenreCollection')) { lookups++; return { data: { GenreCollection: ['Romance', 'Drama'], MediaTagCollection: [{ name: 'Time Travel', isAdult: false }, { name: 'Adult Tag', isAdult: true }] } }; }
 queries.push({ query, variables });
 return { data: { [variables.tag ? 'tagANIME' : 'genreANIME']: { media: [{ id: 1, type: 'ANIME', isAdult: false }, { id: 2, type: 'ANIME', isAdult: true }] } } };
}
(async () => {
 assert.equal((await searchTaxonomy('romance', {}, request)).media.length, 1);
 assert.deepEqual(queries.at(-1).variables.genre, ['Romance']);
 assert.ok(queries.at(-1).query.includes('genreMANGA'));
 const tagMatches = await searchTaxonomy('time', {}, request);
 assert.equal(tagMatches.tags.length, 1);
 assert.equal(tagMatches.genres.length, 0);
 assert.deepEqual(queries.at(-1).variables.tag, ['Time Travel']);
 assert.equal(queries.at(-1).variables.isAdult, false);
 assert.deepEqual((await searchTaxonomy('adult', {}, request)).media, []);
 assert.equal((await searchTaxonomy('adult', { hideAdultContent: false }, request)).media.length, 2);
 assert.deepEqual((await searchTaxonomy('nonexistent', {}, request)).media, []);
 assert.equal(lookups, 1);
 console.log('Genre/tag search checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
