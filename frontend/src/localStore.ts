import type {
  AnimeMedia,
  AppSettings,
  CardDensity,
  DeletedListEntry,
  ImportPayload,
  ImportPreviewItem,
  ListStatus,
  LocalListEntry,
  LocalMangaListEntry,
  MangaImportItem,
  SaveListEntryPayload,
  SeenaryBackup,
  StoredAnime,
  StoredManga,
  SyncActivityItem,
  ThemeAccent,
  TrackedAnimeEntry,
  TrackedMangaEntry,
} from "./types/domain";

type LocalSettings = AppSettings;

type SyncProvider = "anilist" | "mal";
type SyncFailureRecord = {
  provider: SyncProvider;
  mediaType: "ANIME" | "MANGA";
  mediaId: number;
  animeTitle: string | null;
  attempts: number;
  lastError: string | null;
  operation: string;
  updatedAt: string;
  excludedAt: string | null;
  excludedBy?: "user" | "system" | null;
};

type LocalState = {
  version: 6;
  userId: number;
  settings: LocalSettings | null;
  anime: Record<string, StoredAnime>;
  entries: Record<string, LocalListEntry>;
  manga: Record<string, StoredManga>;
  mangaEntries: Record<string, LocalMangaListEntry>;
  dirtyEntries: Record<string, boolean>;
  deletedEntries: Record<string, DeletedListEntry>;
  dirtyMangaEntries: Record<string, boolean>;
  deletedMangaEntries: Record<string, DeletedListEntry>;
  syncHistory: SyncActivityItem[];
  syncFailures: Record<string, SyncFailureRecord>;
  autoSyncEnabled: boolean;
};

const SYNC_FAILURE_LIMIT = 5;

function getSyncProvider(operation: unknown): SyncProvider | null {
  const value = String(operation || "").toLowerCase();
  if (value.includes("anilist")) return "anilist";
  if (value.includes("mal")) return "mal";
  return null;
}

function getSyncMediaIdentity(item: Partial<SyncActivityItem>) {
  const mediaType = item.media_type === "MANGA" || Boolean(item.manga_id) ? "MANGA" : "ANIME";
  const mediaId = Number(mediaType === "MANGA" ? item.manga_id ?? item.anime_id : item.anime_id);
  return { mediaType, mediaId } as const;
}

function getSyncFailureKey(provider: SyncProvider, mediaType: "ANIME" | "MANGA", mediaId: number) {
  return `${provider}:${mediaType}:${mediaId}`;
}

function normalizeSyncFailures(value: unknown) {
  if (!isPlainRecord(value)) return {};
  const failures: Record<string, SyncFailureRecord> = {};
  for (const candidate of Object.values(value)) {
    if (!isPlainRecord(candidate)) continue;
    const provider = candidate.provider === "mal" ? "mal" : candidate.provider === "anilist" ? "anilist" : null;
    const mediaType = candidate.mediaType === "MANGA" ? "MANGA" : candidate.mediaType === "ANIME" ? "ANIME" : null;
    const mediaId = Number(candidate.mediaId);
    if (!provider || !mediaType || !Number.isInteger(mediaId) || mediaId <= 0) continue;
    const attempts = Math.min(100, Math.max(1, Math.round(Number(candidate.attempts) || 1)));
    failures[getSyncFailureKey(provider, mediaType, mediaId)] = {
      provider,
      mediaType,
      mediaId,
      animeTitle: typeof candidate.animeTitle === "string" ? candidate.animeTitle : null,
      attempts,
      lastError: typeof candidate.lastError === "string" ? candidate.lastError : null,
      operation: typeof candidate.operation === "string" ? candidate.operation : "sync_entry",
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
      excludedAt: typeof candidate.excludedAt === "string" ? candidate.excludedAt : null,
      excludedBy:
        candidate.excludedBy === "user" || candidate.excludedBy === "system"
          ? candidate.excludedBy
          : null,
    };
  }
  return failures;
}

function isExcludedForProvider(
  state: LocalState,
  provider: SyncProvider | null | undefined,
  mediaType: "ANIME" | "MANGA",
  mediaId: number
) {
  if (!provider) return false;
  return Boolean(state.syncFailures[getSyncFailureKey(provider, mediaType, mediaId)]?.excludedAt);
}

const DB_NAME = "seenary-local";
const DB_VERSION = 1;
const STATE_STORE = "userStates";
const LEGACY_STATE_PREFIX = "seenary.local-user.";
const LEGACY_MIGRATED_PREFIX = "seenary.indexeddb-migrated.";
const FALLBACK_STATE_PREFIX = "seenary.local-fallback.";
const BACKUP_FORMAT = "seenary.local-backup";
const BACKUP_VERSION = 4;
const DETAILS_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type ValidSeenaryBackup = SeenaryBackup & {
  format: string;
  data: NonNullable<SeenaryBackup["data"]>;
};

function isSeenaryBackup(value: unknown): value is ValidSeenaryBackup {
  if (!value || typeof value !== "object") return false;

  const candidate = value as SeenaryBackup;
  const version = Number(candidate.version ?? 1);
  return (
    candidate.format === BACKUP_FORMAT &&
    Number.isInteger(version) &&
    version >= 1 &&
    version <= BACKUP_VERSION &&
    isPlainRecord(candidate.data)
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getBackupRecord<T>(value: unknown): Record<string, T> {
  return isPlainRecord(value) ? (value as Record<string, T>) : {};
}

function getValidBackupEntries<T extends { anime_id?: number; manga_id?: number }>(
  value: unknown,
  idField: "anime_id" | "manga_id"
) {
  const valid: Array<[string, T]> = [];
  let skipped = 0;

  for (const [key, candidate] of Object.entries(getBackupRecord<T>(value))) {
    if (!isPlainRecord(candidate)) {
      skipped += 1;
      continue;
    }

    const mediaId = Number(candidate[idField] ?? key);
    if (!Number.isInteger(mediaId) || mediaId <= 0) {
      skipped += 1;
      continue;
    }

    valid.push([String(mediaId), { ...candidate, [idField]: mediaId }]);
  }

  return { valid, skipped };
}

function getValidBackupMedia<T extends { anime_id?: number; manga_id?: number }>(
  value: unknown,
  idField: "anime_id" | "manga_id"
) {
  return Object.fromEntries(
    Object.entries(getBackupRecord<T>(value)).flatMap(([key, candidate]) => {
      if (!isPlainRecord(candidate)) return [];
      const mediaId = Number(candidate[idField] ?? key);
      return Number.isInteger(mediaId) && mediaId > 0
        ? [[String(mediaId), { ...candidate, [idField]: mediaId }]]
        : [];
    })
  ) as Record<string, T>;
}

function mergeSyncHistory(current: SyncActivityItem[], incoming: unknown) {
  if (!Array.isArray(incoming)) return current;

  const merged = [...incoming.filter(isPlainRecord), ...current] as SyncActivityItem[];
  const seen = new Set<string>();

  return merged.filter((item) => {
    const signature = [
      item.media_type ?? "ANIME",
      item.manga_id ?? item.anime_id ?? "",
      item.operation ?? "",
      item.status ?? "",
      item.created_at ?? "",
    ].join(":");
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  }).slice(0, 150);
}

let dbPromise: Promise<IDBDatabase> | null = null;
let indexedDbUnavailable = false;

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  themeAccent: "violet",
  customAccentColor: "#a78bfa",
  titleLanguage: "userPreferred",
  showTrendingCarousel: true,
  autoRotateTrending: true,
  autoScrollHomeShelves: true,
  hideAdultContent: true,
  overlayOpacity: 100,
  overlayBackground: "solid",
  navbarStyle: "integrated",
  browseCardStyle: "default",
  backgroundDim: 65,
  animationLevel: "full",
  backgroundGlows: true,
  compactMode: false,
  discoverDensity: "balanced",
  homeDensity: "balanced",
  myListDensity: "balanced",
  startView: "home",
  shareAnonymousUsageStatistics: false,
  analyticsConsentDecided: false,
};

function normalizeAccentColor(value: unknown) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_LOCAL_SETTINGS.customAccentColor;
}

function normalizeDensity(value: unknown): CardDensity {
  const density = String(value || "");
  return ["comfortable", "balanced", "compact"].includes(density)
    ? (density as CardDensity)
    : DEFAULT_LOCAL_SETTINGS.discoverDensity;
}

