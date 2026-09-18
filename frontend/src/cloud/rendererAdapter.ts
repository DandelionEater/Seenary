import { localStore } from '../localStore';
import type { AnimeMedia, SaveListEntryPayload } from '../types/domain';
import { LibraryClient, defaults, fields } from './libraryClient';
import type { Entry, Fields, Media, Reply, State } from './libraryClient';
import { accountLock, browserStorage } from './browserStorage';
import { atlasEndpoint } from './config';

type Api = typeof window.api;
const endpoint = atlasEndpoint;
const storage = browserStorage(endpoint);
const sessionKey = `seenary-atlas-renderer-session:${endpoint}`;
type SessionUser = { id: string; username: string; [key: string]: unknown };
type AccountReply = Reply & {
  account?: { provider: 'anilist' | 'mal'; providerUserId: string; username: string; updatedAt: string } | null;
  settings?: { autoSyncEnabled: boolean };
  requestedAt?: string;
  alreadyQueued?: boolean;
  sync?: {
    running: boolean;
    requestedAt: string | null;
    lastSuccessAt: string | null;
    lastOutcome: string | null;
    counts: { applied?: number; skipped?: number; review?: number } | null;
  } | null;
};
type ImportItem = SaveListEntryPayload & { animeId: number; mediaType: 'ANIME' | 'MANGA'; media: AnimeMedia; isRepeating?: boolean };
type ImportPreview = { ok: boolean; username: string; preview: { groups: { status: string; mediaType: 'ANIME' | 'MANGA'; items: ImportItem[] }[] } };

