import assert from 'node:assert/strict';
import { collectWatchTitles, filterWatchTitles, sortWatchTitles } from '../src/utils/watchOrder.ts';

const title = (id, year, links = []) => ({ id, type: 'ANIME', isAdult: false,
  title: { romaji: `Title ${id}` }, startDate: year ? { year, month: 4, day: 18 } : null,
  relations: { edges: links.map(([relationType, id, type = 'ANIME']) => ({ relationType, node: { id, type, isAdult: false } })) } });
const entries = new Map([
  [1, title(1, 2012, [['PREQUEL', 2], ['ALTERNATIVE', 3], ['ADAPTATION', 10, 'MANGA'], ['CHARACTER', 11]])],
  [2, title(2, 2006, [['SEQUEL', 1], ['SIDE_STORY', 4]])],
  [3, title(3, 2011, [['SPIN_OFF', 5]])],
  [4, title(4, 2006)], [5, title(5, null)],
]);
const calls = [];
const snapshots = [];
const result = await collectWatchTitles(entries.get(1), async id => { calls.push(id); return entries.get(id); }, {
  onProgress: (count, titles) => snapshots.push({ count, ids: titles.map(title => title.id) }),
});
assert.deepEqual(snapshots[0], { count: 1, ids: [1] }, 'results arrive before the full traversal finishes');
assert.deepEqual(snapshots.at(-1).ids, result.titles.map(title => title.id));
assert.deepEqual(calls, [2, 3, 4, 5], 'walks beyond direct relations, excludes manga and shared characters, deduplicates cycles');
let active = 0, peak = 0;
await collectWatchTitles(title(50, 2000, [['SEQUEL', 51], ['SIDE_STORY', 52], ['ALTERNATIVE', 53], ['SPIN_OFF', 54], ['SUMMARY', 55]]), async id => {
  active++; peak = Math.max(peak, active);
  await new Promise(resolve => setImmediate(resolve));
  active--;
  return title(id, 2001);
});
assert.equal(peak, 4, 'cached branches can load concurrently without unbounded requests');
assert.equal(result.incomplete, false);
const ordered = sortWatchTitles([...result.titles, title(6, 2030), { ...title(7, 2020), status: 'NOT_YET_RELEASED' }], new Date(2026, 8, 26));
assert.deepEqual(ordered.dated.map(item => item.id), [2, 4, 3, 1], 'release dates and stable ties');
assert.deepEqual(ordered.unknown.map(item => item.id), [5]);
assert.deepEqual(ordered.upcoming.map(item => item.id), [7, 6]);
const formats = [
  { ...title(20, 2010), format: 'OVA' }, { ...title(21, 2011), format: 'TV' },
  { ...title(22, 2012), format: 'ONA' }, { ...title(23, 2013), format: 'MOVIE' }, title(24, null),
];
assert.deepEqual(sortWatchTitles(filterWatchTitles(formats, ['TV', 'MOVIE'])).dated.map(item => item.id), [21, 23], 'selected formats are filtered before numbering');
assert.deepEqual(filterWatchTitles(formats, []).map(item => item.id), [], 'empty selection hides all titles');
assert.deepEqual(filterWatchTitles(formats, ['UNKNOWN']).map(item => item.id), [24], 'missing formats have their own filter');
const throughOva = await collectWatchTitles({ ...title(30, 2000, [['SEQUEL', 31]]), format: 'TV' }, async id => id === 31
  ? { ...title(31, 2001, [['SEQUEL', 32]]), format: 'OVA' }
  : { ...title(32, 2002), format: 'TV' });
assert.deepEqual(filterWatchTitles(throughOva.titles, ['TV']).map(item => item.id), [30, 32], 'hidden formats still connect later seasons');
const failed = await collectWatchTitles(entries.get(1), async () => { throw new Error('Offline'); });
assert.equal(failed.incomplete, true, 'failed links clearly mark the order partial');
assert.deepEqual(failed.titles.map(item => item.id), [1], 'failed requests do not display unverified entries');
const wrongTitle = await collectWatchTitles(entries.get(1), async () => title(999, 1990, [['SEQUEL', 1000]]));
assert.deepEqual(wrongTitle.titles.map(item => item.id), [1], 'unrelated responses are hidden and never expanded');
const wrongType = await collectWatchTitles(entries.get(1), async id => ({ ...title(id, 1990), type: 'MANGA' }));
assert.deepEqual(wrongType.titles.map(item => item.id), [1], 'non-anime responses are hidden');
const largeFranchise = new Map(Array.from({ length: 85 }, (_, index) => {
  const id = 100 + index;
  return [id, title(id, 2000 + index, [['SEQUEL', index < 84 ? id + 1 : 100], ['PREQUEL', 100]])];
}));
const largeCalls = [];
const largeProgress = [];
const fullFranchise = await collectWatchTitles(largeFranchise.get(100), async id => {
  largeCalls.push(id);
  return largeFranchise.get(id);
}, { onProgress: count => largeProgress.push(count) });
assert.equal(fullFranchise.titles.length, 85, 'loads the entire connected franchise beyond 40 titles');
assert.equal(fullFranchise.incomplete, false, 'large complete franchises are not marked partial');
assert.equal(largeCalls.length, 84, 'cycles and repeated links fetch each title only once');
assert.equal(largeProgress.at(-1), 85, 'live results continue beyond the former cap');
const adult = await collectWatchTitles(entries.get(1), async id => ({ ...entries.get(id), isAdult: true }), { hideAdultContent: true });
assert.deepEqual(adult.titles.map(item => item.id), [1], 'adult titles do not appear or expand');
const controller = new AbortController(); controller.abort();
await assert.rejects(collectWatchTitles(entries.get(1), async id => entries.get(id), { signal: controller.signal }), { name: 'AbortError' });
console.log('PASS: franchise traversal, release ordering, unknown/upcoming dates, ties, partial results, adult filtering, and cancellation.');