function normalizeSettings(settings: Partial<LocalSettings> | null | undefined): LocalSettings {
  const themeAccent: ThemeAccent = ["violet", "rose", "amber", "emerald", "custom"].includes(
    String(settings?.themeAccent || "")
  )
    ? (String(settings?.themeAccent) as ThemeAccent)
    : DEFAULT_LOCAL_SETTINGS.themeAccent;

  return {
    ...DEFAULT_LOCAL_SETTINGS,
    ...(settings ?? {}),
    themeAccent,
    customAccentColor: normalizeAccentColor(settings?.customAccentColor),
    discoverDensity: normalizeDensity(settings?.discoverDensity),
    homeDensity: normalizeDensity(settings?.homeDensity),
    myListDensity: normalizeDensity(settings?.myListDensity),
    shareAnonymousUsageStatistics: settings?.shareAnonymousUsageStatistics === true,
    analyticsConsentDecided: settings?.analyticsConsentDecided === true,
  };
}

function openDb() {
  if (indexedDbUnavailable) {
    return Promise.reject(new Error("IndexedDB is unavailable."));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STATE_STORE)) {
        db.createObjectStore(STATE_STORE, { keyPath: "userId" });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      indexedDbUnavailable = true;
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

function runStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T> | T
) {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STATE_STORE, mode);
        const store = transaction.objectStore(STATE_STORE);
        let directResult: T | undefined;
        let requestResult: T | undefined;
        let settled = false;

        const rejectOnce = (error: unknown) => {
          if (settled) return;
          settled = true;
          reject(error);
        };

        try {
          const result = operation(store);

          if (result instanceof IDBRequest) {
            result.onsuccess = () => {
              requestResult = result.result;
            };
            result.onerror = () => rejectOnce(result.error);
          } else {
            directResult = result;
          }
        } catch (error) {
          rejectOnce(error);
          return;
        }

        transaction.oncomplete = () => {
          if (settled) return;
          settled = true;
          resolve((requestResult ?? directResult) as T);
        };
        transaction.onerror = () => rejectOnce(transaction.error);
        transaction.onabort = () => rejectOnce(transaction.error);
      })
  );
}

function createEmptyState(userId: number): LocalState {
  return {
    version: 6,
    userId,
    settings: null,
    anime: {},
    entries: {},
    manga: {},
    mangaEntries: {},
    dirtyEntries: {},
    deletedEntries: {},
    dirtyMangaEntries: {},
    deletedMangaEntries: {},
    syncHistory: [],
    syncFailures: {},
    autoSyncEnabled: true,
  };
}

function normalizeState(userId: number, value: Partial<LocalState> | null | undefined): LocalState {
  const mangaEntries =
    value?.mangaEntries && typeof value.mangaEntries === "object" ? value.mangaEntries : {};
  const needsMangaSyncBootstrap = Number(value?.version ?? 0) < 5;

  return {
    version: 6,
    userId,
    settings: value?.settings ?? null,
    anime: value?.anime && typeof value.anime === "object" ? value.anime : {},
    entries: value?.entries && typeof value.entries === "object" ? value.entries : {},
    manga: value?.manga && typeof value.manga === "object" ? value.manga : {},
    mangaEntries,
    dirtyEntries:
      value?.dirtyEntries && typeof value.dirtyEntries === "object" ? value.dirtyEntries : {},
    deletedEntries:
      value?.deletedEntries && typeof value.deletedEntries === "object" ? value.deletedEntries : {},
    dirtyMangaEntries:
      needsMangaSyncBootstrap
        ? Object.fromEntries(Object.keys(mangaEntries).map((key) => [key, true]))
        : value?.dirtyMangaEntries && typeof value.dirtyMangaEntries === "object"
          ? value.dirtyMangaEntries
          : {},
    deletedMangaEntries:
      value?.deletedMangaEntries && typeof value.deletedMangaEntries === "object"
        ? value.deletedMangaEntries
        : {},
    syncHistory: Array.isArray(value?.syncHistory) ? value.syncHistory : [],
    syncFailures: normalizeSyncFailures(value?.syncFailures),
    autoSyncEnabled:
      typeof value?.autoSyncEnabled === "boolean" ? value.autoSyncEnabled : true,
  };
}

function getLegacyStateKey(userId: number) {
  return `${LEGACY_STATE_PREFIX}${userId}`;
}

function getLegacyMigratedKey(userId: number) {
  return `${LEGACY_MIGRATED_PREFIX}${userId}`;
}

function getFallbackStateKey(userId: number) {
  return `${FALLBACK_STATE_PREFIX}${userId}`;
}

