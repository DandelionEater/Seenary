const fetch = require('node-fetch');

const MAL_API_URL = 'https://api.myanimelist.net/v2';
const MAL_TOKEN_URL = 'https://myanimelist.net/v1/oauth2/token';
const MAL_REQUEST_TIMEOUT_MS = 15000;

function getClientId() {
  return process.env.MAL_CLIENT_ID || '';
}

function getClientSecret() {
  return process.env.MAL_CLIENT_SECRET || '';
}

function requireClientId() {
  const clientId = getClientId();

  if (!clientId) {
    throw new Error('Set MAL_CLIENT_ID before using MyAnimeList login or sync.');
  }

  return clientId;
}

function buildMalRequestError(data, fallbackMessage, response) {
  const rawMessage = data?.message || data?.error_description || data?.error || fallbackMessage;
  const message =
    typeof rawMessage === 'string' && rawMessage.trim().toLowerCase() === 'invalid q'
      ? 'MyAnimeList rejected the title search query while matching this anime.'
      : rawMessage;
  const error = new Error(message);
  const retryAfter = Number(response.headers.get('retry-after'));
  error.status = response.status;
  error.statusText = response.statusText;
  error.retryAfter = Number.isFinite(retryAfter) ? retryAfter : null;
  error.data = data;
  return error;
}

async function fetchMalJson(url, options = {}, fallbackMessage = 'MyAnimeList request failed.') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAL_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const data = response.status === 204 ? null : await parseMalResponseJson(response);

    if (!response.ok) {
      throw buildMalRequestError(data, fallbackMessage, response);
    }

    return { response, data };
  } catch (error) {
    throw normalizeMalTransportError(error);
  } finally {
    clearTimeout(timeout);
  }
}

async function parseMalResponseJson(response) {
  try {
    return await response.json();
  } catch (error) {
    const requestError = new Error(
      `MyAnimeList returned an unreadable response with status ${response.status}.`
    );
    requestError.status = response.status;
    requestError.statusText = response.statusText;
    requestError.cause = error;
    throw requestError;
  }
}

function normalizeMalTransportError(error) {
  if (error?.name === 'AbortError') {
    const timeoutError = new Error('MyAnimeList request timed out. Try again in a moment.');
    timeoutError.status = 408;
    timeoutError.retryable = true;
    return timeoutError;
  }

  if (error?.status) {
    return error;
  }

  const requestError = new Error(
    error?.message
      ? `MyAnimeList request failed: ${error.message}`
      : 'MyAnimeList request failed before a response was received.'
  );
  requestError.retryable = true;
  requestError.cause = error;
  return requestError;
}

async function withMalRetry(operation, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isRetryableMalError(error) || attempt === attempts) {
        break;
      }

      const retryAfterMs =
        typeof error.retryAfter === 'number' && error.retryAfter > 0
          ? error.retryAfter * 1000
          : 1800 * attempt;
      await delay(retryAfterMs);
    }
  }

  throw lastError;
}

function isRetryableMalError(error) {
  const status = Number(error?.status);
  return (
    error?.retryable === true ||
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function exchangeCodeForToken({ code, codeVerifier, redirectUri }) {
  const clientId = requireClientId();
  const clientSecret = getClientSecret();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  });

  if (clientSecret) {
    body.set('client_secret', clientSecret);
  }

  const { data } = await fetchMalJson(MAL_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  }, 'Failed to exchange MyAnimeList authorization code.');

  if (!data?.access_token) {
    throw new Error('Failed to exchange MyAnimeList authorization code.');
  }

  return data;
}

async function refreshAccessToken(refreshToken) {
  const clientId = requireClientId();
  const clientSecret = getClientSecret();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
  });

  if (clientSecret) {
    body.set('client_secret', clientSecret);
  }

  const { data } = await fetchMalJson(MAL_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  }, 'Failed to refresh MyAnimeList authorization.');

  if (!data?.access_token) {
    throw new Error('Failed to refresh MyAnimeList authorization.');
  }

  return data;
}

