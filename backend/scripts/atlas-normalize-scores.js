require('../env');
const { parseArgs } = require('node:util');
const { connectRuntime, reportError } = require('../atlas/connection');

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: { apply: { type: 'boolean' } },
  });
  const connection = await connectRuntime();
  try {
    const targets = [
      { collection: 'libraryEntries', filter: { score: { $gt: 10, $lte: 100 } }, path: 'score' },
      { collection: 'libraryChanges', filter: { 'entry.score': { $gt: 10, $lte: 100 } }, path: 'entry.score' },
      { collection: 'mutationReceipts', filter: { 'result.entry.score': { $gt: 10, $lte: 100 } }, path: 'result.entry.score' },
      { collection: 'jobs', filter: { 'payload.score': { $gt: 10, $lte: 100 } }, path: 'payload.score' },
    ];
    const before = Object.fromEntries(await Promise.all(targets.map(async target => [
      target.collection,
      await connection.db.collection(target.collection).countDocuments(target.filter),
    ])));
    if (!values.apply) {
      console.log(JSON.stringify({ mode: 'dry-run', records: before }));
      return;
    }
    const session = connection.client.startSession();
    try {
      await session.withTransaction(async () => {
        for (const target of targets) {
          await connection.db.collection(target.collection).updateMany(
            target.filter,
            [{ $set: { [target.path]: { $divide: [`$${target.path}`, 10] } } }],
            { session }
          );
        }
      });
    } finally {
      await session.endSession();
    }
    const remaining = Object.fromEntries(await Promise.all(targets.map(async target => [
      target.collection,
      await connection.db.collection(target.collection).countDocuments(target.filter),
    ])));
    console.log(JSON.stringify({ mode: 'apply', normalized: before, remaining }));
  } finally {
    await connection.close();
  }
}

main().catch(error => {
  reportError(error);
  process.exitCode = 1;
});
