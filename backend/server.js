require('./env');

const http = require('http');
const crypto = require('crypto');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const anilist = require('./anilist');
const searchOrchestrator = require('./searchOrchestrator');
const animethemes = require('./animethemes');
const mal = require('./mal');
const { previewMalImport } = require('./malImport');
const { previewMalMangaPull } = require('./malMangaImport');
const { previewTextImport, previewPdfImport } = require('./textImport');
const { getMalTokenExpiry, withFreshMalAccount } = require('./malTokens');
const {
  createMalJob,
  getMalJob,
  cancelMalJob,
  serializeMalJob,
} = require('./malJobs');
const {
  db,
  dbPath,
  saveAnime,
  saveManga,
  updateAnimeFranchiseStartDate,
  getAnimeById,
  getMangaById,
  getPersonDetails,
  savePersonDetails,
  getSafeUserById,
  getUserByNormalizedUsername,
  getAniListAccountByAniListUserId,
  getAniListAccountByUserId,
  deleteAniListAccountByUserId,
  getMalAccountByMalUserId,
  getMalAccountByUserId,
  deleteMalAccountByUserId,
  clearProviderSyncQueue,
  mergeUserIntoUser,
  upsertAniListAccount,
  updateAniListAccountImportTime,
  upsertMalAccount,
  updateMalAccountImportTime,
  updateTutorialDismissed,
  createWebSessionRecord,
  getWebSessionByHash,
  updateWebSessionExpiry,
  deleteWebSession,
  deleteExpiredWebSessions,
  deleteUser,
} = require('./db');
const { startDatabaseBackups } = require('./databaseBackups');
const {
  deleteEngagementForUser,
  recordEngagement,
} = require('./engagementAnalytics');
const {
  getReportCredentials,
  handleAnalyticsReportRequest,
} = require('./analyticsReports');
const { mapAnimeForDb, mapDbAnimeForFrontend } = require('./animeMapper');
const {
  registerUser,
  loginUser,
  createLinkedUser,
  loginUserById,
  logoutUser,
  normalizeUsername,
  validateUsername,
  verifyLocalPassword,
  setLocalPassword,
} = require('./auth');
const {
  getMyAnimeList,
} = require('./lists');
const {
  getStatelessSyncStatus,
  runStatelessSyncForUser,
} = require('./sync');

const PORT = Number(process.env.PORT || 3000);
const MEDIA_DETAILS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const franchiseStartDateRequests = new Map();
const PERSON_DETAILS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RPC_BODY_BYTES = Number(process.env.MAX_RPC_BODY_BYTES || 40 * 1024 * 1024);
const RPC_RATE_LIMIT_WINDOW_MS = Number(process.env.RPC_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const RPC_RATE_LIMIT_MAX = Number(process.env.RPC_RATE_LIMIT_MAX || 300);
const AUTH_RATE_LIMIT_WINDOW_MS = Number(
  process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000
);
const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX || 20);
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const LEGACY_WRITE_FREEZE = process.env.LEGACY_WRITE_FREEZE === 'true';
const DEFAULT_WEB_ORIGIN = 'https://web.seenary.app';
const ALLOWED_ORIGINS = new Set(
  (process.env.WEB_ORIGINS || process.env.WEB_ORIGIN || DEFAULT_WEB_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

ALLOWED_ORIGINS.add('http://localhost:5173');
ALLOWED_ORIGINS.add('http://127.0.0.1:5173');

const SESSION_COOKIE = 'seenary_sid';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;

function requireEnvironmentValue(name) {
  const value = String(process.env[name] || '').trim();

  if (!value) {
    throw new Error(`${name} must be configured in backend/.env or the host environment.`);
  }

  return value;
}

const ANILIST_CLIENT_ID = requireEnvironmentValue('ANILIST_CLIENT_ID');
const ANILIST_CLIENT_SECRET = requireEnvironmentValue('ANILIST_CLIENT_SECRET');
const ANILIST_AUTHORIZE_URL = 'https://anilist.co/api/v2/oauth/authorize';
const ANILIST_TOKEN_URL = 'https://anilist.co/api/v2/oauth/token';
const DEFAULT_API_ORIGIN =
  process.env.NODE_ENV === 'production' ? 'https://api.seenary.app' : `http://localhost:${PORT}`;
const API_PUBLIC_ORIGIN = process.env.API_PUBLIC_ORIGIN || DEFAULT_API_ORIGIN;
const ANILIST_REDIRECT_URI =
  process.env.ANILIST_REDIRECT_URI || `${API_PUBLIC_ORIGIN}/auth/anilist/callback`;
const MAL_AUTHORIZE_URL = 'https://myanimelist.net/v1/oauth2/authorize';
const MAL_REDIRECT_URI = process.env.MAL_REDIRECT_URI || `${API_PUBLIC_ORIGIN}/auth/mal/callback`;
const ANILIST_FLOW_TIMEOUT_MS = 10 * 60 * 1000;
const ANILIST_TOKEN_TIMEOUT_MS = 15 * 1000;
const DESKTOP_UPDATES_DIR =
  process.env.DESKTOP_UPDATES_DIR || path.join(path.dirname(dbPath), 'desktop-updates');

const DEFAULT_APP_SETTINGS = {
  themeAccent: 'violet',
  customAccentColor: '#a78bfa',
  titleLanguage: 'userPreferred',
  showTrendingCarousel: true,
  autoRotateTrending: true,
  autoScrollHomeShelves: true,
  hideAdultContent: true,
  overlayOpacity: 100,
  overlayBackground: 'solid',
  navbarStyle: 'integrated',
  browseCardStyle: 'default',
  backgroundDim: 65,
  animationLevel: 'full',
  compactMode: false,
  discoverDensity: 'balanced',
  homeDensity: 'balanced',
  myListDensity: 'balanced',
  startView: 'home',
  shareAnonymousUsageStatistics: false,
  analyticsConsentDecided: false,
};

const IMPORT_STATUS_ORDER = ['watching', 'planned', 'completed', 'paused', 'dropped'];
const pendingAniListFlows = new Map();
const pendingAniListSignupByFlowId = new Map();
const pendingAniListLinkConflictByUserId = new Map();
const pendingMalFlows = new Map();
const pendingMalSignupByFlowId = new Map();
const pendingMalLinkConflictByUserId = new Map();
const requestRateLimits = new Map();
let rateLimitSweepCounter = 0;

function getAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return DEFAULT_WEB_ORIGIN;
  return ALLOWED_ORIGINS.has(origin) ? origin : null;
}

function setCorsHeaders(req, res) {
  const allowedOrigin = getAllowedOrigin(req);
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Vary', 'Origin');
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');

  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

function getClientAddress(req) {
  if (TRUST_PROXY) {
    const forwardedFor = String(req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim();
    if (forwardedFor) return forwardedFor;
  }

  return req.socket.remoteAddress || 'unknown';
}

function consumeRateLimit(key, maxRequests, windowMs, now = Date.now()) {
  rateLimitSweepCounter += 1;
  if (rateLimitSweepCounter >= 1000) {
    rateLimitSweepCounter = 0;
    for (const [entryKey, entry] of requestRateLimits) {
      if (entry.resetAt <= now) requestRateLimits.delete(entryKey);
    }
  }

  const current = requestRateLimits.get(key);
  if (!current || current.resetAt <= now) {
    requestRateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  current.count += 1;
  return {
    allowed: current.count <= maxRequests,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

function sendRateLimitResponse(req, res, result) {
  res.setHeader('Retry-After', result.retryAfterSeconds);
  sendJson(req, res, 429, {
    ok: false,
    message: 'Too many requests. Please try again shortly.',
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header
      .split(';')
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const index = cookie.indexOf('=');
        return index === -1
          ? [cookie, '']
          : [cookie.slice(0, index), decodeURIComponent(cookie.slice(index + 1))];
      })
  );
}

function buildCookie(name, value, options = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${options.maxAge ?? SESSION_MAX_AGE_SECONDS}`,
    'SameSite=Lax',
  ];

  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function hashSessionToken(sessionToken) {
  return crypto.createHash('sha256').update(sessionToken).digest('hex');
}

function getWebOrigin(req) {
  return getAllowedOrigin(req);
}

function cleanupAniListFlows(now = Date.now()) {
  for (const [flowId, flow] of pendingAniListFlows) {
    if (now - flow.createdAt > ANILIST_FLOW_TIMEOUT_MS) {
      pendingAniListFlows.delete(flowId);
    }
  }

  for (const [flowId, signup] of pendingAniListSignupByFlowId) {
    if (now - signup.createdAt > ANILIST_FLOW_TIMEOUT_MS) {
      pendingAniListSignupByFlowId.delete(flowId);
    }
  }

  for (const [userId, conflict] of pendingAniListLinkConflictByUserId) {
    if (now - conflict.createdAt > ANILIST_FLOW_TIMEOUT_MS) {
      pendingAniListLinkConflictByUserId.delete(userId);
    }
  }
}

function cleanupMalFlows(now = Date.now()) {
  for (const [flowId, flow] of pendingMalFlows) {
    if (now - flow.createdAt > ANILIST_FLOW_TIMEOUT_MS) {
      pendingMalFlows.delete(flowId);
    }
  }

  for (const [flowId, signup] of pendingMalSignupByFlowId) {
    if (now - signup.createdAt > ANILIST_FLOW_TIMEOUT_MS) {
      pendingMalSignupByFlowId.delete(flowId);
    }
  }

  for (const [userId, conflict] of pendingMalLinkConflictByUserId) {
    if (now - conflict.createdAt > ANILIST_FLOW_TIMEOUT_MS) {
      pendingMalLinkConflictByUserId.delete(userId);
    }
  }
}

function createCodeVerifier() {
  return crypto.randomBytes(48).toString('base64url');
}

function createAniListFlow({ type, userId = null, returnTo }) {
  cleanupAniListFlows();

  const flowId = crypto.randomBytes(16).toString('hex');
  const state = crypto.randomBytes(24).toString('hex');
  const flow = {
    id: flowId,
    state,
    type,
    userId: userId == null ? null : Number(userId),
    returnTo,
    status: 'pending',
    createdAt: Date.now(),
    result: null,
    error: null,
  };

  pendingAniListFlows.set(flowId, flow);

  const url = new URL(ANILIST_AUTHORIZE_URL);
  url.searchParams.set('client_id', ANILIST_CLIENT_ID);
  url.searchParams.set('redirect_uri', ANILIST_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', `${flowId}.${state}`);

  return { flow, authUrl: url.toString() };
}

function createMalFlow({ type, userId = null, returnTo }) {
  cleanupMalFlows();

  const flowId = crypto.randomBytes(16).toString('hex');
  const state = crypto.randomBytes(24).toString('hex');
  const codeVerifier = createCodeVerifier();
  const flow = {
    id: flowId,
    state,
    codeVerifier,
    type,
    userId: userId == null ? null : Number(userId),
    returnTo,
    status: 'pending',
    createdAt: Date.now(),
    result: null,
    error: null,
  };

  pendingMalFlows.set(flowId, flow);

  const url = new URL(MAL_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', mal.requireClientId());
  url.searchParams.set('redirect_uri', MAL_REDIRECT_URI);
  url.searchParams.set('state', `${flowId}.${state}`);
  url.searchParams.set('code_challenge', codeVerifier);

  return { flow, authUrl: url.toString() };
}

function sendAniListCallbackPage(res, title, body, returnTo) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #10141f;
            color: #eef6ff;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          main {
            max-width: 420px;
            padding: 32px;
            text-align: center;
          }
          h1 {
            margin: 0 0 12px;
            font-size: 28px;
          }
          p {
            margin: 0;
            color: rgba(238, 246, 255, 0.72);
            line-height: 1.55;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>${title}</h1>
          <p>${body}</p>
        </main>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'seenary:anilist-oauth-complete' }, ${JSON.stringify(returnTo)});
            window.setTimeout(() => window.close(), 700);
          }
        </script>
      </body>
    </html>
  `);
}

async function exchangeAniListCodeForToken(code) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANILIST_TOKEN_TIMEOUT_MS);
  let response;
  let data;

  try {
    response = await fetch(ANILIST_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: ANILIST_CLIENT_ID,
        client_secret: ANILIST_CLIENT_SECRET,
        redirect_uri: ANILIST_REDIRECT_URI,
        code,
      }),
      signal: controller.signal,
    });
    data = await response.json().catch(() => null);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('AniList token exchange timed out. Try logging in again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok || !data?.access_token) {
    throw new Error(data?.message || 'Failed to exchange AniList authorization code.');
  }

  return data.access_token;
}