async function malRequest(path, { accessToken, method = 'GET', body = null, query = null } = {}) {
  const url = new URL(`${MAL_API_URL}${path}`);
  const clientId = accessToken ? getClientId() : requireClientId();

  for (const [key, value] of Object.entries(query || {})) {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const { data } = await fetchMalJson(url.toString(), {
    method,
    headers: {
      Accept: 'application/json',
      ...(clientId ? { 'X-MAL-CLIENT-ID': clientId } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body ? body.toString() : undefined,
  }, `MyAnimeList request failed while calling ${path}.`);

  return data;
}

async function malRequestWithRetry(path, options = {}) {
  return await withMalRetry(() => malRequest(path, options));
}

async function getViewer(accessToken) {
  return await malRequestWithRetry('/users/@me', {
    accessToken,
    query: {
      fields: 'id,name',
    },
  });
}

async function getViewerAnimeList(accessToken, options = {}) {
  return await getUserAnimeList('@me', {
    ...options,
    accessToken,
  });
}

async function getViewerMangaList(accessToken, options = {}) {
  return await getUserMangaList('@me', {
    ...options,
    accessToken,
  });
}

async function getUserMangaList(username, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 100), 1), 1000);
  const fields = [
    'id',
    'title',
    'main_picture',
    'alternative_titles',
    'start_date',
    'end_date',
    'synopsis',
    'mean',
    'rank',
    'popularity',
    'num_chapters',
    'num_volumes',
    'media_type',
    'status',
    'genres',
    'list_status{status,score,num_chapters_read,num_volumes_read,is_rereading,num_times_reread,start_date,finish_date,comments,updated_at}',
  ].join(',');
  const data = [];
  let nextUrl = null;
  let offset = 0;

  do {
    if (options.isCancelled?.()) {
      const error = new Error('MyAnimeList operation cancelled.');
      error.code = 'MAL_JOB_CANCELLED';
      throw error;
    }
    const page = nextUrl
      ? await fetchNextPage(nextUrl, options.accessToken)
      : await malRequestWithRetry(`/users/${encodeURIComponent(username)}/mangalist`, {
          accessToken: options.accessToken,
          query: { fields, limit, offset, nsfw: 'true' },
        });

    data.push(...(page?.data || []));
    nextUrl = page?.paging?.next || null;
    offset += limit;
    options.onProgress?.({ stage: 'fetching', current: data.length, total: null, mediaType: 'MANGA' });
  } while (nextUrl && data.length < (options.maxEntries || 5000));

  return { userName: username, data, truncated: Boolean(nextUrl) };
}

async function getUserAnimeList(username, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 100), 1), 1000);
  const fields = [
    'id',
    'title',
    'main_picture',
    'alternative_titles',
    'start_date',
    'end_date',
    'synopsis',
    'mean',
    'rank',
    'popularity',
    'num_episodes',
    'media_type',
    'status',
    'genres',
    'list_status{status,score,num_episodes_watched,is_rewatching,num_times_rewatched,start_date,finish_date,comments,updated_at}',
  ].join(',');
  const data = [];
  let nextUrl = null;
  let offset = 0;

  do {
    if (options.isCancelled?.()) {
      const error = new Error('MyAnimeList operation cancelled.');
      error.code = 'MAL_JOB_CANCELLED';
      throw error;
    }
    const page = nextUrl
      ? await fetchNextPage(nextUrl, options.accessToken)
      : await malRequestWithRetry(`/users/${encodeURIComponent(username)}/animelist`, {
          accessToken: options.accessToken,
          query: {
            fields,
            limit,
            offset,
            nsfw: 'true',
          },
        });

    data.push(...(page?.data || []));
    nextUrl = page?.paging?.next || null;
    offset += limit;
    options.onProgress?.({ stage: 'fetching', current: data.length, total: null, mediaType: 'ANIME' });
  } while (nextUrl && data.length < (options.maxEntries || 5000));

  return {
    userName: username,
    data,
    truncated: Boolean(nextUrl),
  };
}

async function searchAnime(search, options = {}) {
  const query = String(search || '').trim();

  if (!query) {
    return [];
  }

  const data = await malRequestWithRetry('/anime', {
    accessToken: options.accessToken,
    query: {
      q: query,
      limit: Math.min(Math.max(Number(options.limit || 10), 1), 100),
      nsfw: 'true',
      fields: [
        'id',
        'title',
        'main_picture',
        'alternative_titles',
        'start_date',
        'end_date',
        'num_episodes',
        'media_type',
        'status',
      ].join(','),
    },
  });

  return (data?.data || []).map((item) => item.node).filter(Boolean);
}

async function searchManga(search, options = {}) {
  const query = String(search || '').trim();

  if (!query) {
    return [];
  }

  const data = await malRequestWithRetry('/manga', {
    accessToken: options.accessToken,
    query: {
      q: query,
      limit: Math.min(Math.max(Number(options.limit || 10), 1), 100),
      nsfw: 'true',
      fields: [
        'id',
        'title',
        'main_picture',
        'alternative_titles',
        'start_date',
        'end_date',
        'num_chapters',
        'num_volumes',
        'media_type',
        'status',
      ].join(','),
    },
  });

  return (data?.data || []).map((item) => item.node).filter(Boolean);
}

async function getAnimeDetails(malAnimeId, options = {}) {
  return await malRequestWithRetry(`/anime/${encodeURIComponent(malAnimeId)}`, {
    accessToken: options.accessToken,
    query: {
      fields: [
        'id',
        'title',
        'alternative_titles',
        'start_date',
        'num_episodes',
        'media_type',
        'status',
      ].join(','),
    },
  });
}

