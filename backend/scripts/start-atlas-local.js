require('../env');

const dns = require('node:dns');
const http = require('node:http');

const callbackRelays = [];

async function startCallbackRelay(provider, redirectUri) {
  const redirect = new URL(redirectUri);
  if (redirect.port === '3001') return;
  if (redirect.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(redirect.hostname)
      || redirect.pathname !== `/auth/${provider}/callback`) {
    throw new Error(`The local ${provider} callback must use localhost and the expected callback path.`);
  }
  const server = http.createServer((request, response) => {
    const incoming = new URL(request.url, redirect);
    if (incoming.pathname !== redirect.pathname) {
      response.writeHead(404).end();
      return;
    }
    const target = new URL(`http://127.0.0.1:3001/auth/${provider}/callback`);
    target.search = incoming.search;
    response.writeHead(302, { Location: target.toString(), 'Cache-Control': 'no-store' });
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(redirect.port), redirect.hostname, resolve);
  });
  callbackRelays.push(server);
  console.log(`${provider === 'anilist' ? 'AniList' : 'MyAnimeList'} callback relay: ${redirect.origin}${redirect.pathname}`);
}

async function resolveWith(name, type) {
  const response = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(8000) }
  );
  if (!response.ok) throw new Error(`DNS-over-HTTPS returned ${response.status}.`);
  const result = await response.json();
  if (result.Status !== 0 || !Array.isArray(result.Answer)) throw new Error('DNS-over-HTTPS lookup failed.');
  return result.Answer.map(answer => answer.data);
}

async function useDirectAtlasSeeds() {
  const original = new URL(process.env.MONGODB_URI);
  if (original.protocol !== 'mongodb+srv:') return;

  const srvName = `_mongodb._tcp.${original.hostname}`;
  let srv;
  let txt;
  try {
    const resolver = new dns.promises.Resolver({ timeout: 3000, tries: 2 });
    resolver.setServers(['1.1.1.1', '8.8.8.8']);
    [srv, txt] = await Promise.all([
      resolver.resolveSrv(srvName),
      resolver.resolveTxt(original.hostname).catch(() => []),
    ]);
    srv = srv.map(record => `${record.name}:${record.port}`);
    txt = txt.flat().join('&');
  } catch {
    const [srvAnswers, txtAnswers] = await Promise.all([
      resolveWith(srvName, 'SRV'),
      resolveWith(original.hostname, 'TXT').catch(() => []),
    ]);
    srv = srvAnswers.map(value => {
      const parts = value.trim().split(/\s+/);
      return `${parts[3].replace(/\.$/, '')}:${parts[2]}`;
    });
    txt = txtAnswers.map(value => value.replace(/^"|"$/g, '')).join('&');
  }

  if (!srv.length) throw new Error('Atlas returned no seed hosts.');
  const query = new URLSearchParams(txt);
  for (const [key, value] of original.searchParams) query.set(key, value);
  query.set('tls', 'true');
  process.env.MONGODB_URI = `mongodb://${srv.join(',')}/?${query}`;
}

async function main() {
  await useDirectAtlasSeeds();
  process.env.ATLAS_ANILIST_REDIRECT_URI ||= 'http://127.0.0.1:37645/auth/anilist/callback';
  process.env.ATLAS_MAL_REDIRECT_URI ||= 'http://127.0.0.1:4000/auth/mal/callback';
  await startCallbackRelay('anilist', process.env.ATLAS_ANILIST_REDIRECT_URI);
  await startCallbackRelay('mal', process.env.ATLAS_MAL_REDIRECT_URI);
  process.argv = ['node', 'atlas-accounts', 'serve'];
  require('./atlas-accounts');
}

const closeRelays = () => callbackRelays.forEach(server => server.close());
process.once('SIGINT', closeRelays);
process.once('SIGTERM', closeRelays);

main().catch(() => {
  console.error('Local Atlas startup failed. Check Atlas network access and the backend environment values. No credentials were logged.');
  process.exitCode = 1;
});
