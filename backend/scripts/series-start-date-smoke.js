const assert = require('node:assert/strict');
const { resolveSeriesStartDate } = require('../seriesStartDate');

async function main() {
  const saved = new Map();
  const season = (id, year, prequels = []) => ({ id, startDate: { year, month: 4, day: 18 },
    relations: { edges: prequels.map(id => ({ relationType: 'PREQUEL', node: { id } })) } });
  const entries = new Map([[1, season(1, 1998)], [4, season(4, 2004, [1])], [5, season(5, 2012, [4])],
    [6, season(6, 2014, [5])], [7, season(7, 2000)], [8, season(8, 2020, [5, 7])]]);
  let requests = 0;
  const options = { getSaved: id => saved.get(id), save: (id, date) => saved.set(id, date),
    fetchMedia: async id => { requests++; return entries.get(id); } };
  const premiere = { year: 1998, month: 4, day: 18 };
  assert.deepEqual(await resolveSeriesStartDate(entries.get(5), options), premiere);
  const before = requests;
  assert.deepEqual(await resolveSeriesStartDate({ id: 4 }, options), premiere);
  assert.equal(requests, before, 'season 4 reuses the date saved while resolving season 5');
  assert.deepEqual(await resolveSeriesStartDate(entries.get(6), options), premiere);
  assert.equal(requests, before, 'a later season reuses its saved prequel');
  await resolveSeriesStartDate(entries.get(8), options);
  assert.equal(saved.get(7).year, 2000, 'branches keep their own premiere');
  assert.equal(saved.get(8).year, 1998);
  await assert.rejects(resolveSeriesStartDate(season(9, 2020, [9]), options), /Incomplete/);
  assert.equal(saved.has(9), false, 'incomplete chains are not saved');
  console.log('PASS: shared season dates, later seasons, independent branches, and incomplete history.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