function readFallbackState(userId: number) {
  try {
    const raw = window.localStorage.getItem(getFallbackStateKey(userId));
    return raw ? normalizeState(userId, JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeFallbackState(userId: number, state: LocalState) {
  try {
    window.localStorage.setItem(
      getFallbackStateKey(userId),
      JSON.stringify(normalizeState(userId, state))
    );
    return true;
  } catch {
    return false;
  }
}

async function readLegacyState(userId: number, options: { ignoreMigrated?: boolean } = {}) {
  try {
    if (
      !options.ignoreMigrated &&
      window.localStorage.getItem(getLegacyMigratedKey(userId)) === "true"
    ) {
      return null;
    }

    const raw = window.localStorage.getItem(getLegacyStateKey(userId));
    return raw ? normalizeState(userId, JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function markLegacyMigrated(userId: number) {
  try {
    window.localStorage.setItem(getLegacyMigratedKey(userId), "true");
  } catch {
    // Keep IndexedDB usable even if localStorage is blocked.
  }
}

const stateCache = new Map<number, LocalState>();
const stateLoadPromises = new Map<number, Promise<LocalState>>();
const stateWriteQueues = new Map<number, Promise<void>>();

async function loadState(userId: number): Promise<LocalState> {
  if (!indexedDbUnavailable) {
    try {
      const stored = await runStore<LocalState | undefined>("readonly", (store) =>
        store.get(userId)
      );

      if (stored) {
        return normalizeState(userId, stored);
      }

      const legacyState = await readLegacyState(userId);
      const state = legacyState ?? readFallbackState(userId) ?? createEmptyState(userId);
      await writeState(userId, state);

      if (legacyState) {
        markLegacyMigrated(userId);
      }

      return state;
    } catch (error) {
      indexedDbUnavailable = true;
      dbPromise = null;
      console.warn("Seenary local database unavailable; using browser storage fallback.", error);
    }
  }

  const state =
    readFallbackState(userId) ??
    (await readLegacyState(userId, { ignoreMigrated: true })) ??
    createEmptyState(userId);
  writeFallbackState(userId, state);

  return state;
}

function readState(userId: number): Promise<LocalState> {
  const cached = stateCache.get(userId);
  if (cached) return Promise.resolve(cached);

  const activeLoad = stateLoadPromises.get(userId);
  if (activeLoad) return activeLoad;

  const load = loadState(userId)
    .then((state) => {
      stateCache.set(userId, state);
      return state;
    })
    .finally(() => {
      if (stateLoadPromises.get(userId) === load) {
        stateLoadPromises.delete(userId);
      }
    });

  stateLoadPromises.set(userId, load);
  return load;
}

function enqueueStateWrite(userId: number, operation: () => Promise<void>) {
  const previous = stateWriteQueues.get(userId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  stateWriteQueues.set(userId, next);

  return next.finally(() => {
    if (stateWriteQueues.get(userId) === next) {
      stateWriteQueues.delete(userId);
    }
  });
}

async function writeState(userId: number, state: LocalState) {
  const normalized = normalizeState(userId, state);
  stateCache.set(userId, normalized);

  if (indexedDbUnavailable) {
    writeFallbackState(userId, normalized);
    return;
  }

  await enqueueStateWrite(userId, async () => {
    try {
      await runStore("readwrite", (store) => store.put(normalized));
    } catch (error) {
      indexedDbUnavailable = true;
      dbPromise = null;
      writeFallbackState(userId, normalized);
      console.warn("Seenary local database write failed; using browser storage fallback.", error);
    }
  });
}

function toDateValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "object") {
    const fuzzyDate = value as { year?: unknown; month?: unknown; day?: unknown };
    const year = Number(fuzzyDate.year);
    if (!Number.isInteger(year) || year <= 0) return null;
    const month = Math.min(12, Math.max(1, Number(fuzzyDate.month) || 1));
    const day = Math.min(31, Math.max(1, Number(fuzzyDate.day) || 1));
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function toProviderTimestamp(value: unknown) {
  if (value === null || value === undefined || value === "") return null;

  const numericValue = Number(value);
  const date =
    Number.isFinite(numericValue) && numericValue > 0
      ? new Date(numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue)
      : new Date(String(value));

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeAnime(media: AnimeMedia): StoredAnime | null {
  if (!media?.id) return null;

  return {
    anime_id: Number(media.id),
    is_adult:
      media.isAdult === null || media.isAdult === undefined ? null : media.isAdult ? 1 : 0,
    title_romaji: media.title?.romaji ?? null,
    title_english: media.title?.english ?? null,
    title_native: media.title?.native ?? null,
    title_preferred: media.title?.userPreferred ?? null,
    cover_image_large: media.coverImage?.extraLarge ?? media.coverImage?.large ?? null,
    banner_image: media.bannerImage ?? null,
    episodes: media.episodes ?? null,
    format: media.format ?? null,
    anime_status: media.status ?? null,
    season: media.season ?? null,
    season_year: media.seasonYear ?? null,
    average_score: media.averageScore ?? null,
    mean_score: media.meanScore ?? null,
    popularity: media.popularity ?? null,
    favourites: media.favourites ?? null,
    duration: media.duration ?? null,
    source: media.source ?? null,
    country_of_origin: media.countryOfOrigin ?? null,
    start_date: media.startDate ?? null,
    end_date: media.endDate ?? null,
    next_airing_episode: media.nextAiringEpisode?.episode ?? null,
    next_airing_at: media.nextAiringEpisode?.airingAt ?? null,
    genres: media.genres ?? [],
    tags: media.tags ?? [],
    recommendations: media.recommendations?.nodes ?? [],
    external_ids: {
      anilist: String(media.id),
      mal:
        media.source && typeof media.source === "object" && media.source.provider === "mal"
          ? String(media.source.animeId)
          : null,
    },
    details: media,
    details_cached_at: new Date().toISOString(),
  };
}

function normalizeManga(media: AnimeMedia): StoredManga | null {
  if (!media?.id) return null;

  return {
    manga_id: Number(media.id),
    anime_id: Number(media.id),
    media_type: "MANGA",
    is_adult:
      media.isAdult === null || media.isAdult === undefined ? null : media.isAdult ? 1 : 0,
    title_romaji: media.title?.romaji ?? null,
    title_english: media.title?.english ?? null,
    title_native: media.title?.native ?? null,
    title_preferred: media.title?.userPreferred ?? null,
    cover_image_large: media.coverImage?.extraLarge ?? media.coverImage?.large ?? null,
    banner_image: media.bannerImage ?? null,
    chapters: media.chapters ?? null,
    episodes: media.chapters ?? null,
    volumes: media.volumes ?? null,
    format: media.format ?? null,
    anime_status: media.status ?? null,
    average_score: media.averageScore ?? null,
    mean_score: media.meanScore ?? null,
    popularity: media.popularity ?? null,
    favourites: media.favourites ?? null,
    source: typeof media.source === "string" ? media.source : null,
    country_of_origin: media.countryOfOrigin ?? null,
    genres: media.genres ?? [],
    tags: media.tags ?? [],
    recommendations: media.recommendations?.nodes ?? [],
    external_ids: {
      anilist: String(media.id),
      mal: media.idMal ? String(media.idMal) : null,
    },
    details: media,
    details_cached_at: new Date().toISOString(),
  };
}

function normalizePreviewAnime(item: ImportPreviewItem): StoredAnime | null {
  if (!item?.animeId) return null;

  return {
    anime_id: Number(item.animeId),
    is_adult:
      item.media?.isAdult === null || item.media?.isAdult === undefined
        ? null
        : item.media.isAdult
          ? 1
          : 0,
    title_romaji: item.title?.romaji ?? null,
    title_english: item.title?.english ?? null,
    title_native: item.title?.native ?? null,
    title_preferred: item.title?.userPreferred ?? null,
    cover_image_large: item.coverImage?.extraLarge ?? item.coverImage?.large ?? null,
    episodes: item.episodes ?? null,
    duration: item.media?.duration ?? null,
    format: item.format ?? null,
    season: item.season ?? null,
    season_year: item.seasonYear ?? null,
    average_score: item.averageScore ?? null,
    next_airing_episode: item.media?.nextAiringEpisode?.episode ?? null,
    next_airing_at: item.media?.nextAiringEpisode?.airingAt ?? null,
    genres: [],
    tags: item.media?.tags ?? [],
    recommendations: [],
    external_ids: {
      anilist: String(item.animeId),
      mal: item.source?.provider === "mal" ? String(item.source.animeId) : null,
    },
    details: item.media ?? null,
    details_cached_at: item.media ? new Date().toISOString() : null,
  };
}

function sanitizeStatus(status: unknown): ListStatus {
  const value = String(status || "").trim().toLowerCase();
  return ["planned", "watching", "completed", "paused", "dropped"].includes(value)
    ? (value as ListStatus)
    : "planned";
}

function buildEntry(
  animeId: number,
  payload: SaveListEntryPayload,
  existing: LocalListEntry | null,
  markLocalActivity = true
): LocalListEntry {
  const now = new Date().toISOString();
  const status = sanitizeStatus(payload?.status ?? existing?.status);
  let startedAt =
    payload?.startedAt !== undefined ? toDateValue(payload.startedAt) : existing?.started_at ?? null;
  let completedAt =
    payload?.completedAt !== undefined
      ? toDateValue(payload.completedAt)
      : existing?.completed_at ?? null;

  if (status === "watching" && !startedAt) {
    startedAt = todayDate();
  }

  if (status === "completed") {
    startedAt = startedAt || todayDate();
    completedAt = completedAt || todayDate();
  }

  if (!["completed", "dropped"].includes(status) && payload?.completedAt === undefined) {
    completedAt = null;
  }

  return {
    ...(existing ?? {}),
    anime_id: animeId,
    status,
    is_favorite:
      payload?.isFavorite === undefined ? existing?.is_favorite ?? 0 : payload.isFavorite ? 1 : 0,
    repeat_count: Math.max(
      0,
      Math.floor(Number(payload?.repeatCount ?? existing?.repeat_count ?? 0))
    ),
    is_rewatching:
      payload?.isRewatching === undefined
        ? existing?.is_rewatching ?? 0
        : payload.isRewatching
          ? 1
          : 0,
    progress: Math.max(0, Math.floor(Number(payload?.progress ?? existing?.progress ?? 0))),
    score:
      payload?.score === null || payload?.score === undefined || payload?.score === ""
        ? null
        : Number(payload.score),
    notes: payload?.notes ? String(payload.notes).trim() : null,
    started_at: startedAt,
    completed_at: completedAt,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    local_updated_at: markLocalActivity ? now : existing?.local_updated_at ?? null,
  };
}

function entriesMatch(left: LocalListEntry | null, right: LocalListEntry | null) {
  if (!left || !right) return false;

  return (
    left.status === right.status &&
    Number(left.is_favorite ?? 0) === Number(right.is_favorite ?? 0) &&
    Number(left.repeat_count ?? 0) === Number(right.repeat_count ?? 0) &&
    Number(left.is_rewatching ?? 0) === Number(right.is_rewatching ?? 0) &&
    Number(left.progress ?? 0) === Number(right.progress ?? 0) &&
    (left.score ?? null) === (right.score ?? null) &&
    (left.notes ?? null) === (right.notes ?? null) &&
    (left.started_at ?? null) === (right.started_at ?? null) &&
    (left.completed_at ?? null) === (right.completed_at ?? null)
  );
}

function mergeEntryWithAnime(entry: LocalListEntry, anime: StoredAnime): TrackedAnimeEntry {
  return {
    ...anime,
    ...entry,
    anime_id: entry.anime_id,
    next_airing_episode:
      anime.next_airing_episode ?? anime.details?.nextAiringEpisode?.episode ?? null,
    next_airing_at:
      anime.next_airing_at ?? anime.details?.nextAiringEpisode?.airingAt ?? null,
  };
}

function buildMangaEntry(
  mangaId: number,
  payload: SaveListEntryPayload,
  existing: LocalMangaListEntry | null,
  markLocalActivity = true
): LocalMangaListEntry {
  const compatibilityEntry: LocalListEntry | null = existing
    ? {
        ...existing,
        anime_id: mangaId,
        is_rewatching: existing.is_rereading,
      }
    : null;
  const base = buildEntry(mangaId, payload, compatibilityEntry, markLocalActivity);

  return {
    manga_id: mangaId,
    status: base.status,
    is_favorite: base.is_favorite,
    repeat_count: base.repeat_count,
    is_rereading:
      payload.isRereading === undefined
        ? existing?.is_rereading ?? 0
        : payload.isRereading
          ? 1
          : 0,
    progress: base.progress,
    volume_progress: Math.max(
      0,
      Math.floor(Number(payload.volumeProgress ?? existing?.volume_progress ?? 0))
    ),
    score: base.score,
    notes: base.notes,
    started_at: base.started_at,
    completed_at: base.completed_at,
    created_at: base.created_at,
    updated_at: base.updated_at,
    local_updated_at: base.local_updated_at,
    provider_updated_at: existing?.provider_updated_at ?? null,
  };
}

function mergeEntryWithManga(
  entry: LocalMangaListEntry,
  manga: StoredManga
): TrackedMangaEntry {
  return {
    ...manga,
    ...entry,
    anime_id: entry.manga_id,
    media_type: "MANGA",
    episodes: manga.chapters ?? null,
    is_rewatching: entry.is_rereading,
  };
}

function mangaEntriesMatch(left: LocalMangaListEntry | null, right: LocalMangaListEntry | null) {
  return Boolean(
    left &&
      right &&
      left.status === right.status &&
      Number(left.repeat_count ?? 0) === Number(right.repeat_count ?? 0) &&
      Number(left.is_rereading ?? 0) === Number(right.is_rereading ?? 0) &&
      Number(left.progress ?? 0) === Number(right.progress ?? 0) &&
      Number(left.volume_progress ?? 0) === Number(right.volume_progress ?? 0) &&
      (left.score ?? null) === (right.score ?? null) &&
      (left.notes ?? null) === (right.notes ?? null) &&
      (left.started_at ?? null) === (right.started_at ?? null) &&
      (left.completed_at ?? null) === (right.completed_at ?? null)
  );
}

export const localStore = {
  async pruneExpiredCachedDetails(
    userId: number,
    maxAgeMs = DETAILS_CACHE_MAX_AGE_MS
  ) {
    const state = await readState(userId);
    const cutoff = Date.now() - Math.max(0, maxAgeMs);
    let removedDetails = 0;

    for (const media of [...Object.values(state.anime), ...Object.values(state.manga)]) {
      if (!media.details || !media.details_cached_at) continue;
      const cachedAt = new Date(media.details_cached_at).getTime();
      if (!Number.isFinite(cachedAt) || cachedAt >= cutoff) continue;
      media.details = null;
      media.details_cached_at = null;
      media.tags = [];
      media.recommendations = [];
      removedDetails += 1;
    }

    if (removedDetails > 0) await writeState(userId, state);
    return { ok: true, removedDetails };
  },

  async repairCachedData(userId: number) {
    const state = await readState(userId);
    const trackedAnimeIds = new Set(Object.keys(state.entries));
    const trackedMangaIds = new Set(Object.keys(state.mangaEntries));
    let removedDetails = 0;
    let removedMedia = 0;

    for (const [key, media] of Object.entries(state.anime)) {
      if (!trackedAnimeIds.has(key)) {
        delete state.anime[key];
        removedMedia += 1;
        continue;
      }
      if (media.details) removedDetails += 1;
      media.details = null;
      media.details_cached_at = null;
      media.tags = [];
      media.recommendations = [];
    }
    for (const [key, media] of Object.entries(state.manga)) {
      if (!trackedMangaIds.has(key)) {
        delete state.manga[key];
        removedMedia += 1;
        continue;
      }
      if (media.details) removedDetails += 1;
      media.details = null;
      media.details_cached_at = null;
      media.tags = [];
      media.recommendations = [];
    }

    await writeState(userId, state);
    return { ok: true, removedDetails, removedMedia };
  },

  async getSettings(userId: number) {
    const state = await readState(userId);
    return normalizeSettings(state.settings);
  },

  async updateSettings(userId: number, settings: Partial<LocalSettings>) {
    const state = await readState(userId);
    state.settings = normalizeSettings({
      ...(state.settings ?? {}),
      ...settings,
    });
    await writeState(userId, state);
    return state.settings;
  },

  async getAutoSyncEnabled(userId: number) {
    return (await readState(userId)).autoSyncEnabled;
  },

  async setAutoSyncEnabled(userId: number, enabled: boolean) {
    const state = await readState(userId);
    state.autoSyncEnabled = enabled;
    await writeState(userId, state);
    return enabled;
  },

  async cacheAnime(userId: number, media: AnimeMedia) {
    const anime = normalizeAnime(media);
    if (!anime) return { ok: false, message: "Invalid anime data." };

    const state = await readState(userId);
    state.anime[String(anime.anime_id)] = {
      ...(state.anime[String(anime.anime_id)] ?? {}),
      ...anime,
    };
    await writeState(userId, state);
    return { ok: true };
  },

  async cacheManga(userId: number, media: AnimeMedia) {
    const manga = normalizeManga(media);
    if (!manga) return { ok: false, message: "Invalid manga data." };

    const state = await readState(userId);
    state.manga[String(manga.manga_id)] = {
      ...(state.manga[String(manga.manga_id)] ?? {}),
      ...manga,
    };
    await writeState(userId, state);
    return { ok: true };
  },

  async getCachedMediaDetails(userId: number, mediaType: "ANIME" | "MANGA", mediaId: number) {
    const state = await readState(userId);
    const stored =
      mediaType === "MANGA"
        ? state.manga[String(mediaId)]
        : state.anime[String(mediaId)];
    return stored?.details ?? null;
  },

  async cacheAnimeAdultFlags(
    userId: number,
    flags: Array<{ id?: number | null; isAdult?: boolean | null }>
  ) {
    const state = await readState(userId);

    for (const flag of flags) {
      const key = String(Number(flag.id));
      const anime = state.anime[key];
      if (!anime || flag.isAdult === null || flag.isAdult === undefined) continue;

      anime.is_adult = flag.isAdult ? 1 : 0;
      if (anime.details) {
        anime.details = { ...anime.details, isAdult: flag.isAdult };
      }
    }

    await writeState(userId, state);
  },

  async cacheAnimeListMetadata(
    userId: number,
    items: Array<{
      id?: number | null;
      isAdult?: boolean | null;
      episodes?: number | null;
      duration?: number | null;
    }>
  ) {
    const state = await readState(userId);

    for (const item of items) {
      const key = String(Number(item.id));
      const anime = state.anime[key];
      if (!anime) continue;

      if (typeof item.isAdult === "boolean") {
        anime.is_adult = item.isAdult ? 1 : 0;
      }
      if (typeof item.episodes === "number" && item.episodes > 0) {
        anime.episodes = item.episodes;
      }
      if (typeof item.duration === "number" && item.duration > 0) {
        anime.duration = item.duration;
      }
      if (anime.details) {
        anime.details = {
          ...anime.details,
          ...(typeof item.isAdult === "boolean" ? { isAdult: item.isAdult } : {}),
          ...(typeof item.episodes === "number" && item.episodes > 0
            ? { episodes: item.episodes }
            : {}),
          ...(typeof item.duration === "number" && item.duration > 0
            ? { duration: item.duration }
            : {}),
        };
      }
    }

    await writeState(userId, state);
  },

  async cachePreviewAnime(userId: number, item: ImportPreviewItem) {
    const anime = normalizePreviewAnime(item);
    if (!anime) return;

    const state = await readState(userId);
    state.anime[String(anime.anime_id)] = {
      ...(state.anime[String(anime.anime_id)] ?? {}),
      ...anime,
    };
    await writeState(userId, state);
  },

  async getList(userId: number) {
    const state = await readState(userId);
    return Object.values(state.entries)
      .map((entry) => mergeEntryWithAnime(entry, state.anime[String(entry.anime_id)] ?? {}))
      .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
  },

  async getMangaList(userId: number) {
    const state = await readState(userId);
    return Object.values(state.mangaEntries)
      .flatMap((entry) => {
        const manga = state.manga[String(entry.manga_id)];
        return manga ? [mergeEntryWithManga(entry, manga)] : [];
      })
      .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
  },

  async getMangaEntry(userId: number, mangaId: number) {
    const state = await readState(userId);
    const entry = state.mangaEntries[String(mangaId)];
    const manga = state.manga[String(mangaId)];
    if (!entry || !manga) return null;
    return mergeEntryWithManga(entry, manga);
  },

  async saveMangaEntry(
    userId: number,
    mangaId: number,
    payload: SaveListEntryPayload,
    options: { markLocalActivity?: boolean } = {}
  ) {
    const state = await readState(userId);
    const key = String(mangaId);
    const manga = state.manga[key];
    if (!manga) {
      return { ok: false, message: "Manga is not cached yet. Open its details first." };
    }

    const existing = state.mangaEntries[key] ?? null;
    state.mangaEntries[key] = buildMangaEntry(
      mangaId,
      payload,
      existing,
      options.markLocalActivity !== false
    );
    state.dirtyMangaEntries[key] = true;
    delete state.deletedMangaEntries[key];
    await writeState(userId, state);
    return {
      ok: true,
      message: existing ? "Manga list entry updated." : "Manga added to your list.",
      entry: mergeEntryWithManga(state.mangaEntries[key], manga),
    };
  },

  async removeMangaEntry(userId: number, mangaId: number) {
    const state = await readState(userId);
    const key = String(mangaId);
    if (!state.mangaEntries[key]) {
      return { ok: false, message: "Manga list entry not found." };
    }

    const manga = state.manga[key];
    state.deletedMangaEntries[key] = {
      manga_id: mangaId,
      media_type: "MANGA",
      external_ids: manga?.external_ids ?? { anilist: key, mal: null },
      title:
        manga?.title_preferred ??
        manga?.title_english ??
        manga?.title_romaji ??
        `Manga #${mangaId}`,
      deleted_at: new Date().toISOString(),
    };
    delete state.mangaEntries[key];
    delete state.dirtyMangaEntries[key];
    await writeState(userId, state);
    return { ok: true, message: "Manga removed from your list." };
  },

  async importLegacyEntries(userId: number, entries: TrackedAnimeEntry[]) {
    const state = await readState(userId);
    let imported = 0;

    for (const entry of entries) {
      const animeId = Number(entry?.anime_id);
      if (!Number.isInteger(animeId) || animeId <= 0 || state.entries[String(animeId)]) {
        continue;
      }

      state.anime[String(animeId)] = {
        anime_id: animeId,
        title_romaji: entry.title_romaji ?? null,
        title_english: entry.title_english ?? null,
        title_native: entry.title_native ?? null,
        title_preferred: entry.title_preferred ?? null,
        cover_image_large: entry.cover_image_large ?? null,
        banner_image: entry.banner_image ?? null,
        episodes: entry.episodes ?? null,
        duration: entry.duration ?? null,
        format: entry.format ?? null,
        anime_status: entry.anime_status ?? null,
        season: entry.season ?? null,
        season_year: entry.season_year ?? null,
        average_score: entry.average_score ?? null,
        next_airing_episode: entry.next_airing_episode ?? null,
        next_airing_at: entry.next_airing_at ?? null,
        genres: entry.genres ?? [],
        recommendations: entry.recommendations ?? [],
      };
      state.entries[String(animeId)] = {
        anime_id: animeId,
        status: entry.status,
        is_favorite: entry.is_favorite ?? 0,
        repeat_count: entry.repeat_count ?? 0,
        is_rewatching: entry.is_rewatching ?? 0,
        progress: entry.progress ?? 0,
        score: entry.score ?? null,
        notes: entry.notes ?? null,
        started_at: entry.started_at ?? null,
        completed_at: entry.completed_at ?? null,
        created_at: entry.created_at ?? new Date().toISOString(),
        updated_at: entry.updated_at ?? new Date().toISOString(),
        local_updated_at: entry.local_updated_at ?? null,
      };
      imported += 1;
    }

    if (imported > 0) {
      await writeState(userId, state);
    }

    return imported;
  },

  async getEntry(userId: number, animeId: number) {
    const state = await readState(userId);
    const entry = state.entries[String(animeId)];
    if (!entry) return null;
    return mergeEntryWithAnime(entry, state.anime[String(animeId)] ?? {});
  },

  async saveEntry(
    userId: number,
    animeId: number,
    payload: SaveListEntryPayload,
    options: { markDirty?: boolean; markLocalActivity?: boolean } = {}
  ) {
    const state = await readState(userId);
    const key = String(animeId);
    const existing = state.entries[key] ?? null;
    const nextEntry = buildEntry(
      animeId,
      payload,
      existing,
      options.markLocalActivity !== false
    );

    if (existing && entriesMatch(existing, nextEntry)) {
      return {
        ok: true,
        unchanged: true,
        message: "List entry already up to date.",
        entry: mergeEntryWithAnime(existing, state.anime[key] ?? {}),
      };
    }

    state.entries[key] = nextEntry;
    if (options.markDirty !== false) {
      state.dirtyEntries[key] = true;
    } else {
      delete state.dirtyEntries[key];
    }
    delete state.deletedEntries[key];
    await writeState(userId, state);

    return {
      ok: true,
      message: existing ? "List entry updated." : "Anime added to your list.",
      entry: mergeEntryWithAnime(state.entries[key], state.anime[key] ?? {}),
    };
  },

  async removeEntry(userId: number, animeId: number) {
    const state = await readState(userId);
    const key = String(animeId);
    if (!state.entries[key]) {
      return { ok: false, message: "Entry not found." };
    }

    state.deletedEntries[key] = {
      anime_id: animeId,
      external_ids: state.anime[key]?.external_ids ?? { anilist: key, mal: null },
      title:
        state.anime[key]?.title_preferred ??
        state.anime[key]?.title_english ??
        state.anime[key]?.title_romaji ??
        `Anime #${animeId}`,
      deleted_at: new Date().toISOString(),
    };
    delete state.entries[key];
    delete state.dirtyEntries[key];
    await writeState(userId, state);
    return { ok: true, message: "Anime removed from your list." };
  },

  async clearList(
    userId: number,
    options: { queueProviderDeletion?: boolean } = {}
  ) {
    const state = await readState(userId);
    const removedCount = Object.keys(state.entries).length;
    const queueProviderDeletion = options.queueProviderDeletion !== false;
    if (queueProviderDeletion) {
      state.deletedEntries = {
        ...state.deletedEntries,
        ...Object.fromEntries(
          Object.keys(state.entries).map((key) => [
            key,
            {
              anime_id: Number(key),
              external_ids: state.anime[key]?.external_ids ?? { anilist: key, mal: null },
              title:
                state.anime[key]?.title_preferred ??
                state.anime[key]?.title_english ??
                state.anime[key]?.title_romaji ??
                `Anime #${key}`,
              deleted_at: new Date().toISOString(),
            },
          ])
        ),
      };
    }
    state.entries = {};
    state.dirtyEntries = {};
    await writeState(userId, state);
    return {
      ok: true,
      message:
        removedCount > 0
          ? `Cleared ${removedCount} entr${removedCount === 1 ? "y" : "ies"} from your list.${queueProviderDeletion ? "" : " No linked-service deletions were queued."}`
          : "Your list was already empty.",
      removedCount,
      animeRemovedCount: removedCount,
      mangaRemovedCount: 0,
    };
  },

  async clearMangaList(
    userId: number,
    options: { queueProviderDeletion?: boolean } = {}
  ) {
    const state = await readState(userId);
    const removedCount = Object.keys(state.mangaEntries).length;
    const queueProviderDeletion = options.queueProviderDeletion !== false;
    if (queueProviderDeletion) {
      state.deletedMangaEntries = {
        ...state.deletedMangaEntries,
        ...Object.fromEntries(
          Object.keys(state.mangaEntries).map((key) => [
            key,
            {
              manga_id: Number(key),
              media_type: "MANGA" as const,
              external_ids: state.manga[key]?.external_ids ?? { anilist: key, mal: null },
              title:
                state.manga[key]?.title_preferred ??
                state.manga[key]?.title_english ??
                state.manga[key]?.title_romaji ??
                `Manga #${key}`,
              deleted_at: new Date().toISOString(),
            },
          ])
        ),
      };
    }
    state.mangaEntries = {};
    state.dirtyMangaEntries = {};
    await writeState(userId, state);
    return {
      ok: true,
      message:
        removedCount > 0
          ? `Cleared ${removedCount} Manga entr${removedCount === 1 ? "y" : "ies"} from your list.${queueProviderDeletion ? "" : " No linked-service deletions were queued."}`
          : "Your Manga list was already empty.",
      removedCount,
      animeRemovedCount: 0,
      mangaRemovedCount: removedCount,
    };
  },

  async clearAllLists(
    userId: number,
    options: { queueProviderDeletion?: boolean } = {}
  ) {
    const state = await readState(userId);
    const animeRemovedCount = Object.keys(state.entries).length;
    const mangaRemovedCount = Object.keys(state.mangaEntries).length;
    const now = new Date().toISOString();

    const queueProviderDeletion = options.queueProviderDeletion !== false;
    if (queueProviderDeletion) {
      state.deletedEntries = {
        ...state.deletedEntries,
        ...Object.fromEntries(
          Object.keys(state.entries).map((key) => [
            key,
            {
              anime_id: Number(key),
              media_type: "ANIME" as const,
              external_ids: state.anime[key]?.external_ids ?? { anilist: key, mal: null },
              title:
                state.anime[key]?.title_preferred ??
                state.anime[key]?.title_english ??
                state.anime[key]?.title_romaji ??
                `Anime #${key}`,
              deleted_at: now,
            },
          ])
        ),
      };
      state.deletedMangaEntries = {
        ...state.deletedMangaEntries,
        ...Object.fromEntries(
          Object.keys(state.mangaEntries).map((key) => [
            key,
            {
              manga_id: Number(key),
              media_type: "MANGA" as const,
              external_ids: state.manga[key]?.external_ids ?? { anilist: key, mal: null },
              title:
                state.manga[key]?.title_preferred ??
                state.manga[key]?.title_english ??
                state.manga[key]?.title_romaji ??
                `Manga #${key}`,
              deleted_at: now,
            },
          ])
        ),
      };
    }
    state.entries = {};
    state.mangaEntries = {};
    state.dirtyEntries = {};
    state.dirtyMangaEntries = {};
    await writeState(userId, state);

    const removedCount = animeRemovedCount + mangaRemovedCount;
    return {
      ok: true,
      message:
        removedCount > 0
          ? `Cleared ${animeRemovedCount} Anime and ${mangaRemovedCount} Manga entries.${queueProviderDeletion ? "" : " No linked-service deletions were queued."}`
          : "Both of your media lists were already empty.",
      removedCount,
      animeRemovedCount,
      mangaRemovedCount,
    };
  },

  async deleteUserData(userId: number) {
    await enqueueStateWrite(userId, async () => {
      if (!indexedDbUnavailable) {
        try {
          await runStore("readwrite", (store) => store.delete(userId));
        } catch (error) {
          indexedDbUnavailable = true;
          dbPromise = null;
          console.warn("Seenary local database deletion failed; clearing browser fallback.", error);
        }
      }
    });

    stateCache.delete(userId);
    stateLoadPromises.delete(userId);

    try {
      window.localStorage.removeItem(getLegacyStateKey(userId));
      window.localStorage.removeItem(getLegacyMigratedKey(userId));
      window.localStorage.removeItem(getFallbackStateKey(userId));
    } catch {
      // The server-side account is already deleted; blocked storage needs no further action.
    }
  },

  async getSyncPayload(userId: number, provider?: SyncProvider | null) {
    const state = await readState(userId);
    const entries = Object.keys(state.dirtyEntries).flatMap((key) => {
      const entry = state.entries[key];
      if (!entry || isExcludedForProvider(state, provider, "ANIME", entry.anime_id)) return [];
      const anime = state.anime[String(entry.anime_id)] ?? {};

      return [
        {
          ...entry,
          title_romaji: anime.title_romaji ?? null,
          title_english: anime.title_english ?? null,
          title_native: anime.title_native ?? null,
          title_preferred: anime.title_preferred ?? null,
          episodes: anime.episodes ?? null,
          season_year: anime.season_year ?? null,
          external_ids: anime.external_ids ?? { anilist: String(entry.anime_id), mal: null },
        },
      ];
    });

    const mangaEntries = Object.keys(state.dirtyMangaEntries).flatMap((key) => {
      const entry = state.mangaEntries[key];
      if (!entry || isExcludedForProvider(state, provider, "MANGA", entry.manga_id)) return [];
      const manga = state.manga[String(entry.manga_id)] ?? {};

      return [
        {
          ...entry,
          media_type: "MANGA" as const,
          title_romaji: manga.title_romaji ?? null,
          title_english: manga.title_english ?? null,
          title_native: manga.title_native ?? null,
          title_preferred: manga.title_preferred ?? null,
          chapters: manga.chapters ?? null,
          volumes: manga.volumes ?? null,
          external_ids: manga.external_ids ?? { anilist: String(entry.manga_id), mal: null },
        },
      ];
    });

    return {
      entries,
      deletedEntries: Object.values(state.deletedEntries).filter(
        (entry) => !isExcludedForProvider(state, provider, "ANIME", Number(entry.anime_id))
      ),
      mangaEntries,
      deletedMangaEntries: Object.values(state.deletedMangaEntries).filter(
        (entry) => !isExcludedForProvider(state, provider, "MANGA", Number(entry.manga_id))
      ),
    };
  },

  async getPendingSyncCount(userId: number, provider?: SyncProvider | null) {
    const state = await readState(userId);
    return (
      Object.keys(state.dirtyEntries).filter(
        (key) => !isExcludedForProvider(state, provider, "ANIME", Number(key))
      ).length +
      Object.values(state.deletedEntries).filter(
        (entry) => !isExcludedForProvider(state, provider, "ANIME", Number(entry.anime_id))
      ).length +
      Object.keys(state.dirtyMangaEntries).filter(
        (key) => !isExcludedForProvider(state, provider, "MANGA", Number(key))
      ).length +
      Object.values(state.deletedMangaEntries).filter(
        (entry) => !isExcludedForProvider(state, provider, "MANGA", Number(entry.manga_id))
      ).length
    );
  },

  async markSynced(userId: number, result: ImportPayload) {
    const state = await readState(userId);
    const now = new Date().toISOString();
    let newlyExcluded = 0;
    const failedKeys = new Set(
      (result?.activity ?? [])
        .filter((item) => item?.status !== "completed")
        .map((item) =>
          item.media_type === "MANGA" || item.manga_id
            ? `MANGA:${item.manga_id ?? item.anime_id}`
            : `ANIME:${item.anime_id}`
        )
    );
    for (const item of result?.activity ?? []) {
      const provider = getSyncProvider(item?.operation);
      const { mediaType, mediaId } = getSyncMediaIdentity(item ?? {});
      if (provider && Number.isInteger(mediaId) && mediaId > 0) {
        const failureKey = getSyncFailureKey(provider, mediaType, mediaId);
        if (item?.status === "completed") {
          delete state.syncFailures[failureKey];
        } else if (item?.status === "failed") {
          const previous = state.syncFailures[failureKey];
          const attempts = (previous?.attempts ?? 0) + 1;
          const excludedAt = attempts >= SYNC_FAILURE_LIMIT ? previous?.excludedAt ?? now : null;
          if (excludedAt && !previous?.excludedAt) newlyExcluded += 1;
          state.syncFailures[failureKey] = {
            provider,
            mediaType,
            mediaId,
            animeTitle: String(item.animeTitle || "") || previous?.animeTitle || null,
            attempts,
            lastError: String(item.message || "") || previous?.lastError || null,
            operation: String(item.operation || previous?.operation || "sync_entry"),
            updatedAt: now,
            excludedAt,
            excludedBy: excludedAt ? previous?.excludedBy ?? "system" : null,
          };
        }
      }

      if (item?.status !== "completed") continue;
      const isManga = mediaType === "MANGA";
      if (!mediaId || failedKeys.has(`${isManga ? "MANGA" : "ANIME"}:${mediaId}`)) continue;

      if (isManga) {
        delete state.dirtyMangaEntries[String(mediaId)];
        if (String(item.operation || "").startsWith("delete_")) {
          delete state.deletedMangaEntries[String(mediaId)];
        }
      } else {
        delete state.dirtyEntries[String(mediaId)];
        if (String(item.operation || "").startsWith("delete_")) {
          delete state.deletedEntries[String(mediaId)];
        }
      }
    }
    state.syncHistory = [
      ...(result.activity ?? []).map((item) => ({
        ...item,
        created_at: item.created_at ?? new Date().toISOString(),
      })),
      ...state.syncHistory,
    ].slice(0, 100);
    await writeState(userId, state);
    return { newlyExcluded };
  },

  async restoreSyncExclusion(
    userId: number,
    provider: SyncProvider,
    mediaType: "ANIME" | "MANGA",
    mediaId: number
  ) {
    const state = await readState(userId);
    const key = getSyncFailureKey(provider, mediaType, mediaId);
    if (!state.syncFailures[key]?.excludedAt) {
      return { ok: false, message: "This sync entry is not excluded." };
    }

    delete state.syncFailures[key];
    if (mediaType === "MANGA") {
      if (state.mangaEntries[String(mediaId)]) state.dirtyMangaEntries[String(mediaId)] = true;
    } else if (state.entries[String(mediaId)]) {
      state.dirtyEntries[String(mediaId)] = true;
    }
    await writeState(userId, state);
    return { ok: true, message: "The entry was restored to the sync queue." };
  },

  async excludeSyncEntry(
    userId: number,
    provider: SyncProvider,
    mediaType: "ANIME" | "MANGA",
    mediaId: number
  ) {
    const state = await readState(userId);
    const key = getSyncFailureKey(provider, mediaType, mediaId);
    const failure = state.syncFailures[key];
    if (!failure || failure.attempts < 1 || failure.excludedAt) {
      return { ok: false, message: "Only queued entries with a failed attempt can be excluded." };
    }

    const now = new Date().toISOString();
    state.syncFailures[key] = {
      ...failure,
      excludedAt: now,
      excludedBy: "user",
      updatedAt: now,
    };
    await writeState(userId, state);
    return { ok: true, message: "The entry was excluded by the user from automatic sync." };
  },

  async replaceEntriesFromImport(userId: number, importResult: ImportPayload) {
    const items = importResult.localEntries ?? [];
    const mangaItems = (importResult.localMangaEntries ?? []) as MangaImportItem[];
    const state = await readState(userId);
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const changes: Array<{ animeId: number; animeTitle: string }> = [];

    for (const item of items) {
      const animeId = Number(item?.animeId);
      if (!Number.isInteger(animeId) || animeId <= 0) {
        continue;
      }

      const key = String(animeId);
      const anime = normalizePreviewAnime(item);
      if (anime) {
        state.anime[key] = {
          ...(state.anime[key] ?? {}),
          ...anime,
        };
      }

      const existing = state.entries[key] ?? null;
      const nextEntry = buildEntry(
        animeId,
        {
          status: item.status,
          progress: item.progress ?? 0,
          score: item.score ?? null,
          notes: item.notes ?? null,
          startedAt: toDateValue(item.startedAt),
          completedAt: toDateValue(item.completedAt),
          repeatCount: item.repeatCount ?? 0,
        },
        existing,
        false
      );
      // Imports must preserve the provider's dates exactly. buildEntry supplies
      // convenient default dates for local edits, but a remote null is not "today".
      nextEntry.started_at = toDateValue(item.startedAt);
      nextEntry.completed_at = toDateValue(item.completedAt);
      const providerUpdatedAt = toProviderTimestamp(item.providerUpdatedAt);
      nextEntry.provider_updated_at =
        providerUpdatedAt ?? existing?.provider_updated_at ?? null;

      if (existing && entriesMatch(existing, nextEntry)) {
        if (providerUpdatedAt) {
          existing.provider_updated_at = providerUpdatedAt;
        }
        unchanged += 1;
        delete state.dirtyEntries[key];
        delete state.deletedEntries[key];
        continue;
      }

      state.entries[key] = nextEntry;
      delete state.dirtyEntries[key];
      delete state.deletedEntries[key];

      if (existing) {
        updated += 1;
      } else {
        created += 1;
      }

      changes.push({
        animeId,
        animeTitle:
          anime?.title_preferred ??
          anime?.title_english ??
          anime?.title_romaji ??
          `Anime #${animeId}`,
      });
    }

    for (const item of mangaItems) {
      const mangaId = Number(item?.mangaId);
      if (!Number.isInteger(mangaId) || mangaId <= 0 || !item.media) continue;

      const key = String(mangaId);
      const manga = normalizeManga(item.media);
      if (manga) {
        state.manga[key] = { ...(state.manga[key] ?? {}), ...manga };
      }

      const existing = state.mangaEntries[key] ?? null;
      const nextEntry = buildMangaEntry(
        mangaId,
        {
          status: item.status,
          progress: item.progress ?? 0,
          volumeProgress: item.volumeProgress ?? 0,
          score: item.score ?? null,
          notes: item.notes ?? null,
          startedAt: toDateValue(item.startedAt),
          completedAt: toDateValue(item.completedAt),
          repeatCount: item.repeatCount ?? 0,
          isRereading: item.isRereading ?? false,
        },
        existing,
        false
      );
      nextEntry.started_at = toDateValue(item.startedAt);
      nextEntry.completed_at = toDateValue(item.completedAt);
      const providerUpdatedAt = toProviderTimestamp(item.providerUpdatedAt);
      nextEntry.provider_updated_at =
        providerUpdatedAt ?? existing?.provider_updated_at ?? null;

      if (existing && mangaEntriesMatch(existing, nextEntry)) {
        if (providerUpdatedAt) {
          existing.provider_updated_at = providerUpdatedAt;
        }
        unchanged += 1;
        delete state.dirtyMangaEntries[key];
        delete state.deletedMangaEntries[key];
        continue;
      }

      state.mangaEntries[key] = nextEntry;
      delete state.dirtyMangaEntries[key];
      delete state.deletedMangaEntries[key];
      if (existing) updated += 1;
      else created += 1;
      changes.push({
        animeId: mangaId,
        animeTitle:
          manga?.title_preferred ??
          manga?.title_english ??
          manga?.title_romaji ??
          `Manga #${mangaId}`,
      });
    }

    await writeState(userId, state);

    return {
      created,
      updated,
      unchanged,
      imported: created + updated,
      changes,
    };
  },

  async recordPullActivity(
    userId: number,
    provider: "anilist" | "mal",
    message: string,
    summary: { created: number; updated: number; unchanged: number },
    options: {
      partial?: boolean;
      mappingFailures?: Array<{
        malAnimeId?: number | null;
        malMangaId?: number | null;
        mediaType?: "ANIME" | "MANGA";
        title?: string | null;
        reason?: string | null;
        message?: string | null;
      }>;
    } = {}
  ) {
    const state = await readState(userId);
    const now = new Date().toISOString();
    const providerLabel = provider === "mal" ? "MyAnimeList" : "AniList";
    const failures = options.mappingFailures ?? [];
    const baseId = Date.now();
    const failureItems: SyncActivityItem[] = failures.map((failure, index) => {
      const isManga = failure.mediaType === "MANGA" || Boolean(failure.malMangaId);
      const mediaId = Number(failure.malMangaId ?? failure.malAnimeId);
      return {
        id: baseId + index,
        anime_id: isManga || !Number.isInteger(mediaId) ? null : mediaId,
        manga_id: isManga && Number.isInteger(mediaId) ? mediaId : null,
        media_type: isManga ? "MANGA" : "ANIME",
        animeTitle: failure.title || `${providerLabel} mapping conflict`,
        operation: `pull_from_${provider}_unmapped`,
        status: "partial",
        created_at: now,
        message:
          failure.message ||
          `No safe one-to-one ${providerLabel} mapping was available for this entry.`,
        changedFields: [
          {
            field: provider === "mal" ? "MyAnimeList ID" : "External ID",
            from: null,
            to: Number.isInteger(mediaId) ? mediaId : null,
          },
          { field: "reason", from: null, to: failure.reason || "mapping_conflict" },
        ],
      };
    });
    const summaryItem: SyncActivityItem = {
      id: baseId + failures.length,
      anime_id: null,
      media_type: "ANIME",
      animeTitle: `${providerLabel} pull summary`,
      operation: `pull_summary_${provider}`,
      status: options.partial ? "partial" : "completed",
      created_at: now,
      message,
      changedFields: [
        { field: "created", from: null, to: summary.created },
        { field: "updated", from: null, to: summary.updated },
        { field: "unchanged", from: null, to: summary.unchanged },
        { field: "mapping conflicts", from: null, to: failures.length },
      ],
    };

    state.syncHistory = [summaryItem, ...failureItems, ...state.syncHistory].slice(0, 150);
    await writeState(userId, state);
  },

  async getSyncActivity(userId: number, provider?: SyncProvider | null) {
    const state = await readState(userId);
    const isPullActivity = (item: SyncActivityItem) =>
      String(item.operation || "").startsWith("pull_");
    const enrichTitleFields = (item: SyncActivityItem): SyncActivityItem => {
      const isManga = item.media_type === "MANGA" || Boolean(item.manga_id);
      const mediaId = Number(isManga ? item.manga_id : item.anime_id);
      const media = Number.isInteger(mediaId)
        ? isManga
          ? state.manga[String(mediaId)]
          : state.anime[String(mediaId)]
        : null;
      return media
        ? {
            ...item,
            title_preferred: media.title_preferred ?? null,
            title_english: media.title_english ?? null,
            title_romaji: media.title_romaji ?? null,
            title_native: media.title_native ?? null,
          }
        : item;
    };
    const enrichPendingFailure = (item: SyncActivityItem): SyncActivityItem => {
      const { mediaType, mediaId } = getSyncMediaIdentity(item);
      if (!provider || !Number.isInteger(mediaId) || mediaId <= 0) return item;
      const failure = state.syncFailures[getSyncFailureKey(provider, mediaType, mediaId)];
      if (!failure || failure.excludedAt) return item;
      return {
        ...item,
        provider,
        attempts: failure.attempts,
        last_error: failure.lastError,
      };
    };
    return {
      pending: ([
        ...Object.keys(state.dirtyEntries).flatMap((key) => {
          const entry = state.entries[key];
          if (!entry || isExcludedForProvider(state, provider, "ANIME", entry.anime_id)) return [];
          return [
            {
              id: -Math.abs(entry.anime_id),
              anime_id: entry.anime_id,
              animeTitle:
                state.anime[String(entry.anime_id)]?.title_preferred ??
                state.anime[String(entry.anime_id)]?.title_english ??
                state.anime[String(entry.anime_id)]?.title_romaji ??
                `Anime #${entry.anime_id}`,
              operation: "upsert_local_entry",
              status: "pending",
              created_at: entry.updated_at ?? new Date().toISOString(),
            },
          ];
        }),
        ...Object.values(state.deletedEntries).filter(
          (entry) => !isExcludedForProvider(state, provider, "ANIME", Number(entry.anime_id))
        ).map((entry) => ({
          id: -Math.abs(Number(entry.anime_id)) - 1_000_000,
          anime_id: entry.anime_id,
          animeTitle: entry.title,
          operation: "delete_local_entry",
          status: "pending",
          created_at: entry.deleted_at ?? new Date().toISOString(),
        })),
        ...Object.keys(state.dirtyMangaEntries).flatMap((key) => {
          const entry = state.mangaEntries[key];
          if (!entry || isExcludedForProvider(state, provider, "MANGA", entry.manga_id)) return [];
          return [
            {
              id: -Math.abs(entry.manga_id) - 2_000_000,
              manga_id: entry.manga_id,
              media_type: "MANGA" as const,
              animeTitle:
                state.manga[key]?.title_preferred ??
                state.manga[key]?.title_english ??
                state.manga[key]?.title_romaji ??
                `Manga #${entry.manga_id}`,
              operation: "upsert_local_manga_entry",
              status: "pending",
              created_at: entry.updated_at ?? new Date().toISOString(),
            },
          ];
        }),
        ...Object.values(state.deletedMangaEntries).filter(
          (entry) => !isExcludedForProvider(state, provider, "MANGA", Number(entry.manga_id))
        ).map((entry) => ({
          id: -Math.abs(Number(entry.manga_id)) - 3_000_000,
          manga_id: entry.manga_id,
          media_type: "MANGA" as const,
          animeTitle: entry.title,
          operation: "delete_local_manga_entry",
          status: "pending",
          created_at: entry.deleted_at ?? new Date().toISOString(),
        })),
      ] as SyncActivityItem[]).map(enrichPendingFailure).map(enrichTitleFields),
      completed: state.syncHistory.filter(
        (item) => item.status === "completed" && !isPullActivity(item)
      ).map(enrichTitleFields),
      failed: state.syncHistory.filter(
        (item) => item.status === "failed" && !isPullActivity(item)
      ).map(enrichTitleFields),
      pulled: state.syncHistory.filter(isPullActivity).map(enrichTitleFields),
      excluded: Object.values(state.syncFailures)
        .filter((failure) => Boolean(failure.excludedAt))
        .sort((left, right) => String(right.excludedAt).localeCompare(String(left.excludedAt)))
        .map((failure, index) =>
          enrichTitleFields({
            id: -4_000_000 - index - failure.mediaId,
            anime_id: failure.mediaType === "ANIME" ? failure.mediaId : null,
            manga_id: failure.mediaType === "MANGA" ? failure.mediaId : null,
            media_type: failure.mediaType,
            animeTitle: failure.animeTitle,
            operation: failure.operation,
            provider: failure.provider,
            status: "excluded",
            excluded_by: failure.excludedBy ?? (failure.attempts >= SYNC_FAILURE_LIMIT ? "system" : "user"),
            attempts: failure.attempts,
            last_error: failure.lastError,
            message: failure.lastError,
            created_at: failure.excludedAt ?? failure.updatedAt,
            updated_at: failure.updatedAt,
          })
        ),
    };
  },

  async exportBackup(
    userId: number,
    username: string,
    preferenceBundle: {
      portablePreferences?: unknown;
      desktopPreferences?: unknown;
    } = {}
  ) {
    const state = await readState(userId);

    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      username,
      data: {
        settings: state.settings,
        anime: state.anime,
        entries: state.entries,
        manga: state.manga,
        mangaEntries: state.mangaEntries,
        dirtyEntries: state.dirtyEntries,
        deletedEntries: state.deletedEntries,
        dirtyMangaEntries: state.dirtyMangaEntries,
        deletedMangaEntries: state.deletedMangaEntries,
        syncHistory: state.syncHistory,
        syncFailures: state.syncFailures,
        autoSyncEnabled: state.autoSyncEnabled,
        portablePreferences: preferenceBundle.portablePreferences,
        desktopPreferences: preferenceBundle.desktopPreferences,
      },
    };
  },

  async importBackup(userId: number, backup: unknown) {
    if (!isSeenaryBackup(backup)) {
      return {
        ok: false,
        message: "This does not look like a Seenary backup file.",
      };
    }

    const state = await readState(userId);
    const backupVersion = Number(backup.version ?? 1);
    const incomingAnime = getValidBackupMedia<StoredAnime>(backup.data.anime, "anime_id");
    const incomingManga = getValidBackupMedia<StoredManga>(backup.data.manga, "manga_id");
    const animeEntries = getValidBackupEntries<LocalListEntry>(backup.data.entries, "anime_id");
    const mangaEntries = getValidBackupEntries<LocalMangaListEntry>(
      backup.data.mangaEntries,
      "manga_id"
    );
    let animeImported = 0;
    let mangaImported = 0;
    let pendingDeletionsRestored = 0;
    let syncFailuresRestored = 0;

    state.settings = isPlainRecord(backup.data.settings)
      ? normalizeSettings({
          ...normalizeSettings(state.settings),
          ...(backup.data.settings as Partial<LocalSettings>),
        })
      : state.settings;
    state.anime = {
      ...state.anime,
      ...incomingAnime,
    };
    state.manga = {
      ...state.manga,
      ...incomingManga,
    };

    for (const [key, entry] of animeEntries.valid) {
      state.entries[key] = entry;
      delete state.deletedEntries[key];
      animeImported += 1;
    }

    for (const [key, entry] of mangaEntries.valid) {
      state.mangaEntries[key] = entry;
      delete state.deletedMangaEntries[key];
      mangaImported += 1;
    }

    if (backupVersion >= 2) {
      const incomingDirtyAnime = getBackupRecord<boolean>(backup.data.dirtyEntries);
      const incomingDirtyManga = getBackupRecord<boolean>(backup.data.dirtyMangaEntries);
      for (const [key] of animeEntries.valid) {
        if (incomingDirtyAnime[key]) state.dirtyEntries[key] = true;
      }
      for (const [key] of mangaEntries.valid) {
        if (incomingDirtyManga[key]) state.dirtyMangaEntries[key] = true;
      }

      for (const [key, deletion] of Object.entries(
        getBackupRecord<DeletedListEntry>(backup.data.deletedEntries)
      )) {
        if (isPlainRecord(deletion) && !state.entries[key]) {
          state.deletedEntries[key] = deletion;
          pendingDeletionsRestored += 1;
        }
      }
      for (const [key, deletion] of Object.entries(
        getBackupRecord<DeletedListEntry>(backup.data.deletedMangaEntries)
      )) {
        if (isPlainRecord(deletion) && !state.mangaEntries[key]) {
          state.deletedMangaEntries[key] = deletion;
          pendingDeletionsRestored += 1;
        }
      }

      state.syncHistory = mergeSyncHistory(state.syncHistory, backup.data.syncHistory);
      if (backupVersion >= 3 && isPlainRecord(backup.data.syncFailures)) {
        const restoredFailures = normalizeSyncFailures(backup.data.syncFailures);
        state.syncFailures = {
          ...state.syncFailures,
          ...restoredFailures,
        };
        syncFailuresRestored = Object.keys(restoredFailures).length;
      }
      if (typeof backup.data.autoSyncEnabled === "boolean") {
        state.autoSyncEnabled = backup.data.autoSyncEnabled;
      }
    } else {
      for (const [key] of animeEntries.valid) state.dirtyEntries[key] = true;
    }

    await writeState(userId, state);

    const imported = animeImported + mangaImported;
    const skipped = animeEntries.skipped + mangaEntries.skipped;
    const importSummary = [
      animeImported ? `${animeImported} Anime` : "",
      mangaImported ? `${mangaImported} Manga` : "",
    ].filter(Boolean).join(" and ");
    const preferencesRestored = isPlainRecord(backup.data.settings) ||
      isPlainRecord(backup.data.portablePreferences);
    const restoredParts = [
      importSummary ? `${importSummary} entr${imported === 1 ? "y" : "ies"}` : "",
      preferencesRestored ? "preferences and layouts" : "",
      pendingDeletionsRestored
        ? `${pendingDeletionsRestored} pending deletion${pendingDeletionsRestored === 1 ? "" : "s"}`
        : "",
      syncFailuresRestored
        ? `${syncFailuresRestored} sync recovery entr${syncFailuresRestored === 1 ? "y" : "ies"}`
        : "",
    ].filter(Boolean);

    return {
      ok: true,
      message: restoredParts.length
        ? `Restored ${restoredParts.join(" plus ")} from the backup${skipped ? `; skipped ${skipped} invalid entr${skipped === 1 ? "y" : "ies"}` : ""}.`
        : "The backup was valid, but it did not contain any list entries.",
      imported,
      animeImported,
      mangaImported,
      skipped,
      settings: normalizeSettings(state.settings),
      portablePreferences: backup.data.portablePreferences,
      desktopPreferences: backup.data.desktopPreferences,
      backupVersion,
      preferencesRestored,
      pendingDeletionsRestored,
      syncFailuresRestored,
    };
  },
};
