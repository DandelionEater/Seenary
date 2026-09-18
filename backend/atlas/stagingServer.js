const http = require('node:http');
const crypto = require('node:crypto');
const { evaluateClient } = require('./clientGate');

function getToken(req, cookieName) {
  return String(req.headers.cookie || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}
function cookie(name, token = '', secure = false, sameSite = 'Strict', maxAge = 604800) {
  return `${name}=${token}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${token ? maxAge : 0}${secure ? '; Secure' : ''}`;
}

function createStagingServer(service, providers = null, media = null, library = null, metadata = null, analytics = null, options = {}) {
  const config = { loopbackOnly: true, secureCookies: false, cookieName: 'seenary_atlas_staging', trustProxy: false,
    allowedOrigins: [], requestLimit: 120, authLimit: 20, windowMs: 60000, ...options };
  const limits = new Map();
  const consume = (key, maximum) => { const now = Date.now(); const current = limits.get(key);
    if (!current || current.resetAt <= now) { limits.set(key, { count: 1, resetAt: now + config.windowMs }); return true; }
    current.count++; return current.count <= maximum; };
  return http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        ...(config.secureCookies ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}) });
      res.end(JSON.stringify(body));
    };
    const address = req.socket.localAddress;
    const expectedHosts = [`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`];
    if (config.loopbackOnly && (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(address) || !expectedHosts.includes(req.headers.host))) {
      send(403, { ok: false, message: 'Loopback access required.' }); return;
    }
    const allowedOrigins = config.loopbackOnly ? [...expectedHosts.map((host) => `http://${host}`), 'http://localhost:5173', 'http://127.0.0.1:5173'] : config.allowedOrigins;
    if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) {
      send(403, { ok: false, message: 'Origin not allowed.' }); return;
    }
    if (req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS' && req.url === '/rpc') {
      res.setHeader('Access-Control-Allow-Methods', 'POST');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Seenary-Version');
      res.writeHead(204); res.end(); return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      try { const health = config.healthCheck ? await config.healthCheck() : { ok: true }; send(health.ok ? 200 : 503, health); }
      catch { send(503, { ok: false }); } return;
    }
    const forwarded = config.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
    const clientAddress = forwarded || req.socket.remoteAddress || 'unknown';
    if (!consume(`request:${clientAddress}`, config.requestLimit)) { send(429, { ok: false, message: 'Too many requests.' }); return; }
    const binding = String(req.headers.cookie || '').split(';').map((part) => part.trim())
      .find((part) => part.startsWith('seenary_oauth_binding='))?.slice('seenary_oauth_binding='.length);
    const callback = /^\/auth\/(anilist|mal)\/callback(?:\?|$)/.exec(req.url);
    if (providers && req.method === 'GET' && callback) {
      if (!consume(`auth:${clientAddress}`, config.authLimit)) { send(429, { ok: false, message: 'Too many authorization attempts.' }); return; }
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const result = await providers.complete(callback[1], url.searchParams.get('state'), url.searchParams.get('code'), binding);
        if (result.token) res.setHeader('Set-Cookie', cookie(config.cookieName, result.token, config.secureCookies));
        const { token: secret, ...body } = result;
        res.setHeader('Referrer-Policy', 'no-referrer');
        send(200, body);
      } catch { send(400, { ok: false, message: 'Provider authorization failed. Restart the authorization flow.' }); }
      return;
    }
    if (req.method !== 'POST' || req.url !== '/rpc') { send(404, { ok: false }); return; }
    if (String(req.headers['content-type']).split(';')[0].trim().toLowerCase() !== 'application/json') {
      send(415, { ok: false, message: 'JSON required.' }); return;
    }
    const client = evaluateClient(req.headers['x-seenary-version']);
    if (!client.allowed) { send(426, { ok: false, code: 'CLIENT_UPDATE_REQUIRED', minimumVersion: client.minimum }); return; }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) { send(413, { ok: false, message: 'Request too large.' }); return; }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { send(400, { ok: false }); return; }
      if (!body || typeof body.method !== 'string' || !Array.isArray(body.args)) { send(400, { ok: false }); return; }
      if (size > 8192 && body.method !== 'mutateLibraryEntry') { send(413, { ok: false, message: 'Request too large.' }); return; }
      if (['register', 'login', 'changePassword', 'beginProviderLogin', 'beginProviderLink', 'unlinkProvider', 'setLocalPassword', 'deleteAccount', 'refreshProvider', 'requestProviderSync'].includes(body.method) && !consume(`auth:${clientAddress}`, config.authLimit)) {
        send(429, { ok: false, message: 'Too many authentication attempts.' }); return;
      }
      const token = getToken(req, config.cookieName);
      if (body.expectedUserId !== undefined) {
        const session = await service.getSession(token);
        if (!session.authenticated || session.user.id !== body.expectedUserId) {
          send(409, { ok: false, code: 'ACCOUNT_CHANGED' }); return;
        }
      }
      let result;
      switch (body.method) {
        case 'setAnalyticsConsent':
        case 'recordEngagement': {
          if (!analytics) { send(503, { ok: false }); return; }
          result = body.method === 'setAnalyticsConsent' ? await analytics.consent(token, body.args[0]) : await analytics.record(token, body.args[0]);
          break;
        }
        case 'previewAniListImport':
        case 'previewMalImport': {
          if (!metadata) { send(503, { ok: false, message: 'Metadata cache is unavailable.' }); return; }
          if (!(await service.getSession(token)).authenticated) { send(401, { ok: false }); return; }
          result = body.method === 'previewMalImport' ? await metadata.previewMalImport(body.args[0]) : await metadata.previewImport(body.args[0]);
          break;
        }
        case 'getAnimeDetails':
        case 'getMediaDetails':
        case 'searchMedia':
        case 'getDiscoverShelfAnime':
        case 'getStudioMedia':
        case 'getArtistMedia':
        case 'getDiscoverMedia': {
          if (!metadata) { send(503, { ok: false, message: 'Metadata cache is unavailable.' }); return; }
          if (!(await service.getSession(token)).authenticated) { send(401, { ok: false }); return; }
          result = body.method === 'getAnimeDetails' ? await metadata.details('ANIME', body.args[0])
            : body.method === 'getMediaDetails' ? await metadata.details(body.args[0], body.args[1])
              : await metadata.query(body.method, body.args);
          break;
        }
        case 'ensureLibraryMedia': {
          if (!media) { send(404, { ok: false }); return; }
          if (!(await service.getSession(token)).authenticated) { send(401, { ok: false }); return; }
          // Only one provider identity is accepted. Client data cannot assert a cross-provider mapping.
          result = { ok: true, media: await media.ensure(body.args[0], body.args[1], body.args[2]) };
          break;
        }
        case 'getLibraryMedia': {
          if (!media || !(await service.getSession(token)).authenticated) { send(401, { ok: false }); return; }
          const ids = body.args[0];
          if (!Array.isArray(ids) || ids.length > 50 || ids.some(id => typeof id !== 'string' || id.length > 100)) {
            send(400, { ok: false }); return;
          }
          result = { ok: true, media: (await Promise.all(ids.map(id => media.resolve(id)))).filter(Boolean) };
          break;
        }
        case 'mutateLibraryEntry':
        case 'getLibraryEntry':
        case 'getLibrarySnapshot':
        case 'getLibraryChanges':
        case 'getFavoriteRecommendationSeeds': {
          if (!library) { send(404, { ok: false }); return; }
          const handlers = {
            mutateLibraryEntry: () => library.mutate(token, body.args[0]),
            getLibraryEntry: () => library.get(token, body.args[0]),
            getLibrarySnapshot: () => library.snapshot(token, body.args[0]),
            getLibraryChanges: () => library.changes(token, body.args[0]),
            getFavoriteRecommendationSeeds: () => library.favoriteSeeds(token, body.args[0]),
          };
          result = await handlers[body.method]();
          break;
        }
        case 'getMedia':
        case 'resolveMedia': {
          if (!media) { send(404, { ok: false }); return; }
          if (!(await service.getSession(token)).authenticated) { send(401, { ok: false }); return; }
          if (body.method === 'getMedia' && (typeof body.args[0] !== 'string' || body.args[0].length > 100)) { send(400, { ok: false }); return; }
          result = { ok: true, media: body.method === 'getMedia' ? await media.resolve(body.args[0]) : await media.byProvider(body.args[0], body.args[1], body.args[2]) };
          break;
        }
        case 'beginProviderLogin':
        case 'beginProviderLink': {
          if (!providers) { send(404, { ok: false }); return; }
          const browserBinding = /^[a-f0-9]{64}$/.test(binding || '') ? binding : crypto.randomBytes(32).toString('hex');
          result = await providers.begin(body.args[0], body.method === 'beginProviderLink' ? 'link' : 'login', token, browserBinding, body.args[1]);
          if (result.ok) res.setHeader('Set-Cookie', cookie('seenary_oauth_binding', browserBinding, config.secureCookies, 'Lax', 600));
          break;
        }
        case 'exportAccountData':
        case 'getProviderAccount':
        case 'refreshProvider':
        case 'requestProviderSync':
        case 'getProviderSyncStatus':
        case 'setLocalPassword':
        case 'unlinkProvider':
        case 'getAccountSettings':
        case 'setAccountSettings':
        case 'deleteAccount': {
          if (!providers) { send(404, { ok: false }); return; }
          const handlers = {
            exportAccountData: () => providers.exportAccount(token), getProviderAccount: () => providers.getLink(token), refreshProvider: () => providers.refresh(token),
            requestProviderSync: () => providers.requestInboundSync(token, body.args[0]),
            getProviderSyncStatus: () => providers.inboundSyncStatus(token, body.args[0]),
            setLocalPassword: () => providers.setLocalPassword(token, body.args[0]),
            unlinkProvider: () => providers.unlink(token, body.args[0]),
            getAccountSettings: () => providers.settings(token), setAccountSettings: () => providers.settings(token, body.args[0]),
            deleteAccount: () => providers.deleteAccount(token, body.args[0], body.args[1]),
          };
          result = await handlers[body.method]();
          if (result.ok && ['setLocalPassword', 'unlinkProvider', 'deleteAccount'].includes(body.method)) res.setHeader('Set-Cookie', cookie(config.cookieName, '', config.secureCookies));
          break;
        }
        case 'register': result = await service.register(body.args[0], body.args[1]); break;
        case 'login': result = await service.login(body.args[0], body.args[1]); break;
        case 'getSession': result = await service.getSession(token); break;
        case 'logout': result = await service.logout(token); res.setHeader('Set-Cookie', cookie(config.cookieName, '', config.secureCookies)); break;
        case 'changePassword':
          result = await service.changePassword(token, body.args[0], body.args[1]);
          if (result.ok) res.setHeader('Set-Cookie', cookie(config.cookieName, '', config.secureCookies));
          break;
        default: send(404, { ok: false, message: 'This method is outside account batch 1.' }); return;
      }
      if (result.token) {
        res.setHeader('Set-Cookie', cookie(config.cookieName, result.token, config.secureCookies));
        const { token: secret, ...publicResult } = result;
        result = publicResult;
      }
      send(200, result);
    } catch {
      send(500, { ok: false, message: 'Account operation failed.' });
    }
  });
}

module.exports = { createStagingServer };
