// Read-only capacity review: never prints titles, search terms, account data, or credentials.
require('../env');
const { calculateObjectSize } = require('bson');
const { connectStaging, reportError } = require('../atlas/connection');
const { createAniListMetadataProvider } = require('../atlas/anilistMetadataProvider');
const { getPublicMediaDetails } = require('../mal');

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Read-only Atlas capacity report. Usage: npm run atlas:metadata-capacity -- [--sample-provider]');
    return;
  }
  if (process.argv.slice(2).some(arg => arg !== '--sample-provider')) throw new Error('Unknown option.');
  const connection = await connectStaging();
  try {
    const report = { measuredAt: new Date().toISOString(), collections: {} };
    for (const name of ['media', 'metadataQueries']) {
      const sizes = [];
      // Return only byte counts from Mongo, not metadata or personal records.
      for await (const row of connection.db.collection(name).aggregate([
        { $project: { _id: 0, bytes: { $bsonSize: '$$ROOT' } } },
      ])) sizes.push(row.bytes);
      sizes.sort((a, b) => a - b);
      const total = sizes.reduce((sum, value) => sum + value, 0);
      report.collections[name] = { count: sizes.length, logicalBytes: total,
        meanBytes: sizes.length ? Math.round(total / sizes.length) : 0,
        p95Bytes: sizes.length ? sizes[Math.ceil(sizes.length * .95) - 1] : 0,
        maxBytes: sizes.at(-1) || 0 };
    }
    const stats = await connection.db.stats();
    report.database = { logicalDataBytes: stats.dataSize, allocatedStorageBytes: stats.storageSize,
      indexBytes: stats.indexSize, collections: stats.collections };
    const queries = connection.db.collection('metadataQueries');
    const now = new Date();
    report.queryState = {
      payloads: await queries.countDocuments({ payload: { $exists: true } }),
      stalePayloads: await queries.countDocuments({ payload: { $exists: true }, freshUntil: { $lte: now } }),
      failureOnly: await queries.countDocuments({ payload: { $exists: false } }),
      activeLeases: await queries.countDocuments({ leaseUntil: { $gt: now } }),
    };
    if (process.argv.includes('--sample-provider')) {
      const provider = createAniListMetadataProvider();
      report.publicPayloadSamples = [];
      const probes = [
        ['anime-details', () => provider.details('ANIME', 1)],
        ['anime-details', () => provider.details('ANIME', 16498)],
        ['manga-details', () => provider.details('MANGA', 30002)],
        ['search', () => provider.search('naruto', true)],
        ['discovery', () => provider.discover(true)],
      ];
      for (const [kind, fetch] of probes) {
        const payload = await fetch();
        report.publicPayloadSamples.push({ kind, bsonBytes: calculateObjectSize({ payload }) });
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      for (const [kind, type, id] of [['mal-anime-details', 'ANIME', 1], ['mal-manga-details', 'MANGA', 1]]) {
        const payload = await getPublicMediaDetails(type, id);
        report.publicPayloadSamples.push({ kind, bsonBytes: calculateObjectSize({ payload }) });
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    console.log(JSON.stringify(report, null, 2));
  } finally { await connection.close(); }
}
main().catch(error => { reportError(error); process.exitCode = 1; });
