const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../anilist'), 'utf8');
const start = source.indexOf('async function getReleaseCalendar(');
const end = source.indexOf('async function fetchDiscoverShelfPage(', start);
assert(start >= 0 && end > start);
let calls = [];
const calendar = vm.runInNewContext(`${source.slice(start, end)};getReleaseCalendar`, {
  Date, clampInteger: (value, min, max, fallback) => Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback,
  anilistRequestWithRetry: async (_query, args) => {
    calls.push(args);
    return { data: { Page: { pageInfo: { hasNextPage: true }, airingSchedules: [
      { airingAt: 1700000001, episode: args.page, media: { id: args.page, isAdult: false } },
      { airingAt: 1700000002, media: { id: 99, isAdult: true } },
    ], media: [] } } };
  },
});
async function main() {
  const options = { start: 1700000000, end: 1700600000, hideAdultContent: true };
  const first = await calendar({ ...options, page: 1 });
  assert.equal(calls.length, 1, 'paged lookup makes only one provider request');
  assert.equal(first.items.length, 1, 'adult filtering remains enforced');
  assert.equal(first.hasNextPage, true);
  calls = [];
  assert.equal((await calendar({ ...options, page: 5 })).hasNextPage, false, 'last page respects the existing five-page budget');
  calls = [];
  assert.equal((await calendar(options)).items.length, 5, 'older clients still receive the full calendar');
  assert.equal(calls.length, 5);
  await assert.rejects(calendar({ ...options, page: 6 }));
  await assert.rejects(calendar({ ...options, page: 0 }));
  calls = [];
  await calendar({ ...options, mediaType: 'MANGA', page: 1 });
  assert.equal(calls.length, 1);
  console.log('PASS: calendar provider pagination, legacy full lookup, adult filter, validation, and request limits.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
