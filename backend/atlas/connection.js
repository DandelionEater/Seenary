const { MongoClient } = require('mongodb');

async function connectAtlas(env = process.env, expectedDatabase = null) {
  for (const key of ['MONGODB_URI', 'MONGODB_DATABASE', 'MONGODB_USERNAME', 'MONGODB_PASSWORD']) {
    if (!env[key] || /^<.*>$/.test(env[key])) throw new Error(`Missing ${key}.`);
  }
  if (expectedDatabase && env.MONGODB_DATABASE !== expectedDatabase) throw new Error(`Expected Atlas database ${expectedDatabase}.`);
  const client = new MongoClient(env.MONGODB_URI, {
    auth: { username: env.MONGODB_USERNAME, password: env.MONGODB_PASSWORD },
    authSource: 'admin', serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000, socketTimeoutMS: 15000, maxPoolSize: 5,
  });
  try {
    await client.connect();
    return { client, db: client.db(env.MONGODB_DATABASE), close: () => client.close() };
  } catch (error) {
    await client.close();
    throw error;
  }
}

const connectStaging = env => connectAtlas(env, 'seenary_staging');
const connectProduction = env => connectAtlas(env, 'seenary');
function connectRuntime(env = process.env) {
  const mode = String(env.ATLAS_RUNTIME_MODE || 'staging').trim();
  if (mode === 'production') return connectProduction(env);
  if (mode === 'staging') return connectStaging(env);
  throw new Error('ATLAS_RUNTIME_MODE must be staging or production.');
}

function reportError(error) {
  // Do not print driver messages, URIs, imported rows, or credentials.
  const code = typeof error.code === 'number' ? ` (${error.code})` : '';
  console.error(`Atlas operation failed${code}. Check configuration, permissions, network access, and input. No credentials were logged.`);
}

module.exports = { connectAtlas, connectStaging, connectProduction, connectRuntime, reportError };