// Shared metadata uses application credentials only. Persisted cache retries own backoff;
// do not hold a refresh lease while the legacy transport sleeps through retries.
async function getPublicMediaDetails(type, id) {
  if (!['ANIME', 'MANGA'].includes(type) || !Number.isSafeInteger(id) || id < 1) throw new Error('Invalid MAL identity.');
  const fields = ['id', 'title', 'main_picture', 'alternative_titles', 'start_date', 'end_date', 'synopsis',
    'mean', 'rank', 'popularity', 'num_list_users', 'num_scoring_users', 'nsfw', 'genres', 'media_type', 'status',
    ...(type === 'ANIME' ? ['num_episodes', 'studios', 'source', 'rating', 'average_episode_duration'] : ['num_chapters', 'num_volumes'])];
  return malRequest(`/${type.toLowerCase()}/${id}`, { query: { fields: fields.join(',') } });
}

async function fetchNextPage(url, accessToken) {
  const clientId = accessToken ? getClientId() : requireClientId();
  return await withMalRetry(async () => {
    const { data } = await fetchMalJson(url, {
      headers: {
        Accept: 'application/json',
        ...(clientId ? { 'X-MAL-CLIENT-ID': clientId } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    }, 'MyAnimeList request failed while loading the next list page.');

    return data;
  });
}

function mapStatus(status) {
  switch (status) {
    case 'watching':
      return 'watching';
    case 'planned':
      return 'plan_to_watch';
    case 'completed':
      return 'completed';
    case 'paused':
      return 'on_hold';
    case 'dropped':
      return 'dropped';
    default:
      return 'plan_to_watch';
  }
}

function buildListStatusPayload(entry) {
  const body = new URLSearchParams({
    status: mapStatus(entry.status),
    num_watched_episodes: String(entry.progress ?? 0),
  });

  body.set(
    'score',
    entry.score === null || entry.score === undefined || entry.score === ''
      ? '0'
      : String(Math.min(10, Math.max(0, Math.round(Number(entry.score) || 0))))
  );
  body.set('comments', entry.notes === null || entry.notes === undefined ? '' : String(entry.notes));

  if (entry.started_at) {
    body.set('start_date', entry.started_at);
  }

  if (entry.completed_at) {
    body.set('finish_date', entry.completed_at);
  }

  return body;
}

async function saveAnimeListStatus(accessToken, malAnimeId, entry) {
  return await malRequest(`/anime/${malAnimeId}/my_list_status`, {
    accessToken,
    method: 'PATCH',
    body: buildListStatusPayload(entry),
  });
}

async function deleteAnimeListStatus(accessToken, malAnimeId) {
  try {
    return await malRequest(`/anime/${malAnimeId}/my_list_status`, {
      accessToken,
      method: 'DELETE',
    });
  } catch (error) {
    if (Number(error?.status) === 404) {
      return {
        deleted: true,
        alreadyDeleted: true,
      };
    }

    throw error;
  }
}

function mapMangaStatus(status) {
  switch (status) {
    case 'watching':
      return 'reading';
    case 'planned':
      return 'plan_to_read';
    case 'completed':
      return 'completed';
    case 'paused':
      return 'on_hold';
    case 'dropped':
      return 'dropped';
    default:
      return 'plan_to_read';
  }
}

function buildMangaListStatusPayload(entry) {
  const body = new URLSearchParams({
    status: mapMangaStatus(entry.status),
    num_chapters_read: String(entry.progress ?? 0),
    num_volumes_read: String(entry.volume_progress ?? entry.volumeProgress ?? 0),
  });

  body.set(
    'score',
    entry.score === null || entry.score === undefined || entry.score === ''
      ? '0'
      : String(Math.min(10, Math.max(0, Math.round(Number(entry.score) || 0))))
  );
  body.set('comments', entry.notes === null || entry.notes === undefined ? '' : String(entry.notes));
  if (entry.started_at) body.set('start_date', entry.started_at);
  if (entry.completed_at) body.set('finish_date', entry.completed_at);
  if (entry.repeat_count !== null && entry.repeat_count !== undefined) {
    body.set('num_times_reread', String(Math.max(0, Math.floor(Number(entry.repeat_count) || 0))));
  }
  body.set('is_rereading', entry.is_rereading ? 'true' : 'false');

  return body;
}

async function saveMangaListStatus(accessToken, malMangaId, entry) {
  return await malRequest(`/manga/${malMangaId}/my_list_status`, {
    accessToken,
    method: 'PATCH',
    body: buildMangaListStatusPayload(entry),
  });
}

async function deleteMangaListStatus(accessToken, malMangaId) {
  try {
    return await malRequest(`/manga/${malMangaId}/my_list_status`, {
      accessToken,
      method: 'DELETE',
    });
  } catch (error) {
    if (Number(error?.status) === 404) return { deleted: true, alreadyDeleted: true };
    throw error;
  }
}

module.exports = {
  getPublicMediaDetails,
  exchangeCodeForToken,
  refreshAccessToken,
  getViewer,
  getViewerAnimeList,
  getUserAnimeList,
  getViewerMangaList,
  getUserMangaList,
  searchAnime,
  searchManga,
  getAnimeDetails,
  saveAnimeListStatus,
  deleteAnimeListStatus,
  saveMangaListStatus,
  deleteMangaListStatus,
  requireClientId,
};
