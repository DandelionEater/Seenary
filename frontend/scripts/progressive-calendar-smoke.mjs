import assert from 'node:assert/strict';
import { loadCalendarPages } from '../src/utils/progressiveCalendar.ts';

const item = (id, episode = 1) => ({ media: { id }, airingAt: 1700000000, episode });
const reply = (items, hasNextPage = false) => ({ mediaType: 'ANIME', start: 1, end: 2, precision: 'time', items, hasNextPage });
const published = [];
let release;
let requests = 0;
const loading = loadCalendarPages(async page => {
  requests++;
  if (page === 1) return reply([item(1)], true);
  await new Promise(resolve => { release = resolve; });
  return reply([item(1), item(2), item(1, 2)]);
}, result => published.push(result), () => false);
await new Promise(resolve => setImmediate(resolve));
assert.equal(published.length, 1, 'first page is visible while page two is still in flight');
assert.equal(published[0].items.length, 1);
release(); await loading;
assert.equal(requests, 2);
assert.equal(published[1].items.length, 3, 'deduplicate exact rows, retain distinct episodes');

let cancelled = false;
requests = 0;
await loadCalendarPages(async () => { requests++; return reply([item(1)], true); }, () => { cancelled = true; }, () => cancelled);
assert.equal(requests, 1, 'week changes/closing stops subsequent page requests');
let completeStale;
const stale = [];
cancelled = false;
const pending = loadCalendarPages(() => new Promise(resolve => { completeStale = resolve; }), result => stale.push(result), () => cancelled);
cancelled = true; completeStale(reply([item(3)], true)); await pending;
assert.equal(stale.length, 0, 'old week cannot publish after navigation');

const partial = [];
await assert.rejects(loadCalendarPages(async page => { if (page > 1) throw Error('Provider unavailable'); return reply([item(1)], true); }, result => partial.push(result), () => false));
assert.equal(partial[0].items.length, 1, 'later failure retains results already published');
requests = 0;
await loadCalendarPages(async () => { requests++; return reply([], true); }, () => {}, () => false);
assert.equal(requests, 5, 'provider request budget stays bounded');
requests = 0;
await loadCalendarPages(async () => { requests++; return { ...reply([]), mediaType: 'MANGA' }; }, () => {}, () => false);
assert.equal(requests, 1, 'single-page/manga calendars do not add requests');
console.log('PASS: progressive calendar rendering, deduplication, cancellation, partial failures, page budget, and manga request count.');