function buildAniListAccountPayload(account) {
  return {
    anilistUserId: account.anilist_user_id,
    anilistUsername: account.anilist_username,
    originalAniListUsername: account.original_anilist_username,
    lastImportAt: account.last_import_at,
    updatedAt: account.updated_at,
  };
}

function buildMalAccountPayload(account) {
  return {
    malUserId: account.mal_user_id,
    malUsername: account.mal_username,
    originalMalUsername: account.original_mal_username,
    lastImportAt: account.last_import_at,
    updatedAt: account.updated_at,
  };
}

function getLocalCredentialsConfirmed(userId) {
  const value = getSafeUserById(userId)?.local_credentials_confirmed;
  return value === null || value === undefined ? null : Boolean(value);
}

function getUnlinkPasswordError(userId) {
  return getLocalCredentialsConfirmed(userId) === true
    ? 'Incorrect local password.'
    : 'Confirm an existing local password or create one before unlinking this account.';
}

function createWebSession(res, userId) {
  const sessionToken = crypto.randomBytes(32).toString('hex');
  createWebSessionRecord({
    sessionHash: hashSessionToken(sessionToken),
    userId: Number(userId),
    expiresAt: Date.now() + SESSION_MAX_AGE_MS,
  });
  res.setHeader('Set-Cookie', buildCookie(SESSION_COOKIE, sessionToken));
}

function clearWebSession(req, res) {
  const sessionToken = parseCookies(req)[SESSION_COOKIE];
  if (sessionToken) {
    deleteWebSession(hashSessionToken(sessionToken));
  }
  res.setHeader('Set-Cookie', buildCookie(SESSION_COOKIE, '', { maxAge: 0 }));
}

function getCurrentSession(req, res, options = {}) {
  const shouldRefresh = options.refresh !== false;
  const sessionToken = parseCookies(req)[SESSION_COOKIE];
  const sessionHash = sessionToken ? hashSessionToken(sessionToken) : null;
  const session = sessionHash ? getWebSessionByHash(sessionHash) : null;

  if (!session?.user_id) {
    return { authenticated: false, user: null };
  }

  if (Number(session.expires_at) <= Date.now()) {
    deleteWebSession(sessionHash);
    if (res) {
      res.setHeader('Set-Cookie', buildCookie(SESSION_COOKIE, '', { maxAge: 0 }));
    }
    return { authenticated: false, user: null };
  }

  const user = getSafeUserById(session.user_id);

  if (!user) {
    deleteWebSession(sessionHash);
    if (res) {
      res.setHeader('Set-Cookie', buildCookie(SESSION_COOKIE, '', { maxAge: 0 }));
    }
    return { authenticated: false, user: null };
  }

  const expiresAt = shouldRefresh ? Date.now() + SESSION_MAX_AGE_MS : Number(session.expires_at);

  if (shouldRefresh) {
    updateWebSessionExpiry(sessionHash, expiresAt);
  }

  if (res && shouldRefresh) {
    res.setHeader('Set-Cookie', buildCookie(SESSION_COOKIE, sessionToken));
  }

  return { authenticated: true, user, expiresAt };
}

function sendJson(req, res, status, payload) {
  setCorsHeaders(req, res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case '.yml':
    case '.yaml':
      return 'text/yaml; charset=utf-8';
    case '.exe':
      return 'application/vnd.microsoft.portable-executable';
    case '.blockmap':
      return 'application/octet-stream';
    default:
      return 'application/octet-stream';
  }
}

function getDesktopUpdatesDebugInfo() {
  const updatesRoot = path.resolve(DESKTOP_UPDATES_DIR);
  let rootStats = null;
  let files = [];
  let error = null;

  try {
    rootStats = fs.statSync(updatesRoot);

    if (rootStats.isDirectory()) {
      files = fs.readdirSync(updatesRoot, { withFileTypes: true }).map((entry) => {
        const entryPath = path.join(updatesRoot, entry.name);
        const stats = fs.statSync(entryPath);

        return {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: entry.isFile() ? stats.size : null,
          modifiedAt: stats.mtime.toISOString(),
        };
      });
    }
  } catch (debugError) {
    error = debugError.message;
  }

  return {
    cwd: process.cwd(),
    serverDir: __dirname,
    dbPath,
    desktopUpdatesDir: DESKTOP_UPDATES_DIR,
    resolvedDesktopUpdatesDir: updatesRoot,
    desktopUpdatesDirExists: Boolean(rootStats),
    desktopUpdatesDirIsDirectory: Boolean(rootStats?.isDirectory()),
    files,
    candidates: findDesktopUpdateCandidates(),
    error,
  };
}

function getDirectorySummary(directoryPath) {
  try {
    const stats = fs.statSync(directoryPath);

    if (!stats.isDirectory()) {
      return { path: directoryPath, exists: true, isDirectory: false, entries: [] };
    }

    return {
      path: directoryPath,
      exists: true,
      isDirectory: true,
      entries: fs.readdirSync(directoryPath, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      })),
    };
  } catch (summaryError) {
    return {
      path: directoryPath,
      exists: false,
      isDirectory: false,
      entries: [],
      error: summaryError.message,
    };
  }
}

function findDesktopUpdateCandidates() {
  const startPaths = Array.from(
    new Set([
      process.cwd(),
      __dirname,
      path.dirname(__dirname),
      path.dirname(dbPath),
      path.dirname(path.dirname(dbPath)),
      path.join(process.cwd(), 'data'),
      path.join(__dirname, 'data'),
      path.join(path.dirname(__dirname), 'data'),
    ])
  );
  const found = [];
  const visited = new Set();
  const maxDepth = 4;
  const maxFound = 30;

  function walk(directoryPath, depth) {
    const resolvedPath = path.resolve(directoryPath);

    if (visited.has(resolvedPath) || found.length >= maxFound) return;
    visited.add(resolvedPath);

    let entries;

    try {
      entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
    } catch {
      return;
    }

    const hasUpdateYml = entries.some(
      (entry) =>
        entry.isFile() && ['latest.yml', 'beta.yml', 'alpha.yml', 'dev.yml'].includes(entry.name)
    );
    const hasDesktopUpdatesDir = entries.some(
      (entry) => entry.isDirectory() && entry.name === 'desktop-updates'
    );

    if (hasUpdateYml || hasDesktopUpdatesDir || path.basename(resolvedPath) === 'desktop-updates') {
      found.push(getDirectorySummary(resolvedPath));
    }

    if (depth >= maxDepth) return;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(path.join(resolvedPath, entry.name), depth + 1);
      if (found.length >= maxFound) return;
    }
  }

  for (const startPath of startPaths) {
    walk(startPath, 0);
  }

  return found;
}

function sendDesktopUpdatesDebug(req, res) {
  const debugToken = process.env.DESKTOP_UPDATES_DEBUG_TOKEN;

  if (!debugToken) {
    sendJson(req, res, 404, { ok: false, message: 'Not found.' });
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);

  if (requestUrl.searchParams.get('token') !== debugToken) {
    sendJson(req, res, 403, { ok: false, message: 'Forbidden.' });
    return;
  }

  sendJson(req, res, 200, {
    ok: true,
    ...getDesktopUpdatesDebugInfo(),
  });
}

