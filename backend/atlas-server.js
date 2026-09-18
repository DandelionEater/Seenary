require('./env');
const { connectProduction, reportError } = require('./atlas/connection');
const { validateDeployment, healthReport } = require('./atlas/operations');
const { createAtlasApplication } = require('./atlas/application');
const { createStagingServer } = require('./atlas/stagingServer');

async function main() {
  const validation = validateDeployment(process.env, 'production');
  if (!validation.ok) throw new Error(`Production configuration failed: ${validation.errors.join(', ')}`);
  const connection = await connectProduction(process.env); let server;
  try {
    const initialHealth = await healthReport(connection.db);
    if (!initialHealth.ok) throw new Error('Atlas health gate failed.');
    const app = await createAtlasApplication(connection);
    const origins = process.env.WEB_ORIGINS.split(',').map(value => value.trim()).filter(Boolean);
    server = createStagingServer(app.accounts, app.providers, app.media, app.library, app.metadata, app.analytics, {
      loopbackOnly: false, secureCookies: true, cookieName: 'seenary_sid', allowedOrigins: origins,
      trustProxy: process.env.TRUST_PROXY === 'true', requestLimit: Number(process.env.RPC_RATE_LIMIT_MAX || 300),
      authLimit: Number(process.env.AUTH_RATE_LIMIT_MAX || 20), windowMs: Number(process.env.RPC_RATE_LIMIT_WINDOW_MS || 60000),
      healthCheck: () => healthReport(connection.db),
    });
    const port = Number(process.env.PORT || 3000);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', resolve); });
    console.log(`Seenary Atlas API listening on port ${port}.`);
    await new Promise(resolve => { const stop = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); server.close(resolve); server.closeIdleConnections(); };
      process.on('SIGINT', stop); process.on('SIGTERM', stop); });
  } finally { if (server?.listening) server.close(); await connection.close(); }
}

if (require.main === module) main().catch(error => { reportError(error); process.exitCode = 1; });
module.exports = { main };
