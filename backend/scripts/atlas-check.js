require('../env');

async function main() {
  const required = ['MONGODB_URI', 'MONGODB_DATABASE', 'MONGODB_USERNAME', 'MONGODB_PASSWORD'];
  if (required.some((key) => !process.env[key] || /^<.*>$/.test(process.env[key]))) {
    console.error('Set MONGODB_URI, MONGODB_DATABASE, MONGODB_USERNAME, and MONGODB_PASSWORD in backend/.env first.');
    process.exitCode = 1;
    return;
  }

  const { MongoClient } = require('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, {
    auth: { username: process.env.MONGODB_USERNAME, password: process.env.MONGODB_PASSWORD },
    authSource: 'admin',
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 10000,
    maxPoolSize: 1,
  });
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DATABASE);
    await db.command({ ping: 1 });
    // A read also checks database access; ping alone does not verify read permissions.
    await db.collection('media').findOne({}, { projection: { _id: 1 }, maxTimeMS: 5000 });
    console.log('Atlas connection, authentication, and database read check passed. No data was written.');
  } finally {
    await client.close();
  }
}

main().catch(error => {
  // Driver errors can contain connection details. Keep credentials out of logs.
  console.error('Atlas check failed. Check credentials, database permissions, the Atlas IP access list, and network connectivity.');
  const safe = value => /^[A-Za-z0-9_]+$/.test(String(value || '')) ? String(value) : 'unknown';
  console.error(JSON.stringify({ errorClass: safe(error.name), code: safe(error.code), servers: [...(error.reason?.servers?.values() || [])].map(server => ({ errorClass: safe(server.error?.name), code: safe(server.error?.code), causeCode: safe(server.error?.cause?.code) })) }));
  process.exitCode = 1;
});