export function installAtlasRenderer(legacy: Api) {
  let user: SessionUser | null = null;
  let preferenceId: number | null = null;
  let refreshNeeded = true;
  const seenRevisions = new Map<string, number>();
  const listeners = new Set<(result: unknown) => void>();
  let syncRunning = false;
  let lastRequest = 0;
  const importPreviews = new Map<string, ImportPreview>();
  const notify = () => window.dispatchEvent(new Event('seenary:local-library-updated'));
  async function rpc(method: string, args: unknown[] = [], expectedUserId?: string): Promise<AccountReply> {
    const wait = Math.max(0, lastRequest + 650 - Date.now()); lastRequest = Date.now() + wait;
    await new Promise(resolve => setTimeout(resolve, wait));
    const response = await fetch(`${endpoint}/rpc`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Seenary-Version': __APP_VERSION__ },
      body: JSON.stringify({ method, args, ...(expectedUserId ? { expectedUserId } : {}) }), signal: AbortSignal.timeout(['previewAniListImport', 'previewMalImport'].includes(method) ? 180000 : 30000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.code || result.message || 'Atlas is unavailable.');
    return result;
  }
  async function activate(value: SessionUser | null) {
    if (value?.id !== user?.id) { refreshNeeded = true; seenRevisions.clear(); importPreviews.clear(); }
    user = value;
    preferenceId = null;
    if (!value) { localStorage.removeItem(sessionKey); localStorage.removeItem(`seenary-cloud-user:${endpoint}`); return null; }
    localStorage.setItem(sessionKey, JSON.stringify(value));
    localStorage.setItem(`seenary-cloud-user:${endpoint}`, JSON.stringify(value));
    // A local UI/preference alias only. Cloud authorization and storage always use the UUID.
    // Reserve negative IDs so existing positive legacy account data is never opened implicitly.
    preferenceId = await navigator.locks.request('seenary-atlas-preference-aliases', () => {
      const key = 'seenary-atlas-preference-aliases';
      const aliases: Record<string, number> = JSON.parse(localStorage.getItem(key) || '{}');
      const identity = `${endpoint}:${value.id}`;
      if (!aliases[identity]) { aliases[identity] = Math.min(0, ...Object.values(aliases)) - 1; localStorage.setItem(key, JSON.stringify(aliases)); }
      return aliases[identity];
    });
    return { ...value, id: preferenceId, cloudUserId: value.id };
  }
  async function operate<T>(task: (client: LibraryClient) => Promise<T>): Promise<T> {
    const id = user?.id;
    if (!id) throw new Error('Sign in to your Atlas account.');
    return accountLock(endpoint, id, async () => {
      const result = await task(new LibraryClient(id, storage, rpc));
      if (user?.id !== id) throw new Error('The active account changed.');
      return result;
    });
  }
  async function load() {
    return operate(async client => {
      if (refreshNeeded) {
        try { await client.refresh(); refreshNeeded = false; }
        catch (error) { if (!(await client.read()).cursor) throw error; }
      }
      return client.read();
    });
  }
  const numericId = (media: Media) => media.anilistId ?? -(media.malId!);
  function row(entry: Entry, state: State) {
    const media = state.media[entry.mediaId];
    if (!media) throw new Error('Title identity is not cached yet. Reconnect to finish loading your library.');
    return { ...media.metadata, [entry.type === 'ANIME' ? 'anime_id' : 'manga_id']: numericId(media), seenary_id: entry.mediaId,
      media_type: entry.type, status: entry.status, is_favorite: entry.isFavorite, progress: entry.progress, volume_progress: entry.volumeProgress,
      score: entry.score, notes: entry.notes, started_at: entry.startedAt, completed_at: entry.completedAt,
      repeat_count: entry.repeatCount, is_rewatching: entry.isRepeating, is_rereading: entry.isRepeating,
      recommendations: media.metadata.recommendations ?? media.sources?.anilist?.details?.recommendations?.nodes ?? [],
      title_preferred: media.metadata.title_preferred || media.metadata.title_english || media.metadata.title_romaji || `${media.anilistId ? 'AniList' : 'MAL'} #${Math.abs(numericId(media))}`,
      external_ids: { anilist: media.anilistId ?? null, mal: media.malId ?? null } };
  }
  function overlay(state: State) {
    const entries = { ...state.entries };
    for (const item of state.pending) {
      const id = item.request.mediaId;
      entries[id] = { ...(entries[id] ?? { ...defaults, mediaId: id, type: state.media[id]?.type ?? 'ANIME', revision: 0 }), ...item.request.patch, deleted: item.request.action === 'delete' };
    }
    return entries;
  }
  async function list(type: Entry['type']) {
    const state = await load();
    return { ok: true, entries: Object.values(overlay(state)).filter(entry => entry.type === type && !entry.deleted).map(entry => row(entry, state)) };
  }
  async function entry(type: Entry['type'], id: number) {
    const state = await load();
    const media = Object.values(state.media).find(media => media.type === type && numericId(media) === id);
    const found = media && overlay(state)[media._id];
    seenRevisions.set(`${type}:${id}`, found?.revision ?? 0);
    return { ok: true, entry: found && !found.deleted ? row(found, state) : null };
  }
  async function save(type: Entry['type'], id: number, data: Record<string, unknown>, action: 'upsert' | 'delete' = 'upsert') {
    try {
      return await operate(async client => {
        const state = await client.read();
        let media = Object.values(state.media).find(media => media.type === type && numericId(media) === id);
        if (!media) {
          const reply = await rpc('ensureLibraryMedia', [type, id > 0 ? 'anilist' : 'mal', Math.abs(id)], client.userId);
          if (!reply.ok) throw new Error(reply.code || 'Unable to resolve title.');
          media = reply.media as Media;
          state.media[media._id] = media; await storage.write(client.userId, state);
        }
        const patch = fields(data as Partial<Fields>);
        if (data.isRewatching !== undefined || data.isRereading !== undefined) patch.isRepeating = Boolean(data.isRewatching ?? data.isRereading);
        if (data.score === '') patch.score = null;
        else if (data.score !== undefined && data.score !== null) patch.score = Number(data.score);
        await client.queue(media._id, patch, action, false, seenRevisions.get(`${type}:${id}`));
        seenRevisions.delete(`${type}:${id}`);
        notify();
        const updated = await client.read();
        return { ok: true, message: 'Saved on this device; queued for Atlas.', entry: row(overlay(updated)[media._id], updated) };
      });
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'Save failed.' }; }
  }
  async function sync() {
    return operate(async client => {
      const before = (await client.read()).pending.length;
      await client.flush(); await client.refresh(); refreshNeeded = false; notify();
      const state = await client.read();
      return { ok: true, synced: before - state.pending.length, pending: state.pending.length, failed: state.pending.filter(item => item.error).length,
        message: state.pending.length ? 'Some cloud edits need review. Open Cloud saves.' : 'Library saved in Atlas. Provider delivery runs separately.' };
    });
  }
  async function clear(type?: Entry['type'], options: { queueProviderDeletion?: boolean } = {}) {
    if (options.queueProviderDeletion === false) return { ok: false, message: 'Atlas lists are shared across devices. Device-only clearing is unavailable; use Cloud saves to review cloud deletions.' };
    try {
      return await operate(async client => {
        const state = await client.read();
        const entries = Object.values(state.entries).filter(item => !item.deleted && (!type || item.type === type));
        if (state.pending.some(item => entries.some(entry => entry.mediaId === item.request.mediaId))) throw new Error('Sync or review pending edits before clearing this list.');
        for (const item of entries) state.pending.push({ request: { operationId: crypto.randomUUID(), mediaId: item.mediaId, expectedRevision: item.revision, action: 'delete' } });
        await storage.write(client.userId, state); notify();
        return { ok: true, removedCount: entries.length, message: 'Deletions queued for Atlas.' };
      });
    } catch (error) { return { ok: false, message: String(error) }; }
  }
  async function details(type: Entry['type'], id: number) {
    const state = await load();
    const cached = Object.values(state.media).find(media => media.type === type && numericId(media) === id);
    if (Number.isSafeInteger(id) && id !== 0) {
      try {
        const result = await rpc('getMediaDetails', [type, id], user?.id) as unknown as AnimeMedia;
        if ((result?.id === id || id < 0 && result?.idMal === -id) && result?.title) return result;
      } catch { /* The cached canonical title remains usable during provider outages. */ }
    }
    if (!cached) throw new Error('Title details are unavailable. Try again when the metadata service is reachable.');
    const meta = cached.metadata;
    return { ...meta, id, type, title: { userPreferred: meta.title_preferred || meta.title_english || meta.title_romaji || `MAL #${Math.abs(id)}`, english: meta.title_english, romaji: meta.title_romaji, native: meta.title_native },
      coverImage: { large: meta.cover_image_large ?? '' }, bannerImage: meta.banner_image, seasonYear: meta.season_year,
      averageScore: meta.average_score, meanScore: meta.mean_score, isAdult: Boolean(meta.is_adult),
      status: meta.anime_status ?? meta.manga_status, recommendations: { nodes: meta.recommendations ?? cached.sources?.anilist?.details?.recommendations?.nodes ?? [] } };
  }
  async function cacheMinimal(type: Entry['type'], incoming: AnimeMedia) {
    return operate(async client => {
      const state = await client.read();
      let media = Object.values(state.media).find(media => media.type === type && numericId(media) === incoming.id);
      if (!media) {
        const reply = await rpc('ensureLibraryMedia', [type, incoming.id > 0 ? 'anilist' : 'mal', Math.abs(incoming.id)], client.userId);
        if (!reply.ok) return reply;
        media = reply.media as Media;
      }
      const metadata = { ...media.metadata };
      const values = { title_preferred: incoming.title?.userPreferred, title_english: incoming.title?.english, title_romaji: incoming.title?.romaji, title_native: incoming.title?.native,
        cover_image_large: incoming.coverImage?.large, banner_image: incoming.bannerImage, episodes: incoming.episodes, chapters: incoming.chapters, volumes: incoming.volumes,
        is_adult: incoming.isAdult, duration: incoming.duration, genres: incoming.genres, recommendations: incoming.recommendations?.nodes };
      for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null) metadata[key] = value;
      state.media[media._id] = { ...media, metadata };
      await storage.write(client.userId, state);
      return { ok: true };
    });
  }
  async function linkStatus(provider: 'anilist' | 'mal') {
    const result = await rpc('getProviderAccount', [], user?.id);
    const link = result.account?.provider === provider ? result.account : null;
    return { ok: result.ok, linked: Boolean(link), account: link ? {
      ...(provider === 'anilist' ? { anilistUserId: Number(link.providerUserId), anilistUsername: link.username, originalAniListUsername: link.username } : { malUserId: Number(link.providerUserId), malUsername: link.username, originalMalUsername: link.username }),
      lastImportAt: null, updatedAt: link.updatedAt } : null };
  }
  async function syncStatus() {
    const result = await rpc('getAccountSettings', [], user?.id);
    const link = await rpc('getProviderAccount', [], user?.id);
    return { ok: result.ok && link.ok, linked: Boolean(link.account), provider: link.account?.provider ?? null,
      providerLabel: link.account?.provider === 'mal' ? 'MyAnimeList' : 'AniList',
      autoSyncEnabled: result.settings?.autoSyncEnabled ?? false, pendingCount: (await load()).pending.length,
      message: 'Cloud edits are queued separately from provider delivery.' };
  }
  const watchedProviderPulls = new Set<string>();
  async function watchProviderPull(provider: 'anilist' | 'mal', requestedAt: number) {
    if (watchedProviderPulls.has(provider)) return;
    watchedProviderPulls.add(provider);
    try {
      const deadline = Date.now() + 10 * 60000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const status = await rpc('getProviderSyncStatus', [provider], user?.id);
        const completedAt = Date.parse(String(status.sync?.lastSuccessAt || ''));
        if (Number.isFinite(completedAt) && completedAt >= requestedAt) {
          refreshNeeded = true;
          await load();
          notify();
          return;
        }
        if (status.sync?.lastOutcome === 'reauthorization-required') return;
      }
    } catch { /* The worker keeps running; the regular cloud refresh will catch up. */ }
    finally { watchedProviderPulls.delete(provider); }
  }
  async function pullProvider(provider: 'anilist' | 'mal') {
    const queued = await rpc('requestProviderSync', [provider], user?.id);
    if (!queued.ok) return queued;
    const requestedAt = Date.parse(String(queued.requestedAt));
    if (Number.isFinite(requestedAt)) void watchProviderPull(provider, requestedAt);
    const label = provider === 'anilist' ? 'AniList' : 'MyAnimeList';
    return { ok: true, message: queued.alreadyQueued
      ? `${label} update is already running in the background.`
      : `${label} update started in the background. The first reconciliation may take several minutes.` };
  }
  async function previewImport(username: string, provider: 'anilist' | 'mal' = 'anilist') {
    const id = user?.id;
    if (!id) throw new Error('Sign in before importing.');
    const reply = await rpc(provider === 'mal' ? 'previewMalImport' : 'previewAniListImport', [username], id) as unknown as ImportPreview;
    if (user?.id !== id) throw new Error('The active account changed.');
    if (reply.ok) { importPreviews.clear(); importPreviews.set(`${provider}:${username.trim().toLowerCase()}`, reply); }
    return reply;
  }
  async function importProvider(username: string, statuses: string[] = [], keys: string[] = [], options: { signal?: AbortSignal } = {}, provider: 'anilist' | 'mal' = 'anilist') {
    const id = user?.id;
    if (!id) throw new Error('Sign in before importing.');
    if (options.signal?.aborted) return { ok: false, cancelled: true, message: 'Import cancelled.' };
    const preview = importPreviews.get(`${provider}:${username.trim().toLowerCase()}`) ?? await previewImport(username, provider);
    if (options.signal?.aborted) return { ok: false, cancelled: true, message: 'Import cancelled.' };
    if (!preview.ok) return preview;
    if (id !== user?.id) throw new Error('The active account changed.');
    const data: Record<string, Record<string, unknown>> = { entries: {}, mangaEntries: {}, anime: {}, manga: {} };
    let count = 0;
    for (const group of preview.preview.groups) for (const item of group.items) {
      if (statuses.length && !statuses.includes(group.status) || keys.length && !keys.includes(`${item.mediaType}:${item.animeId}`)) continue;
      const isAnime = item.mediaType === 'ANIME';
      const entry: Record<string, unknown> = { [isAnime ? 'anime_id' : 'manga_id']: item.animeId, status: item.status };
      const mapping = { progress: 'progress', score: 'score', notes: 'notes', startedAt: 'started_at', completedAt: 'completed_at', repeatCount: 'repeat_count', isRepeating: isAnime ? 'is_rewatching' : 'is_rereading', ...(!isAnime ? { volumeProgress: 'volume_progress' } : {}) };
      for (const [field, column] of Object.entries(mapping)) {
        const value = item[field as keyof ImportItem];
        if (value !== undefined) entry[column] = value;
      }
      // Provider imports never clear Seenary favorites.
      data[isAnime ? 'entries' : 'mangaEntries'][String(item.animeId)] = entry;
      data[isAnime ? 'anime' : 'manga'][String(item.animeId)] = { title_preferred: item.media.title.userPreferred, title_english: item.media.title.english, title_romaji: item.media.title.romaji,
        external_ids: { anilist: item.animeId > 0 ? item.animeId : null, mal: item.media.idMal ?? null } };
      count++;
    }
    await operate(async client => {
      if (client.userId !== id) throw new Error('The active account changed.');
      await client.stageImport({ format: 'seenary.local-backup', version: 4, username, data });
    });
    return { ok: true, message: `${count} entries prepared. Open Cloud saves to review and upload them.`, summary: { imported: 0, prepared: count, sourceUsername: username } };
  }
  const handlers: Record<string, (...args: never[]) => unknown> = {};
  // The facade translates the existing renderer contract at one boundary.
  const methods = {
    getSession: async () => {
      try { const reply = await rpc('getSession'); return { ...reply, user: await activate(reply.user as SessionUser ?? null) }; }
      catch (error) {
        const cached = JSON.parse(localStorage.getItem(sessionKey) || 'null') as SessionUser | null;
        if (!cached?.id) throw error;
        return { authenticated: true, offline: true, user: await activate(cached) };
      }
    },
    login: async (name: string, password: string) => { const reply = await rpc('login', [name, password]); return { ...reply, message: reply.message || reply.code || '', user: reply.user ? await activate(reply.user as SessionUser) : undefined }; },
    register: async (name: string, password: string) => { const reply = await rpc('register', [name, password]); return { ...reply, message: reply.message || reply.code || '', user: reply.user ? await activate(reply.user as SessionUser) : undefined }; },
    logout: async () => { const reply = await rpc('logout', [], user?.id); if (reply.ok) await activate(null); return reply; },
    getMyList: () => list('ANIME'), getMyMangaList: () => list('MANGA'),
    getMyListEntry: (id: number) => entry('ANIME', id), getMyMangaListEntry: (id: number) => entry('MANGA', id),
    saveMyListEntry: (id: number, data: Record<string, unknown>) => save('ANIME', id, data),
    saveMyMangaListEntry: (id: number, data: Record<string, unknown>) => save('MANGA', id, data),
    removeMyListEntry: (id: number) => save('ANIME', id, {}, 'delete'), removeMyMangaListEntry: (id: number) => save('MANGA', id, {}, 'delete'),
    clearMyList: (options?: { queueProviderDeletion?: boolean }) => clear('ANIME', options), clearMyMangaList: (options?: { queueProviderDeletion?: boolean }) => clear('MANGA', options), clearAllMediaLists: (options?: { queueProviderDeletion?: boolean }) => clear(undefined, options),
    getAnimeDetails: (id: number) => details('ANIME', id), getMediaDetails: (type: Entry['type'], id: number) => details(type, id),
    searchMedia: (text: string, hideAdultContent = true) => rpc('searchMedia', [text, hideAdultContent], user?.id),
    getDiscoverMedia: (hideAdultContent = true) => rpc('getDiscoverMedia', [hideAdultContent], user?.id),
    getDiscoverShelfAnime: (shelfId: string, page = 1, hideAdultContent = true, mediaType = 'ANIME') => rpc('getDiscoverShelfAnime', [shelfId, page, hideAdultContent, mediaType], user?.id),
    getStudioMedia: (id: number, page = 1, hideAdultContent = true) => rpc('getStudioMedia', [id, page, hideAdultContent], user?.id),
    getArtistMedia: (slug: string, page = 1, hideAdultContent = true) => rpc('getArtistMedia', [slug, page, hideAdultContent], user?.id),
    previewAniListImport: (username: string) => previewImport(username),
    previewMalImport: (username: string) => previewImport(username, 'mal'),
    importAniList: importProvider,
    importMal: (username: string, statuses: string[] = [], keys: string[] = [], options: { signal?: AbortSignal } = {}) => importProvider(username, statuses, keys, options, 'mal'),
    cacheMinimalAnime: (media: AnimeMedia) => cacheMinimal('ANIME', media), cacheMinimalManga: (media: AnimeMedia) => cacheMinimal('MANGA', media),
    getSettings: () => localStore.getSettings(preferenceId ?? 0),
    updateSettings: async (settings: Parameters<Api['updateSettings']>[0]) => {
      if (!preferenceId || !user?.id) throw new Error('Sign in first.');
      if (settings.analyticsConsentDecided === true && typeof settings.shareAnonymousUsageStatistics === 'boolean') {
        const result = await rpc('setAnalyticsConsent', [settings.shareAnonymousUsageStatistics], user.id);
        if (!result.ok) throw new Error('Unable to save the analytics choice.');
      }
      return localStore.updateSettings(preferenceId, settings);
    },
    getSyncStatus: syncStatus,
    setAutoSync: async (enabled: boolean) => { const result = await rpc('setAccountSettings', [{ autoSyncEnabled: enabled }], user?.id); return result.ok ? syncStatus() : result; },
    runSyncNow: sync,
    pullFromAniList: () => pullProvider('anilist'),
    pullFromMal: () => pullProvider('mal'),
    onAutoSyncComplete: (callback: (result: unknown) => void) => { listeners.add(callback); return () => listeners.delete(callback); },
    onSyncProgress: () => () => {},
    getAniListLinkStatus: () => linkStatus('anilist'), getMalLinkStatus: () => linkStatus('mal'),
    setLocalPassword: (password: string) => rpc('setLocalPassword', [password], user?.id),
    unlinkAniListAccount: (password: string) => rpc('unlinkProvider', [password], user?.id),
    unlinkMalAccount: (password: string) => rpc('unlinkProvider', [password], user?.id),
    recordEngagement: (payload: Parameters<Api['recordEngagement']>[0]) => rpc('recordEngagement', [payload], user?.id),
    exportLocalBackup: async (preferences: Record<string, unknown> = {}) => ({ format: 'seenary.cloud-backup', version: 1, userId: user?.id, exportedAt: new Date().toISOString(), state: await load(),
      data: { ...preferences, settings: await localStore.getSettings(preferenceId ?? 0) } }),
    importLocalBackup: async (backup: unknown) => {
      await operate(client => client.stageImport(backup));
      const data = (backup as { data?: Record<string, unknown> }).data;
      const settings = data?.settings && preferenceId ? await localStore.updateSettings(preferenceId, data.settings as Parameters<Api['updateSettings']>[0]) : undefined;
      return { ok: true, imported: 0, message: 'Backup staged. Open Cloud saves to review entries before uploading.', settings,
        portablePreferences: data?.portablePreferences, desktopPreferences: data?.desktopPreferences };
    },
    setTutorialDismissed: async () => ({ ok: true, user: user && { ...user, id: preferenceId, tutorial_dismissed: 1 } }),
  };
  Object.assign(handlers, methods);
  const publicReads = new Set(['searchMedia', 'getDiscoverMedia', 'getDiscoverShelfAnime', 'getStudioMedia', 'getArtistMedia', 'getAnimeThemeMusic', 'getCharacterDetails', 'getStaffDetails']);
  window.api = new Proxy(legacy, { get(target, property) {
    const name = String(property);
    if (handlers[name]) return handlers[name];
    if (publicReads.has(name)) return Reflect.get(target, property);
    return async () => ({ ok: false, message: 'This operation is not available in Atlas yet. Use Cloud saves to manage your library.' });
  } });
  const tick = async () => {
    if (!user || syncRunning) return;
    syncRunning = true;
    try { const result = await sync(); listeners.forEach(listener => listener(result)); }
    catch { /* Pending requests remain durable; the Cloud saves panel exposes their status. */ }
    finally { syncRunning = false; }
  };
  window.addEventListener('online', () => void tick());
  window.setInterval(() => void tick(), 60000);
}