function sendDesktopUpdateFile(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  const relativePath = decodeURIComponent(
    requestUrl.pathname.replace(/^\/desktop-updates\/?/, '')
  );

  if (!relativePath) {
    sendJson(req, res, 404, { ok: false, message: 'Update file not found.' });
    return;
  }

  const updatesRoot = path.resolve(DESKTOP_UPDATES_DIR);
  const filePath = path.resolve(updatesRoot, relativePath);

  if (!filePath.startsWith(`${updatesRoot}${path.sep}`)) {
    sendJson(req, res, 403, { ok: false, message: 'Invalid update file path.' });
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      sendJson(req, res, 404, { ok: false, message: 'Update file not found.' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': getContentType(filePath),
      'Content-Length': stats.size,
      'Cache-Control': relativePath.endsWith('.yml') ? 'no-cache' : 'public, max-age=31536000',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RPC_BODY_BYTES) {
      reject(Object.assign(new Error('Request body is too large.'), { statusCode: 413 }));
      req.resume();
      return;
    }

    const chunks = [];
    let bodyBytes = 0;
    let bodyTooLarge = false;
    req.on('data', (chunk) => {
      if (bodyTooLarge) {
        return;
      }

      bodyBytes += chunk.length;
      if (bodyBytes > MAX_RPC_BODY_BYTES) {
        bodyTooLarge = true;
        chunks.length = 0;
        reject(
          Object.assign(new Error(
            `Request body is too large. Import files must stay under ${Math.floor(
              MAX_RPC_BODY_BYTES / 1024 / 1024
            )} MB.`
          ), { statusCode: 413 })
        );
        return;
      }

      chunks.push(chunk);
    });
    req.on('end', () => {
      if (bodyTooLarge) {
        return;
      }

      const body = Buffer.concat(chunks).toString('utf8');
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body.'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sanitizeImportStatus(status) {
  const value = String(status || '').trim().toUpperCase();

  switch (value) {
    case 'CURRENT':
    case 'REPEATING':
      return 'watching';
    case 'PLANNING':
      return 'planned';
    case 'COMPLETED':
      return 'completed';
    case 'PAUSED':
      return 'paused';
    case 'DROPPED':
      return 'dropped';
    default:
      return null;
  }
}

function sanitizeStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  return IMPORT_STATUS_ORDER.includes(value) ? value : 'planned';
}

function mapAniListDate(date) {
  if (!date?.year) {
    return null;
  }

  const month = String(date.month || 1).padStart(2, '0');
  const day = String(date.day || 1).padStart(2, '0');
  return `${date.year}-${month}-${day}`;
}

function buildAniListImportPreview(collection, mediaType = 'ANIME') {
  const normalizedMediaType = mediaType === 'MANGA' ? 'MANGA' : 'ANIME';
  const lists = Array.isArray(collection?.lists) ? collection.lists : [];
  const grouped = {
    watching: [],
    planned: [],
    completed: [],
    paused: [],
    dropped: [],
  };

  for (const list of lists) {
    for (const entry of list?.entries || []) {
      const media = entry?.media;
      const status = sanitizeImportStatus(entry?.status);

      if (!media?.id || !status || !grouped[status]) {
        continue;
      }

      grouped[status].push({
        animeId: media.id,
        mangaId: normalizedMediaType === 'MANGA' ? media.id : undefined,
        mediaId: media.id,
        mediaType: normalizedMediaType,
        providerUpdatedAt: entry.updatedAt ?? null,
        status,
        progress: entry.progress ?? 0,
        score: entry.score ?? null,
        notes: entry.notes ?? null,
        startedAt: mapAniListDate(entry.startedAt),
        completedAt: mapAniListDate(entry.completedAt),
        repeatCount: entry.repeat ?? 0,
        title: {
          romaji: media.title?.romaji ?? null,
          english: media.title?.english ?? null,
          native: media.title?.native ?? null,
          userPreferred: media.title?.userPreferred ?? null,
        },
        coverImage: { large: media.coverImage?.large ?? null },
        episodes: media.episodes ?? null,
        chapters: media.chapters ?? null,
        volumes: media.volumes ?? null,
        volumeProgress: entry.progressVolumes ?? 0,
        format: media.format ?? null,
        season: media.season ?? null,
        seasonYear: media.seasonYear ?? null,
        media,
      });
    }
  }

  return {
    totalFound: Object.values(grouped).reduce((sum, items) => sum + items.length, 0),
    groups: IMPORT_STATUS_ORDER.map((status) => ({
      status,
      mediaType: normalizedMediaType,
      items: grouped[status],
    })),
  };
}

function combineAniListImportPreviews(animeCollection, mangaCollection) {
  const animePreview = buildAniListImportPreview(animeCollection, 'ANIME');
  const mangaPreview = buildAniListImportPreview(mangaCollection, 'MANGA');
  return {
    totalFound: animePreview.totalFound + mangaPreview.totalFound,
    animeFound: animePreview.totalFound,
    mangaFound: mangaPreview.totalFound,
    groups: [...animePreview.groups, ...mangaPreview.groups].filter(
      (group) => group.items.length > 0
    ),
  };
}

function splitSelectedMediaKeys(selectedMediaKeys) {
  const animeIds = [];
  const mangaIds = [];
  for (const key of Array.isArray(selectedMediaKeys) ? selectedMediaKeys : []) {
    const match = /^(ANIME|MANGA):(\d+)$/.exec(String(key));
    if (!match) continue;
    const id = Number(match[2]);
    if (match[1] === 'MANGA') mangaIds.push(id);
    else animeIds.push(id);
  }
  return { animeIds, mangaIds };
}

function combineMalImportPreviews(animePreview, mangaPreview) {
  return {
    totalFound: (animePreview?.totalFound || 0) + (mangaPreview?.totalFound || 0),
    animeFound: animePreview?.totalFound || 0,
    mangaFound: mangaPreview?.totalFound || 0,
    skipped: (animePreview?.skipped || 0) + (mangaPreview?.skipped || 0),
    mappingFailures: [
      ...(animePreview?.mappingFailures || []),
      ...(mangaPreview?.mappingFailures || []),
    ],
    groups: [...(animePreview?.groups || []), ...(mangaPreview?.groups || [])].filter(
      (group) => group.items.length > 0
    ),
  };
}

function filterLocalMangaImportEntries(
  entries,
  selectedStatuses = [],
  selectedMangaIds = [],
  selectionProvided = false
) {
  const allowedStatuses = new Set(
    (Array.isArray(selectedStatuses) ? selectedStatuses : []).map((status) => sanitizeStatus(status))
  );
  const allowedMangaIds = new Set((selectedMangaIds || []).map(Number));
  return (entries || []).filter((item) => {
    const statusMatches =
      !allowedStatuses.size || allowedStatuses.has(sanitizeStatus(item.status));
    const idMatches =
      (!selectionProvided && !allowedMangaIds.size) ||
      allowedMangaIds.has(Number(item.mangaId));
    return statusMatches && idMatches;
  });
}

function buildAniListMangaPullEntries(collection) {
  const entries = [];
  for (const list of Array.isArray(collection?.lists) ? collection.lists : []) {
    for (const entry of list?.entries || []) {
      const media = entry?.media;
      const status = sanitizeImportStatus(entry?.status);
      if (!media?.id || !status) continue;
      entries.push({
        mangaId: media.id,
        mediaType: 'MANGA',
        providerUpdatedAt: entry.updatedAt ?? null,
        status,
        progress: entry.progress ?? 0,
        volumeProgress: entry.progressVolumes ?? 0,
        score: entry.score ?? null,
        notes: entry.notes ?? null,
        startedAt: mapAniListDate(entry.startedAt),
        completedAt: mapAniListDate(entry.completedAt),
        repeatCount: entry.repeat ?? 0,
        isRereading: String(entry.status || '').toUpperCase() === 'REPEATING',
        title: media.title,
        coverImage: media.coverImage,
        chapters: media.chapters ?? null,
        volumes: media.volumes ?? null,
        format: media.format ?? null,
        media,
      });
    }
  }
  return entries;
}

function buildLocalImportResult(
  preview,
  selectedStatuses = [],
  selectedAnimeIds = [],
  sourceUsername,
  selectionProvided = false
) {
  const allowedStatuses = new Set(
    (Array.isArray(selectedStatuses) ? selectedStatuses : []).map((status) =>
      sanitizeStatus(status)
    )
  );
  const allowedAnimeIds = new Set(
    (Array.isArray(selectedAnimeIds) ? selectedAnimeIds : [])
      .map((animeId) => Number(animeId))
      .filter((animeId) => Number.isInteger(animeId) && animeId > 0)
  );
  const hasStatusFilter = allowedStatuses.size > 0;
  const hasAnimeFilter = selectionProvided || allowedAnimeIds.size > 0;
  const localEntries = [];
  let skipped = 0;

  for (const group of preview.groups || []) {
    const status = sanitizeStatus(group.status);

    for (const item of group.items || []) {
      const animeId = Number(item?.animeId);

      if (
        !Number.isInteger(animeId) ||
        animeId <= 0 ||
        (hasStatusFilter && !allowedStatuses.has(status)) ||
        (hasAnimeFilter && !allowedAnimeIds.has(animeId))
      ) {
        skipped += 1;
        continue;
      }

      localEntries.push({ ...item, status });
    }
  }

  return {
    ok: true,
    message: `Imported ${localEntries.length} entr${localEntries.length === 1 ? 'y' : 'ies'}.`,
    localEntries,
    summary: {
      sourceUsername,
      totalFound: preview.totalFound ?? localEntries.length + skipped,
      selectedStatuses: Array.from(allowedStatuses),
      selectedAnimeIds: Array.from(allowedAnimeIds),
      imported: localEntries.length,
      created: localEntries.length,
      updated: 0,
      skipped,
    },
  };
}

function buildLocalMangaImportEntries(collection, selectedStatuses = [], selectedMangaIds = [], selectionProvided = false) {
  const allowedStatuses = new Set(
    (Array.isArray(selectedStatuses) ? selectedStatuses : []).map((status) => sanitizeStatus(status))
  );
  const allowedMangaIds = new Set(
    (Array.isArray(selectedMangaIds) ? selectedMangaIds : [])
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0)
  );
  return buildAniListMangaPullEntries(collection).filter((item) => {
    const statusMatches =
      !allowedStatuses.size || allowedStatuses.has(sanitizeStatus(item.status));
    const idMatches =
      (!selectionProvided && !allowedMangaIds.size) ||
      allowedMangaIds.has(Number(item.mangaId));
    return statusMatches && idMatches;
  });
}

async function importAuthenticatedAniListList(accessToken, viewer) {
  const [animeCollection, mangaCollection] = await Promise.all([
    anilist.getViewerAnimeCollection(accessToken, viewer.id),
    anilist.getViewerMangaCollection(accessToken, viewer.id),
  ]);
  const preview = buildAniListImportPreview(animeCollection);
  const result = buildLocalImportResult(preview, IMPORT_STATUS_ORDER, [], viewer.name);
  const localMangaEntries = buildAniListMangaPullEntries(mangaCollection);
  const combinedResult = {
    ...result,
    localMangaEntries,
    message: `Prepared ${result.localEntries?.length || 0} Anime and ${
      localMangaEntries.length
    } Manga entries from AniList.`,
    summary: {
      ...(result.summary || {}),
      totalFound: (result.summary?.totalFound || 0) + localMangaEntries.length,
      imported: (result.summary?.imported || 0) + localMangaEntries.length,
      mangaFound: localMangaEntries.length,
    },
  };

  if (combinedResult.ok) {
    updateAniListAccountImportTime(viewer.id);
  }

  return combinedResult;
}

async function importAuthenticatedMalList(accessToken, viewer, userId) {
  const [animeList, mangaList] = await Promise.all([
    mal.getViewerAnimeList(accessToken),
    mal.getViewerMangaList(accessToken),
  ]);
  const animeResult = await previewMalImport(animeList, {
    submittedByUserId: userId,
  });
  const mangaResult = await previewMalMangaPull(mangaList, {
    submittedByUserId: userId,
  });
  const importResult = buildLocalImportResult(
    animeResult.preview,
    IMPORT_STATUS_ORDER,
    [],
    animeResult.username || viewer.name
  );
  const localMangaEntries = mangaResult.localMangaEntries || [];
  const mappingFailures = [
    ...(animeResult.preview?.mappingFailures || []).map((failure) => ({
      ...failure,
      mediaType: 'ANIME',
    })),
    ...(mangaResult.mappingFailures || []).map((failure) => ({
      ...failure,
      mediaType: 'MANGA',
    })),
  ];
  const skipped = Number(animeResult.preview?.skipped || 0) + Number(mangaResult.skipped || 0);
  const imported = importResult.localEntries.length + localMangaEntries.length;
  const result = {
    ...importResult,
    ok: true,
    partial: skipped > 0,
    message: `Imported ${imported} Anime and Manga entr${
      imported === 1 ? 'y' : 'ies'
    } from MyAnimeList.${
      skipped > 0
        ? ` ${skipped} remote entr${skipped === 1 ? 'y was' : 'ies were'} skipped because no safe AniList match was found.`
        : ''
    }`,
    localMangaEntries,
    summary: {
      ...(importResult.summary || {}),
      sourceUsername: animeResult.username || viewer.name,
      totalFound: Number(importResult.summary?.totalFound || 0) + localMangaEntries.length,
      imported,
      created: imported,
      mangaFound: localMangaEntries.length,
      mangaMapped: mangaResult.mapped,
      mangaUnmapped: mangaResult.skipped,
      animeUnmapped: Number(animeResult.preview?.skipped || 0),
      mappingFailures,
    },
  };

  updateMalAccountImportTime(viewer.id);
  return result;
}

async function finishAniListLogin({ accessToken, viewer, userId, res, deferImport = false }) {
  deleteAniListAccountByUserId(userId);
  deleteMalAccountByUserId(userId);

  upsertAniListAccount({
    userId,
    anilistUserId: viewer.id,
    anilistUsername: viewer.name,
    originalAniListUsername: viewer.name,
    accessToken,
  });

  const loginResult = loginUserById(userId);

  if (!loginResult.ok) {
    return loginResult;
  }

  if (res) {
    createWebSession(res, userId);
  }

  if (deferImport) {
    return {
      ok: true,
      message: 'Logged in with AniList. Your Anime and Manga lists are loading in the background.',
      user: loginResult.user,
      importPending: true,
    };
  }

  let importResult;

  try {
    importResult = await importAuthenticatedAniListList(accessToken, viewer);
  } catch (error) {
    console.error('AniList authenticated import error:', error);
    importResult = {
      ok: false,
      message: error.message || 'Failed to import AniList list.',
    };
  }

  return {
    ok: true,
    message: importResult.ok
      ? 'Logged in with AniList and imported your Anime and Manga lists.'
      : 'Logged in with AniList, but list import failed.',
    user: loginResult.user,
    import: importResult,
  };
}

async function linkAniListToUser({ accessToken, viewer, userId }) {
  if (getMalAccountByUserId(userId)) {
    return {
      ok: false,
      linked: false,
      message: 'Unlink MyAnimeList before linking AniList. Seenary supports one sync provider at a time.',
    };
  }
  deleteAniListAccountByUserId(userId);
  upsertAniListAccount({
    userId,
    anilistUserId: viewer.id,
    anilistUsername: viewer.name,
    originalAniListUsername: viewer.name,
    accessToken,
  });

  const importResult = await importAuthenticatedAniListList(accessToken, viewer).catch((error) => {
    console.error('AniList link import error:', error);
    return {
      ok: false,
      message: error.message || 'Failed to import AniList list.',
    };
  });

  const account = getAniListAccountByUserId(userId);

  return {
    ok: true,
    linked: true,
    message: importResult.ok
      ? `Linked AniList account ${viewer.name} and imported your Anime and Manga lists.`
      : `Linked AniList account ${viewer.name}, but list import failed.`,
    account: account
      ? buildAniListAccountPayload(account)
      : {
          anilistUserId: viewer.id,
          anilistUsername: viewer.name,
          originalAniListUsername: viewer.name,
          lastImportAt: importResult.ok ? new Date().toISOString() : null,
          updatedAt: new Date().toISOString(),
        },
    import: importResult,
  };
}

async function handleAniListLoginCallback(flow, accessToken, viewer) {
  if (!viewer?.id || !viewer?.name) {
    return { ok: false, message: 'AniList did not return account details.' };
  }

  const linkedAccount = getAniListAccountByAniListUserId(viewer.id);

  if (linkedAccount?.user_id) {
    pendingAniListSignupByFlowId.delete(flow.id);
    return await finishAniListLogin({
      accessToken,
      viewer,
      userId: linkedAccount.user_id,
      deferImport: true,
    });
  }

  pendingAniListSignupByFlowId.set(flow.id, {
    accessToken,
    viewer,
    createdAt: Date.now(),
  });

  return {
    ok: true,
    needsProfile: true,
    message: 'AniList account verified. Choose your local display name.',
    anilist: {
      id: viewer.id,
      username: viewer.name,
    },
    suggestedUsername: viewer.name,
  };
}

async function handleAniListLinkCallback(flow, accessToken, viewer) {
  if (!flow.userId) {
    return { ok: false, linked: false, message: 'AniList link session expired. Try linking again.' };
  }

  const sessionUser = getSafeUserById(flow.userId);

  if (!sessionUser) {
    return { ok: false, linked: false, message: 'You must be logged in.', };
  }

  if (!viewer?.id || !viewer?.name) {
    return { ok: false, linked: false, message: 'AniList did not return account details.' };
  }

  const existingLinkedAccount = getAniListAccountByAniListUserId(viewer.id);

  if (
    existingLinkedAccount?.user_id &&
    Number(existingLinkedAccount.user_id) !== Number(flow.userId)
  ) {
    const existingUser = getSafeUserById(existingLinkedAccount.user_id);

    pendingAniListLinkConflictByUserId.set(Number(flow.userId), {
      accessToken,
      viewer,
      sourceUserId: Number(existingLinkedAccount.user_id),
      targetUserId: Number(flow.userId),
      createdAt: Date.now(),
    });

    return {
      ok: true,
      message: `AniList account ${viewer.name} is already linked to another local account.`,
      linked: false,
      needsConflictResolution: true,
      conflict: {
        anilistUserId: viewer.id,
        anilistUsername: viewer.name,
        sourceUser: existingUser
          ? {
              id: existingUser.id,
              username: existingUser.username,
            }
          : null,
        targetUser: {
          id: sessionUser.id,
          username: sessionUser.username,
        },
      },
    };
  }

  pendingAniListLinkConflictByUserId.delete(Number(flow.userId));

  return await linkAniListToUser({
    accessToken,
    viewer,
    userId: flow.userId,
  });
}

async function finishMalLogin({ tokenData, viewer, userId, res, deferImport = false }) {
  deleteAniListAccountByUserId(userId);
  deleteMalAccountByUserId(userId);

  upsertMalAccount({
    userId,
    malUserId: viewer.id,
    malUsername: viewer.name,
    originalMalUsername: viewer.name,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    tokenExpiresAt: getMalTokenExpiry(tokenData),
  });

  const loginResult = loginUserById(userId);

  if (!loginResult.ok) {
    return loginResult;
  }

  if (res) {
    createWebSession(res, userId);
  }

  if (deferImport) {
    return {
      ok: true,
      message: 'Logged in with MyAnimeList. Your Anime and Manga lists are loading in the background.',
      user: loginResult.user,
      importPending: true,
    };
  }

  let importResult;

  try {
    importResult = await importAuthenticatedMalList(
      tokenData.access_token,
      viewer,
      userId
    );
  } catch (error) {
    console.error('MyAnimeList authenticated import error:', error);
    importResult = {
      ok: false,
      message: error.message || 'Failed to import MyAnimeList lists.',
    };
  }

  return {
    ok: true,
    message: importResult.ok
      ? 'Logged in with MyAnimeList and imported your Anime and Manga lists.'
      : 'Logged in with MyAnimeList, but list import failed.',
    user: loginResult.user,
    import: importResult,
  };
}

async function linkMalToUser({ tokenData, viewer, userId, deferImport = false }) {
  if (getAniListAccountByUserId(userId)) {
    return {
      ok: false,
      linked: false,
      message: 'Unlink AniList before linking MyAnimeList. Seenary supports one sync provider at a time.',
    };
  }
  deleteMalAccountByUserId(userId);

  upsertMalAccount({
    userId,
    malUserId: viewer.id,
    malUsername: viewer.name,
    originalMalUsername: viewer.name,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    tokenExpiresAt: getMalTokenExpiry(tokenData),
  });

  if (deferImport) {
    return {
      ok: true,
      linked: true,
      importPending: true,
      message: `Linked MyAnimeList account ${viewer.name}. Your Anime and Manga lists are loading in the background.`,
      account: buildMalAccountPayload(getMalAccountByUserId(userId)),
    };
  }

  const importResult = await importAuthenticatedMalList(
    tokenData.access_token,
    viewer,
    userId
  ).catch((error) => {
    console.error('MyAnimeList link import error:', error);
    return {
      ok: false,
      message: error.message || 'Failed to import MyAnimeList lists.',
    };
  });

  const account = getMalAccountByUserId(userId);

  return {
    ok: true,
    linked: true,
    message: importResult.ok
      ? `Linked MyAnimeList account ${viewer.name} and imported your Anime and Manga lists.`
      : `Linked MyAnimeList account ${viewer.name}, but list import failed.`,
    account: account
      ? buildMalAccountPayload(account)
      : {
          malUserId: viewer.id,
          malUsername: viewer.name,
          originalMalUsername: viewer.name,
          lastImportAt: null,
          updatedAt: new Date().toISOString(),
        },
    import: importResult,
  };
}

async function handleMalLoginCallback(flow, tokenData, viewer) {
  if (!viewer?.id || !viewer?.name) {
    return { ok: false, message: 'MyAnimeList did not return account details.' };
  }

  const linkedAccount = getMalAccountByMalUserId(viewer.id);

  if (linkedAccount?.user_id) {
    pendingMalSignupByFlowId.delete(flow.id);
    return await finishMalLogin({
      tokenData,
      viewer,
      userId: linkedAccount.user_id,
      deferImport: true,
    });
  }

  pendingMalSignupByFlowId.set(flow.id, {
    tokenData,
    viewer,
    createdAt: Date.now(),
  });

  return {
    ok: true,
    needsProfile: true,
    message: 'MyAnimeList account verified. Choose your local display name.',
    mal: {
      id: viewer.id,
      username: viewer.name,
    },
    suggestedUsername: viewer.name,
  };
}

async function handleMalLinkCallback(flow, tokenData, viewer) {
  if (!flow.userId) {
    return { ok: false, linked: false, message: 'MyAnimeList link session expired. Try linking again.' };
  }

  const sessionUser = getSafeUserById(flow.userId);

  if (!sessionUser) {
    return { ok: false, linked: false, message: 'You must be logged in.' };
  }

  if (!viewer?.id || !viewer?.name) {
    return { ok: false, linked: false, message: 'MyAnimeList did not return account details.' };
  }

  const existingLinkedAccount = getMalAccountByMalUserId(viewer.id);

  if (
    existingLinkedAccount?.user_id &&
    Number(existingLinkedAccount.user_id) !== Number(flow.userId)
  ) {
    const existingUser = getSafeUserById(existingLinkedAccount.user_id);

    pendingMalLinkConflictByUserId.set(Number(flow.userId), {
      tokenData,
      viewer,
      sourceUserId: Number(existingLinkedAccount.user_id),
      targetUserId: Number(flow.userId),
      createdAt: Date.now(),
    });

    return {
      ok: true,
      message: `MyAnimeList account ${viewer.name} is already linked to another local account.`,
      linked: false,
      needsConflictResolution: true,
      conflict: {
        malUserId: viewer.id,
        malUsername: viewer.name,
        sourceUser: existingUser
          ? {
              id: existingUser.id,
              username: existingUser.username,
            }
          : null,
        targetUser: {
          id: sessionUser.id,
          username: sessionUser.username,
        },
      },
    };
  }

  pendingMalLinkConflictByUserId.delete(Number(flow.userId));

  return await linkMalToUser({
    tokenData,
    viewer,
    userId: flow.userId,
    deferImport: true,
  });
}

async function fetchAnimeDetailsFromAniList(id) {
  const media = await anilist.getAnimeDetails
    ? await anilist.getAnimeDetails(id, { includeFranchiseStartDate: false })
    : await fetchAnimeDetailsFallback(id);
  return media;
}

async function prepareMalImportData({ username, userId, accessToken = null, job = null }) {
  const isCancelled = () => Boolean(job?.isCancelled());
  const report = (progress) => job?.report(progress);
  report({ stage: 'fetching', current: 0, total: null, label: 'Fetching MyAnimeList lists...' });
  const listOptions = {
    accessToken,
    isCancelled,
    onProgress: ({ current, mediaType }) =>
      report({
        stage: 'fetching',
        current,
        total: null,
        label: `Fetching MyAnimeList ${mediaType === 'MANGA' ? 'Manga' : 'Anime'}...`,
      }),
  };
  const [animeList, mangaList] = await Promise.all([
    mal.getUserAnimeList(username, listOptions),
    mal.getUserMangaList(username, listOptions),
  ]);
  job?.throwIfCancelled();
  const animeCount = animeList.data?.length || 0;
  const mangaCount = mangaList.data?.length || 0;
  const total = animeCount + mangaCount;
  report({ stage: 'mapping', current: 0, total, label: 'Matching MyAnimeList entries...' });
  const animeResult = await previewMalImport(animeList, {
    submittedByUserId: userId,
    isCancelled,
    onProgress: ({ current, entryTitle }) =>
      report({
        stage: 'mapping',
        current,
        total,
        label: `Matching Anime ${current} of ${animeCount}: ${entryTitle}`,
      }),
  });
  job?.throwIfCancelled();
  const mangaResult = await previewMalMangaPull(mangaList, {
    isCancelled,
    onProgress: ({ current, entryTitle }) =>
      report({
        stage: 'mapping',
        current: animeCount + current,
        total,
        label: `Matching Manga ${current} of ${mangaCount}: ${entryTitle}`,
      }),
  });
  job?.throwIfCancelled();
  return { animeList, mangaList, animeResult, mangaResult, total };
}

function buildMalPullResponse(data, linkedAccount) {
  const { animeResult, mangaResult } = data;
  const importResult = buildLocalImportResult(
    animeResult.preview,
    IMPORT_STATUS_ORDER,
    [],
    animeResult.username || linkedAccount?.mal_username || 'MyAnimeList'
  );
  const pullSucceeded = importResult.ok || mangaResult.localMangaEntries.length > 0;
  const mappingFailures = [
    ...(animeResult.preview?.mappingFailures || []).map((failure) => ({
      ...failure,
      mediaType: 'ANIME',
    })),
    ...(mangaResult.mappingFailures || []).map((failure) => ({
      ...failure,
      mediaType: 'MANGA',
    })),
  ];
  const unmappedCount = Number(animeResult.preview?.skipped || 0) + mangaResult.skipped;
  const failedTitles = mappingFailures.map((failure) => failure?.title).filter(Boolean);
  const failedTitleLabel = failedTitles.length
    ? ` (${failedTitles.slice(0, 3).join(', ')}${failedTitles.length > 3 ? ', ...' : ''})`
    : '';
  if (pullSucceeded && linkedAccount?.mal_user_id) {
    updateMalAccountImportTime(linkedAccount.mal_user_id);
  }
  return {
    ...importResult,
    ok: pullSucceeded,
    partial: unmappedCount > 0,
    message: pullSucceeded
      ? `Updated Anime and Manga from MyAnimeList.${
          unmappedCount > 0
            ? ` ${unmappedCount} remote entr${unmappedCount === 1 ? 'y' : 'ies'}${
                failedTitleLabel
              } could not be mapped one-to-one and ${unmappedCount === 1 ? 'was' : 'were'} skipped.`
            : ''
        }`
      : importResult.message,
    localMangaEntries: mangaResult.localMangaEntries,
    summary: {
      ...(importResult.summary || {}),
      totalFound:
        (importResult.summary?.totalFound || 0) + mangaResult.localMangaEntries.length,
      mangaFound: mangaResult.localMangaEntries.length,
      mangaMapped: mangaResult.mapped,
      mangaUnmapped: mangaResult.skipped,
      animeUnmapped: Number(animeResult.preview?.skipped || 0),
      mappingFailures,
    },
  };
}

async function pullFromMalForUser(userId, job = null) {
  let linkedAccount = null;
  const data = await withFreshMalAccount(userId, async (account) => {
    if (!account?.access_token) {
      throw new Error('Link a MyAnimeList account before updating from MyAnimeList.');
    }
    linkedAccount = account;
    return await prepareMalImportData({
      username: '@me',
      userId,
      accessToken: account.access_token,
      job,
    });
  });
  return buildMalPullResponse(data, linkedAccount);
}

function hasCachedStudioIds(value) {
  try {
    const studios = JSON.parse(value || '[]');
    return (
      !studios.length ||
      studios.every(
        (studio) =>
          studio &&
          typeof studio === 'object' &&
          Number.isInteger(Number(studio.id)) &&
          Number(studio.id) > 0
      )
    );
  } catch {
    return false;
  }
}

function hasUsableAnimeDetailsCache(row) {
  if (!row || row.is_adult === null || row.is_adult === undefined) return false;
  if (!hasCachedStudioIds(row.studios)) return false;

  const hasFullDetails =
    Boolean(row.site_url) ||
    Boolean(row.description) ||
    Boolean(row.trailer_id) ||
    Boolean(row.external_links && row.external_links !== '[]') ||
    Boolean(row.relations && row.relations !== '[]') ||
    Boolean(row.recommendations && row.recommendations !== '[]');

  return hasFullDetails;
}

function isFreshCacheDate(value, ttlMs) {
  const cachedAt = Date.parse(value);
  return Number.isFinite(cachedAt) && Date.now() - cachedAt < ttlMs;
}

function hasFreshAnimeDetailsCache(row) {
  return hasUsableAnimeDetailsCache(row) && isFreshCacheDate(row.cached_at, MEDIA_DETAILS_CACHE_TTL_MS);
}

function hasFreshMangaDetailsCache(row) {
  return Boolean(row?.details) && isFreshCacheDate(row.cached_at, MEDIA_DETAILS_CACHE_TTL_MS);
}

async function getAnimeDetails(id) {
  const cachedAnime = getAnimeById(id);

  if (hasFreshAnimeDetailsCache(cachedAnime)) {
    return mapDbAnimeForFrontend(cachedAnime);
  }

  try {
    const media = await fetchAnimeDetailsFromAniList(id);
    if (media?.id) saveAnime(mapAnimeForDb(media));
    return media;
  } catch (error) {
    if (cachedAnime) {
      console.warn(`AniList anime details unavailable for ${id}; serving stale cached data.`);
      return mapDbAnimeForFrontend(cachedAnime);
    }
    error.statusCode = Number(error.statusCode || error.status) || 503;
    error.publicMessage = 'AniList is unavailable and no cached anime details are available.';
    throw error;
  }
}

async function calculateAnimeFranchiseStartDate(id) {
  const cachedAnime = getAnimeById(id);
  if (cachedAnime?.franchise_start_resolved && cachedAnime.franchise_start_date) {
    return mapDbAnimeForFrontend(cachedAnime).franchiseStartDate;
  }

  let media = cachedAnime ? mapDbAnimeForFrontend(cachedAnime) : null;
  if (!media) {
    media = await fetchAnimeDetailsFromAniList(id);
    if (media?.id) saveAnime(mapAnimeForDb(media));
  }

  const franchiseStartDate = await anilist.findAnimeSeriesStartDate(media);
  if (!franchiseStartDate?.year) {
    throw new Error('AniList did not provide enough dates to calculate the franchise age.');
  }

  updateAnimeFranchiseStartDate(id, franchiseStartDate);
  return franchiseStartDate;
}

function getAnimeFranchiseStartDate(id) {
  const animeId = Number(id);
  if (!Number.isInteger(animeId) || animeId <= 0) {
    throw new Error('A valid anime ID is required.');
  }

  const existingRequest = franchiseStartDateRequests.get(animeId);
  if (existingRequest) return existingRequest;

  const request = calculateAnimeFranchiseStartDate(animeId).finally(() => {
    franchiseStartDateRequests.delete(animeId);
  });
  franchiseStartDateRequests.set(animeId, request);
  return request;
}

async function getMangaDetails(id) {
  const cachedManga = getMangaById(id);

  if (hasFreshMangaDetailsCache(cachedManga)) {
    return cachedManga.details;
  }

  try {
    const media = await anilist.getMangaDetails(id);
    if (media?.id) saveManga(media);
    return media;
  } catch (error) {
    if (cachedManga?.details) {
      console.warn(`AniList manga details unavailable for ${id}; serving stale cached data.`);
      return cachedManga.details;
    }
    error.statusCode = Number(error.statusCode || error.status) || 503;
    error.publicMessage = 'AniList is unavailable and no cached manga details are available.';
    throw error;
  }
}

function hasFreshPersonDetailsCache(row) {
  if (!row?.details) return false;

  const cachedAt = Date.parse(row.cachedAt);
  return Number.isFinite(cachedAt) && Date.now() - cachedAt < PERSON_DETAILS_CACHE_TTL_MS;
}

async function getCachedPersonDetails(kind, id) {
  const cachedDetails = getPersonDetails(kind, id);

  if (hasFreshPersonDetailsCache(cachedDetails)) {
    return cachedDetails.details;
  }

  const details =
    kind === 'character'
      ? await anilist.getCharacterDetails(Number(id))
      : await anilist.getStaffDetails(Number(id));

  if (details?.id) {
    savePersonDetails(kind, details.id, details);
  }

  return details;
}

async function getCharacterDetails(id) {
  return await getCachedPersonDetails('character', id);
}

async function getStaffDetails(id) {
  return await getCachedPersonDetails('staff', id);
}

async function fetchAnimeDetailsFallback(id) {
  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        isAdult
        title { romaji english native userPreferred }
        coverImage { extraLarge large }
        bannerImage
        episodes
        format
        status
        season
        seasonYear
        averageScore
        meanScore
        popularity
        favourites
        duration
        source
        countryOfOrigin
        startDate { year month day }
        endDate { year month day }
        trailer { id site thumbnail }
        siteUrl
        description
        genres
        synonyms
        nextAiringEpisode { episode airingAt }
        studios { nodes { id name isAnimationStudio } }
        tags { id name description rank isMediaSpoiler isGeneralSpoiler }
        characters(perPage: 20) {
          edges {
            role
            node { id name { full native userPreferred } image { large } }
            voiceActors(language: JAPANESE) {
              id
              name { full native userPreferred }
              language
              image { large }
            }
          }
        }
        staff(perPage: 20) {
          edges {
            role
            node { id name { full native userPreferred } image { large } }
          }
        }
        relations {
          edges {
            relationType
            node {
              id
              type
              title { romaji english native userPreferred }
              coverImage { large }
              episodes
              format
              status
              season
              seasonYear
              averageScore
            }
          }
        }
        recommendations(perPage: 10) {
          nodes {
            rating
            mediaRecommendation {
              id
              title { romaji english native userPreferred }
              coverImage { large }
              description
              episodes
              format
              status
              season
              seasonYear
              averageScore
            }
          }
        }
        externalLinks {
          id
          url
          site
          siteId
          type
          language
          color
          icon
          notes
          isDisabled
        }
        streamingEpisodes { title thumbnail url site }
      }
    }
  `;

  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables: { id } }),
  });
  const data = await response.json();

  if (!response.ok || data.errors) {
    throw new Error(data.errors?.[0]?.message || `AniList request failed with status ${response.status}`);
  }

  return data.data.Media;
}

async function handleRpc(method, args, req, res) {
  const currentSession = getCurrentSession(req, res, {
    refresh: method !== 'getSession',
  });

  switch (method) {
    case 'getMediaDetails': {
      const mediaType = String(args[0] || '').toUpperCase();
      const mediaId = Number(args[1]);

      if (mediaType === 'ANIME') return await getAnimeDetails(mediaId);
      if (mediaType === 'MANGA') return await getMangaDetails(mediaId);
      throw new Error('Unsupported media type.');
    }
    case 'getAnimeFranchiseStartDate':
      return { franchiseStartDate: await getAnimeFranchiseStartDate(args[0]) };
    case 'searchMedia':
      return await searchOrchestrator.searchMedia(args[0], {
        hideAdultContent: args[1],
      });
    case 'getDiscoverMedia':
      return await anilist.getDiscoverMedia({ hideAdultContent: args[0] });
    case 'getDiscoverShelfAnime':
      return await anilist.getDiscoverShelfAnime({
        shelfId: args[0],
        page: args[1],
        hideAdultContent: args[2],
        mediaType: args[3],
      });
    case 'getStudioMedia':
      return await anilist.getStudioMedia(args[0], args[1], {
        hideAdultContent: args[2],
      });
    case 'getArtistMedia':
      return await searchOrchestrator.getArtistMedia(args[0], args[1], {
        hideAdultContent: args[2],
      });
    case 'getAnimeThemeMusic':
      return await animethemes.getAnimeThemeMusic(args[0], args[1]);
    case 'previewAniListImport': {
      const username = String(args[0] || '').trim();
      if (!username) return { ok: false, message: 'Enter an AniList username first.' };
      const [animeCollection, mangaCollection] = await Promise.all([
        anilist.getUserAnimeCollection(username),
        anilist.getUserMangaCollection(username),
      ]);
      const preview = combineAniListImportPreviews(animeCollection, mangaCollection);
      return preview.totalFound
        ? { ok: true, username, preview }
        : { ok: false, message: `No Anime or Manga list data was found for ${username}.` };
    }
    case 'importAniList': {
      const username = String(args[0] || '').trim();
      if (!username) return { ok: false, message: 'Enter an AniList username first.' };
      const [animeCollection, mangaCollection] = await Promise.all([
        anilist.getUserAnimeCollection(username),
        anilist.getUserMangaCollection(username),
      ]);
      const selection = splitSelectedMediaKeys(args[2]);
      const selectionProvided = Array.isArray(args[2]) && args[2].length > 0;
      const animePreview = buildAniListImportPreview(animeCollection, 'ANIME');
      const result = buildLocalImportResult(
        animePreview,
        args[1],
        selection.animeIds,
        username,
        selectionProvided
      );
      const localMangaEntries = buildLocalMangaImportEntries(
        mangaCollection,
        args[1],
        selection.mangaIds,
        selectionProvided
      );
      return {
        ...result,
        localMangaEntries,
        message: `Prepared ${(result.localEntries?.length || 0) + localMangaEntries.length} selected Anime and Manga entries from AniList.`,
        summary: {
          ...(result.summary || {}),
          totalFound: animePreview.totalFound + buildAniListMangaPullEntries(mangaCollection).length,
          imported: (result.localEntries?.length || 0) + localMangaEntries.length,
          selectedMediaKeys: args[2],
        },
      };
    }
    case 'startMalPreviewJob': {
      if (!currentSession.authenticated || !currentSession.user?.id) {
        return { ok: false, message: 'You must be logged in.' };
      }
      const username = String(args[0] || '').trim();
      if (!username) return { ok: false, message: 'Enter a MyAnimeList username first.' };
      const job = createMalJob({
        userId: currentSession.user.id,
        key: `preview:${username.toLowerCase()}`,
        run: async (context) => {
          const data = await prepareMalImportData({
            username,
            userId: currentSession.user.id,
            job: context,
          });
          const preview = combineMalImportPreviews(
            data.animeResult.preview,
            data.mangaResult.preview
          );
          if (!preview.totalFound) {
            const remoteTotal =
              (data.animeList.data?.length || 0) + (data.mangaList.data?.length || 0);
            throw new Error(
              remoteTotal
                ? `MyAnimeList returned ${remoteTotal} entries for ${username}, but none could be safely matched to AniList.`
                : `No public Anime or Manga list entries were found for ${username}.`
            );
          }
          return {
            ok: true,
            message: `Found ${preview.totalFound} matched MyAnimeList Anime and Manga entries.`,
            username,
            preview,
          };
        },
      });
      return { ok: true, jobId: job.id };
    }
    case 'startMalPullJob': {
      if (!currentSession.authenticated || !currentSession.user?.id) {
        return { ok: false, message: 'You must be logged in.' };
      }
      const job = createMalJob({
        userId: currentSession.user.id,
        key: 'pull',
        run: async (context) => await pullFromMalForUser(currentSession.user.id, context),
      });
      return { ok: true, jobId: job.id };
    }
    case 'getMalJob': {
      if (!currentSession.authenticated || !currentSession.user?.id) {
        return { ok: false, message: 'You must be logged in.' };
      }
      const job = getMalJob(args[0], currentSession.user.id);
      return job
        ? { ok: true, job: serializeMalJob(job) }
        : { ok: false, message: 'MyAnimeList operation was not found or has expired.' };
    }
    case 'cancelMalJob': {
      if (!currentSession.authenticated || !currentSession.user?.id) {
        return { ok: false, message: 'You must be logged in.' };
      }
      return cancelMalJob(args[0], currentSession.user.id)
        ? { ok: true, message: 'Cancellation requested.' }
        : { ok: false, message: 'MyAnimeList operation was not found or has expired.' };
    }
    case 'previewMalImport': {
      if (!currentSession.authenticated || !currentSession.user?.id) {
        return { ok: false, message: 'You must be logged in.' };
      }
      const username = String(args[0] || '').trim();
      if (!username) return { ok: false, message: 'Enter a MyAnimeList username first.' };
      const [animeList, mangaList] = await Promise.all([
        mal.getUserAnimeList(username),
        mal.getUserMangaList(username),
      ]);
      const animeResult = await previewMalImport(animeList, {
        submittedByUserId: currentSession.user.id,
      });
      const mangaResult = await previewMalMangaPull(mangaList);
      const preview = combineMalImportPreviews(animeResult.preview, mangaResult.preview);
      if (!preview.totalFound) {
        const remoteTotal = (animeList.data?.length || 0) + (mangaList.data?.length || 0);
        return {
          ok: false,
          message: remoteTotal
            ? `MyAnimeList returned ${remoteTotal} entries for ${username}, but none could be safely matched to AniList.`
            : `No public Anime or Manga list entries were found for ${username}.`,
        };
      }
      return {
        ok: true,
        message: `Found ${preview.totalFound} matched MyAnimeList Anime and Manga entries.`,
        username,
        preview,
      };
    }
    case 'importMal': {
      if (!currentSession.authenticated || !currentSession.user?.id) {
        return { ok: false, message: 'You must be logged in.' };
      }
      const username = String(args[0] || '').trim();
      if (!username) return { ok: false, message: 'Enter a MyAnimeList username first.' };
      const [animeList, mangaList] = await Promise.all([
        mal.getUserAnimeList(username),
        mal.getUserMangaList(username),
      ]);
      const animeResult = await previewMalImport(animeList, {
        submittedByUserId: currentSession.user.id,
      });
      const mangaResult = await previewMalMangaPull(mangaList);
      const selection = splitSelectedMediaKeys(args[2]);
      const selectionProvided = Array.isArray(args[2]) && args[2].length > 0;
      const importResult = buildLocalImportResult(
        animeResult.preview,
        args[1],
        selection.animeIds,
        username,
        selectionProvided
      );
      const localMangaEntries = filterLocalMangaImportEntries(
        mangaResult.localMangaEntries,
        args[1],
        selection.mangaIds,
        selectionProvided
      );
      const imported = (importResult.localEntries?.length || 0) + localMangaEntries.length;
      return {
        ...importResult,
        localMangaEntries,
        message: `Prepared ${imported} selected Anime and Manga entries from MyAnimeList.`,
        summary: {
          ...(importResult.summary || {}),
          totalFound: animeResult.preview.totalFound + mangaResult.preview.totalFound,
          imported,
          selectedMediaKeys: args[2],
          mappingFailures: [
            ...(animeResult.preview.mappingFailures || []),
            ...(mangaResult.mappingFailures || []),
          ],
          unmapped: (animeResult.preview.skipped || 0) + (mangaResult.skipped || 0),
        },
      };
    }
    case 'previewTextImport':
      return await previewTextImport(args[0], { hideAdultContent: args[1], mediaType: args[2] });
    case 'previewPdfImport':
      return await previewPdfImport(args[0], { hideAdultContent: args[1], mediaType: args[2] });
    case 'importTextList':
      return buildLocalImportResult(
        {
          totalFound: Array.isArray(args[0]) ? args[0].length : 0,
          groups: [
            {
              status: 'completed',
              items: Array.isArray(args[0]) ? args[0] : [],
            },
          ],
        },
        [],
        args[1],
        'Text file'
      );
    case 'getSettings':
      return DEFAULT_APP_SETTINGS;
    case 'updateSettings':
      return {
        ...DEFAULT_APP_SETTINGS,
        ...(args[0] && typeof args[0] === 'object' ? args[0] : {}),
      };
    case 'recordEngagement':
      if (!currentSession.authenticated || !currentSession.user?.id) {
        return { ok: false, recorded: false, message: 'You must be logged in.' };
      }
      return recordEngagement({
        userId: currentSession.user.id,
        platform: args[0]?.platform,
        appVersion: args[0]?.appVersion,
      });
    case 'getSyncStatus':
      return currentSession.authenticated
        ? getStatelessSyncStatus(currentSession.user.id, args[0], args[1])
        : { ok: false, message: 'You must be logged in.' };
    case 'setAutoSync':
      return currentSession.authenticated
        ? getStatelessSyncStatus(currentSession.user.id, args[1], args[0])
        : { ok: false, message: 'You must be logged in.' };
    case 'runSyncNow':
      return currentSession.authenticated
        ? await runStatelessSyncForUser(currentSession.user.id, args[0])
        : { ok: false, message: 'You must be logged in.' };
    case 'pullFromAniList': {
      if (!currentSession.authenticated) return { ok: false, message: 'You must be logged in.' };
      const linkedAccount = getAniListAccountByUserId(currentSession.user.id);
      if (!linkedAccount?.access_token || !linkedAccount?.anilist_user_id) {
        return { ok: false, message: 'Link an AniList account before updating from AniList.' };
      }
      const [animeCollection, mangaCollection] = await Promise.all([
        anilist.getViewerAnimeCollection(
          linkedAccount.access_token,
          linkedAccount.anilist_user_id
        ),
        anilist.getViewerMangaCollection(
          linkedAccount.access_token,
          linkedAccount.anilist_user_id
        ),
      ]);
      const preview = buildAniListImportPreview(animeCollection);
      const result = buildLocalImportResult(
        preview,
        IMPORT_STATUS_ORDER,
        [],
        linkedAccount.anilist_username
      );
      const localMangaEntries = buildAniListMangaPullEntries(mangaCollection);
      const pullSucceeded = result.ok || localMangaEntries.length > 0;
      if (pullSucceeded) updateAniListAccountImportTime(linkedAccount.anilist_user_id);
      return {
        ...result,
        ok: pullSucceeded,
        message: pullSucceeded
          ? 'Updated Anime and Manga from AniList.'
          : result.message,
        localMangaEntries,
        summary: {
          ...(result.summary || {}),
          totalFound: (result.summary?.totalFound || 0) + localMangaEntries.length,
          mangaFound: localMangaEntries.length,
        },
      };
    }
    case 'pullFromMal': {
      if (!currentSession.authenticated || !currentSession.user?.id) {
        return { ok: false, message: 'You must be logged in.' };
      }

      const linkedAccount = getMalAccountByUserId(currentSession.user.id);
      const lists = await withFreshMalAccount(currentSession.user.id, async (account) => {
        if (!account?.access_token) {
          throw new Error('Link a MyAnimeList account before updating from MyAnimeList.');
        }

        const [anime, manga] = await Promise.all([
          mal.getViewerAnimeList(account.access_token),
          mal.getViewerMangaList(account.access_token),
        ]);
        return { anime, manga };
      });
      const result = await previewMalImport(lists.anime, {
        submittedByUserId: currentSession.user.id,
      });
      const mangaResult = await previewMalMangaPull(lists.manga);
      const importResult = buildLocalImportResult(
        result.preview,
        IMPORT_STATUS_ORDER,
        [],
        result.username || linkedAccount?.mal_username || 'MyAnimeList'
      );
      const pullSucceeded = importResult.ok || mangaResult.localMangaEntries.length > 0;
      const animeMappingFailures = result.preview?.mappingFailures || [];
      const mappingFailures = [
        ...animeMappingFailures.map((failure) => ({ ...failure, mediaType: 'ANIME' })),
        ...(mangaResult.mappingFailures || []).map((failure) => ({
          ...failure,
          mediaType: 'MANGA',
        })),
      ];
      const unmappedCount = Number(result.preview?.skipped || 0) + mangaResult.skipped;
      const failedTitles = mappingFailures
        .map((failure) => failure?.title)
        .filter(Boolean);
      const failedTitleLabel = failedTitles.length
        ? ` (${failedTitles.slice(0, 3).join(', ')}${
            failedTitles.length > 3 ? ', ...' : ''
          })`
        : '';
      if (pullSucceeded && linkedAccount?.mal_user_id) {
        updateMalAccountImportTime(linkedAccount.mal_user_id);
      }
      return {
        ...importResult,
        ok: pullSucceeded,
        partial: unmappedCount > 0,
        message: pullSucceeded
          ? `Updated Anime and Manga from MyAnimeList.${
              unmappedCount > 0
                ? ` ${unmappedCount} remote entr${
                    unmappedCount === 1 ? 'y' : 'ies'
                  }${failedTitleLabel} could not be mapped one-to-one and ${
                    unmappedCount === 1 ? 'was' : 'were'
                  } skipped.`
                : ''
            }`
          : importResult.message,
        localMangaEntries: mangaResult.localMangaEntries,
        summary: {
          ...(importResult.summary || {}),
          totalFound:
            (importResult.summary?.totalFound || 0) + mangaResult.localMangaEntries.length,
          mangaFound: mangaResult.localMangaEntries.length,
          mangaMapped: mangaResult.mapped,
          mangaUnmapped: mangaResult.skipped,
          animeUnmapped: Number(result.preview?.skipped || 0),
          mappingFailures,
        },
      };
    }
    case 'getSyncActivity':
      return { ok: true, pending: [], completed: [], failed: [], pulled: [] };
    case 'getAnimeDetails':
      return await getAnimeDetails(args[0]);
    case 'getAnimeAdultFlags':
      return await anilist.getAnimeAdultFlags(args[0]);
    case 'getAnimeListMetadata':
      return await anilist.getAnimeListMetadata(args[0]);
    case 'getCharacterDetails':
      return await getCharacterDetails(args[0]);
    case 'getStaffDetails':
      return await getStaffDetails(args[0]);
    case 'cacheMinimalAnime':
      if (!args[0]?.id) return { ok: false, message: 'Invalid anime data.' };
      return { ok: true };
    case 'cacheMinimalManga':
      if (!args[0]?.id) return { ok: false, message: 'Invalid manga data.' };
      return { ok: true };
    case 'register': {
      const result = await registerUser(args[0], args[1]);
      if (result.ok && result.user?.id) createWebSession(res, result.user.id);
      return result;
    }
    case 'login': {
      const result = await loginUser(args[0], args[1]);
      if (result.ok && result.user?.id) createWebSession(res, result.user.id);
      return result;
    }
    case 'setLocalPassword': {
      if (!currentSession.authenticated || !currentSession.user?.id) {
        return { ok: false, message: 'You must be logged in.' };
      }
      if (getLocalCredentialsConfirmed(currentSession.user.id) === true) {
        return { ok: false, message: 'Your local password is already confirmed.' };
      }
      const result = await setLocalPassword(currentSession.user.id, args[0]);
      return result.ok ? { ...result, localCredentialsConfirmed: true } : result;
    }
    case 'unlinkAniListAccount':
    case 'unlinkMalAccount': {
      if (!currentSession.authenticated || !currentSession.user?.id) {
        return { ok: false, message: 'You must be logged in.', linked: false };
      }
      const userId = currentSession.user.id;
      const provider = method === 'unlinkMalAccount' ? 'mal' : 'anilist';
      const validPassword = await verifyLocalPassword(userId, args[0]);
      if (!validPassword) {
        return {
          ok: false,
          linked: true,
          needsLocalPassword: getLocalCredentialsConfirmed(userId) !== true,
          message: getUnlinkPasswordError(userId),
        };
      }
      if (provider === 'mal') deleteMalAccountByUserId(userId);
      else deleteAniListAccountByUserId(userId);
      clearProviderSyncQueue(userId, provider);
      const providerName = provider === 'mal' ? 'MyAnimeList' : 'AniList';
      return {
        ok: true,
        linked: false,
        localCredentialsConfirmed: true,
        message: `${providerName} was unlinked. Your Seenary library data was kept.`,
      };
    }
    case 'logout':
      clearWebSession(req, res);
      logoutUser();
      return { ok: true, message: 'Logged out successfully.' };
    case 'deleteAccount': {
      if (!currentSession.authenticated || !currentSession.user?.id) {
        return { ok: false, message: 'You must be logged in.' };
      }
      if (String(args[0] || '').trim() !== currentSession.user.username) {
        return { ok: false, message: 'The username confirmation does not match.' };
      }
      const userId = Number(currentSession.user.id);
      pendingAniListLinkConflictByUserId.delete(userId);
      pendingMalLinkConflictByUserId.delete(userId);
      for (const [flowId, flow] of pendingAniListFlows) {
        if (Number(flow.userId) === userId) pendingAniListFlows.delete(flowId);
      }
      for (const [flowId, flow] of pendingMalFlows) {
        if (Number(flow.userId) === userId) pendingMalFlows.delete(flowId);
      }
      clearWebSession(req, res);
      deleteEngagementForUser(userId);
      const deleted = deleteUser(userId);
      logoutUser();
      return deleted
        ? { ok: true, message: 'Your Seenary account and its stored data were deleted.' }
        : { ok: false, message: 'The account could not be deleted.' };
    }
    case 'getSession':
      return currentSession;
    case 'setTutorialDismissed':
      if (!currentSession.authenticated) return { ok: false, message: 'You must be logged in.', user: null };
      updateTutorialDismissed(currentSession.user.id, Boolean(args[0]));
      return { ok: true, message: 'Tutorial preference updated.', user: getSafeUserById(currentSession.user.id) };
    case 'getMyList':
      return { ok: true, entries: [] };
    case 'exportLegacyMyList':
      return getMyAnimeList(currentSession);
    case 'getMyListEntry':
      return { ok: true, entry: null };
    case 'saveMyListEntry':
      return { ok: false, message: 'List entries are saved locally in the browser.' };
    case 'removeMyListEntry':
      return { ok: false, message: 'List entries are saved locally in the browser.' };
    case 'clearMyList':
      return {
        ok: true,
        message: 'Your browser-local list is managed on this device.',
        removedCount: 0,
      };
    case 'startAniListLogin': {
      const { flow, authUrl } = createAniListFlow({
        type: 'login',
        returnTo: getWebOrigin(req),
      });

      return {
        ok: true,
        pendingOAuth: true,
        flowId: flow.id,
        authUrl,
        message: 'Open AniList to continue.',
      };
    }
    case 'pollAniListLogin': {
      cleanupAniListFlows();
      const flowId = String(args[0] || '');
      const flow = pendingAniListFlows.get(flowId);

      if (!flow) {
        return { ok: false, done: true, message: 'AniList login session expired. Try again.' };
      }

      if (flow.status === 'pending') {
        return { ok: true, done: false, message: 'Waiting for AniList authorization.' };
      }

      pendingAniListFlows.delete(flowId);

      if (flow.status === 'failed') {
        return { ok: false, done: true, message: flow.error || 'AniList login failed.' };
      }

      if (flow.result?.user?.id) {
        createWebSession(res, flow.result.user.id);
      }

      return { ...flow.result, done: true };
    }
    case 'completeAniListLogin': {
      cleanupAniListFlows();
      const username = String(args[0] || '').trim();
      const flowId = String(args[1] || '');
      const signup = pendingAniListSignupByFlowId.get(flowId);

      if (!signup) {
        return { ok: false, message: 'AniList login session expired. Try again.' };
      }

      const usernameError = validateUsername(username);

      if (usernameError) {
        return { ok: false, message: usernameError };
      }

      const usernameNormalized = normalizeUsername(username);

      if (getUserByNormalizedUsername(usernameNormalized)) {
        return { ok: false, message: 'Username is already taken.' };
      }

      const created = await createLinkedUser(username);

      if (!created.ok || !created.user) {
        return created;
      }

      pendingAniListSignupByFlowId.delete(flowId);

      return await finishAniListLogin({
        accessToken: signup.accessToken,
        viewer: signup.viewer,
        userId: created.user.id,
        res,
        deferImport: true,
      });
    }
    case 'startMalLogin': {
      const { flow, authUrl } = createMalFlow({
        type: 'login',
        returnTo: getWebOrigin(req),
      });

      return {
        ok: true,
        pendingOAuth: true,
        flowId: flow.id,
        authUrl,
        message: 'Open MyAnimeList to continue.',
      };
    }
    case 'pollMalLogin': {
      cleanupMalFlows();
      const flowId = String(args[0] || '');
      const flow = pendingMalFlows.get(flowId);

      if (!flow) {
        return { ok: false, done: true, message: 'MyAnimeList login session expired. Try again.' };
      }

      if (flow.status === 'pending') {
        return { ok: true, done: false, message: 'Waiting for MyAnimeList authorization.' };
      }

      pendingMalFlows.delete(flowId);

      if (flow.status === 'failed') {
        return { ok: false, done: true, message: flow.error || 'MyAnimeList login failed.' };
      }

      if (flow.result?.user?.id) {
        createWebSession(res, flow.result.user.id);
      }

      return { ...flow.result, done: true };
    }
    case 'completeMalLogin': {
      cleanupMalFlows();
      const username = String(args[0] || '').trim();
      const flowId = String(args[1] || '');
      const signup = pendingMalSignupByFlowId.get(flowId);

      if (!signup) {
        return { ok: false, message: 'MyAnimeList login session expired. Try again.' };
      }

      const usernameError = validateUsername(username);

      if (usernameError) {
        return { ok: false, message: usernameError };
      }

      const usernameNormalized = normalizeUsername(username);

      if (getUserByNormalizedUsername(usernameNormalized)) {
        return { ok: false, message: 'Username is already taken.' };
      }

      const created = await createLinkedUser(username);

      if (!created.ok || !created.user) {
        return created;
      }

      pendingMalSignupByFlowId.delete(flowId);

      return await finishMalLogin({
        tokenData: signup.tokenData,
        viewer: signup.viewer,
        userId: created.user.id,
        res,
        deferImport: true,
      });
    }
    case 'linkAniListAccount': {
      if (!currentSession.authenticated || !currentSession.user?.id) {
        return { ok: false, message: 'You must be logged in.', linked: false };
      }

      if (getMalAccountByUserId(currentSession.user.id)) {
        return {
          ok: false,
          message: 'Unlink MyAnimeList before linking AniList. Seenary supports one sync provider at a time.',
          linked: false,
        };
      }

      const { flow, authUrl } = createAniListFlow({
        type: 'link',
        userId: currentSession.user.id,
        returnTo: getWebOrigin(req),
      });

      return {
        ok: true,
        pendingOAuth: true,
        flowId: flow.id,
        authUrl,
        linked: false,
        message: 'Open AniList to continue.',
      };
    }
    case 'linkMalAccount': {
      if (!currentSession.authenticated || !currentSession.user?.id) {
        return { ok: false, message: 'You must be logged in.', linked: false };
      }

      if (getAniListAccountByUserId(currentSession.user.id)) {
        return {
          ok: false,
          message: 'Unlink AniList before linking MyAnimeList. Seenary supports one sync provider at a time.',
          linked: false,
        };
      }

      const { flow, authUrl } = createMalFlow({
        type: 'link',
        userId: currentSession.user.id,
        returnTo: getWebOrigin(req),
      });

      return {
        ok: true,
        pendingOAuth: true,
        flowId: flow.id,
        authUrl,
        linked: false,
        message: 'Open MyAnimeList to continue.',
      };
    }
    case 'pollMalLink': {
      cleanupMalFlows();

      if (!currentSession.authenticated || !currentSession.user?.id) {
        return { ok: false, done: true, message: 'You must be logged in.', linked: false };
      }

      const flowId = String(args[0] || '');
      const flow = pendingMalFlows.get(flowId);

      if (!flow || Number(flow.userId) !== Number(currentSession.user.id)) {
        return { ok: false, done: true, message: 'MyAnimeList link session expired. Try linking again.', linked: false };
      }

      if (flow.status === 'pending') {
        return { ok: true, done: false, linked: false, message: 'Waiting for MyAnimeList authorization.' };
      }

      pendingMalFlows.delete(flowId);

      if (flow.status === 'failed') {
        return { ok: false, done: true, linked: false, message: flow.error || 'MyAnimeList link failed.' };
      }

      return { ...flow.result, done: true };
    }
    case 'pollAniListLink': {
      cleanupAniListFlows();

      if (!currentSession.authenticated || !currentSession.user?.id) {
        return { ok: false, done: true, message: 'You must be logged in.', linked: false };
      }

      const flowId = String(args[0] || '');
      const flow = pendingAniListFlows.get(flowId);

      if (!flow || Number(flow.userId) !== Number(currentSession.user.id)) {
        return { ok: false, done: true, message: 'AniList link session expired. Try linking again.', linked: false };
      }

      if (flow.status === 'pending') {
        return { ok: true, done: false, linked: false, message: 'Waiting for AniList authorization.' };
      }

      pendingAniListFlows.delete(flowId);

      if (flow.status === 'failed') {
        return { ok: false, done: true, linked: false, message: flow.error || 'AniList link failed.' };
      }

      return { ...flow.result, done: true };
    }
    case 'resolveAniListLinkConflict': {
      if (!currentSession.authenticated || !currentSession.user?.id) {
        return { ok: false, message: 'You must be logged in.', linked: false };
      }

      cleanupAniListFlows();

      const conflict = pendingAniListLinkConflictByUserId.get(Number(currentSession.user.id));

      if (!conflict) {
        return { ok: false, message: 'No AniList link conflict is waiting.', linked: false };
      }

      const action = String(args[0] || '').trim();

      if (!['transfer', 'merge'].includes(action)) {
        return { ok: false, message: 'Choose transfer or merge.', linked: false };
      }

      pendingAniListLinkConflictByUserId.delete(Number(currentSession.user.id));

      let mergeSummary = null;

      if (action === 'merge') {
        mergeSummary = mergeUserIntoUser(conflict.sourceUserId, conflict.targetUserId);
      }

      const result = await linkAniListToUser({
        accessToken: conflict.accessToken,
        viewer: conflict.viewer,
        userId: conflict.targetUserId,
      });

      return {
        ...result,
        message:
          action === 'merge'
            ? `${result.message} Merged ${mergeSummary?.movedEntries ?? 0} list entries from the old local account.`
            : result.message,
        resolution: action,
        mergeSummary,
      };
    }
    case 'resolveMalLinkConflict': {
      if (!currentSession.authenticated || !currentSession.user?.id) {
        return { ok: false, message: 'You must be logged in.', linked: false };
      }

      cleanupMalFlows();

      const conflict = pendingMalLinkConflictByUserId.get(Number(currentSession.user.id));

      if (!conflict) {
        return { ok: false, message: 'No MyAnimeList link conflict is waiting.', linked: false };
      }

      const action = String(args[0] || '').trim();

      if (!['transfer', 'merge'].includes(action)) {
        return { ok: false, message: 'Choose transfer or merge.', linked: false };
      }

      pendingMalLinkConflictByUserId.delete(Number(currentSession.user.id));

      let mergeSummary = null;

      if (action === 'merge') {
        mergeSummary = mergeUserIntoUser(conflict.sourceUserId, conflict.targetUserId);
      }

      const result = await linkMalToUser({
        tokenData: conflict.tokenData,
        viewer: conflict.viewer,
        userId: conflict.targetUserId,
        deferImport: true,
      });

      return {
        ...result,
        message:
          action === 'merge'
            ? `${result.message} Merged ${mergeSummary?.movedEntries ?? 0} list entries from the old local account.`
            : result.message,
        resolution: action,
        mergeSummary,
      };
    }
    case 'getAniListLinkStatus': {
      if (!currentSession.authenticated) {
        return { ok: false, message: 'You must be logged in.', linked: false };
      }

      const linkedAccount = getAniListAccountByUserId(currentSession.user.id);

      return {
        ok: true,
        linked: Boolean(linkedAccount),
        localCredentialsConfirmed: getLocalCredentialsConfirmed(currentSession.user.id),
        account: linkedAccount
          ? {
              anilistUserId: linkedAccount.anilist_user_id,
              anilistUsername: linkedAccount.anilist_username,
              originalAniListUsername: linkedAccount.original_anilist_username,
              lastImportAt: linkedAccount.last_import_at,
              updatedAt: linkedAccount.updated_at,
            }
          : null,
      };
    }
    case 'getMalLinkStatus': {
      if (!currentSession.authenticated) {
        return { ok: false, message: 'You must be logged in.', linked: false };
      }

      const linkedAccount = getMalAccountByUserId(currentSession.user.id);

      return {
        ok: true,
        linked: Boolean(linkedAccount),
        account: linkedAccount ? buildMalAccountPayload(linkedAccount) : null,
        localCredentialsConfirmed: getLocalCredentialsConfirmed(currentSession.user.id),
      };
    }
    default:
      return { ok: false, message: `Unknown API method: ${method}` };
  }
}

async function handleAniListCallback(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  const stateValue = requestUrl.searchParams.get('state') || '';
  const code = requestUrl.searchParams.get('code');
  const error = requestUrl.searchParams.get('error');
  const [flowId, returnedState] = stateValue.split('.');
  const flow = flowId ? pendingAniListFlows.get(flowId) : null;
  const returnTo = flow?.returnTo || DEFAULT_WEB_ORIGIN;

  if (!flow || !returnedState || returnedState !== flow.state) {
    sendAniListCallbackPage(
      res,
      'AniList login failed',
      'The authorization response could not be verified. You can close this tab and try again.',
      returnTo
    );
    return;
  }

  if (error) {
    flow.status = 'failed';
    flow.error = 'AniList authorization was cancelled.';
    sendAniListCallbackPage(
      res,
      'AniList login cancelled',
      'The authorization request was not completed. You can close this tab.',
      returnTo
    );
    return;
  }

  if (!code) {
    flow.status = 'failed';
    flow.error = 'AniList did not return an authorization code.';
    sendAniListCallbackPage(
      res,
      'AniList login failed',
      'AniList did not return an authorization code. You can close this tab and try again.',
      returnTo
    );
    return;
  }

  try {
    const accessToken = await exchangeAniListCodeForToken(code);
    const viewer = await anilist.getViewer(accessToken);
    flow.result =
      flow.type === 'link'
        ? await handleAniListLinkCallback(flow, accessToken, viewer)
        : await handleAniListLoginCallback(flow, accessToken, viewer);
    flow.status = 'completed';

    sendAniListCallbackPage(
      res,
      'AniList connected',
      'You can close this tab and return to Seenary.',
      returnTo
    );
  } catch (callbackError) {
    console.error('AniList OAuth callback error:', callbackError);
    flow.status = 'failed';
    flow.error = callbackError.message || 'Failed to finish AniList authorization.';
    sendAniListCallbackPage(
      res,
      'AniList login failed',
      'Seenary could not finish the AniList authorization. You can close this tab and try again.',
      returnTo
    );
  }
}

async function handleMalCallback(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  const stateValue = requestUrl.searchParams.get('state') || '';
  const code = requestUrl.searchParams.get('code');
  const error = requestUrl.searchParams.get('error');
  const [flowId, returnedState] = stateValue.split('.');
  const flow = flowId ? pendingMalFlows.get(flowId) : null;
  const returnTo = flow?.returnTo || DEFAULT_WEB_ORIGIN;

  if (!flow || !returnedState || returnedState !== flow.state) {
    sendAniListCallbackPage(
      res,
      'MyAnimeList login failed',
      'The authorization response could not be verified. You can close this tab and try again.',
      returnTo
    );
    return;
  }

  if (error) {
    flow.status = 'failed';
    flow.error = 'MyAnimeList authorization was cancelled.';
    sendAniListCallbackPage(
      res,
      'MyAnimeList login cancelled',
      'The authorization request was not completed. You can close this tab.',
      returnTo
    );
    return;
  }

  if (!code) {
    flow.status = 'failed';
    flow.error = 'MyAnimeList did not return an authorization code.';
    sendAniListCallbackPage(
      res,
      'MyAnimeList login failed',
      'MyAnimeList did not return an authorization code. You can close this tab and try again.',
      returnTo
    );
    return;
  }

  try {
    const tokenData = await mal.exchangeCodeForToken({
      code,
      codeVerifier: flow.codeVerifier,
      redirectUri: MAL_REDIRECT_URI,
    });
    const viewer = await mal.getViewer(tokenData.access_token);
    flow.result =
      flow.type === 'link'
        ? await handleMalLinkCallback(flow, tokenData, viewer)
        : await handleMalLoginCallback(flow, tokenData, viewer);
    flow.status = 'completed';

    sendAniListCallbackPage(
      res,
      'MyAnimeList connected',
      'You can close this tab and return to Seenary.',
      returnTo
    );
  } catch (callbackError) {
    console.error('MyAnimeList OAuth callback error:', callbackError);
    flow.status = 'failed';
    flow.error = callbackError.message || 'Failed to finish MyAnimeList authorization.';
    sendAniListCallbackPage(
      res,
      'MyAnimeList login failed',
      'Seenary could not finish the MyAnimeList authorization. You can close this tab and try again.',
      returnTo
    );
  }
}

const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);

  if (req.headers.origin && !getAllowedOrigin(req)) {
    sendJson(req, res, 403, { ok: false, message: 'Origin is not allowed.' });
    return;
  }

  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(req, res, 200, {
      ok: true,
      writeFrozen: LEGACY_WRITE_FREEZE,
      ...(process.env.SHOW_DB_PATH === 'true' ? { dbPath } : {}),
    });
    return;
  }

  if (LEGACY_WRITE_FREEZE && (req.method === 'POST' && req.url === '/rpc'
      || req.method === 'GET' && /^\/auth\/(anilist|mal)\/callback(?:\?|$)/.test(req.url))) {
    sendJson(req, res, 503, { ok: false, code: 'MIGRATION_MAINTENANCE', message: 'Seenary is briefly read-only for a database migration.' });
    return;
  }

  if (handleAnalyticsReportRequest(req, res)) {
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/desktop-updates-debug')) {
    sendDesktopUpdatesDebug(req, res);
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/desktop-updates/')) {
    sendDesktopUpdateFile(req, res);
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/auth/anilist/callback')) {
    try {
      await handleAniListCallback(req, res);
    } catch (error) {
      console.error('AniList callback route error:', error);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Failed to finish AniList authorization.');
    }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/auth/mal/callback')) {
    try {
      await handleMalCallback(req, res);
    } catch (error) {
      console.error('MyAnimeList callback route error:', error);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Failed to finish MyAnimeList authorization.');
    }
    return;
  }

  if (req.method !== 'POST' || req.url !== '/rpc') {
    sendJson(req, res, 404, { ok: false, message: 'Not found.' });
    return;
  }

  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    sendJson(req, res, 415, {
      ok: false,
      message: 'Content-Type must be application/json.',
    });
    return;
  }

  const clientAddress = getClientAddress(req);
  const rpcRateLimit = consumeRateLimit(
    `rpc:${clientAddress}`,
    RPC_RATE_LIMIT_MAX,
    RPC_RATE_LIMIT_WINDOW_MS
  );
  if (!rpcRateLimit.allowed) {
    sendRateLimitResponse(req, res, rpcRateLimit);
    return;
  }

  try {
    const body = await readJson(req);
    const method = typeof body.method === 'string' ? body.method : '';
    if (!method) {
      sendJson(req, res, 400, { ok: false, message: 'A valid RPC method is required.' });
      return;
    }

    if (method === 'login' || method === 'register') {
      const authRateLimit = consumeRateLimit(
        `auth:${clientAddress}`,
        AUTH_RATE_LIMIT_MAX,
        AUTH_RATE_LIMIT_WINDOW_MS
      );
      if (!authRateLimit.allowed) {
        sendRateLimitResponse(req, res, authRateLimit);
        return;
      }
    }

    const result = await handleRpc(method, Array.isArray(body.args) ? body.args : [], req, res);
    sendJson(req, res, 200, result);
  } catch (error) {
    console.error('API error:', error);
    const statusCode = Number(error.statusCode || error.status) || 500;
    sendJson(req, res, statusCode, {
      ok: false,
      message:
        error.publicMessage ||
        (statusCode < 500 || process.env.NODE_ENV !== 'production'
          ? error.message || 'Request failed.'
          : 'Internal server error.'),
    });
  }
});

function startServer(port = PORT, options = {}) {
  return server.listen(port, () => {
    deleteExpiredWebSessions();
    if (options.startBackups !== false) {
      startDatabaseBackups(db, dbPath);
    }
    if (!getReportCredentials().configured) {
      console.warn(
        'Analytics reports are disabled until ANALYTICS_REPORT_USERNAME and a 16+ character ANALYTICS_REPORT_PASSWORD are configured.'
      );
    }
    const address = server.address();
    const listeningPort =
      address && typeof address === 'object' ? address.port : port;
    console.log(`Seenary API listening on port ${listeningPort}`);
  });
}

// Hostinger loads the configured entry file through its own Node.js wrapper,
// so `require.main === module` is false even though this is the application
// entry point. Start during module evaluation so the hosting runtime observes
// listen() within its startup deadline.
startServer();

module.exports = {
  server,
  startServer,
};
