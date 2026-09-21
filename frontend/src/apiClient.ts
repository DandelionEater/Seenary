import { DEFAULT_LOCAL_SETTINGS, localStore } from "./localStore";
import type { AuthImportResult } from "./types/domain";

type ApiClient = typeof window.api;
type SyncProgressPayload = Parameters<Parameters<ApiClient["onSyncProgress"]>[0]>[0];

type ImportOptions = {
  signal?: AbortSignal;
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : "https://api.seenary.app");

let pendingAniListLoginFlowId: string | null = null;
let pendingMalLoginFlowId: string | null = null;
let activeUserId: number | null = null;
let activeSyncProvider: "anilist" | "mal" | null | undefined;
let localAutoSyncTimer: number | null = null;
const localAutoSyncListeners = new Set<(result: AutoSyncCompleteEvent) => void>();
const localSyncProgressListeners = new Set<(progress: SyncProgressPayload) => void>();
const malPreviewCache = new Map<string, AuthImportResult>();
const cachePrunedUserIds = new Set<number>();
const LOCAL_AUTO_SYNC_DELAY_MS = 15_000;
const DEFAULT_RPC_TIMEOUT_MS = 30_000;
const LONG_OPERATION_TIMEOUT_MS = 120_000;
const LOCAL_LIBRARY_UPDATED_EVENT = "seenary:local-library-updated";

function emitLocalSyncProgress(progress: SyncProgressPayload) {
  localSyncProgressListeners.forEach((listener) => listener(progress));
}

async function runMalJob(
  startMethod: "startMalPreviewJob" | "startMalPullJob",
  args: unknown[] = [],
  options: { signal?: AbortSignal; operation?: "pull-mal" } = {}
) {
  throwIfAborted(options.signal);
  const start = await rpc(startMethod, args, { signal: options.signal });
  if (!start.ok || !start.jobId) {
    throw new Error(start.message || "Failed to start MyAnimeList operation.");
  }

  try {
    while (true) {
      if (options.signal?.aborted) {
        await rpc("cancelMalJob", [start.jobId]).catch(() => undefined);
        throwIfAborted(options.signal);
      }

      const status = await rpc("getMalJob", [start.jobId], { signal: options.signal });
      if (!status.ok || !status.job) {
        throw new Error(status.message || "MyAnimeList operation was lost.");
      }

      if (options.operation && status.job.progress) {
        emitLocalSyncProgress({
          operation: options.operation,
          stage:
            status.job.progress.stage === "queued"
              ? "fetching"
              : status.job.progress.stage,
          label: status.job.progress.label || "Working with MyAnimeList...",
          current: status.job.progress.current ?? null,
          total: status.job.progress.total ?? null,
          updatedAt: new Date(status.job.updatedAt || Date.now()).toISOString(),
        });
      }

      if (status.job.status === "complete") return status.job.result;
      if (status.job.status === "failed") {
        throw new Error(status.job.error || "MyAnimeList operation failed.");
      }
      if (status.job.status === "cancelled") {
        throw new DOMException("MyAnimeList operation cancelled.", "AbortError");
      }

      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
  } catch (error) {
    if (options.signal?.aborted) {
      await rpc("cancelMalJob", [start.jobId]).catch(() => undefined);
    }
    throw error;
  }
}

async function rpc(
  method: string,
  args: unknown[] = [],
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  const timeoutController = timeoutMs > 0 ? new AbortController() : null;
  const forwardAbort = () => timeoutController?.abort(options.signal?.reason);
  let timedOut = false;
  const timeoutId = timeoutController
    ? window.setTimeout(() => {
        timedOut = true;
        timeoutController.abort();
      }, timeoutMs)
    : null;

  if (timeoutController && options.signal) {
    if (options.signal.aborted) {
      forwardAbort();
    } else {
      options.signal.addEventListener("abort", forwardAbort, { once: true });
    }
  }

  try {
    const response = await fetch(`${API_BASE_URL}/rpc`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Seenary-Version": __APP_VERSION__,
      },
      body: JSON.stringify({ method, args }),
      signal: timeoutController?.signal ?? options.signal,
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.message || `API request failed with status ${response.status}`);
    }

    return payload;
  } catch (error) {
    if (timedOut) {
      throw new Error("The request timed out. Try again in a moment.", {
        cause: error,
      });
    }
    throw error;
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) {
    return;
  }

  throw new DOMException("Import cancelled.", "AbortError");
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function buildCancelledImportResult() {
  return {
    ok: false,
    cancelled: true,
    message: "Import cancelled.",
  };
}

function isThirdPartyImport(source: string) {
  return source === "AniList" || source === "MyAnimeList";
}

async function runLocalAutoSync(userId: number) {
  if (!(await localStore.getAutoSyncEnabled(userId))) {
    return;
  }

  const provider = await getActiveSyncProvider(userId);
  if ((await localStore.getPendingSyncCount(userId, provider)) <= 0) {
    return;
  }

  const result = await rpc("runSyncNow", [await localStore.getSyncPayload(userId, provider)]);
  const syncState = await localStore.markSynced(userId, result);
  result.pending = await localStore.getPendingSyncCount(userId, provider);
  if (syncState.newlyExcluded > 0) {
    result.excluded = syncState.newlyExcluded;
    result.message = `Excluded ${syncState.newlyExcluded} sync entr${syncState.newlyExcluded === 1 ? "y" : "ies"} after five failed attempts.`;
  }

  if ((result.synced ?? 0) > 0 || (result.failed ?? 0) > 0 || (!result.ok && result.pending > 0)) {
    localAutoSyncListeners.forEach((listener) => listener(result));
  }
}

async function getActiveSyncProvider(userId: number, refresh = false) {
  if (!refresh && activeSyncProvider !== undefined) return activeSyncProvider;
  const status = await rpc("getSyncStatus", [
    await localStore.getPendingSyncCount(userId),
    await localStore.getAutoSyncEnabled(userId),
  ]);
  activeSyncProvider = status?.provider === "anilist" || status?.provider === "mal"
    ? status.provider
    : null;
  return activeSyncProvider;
}

function scheduleLocalAutoSync(userId: number) {
  if (localAutoSyncTimer !== null) {
    window.clearTimeout(localAutoSyncTimer);
  }

  localAutoSyncTimer = window.setTimeout(() => {
    localAutoSyncTimer = null;
    runLocalAutoSync(userId).catch((error) => {
      console.error("Auto sync failed:", error);
    });
  }, LOCAL_AUTO_SYNC_DELAY_MS);
}

function openPopup(url: string, name = "seenary-oauth") {
  const popup = window.open(url, name, "width=560,height=720,popup=yes");

  if (!popup) {
    if (window.desktopUpdater) {
      return null;
    }

    throw new Error("Allow popups so Seenary can open the authorization page.");
  }

  popup.focus();
  return popup;
}

async function waitForAniListFlow(method: string, flowId: string, popup: Window | null) {
  const startedAt = Date.now();
  const timeoutMs = 10 * 60 * 1000;

  while (Date.now() - startedAt < timeoutMs) {
    const result = await rpc(method, [flowId]);

    if (result.done) {
      return result;
    }

    if (popup?.closed) {
      await new Promise((resolve) => window.setTimeout(resolve, 700));
    } else {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
  }

  throw new Error("AniList authorization timed out.");
}

async function startAniListLogin() {
  const start = await rpc("startAniListLogin");

  if (!start.pendingOAuth) {
    return start;
  }

  const popup = openPopup(start.authUrl);
  const result = await waitForAniListFlow("pollAniListLogin", start.flowId, popup);

  if (result.needsProfile) {
    pendingAniListLoginFlowId = start.flowId;
  }

  if (result.user?.id) {
    activeUserId = result.user.id;
  }

  await saveAuthImportLocally(result);
  startDeferredProviderImport(result, "AniList");

  return result;
}

async function completeAniListLogin(username: string) {
  const result = await rpc("completeAniListLogin", [username, pendingAniListLoginFlowId], {
    timeoutMs: LONG_OPERATION_TIMEOUT_MS,
  });

  if (result.ok) {
    pendingAniListLoginFlowId = null;
  }

  if (result.user?.id) {
    activeUserId = result.user.id;
  }

  await saveAuthImportLocally(result);
  startDeferredProviderImport(result, "AniList");

  return result;
}

function startDeferredProviderImport(
  result: AuthImportResult,
  provider: "AniList" | "MyAnimeList"
) {
  const userId = Number(result?.user?.id ?? activeUserId);

  if (!result?.importPending || !Number.isInteger(userId) || userId <= 0) {
    return;
  }

  void (async () => {
    try {
      const pullResult = provider === "AniList"
        ? await rpc("pullFromAniList", [], { timeoutMs: LONG_OPERATION_TIMEOUT_MS })
        : await runMalJob("startMalPullJob");

      if (!pullResult.ok) {
        throw new Error(pullResult.message || `Failed to load your ${provider} library.`);
      }

      const summary = await localStore.replaceEntriesFromImport(userId, pullResult);
      window.dispatchEvent(new CustomEvent(LOCAL_LIBRARY_UPDATED_EVENT, {
        detail: {
          ok: true,
          provider,
          message: `Your ${provider} library is ready. ${summary.created} created, ${summary.updated} updated.`,
        },
      }));
    } catch (error) {
      console.error(`Deferred ${provider} import failed:`, error);
      window.dispatchEvent(new CustomEvent(LOCAL_LIBRARY_UPDATED_EVENT, {
        detail: {
          ok: false,
          provider,
          message:
            error instanceof Error
              ? error.message
              : `Failed to load your ${provider} library in the background.`,
        },
      }));
    }
  })();
}

async function linkAniListAccount() {
  const start = await rpc("linkAniListAccount");

  if (!start.pendingOAuth) {
    await saveAuthImportLocally(start);
    return start;
  }

  const popup = openPopup(start.authUrl);
  const result = await waitForAniListFlow("pollAniListLink", start.flowId, popup);
  await saveAuthImportLocally(result);
  return result;
}

async function waitForMalFlow(method: string, flowId: string, popup: Window | null) {
  const startedAt = Date.now();
  const timeoutMs = 10 * 60 * 1000;

  while (Date.now() - startedAt < timeoutMs) {
    const result = await rpc(method, [flowId]);

    if (result.done) {
      return result;
    }

    if (popup?.closed) {
      await new Promise((resolve) => window.setTimeout(resolve, 700));
    } else {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
  }

  throw new Error("MyAnimeList authorization timed out.");
}

async function startMalLogin() {
  const start = await rpc("startMalLogin");

  if (!start.pendingOAuth) {
    await saveAuthImportLocally(start);
    return start;
  }

  const popup = openPopup(start.authUrl, "seenary-mal-oauth");
  const result = await waitForMalFlow("pollMalLogin", start.flowId, popup);

  if (result.needsProfile) {
    pendingMalLoginFlowId = start.flowId;
  }

  if (result.user?.id) {
    activeUserId = result.user.id;
  }

  await saveAuthImportLocally(result);
  startDeferredProviderImport(result, "MyAnimeList");

  return result;
}

async function completeMalLogin(username: string) {
  const result = await rpc("completeMalLogin", [username, pendingMalLoginFlowId], {
    timeoutMs: LONG_OPERATION_TIMEOUT_MS,
  });

  if (result.ok) {
    pendingMalLoginFlowId = null;
  }

  if (result.user?.id) {
    activeUserId = result.user.id;
  }

  await saveAuthImportLocally(result);
  startDeferredProviderImport(result, "MyAnimeList");

  return result;
}

async function linkMalAccount() {
  const start = await rpc("linkMalAccount");

  if (!start.pendingOAuth) {
    await saveAuthImportLocally(start);
    return start;
  }

  const popup = openPopup(start.authUrl, "seenary-mal-oauth");
  const result = await waitForMalFlow("pollMalLink", start.flowId, popup);
  await saveAuthImportLocally(result);
  startDeferredProviderImport(result, "MyAnimeList");
  return result;
}

async function saveAuthImportLocally(result: AuthImportResult) {
  const userId = result?.user?.id ?? activeUserId;

  if (
    !userId ||
    (!result?.import?.localEntries?.length && !result?.import?.localMangaEntries?.length)
  ) {
    return;
  }

  activeUserId = userId;

  try {
    await localStore.replaceEntriesFromImport(userId, result.import);
  } catch (error) {
    console.error("Failed to save OAuth-imported entries locally:", error);
  }
}

async function getActiveUserId() {
  if (activeUserId) {
    return activeUserId;
  }

  const session = await rpc("getSession");
  activeUserId = session?.user?.id ?? null;
  return activeUserId;
}

async function requireActiveUserId() {
  const userId = await getActiveUserId();

  if (!userId) {
    throw new Error("You must be logged in.");
  }

  return userId;
}

async function getSession() {
  const session = await rpc("getSession");
  activeUserId = session?.user?.id ?? null;
  const sessionUserId = activeUserId;
  if (sessionUserId && !cachePrunedUserIds.has(sessionUserId)) {
    cachePrunedUserIds.add(sessionUserId);
    void localStore.pruneExpiredCachedDetails(sessionUserId).catch((error) => {
      cachePrunedUserIds.delete(sessionUserId);
      console.warn("Failed to prune expired media details cache:", error);
    });
  }
  return session;
}

async function login(username: string, password: string) {
  const result = await rpc("login", [username, password]);

  if (result.user?.id) {
    activeUserId = result.user.id;
  }

  return result;
}

async function register(username: string, password: string) {
  const result = await rpc("register", [username, password]);

  if (result.user?.id) {
    activeUserId = result.user.id;
  }

  return result;
}

async function logout() {
  const result = await rpc("logout");
  activeUserId = null;
  activeSyncProvider = undefined;
  return result;
}

function flattenPreviewEntries(result: AuthImportResult, selectedMediaKeys: Array<number | string> = []) {
  const selected = new Set(
    selectedMediaKeys.map((value) =>
      typeof value === "number" ? `ANIME:${value}` : String(value)
    )
  );
  const hasSelection = selected.size > 0;

  return (result.localEntries ?? result.preview?.groups?.flatMap((group) => group.items) ?? [])
    .filter((item) => {
      const mediaType = item.mediaType === "MANGA" ? "MANGA" : "ANIME";
      const mediaId = Number(mediaType === "MANGA" ? item.mangaId ?? item.mediaId : item.animeId ?? item.mediaId);
      return Number.isInteger(mediaId) && mediaId > 0 && (!hasSelection || selected.has(`${mediaType}:${mediaId}`));
    });
}

async function importLocalEntries(
  userId: number,
  result: AuthImportResult,
  selectedMediaKeys: Array<number | string> = [],
  fallbackSource = "Import",
  signal?: AbortSignal
) {
  throwIfAborted(signal);

  const items = flattenPreviewEntries(result, selectedMediaKeys);
  let imported = 0;
  let created = 0;
  let updated = 0;

  for (const item of items) {
    throwIfAborted(signal);
    if (item.mediaType === "MANGA") {
      const mangaId = Number(item.mangaId ?? item.mediaId);
      if (!item.media) continue;
      await localStore.cacheManga(userId, item.media);
      throwIfAborted(signal);
      const existing = await localStore.getMangaEntry(userId, mangaId);
      const saved = await localStore.saveMangaEntry(
        userId,
        mangaId,
        {
          status: item.status,
          progress: item.progress ?? 0,
          volumeProgress: item.volumeProgress ?? 0,
          score: item.score ?? null,
          notes: item.notes ?? null,
          startedAt: item.startedAt ?? null,
          completedAt: item.completedAt ?? null,
          repeatCount: item.repeatCount ?? 0,
          isFavorite: Boolean(existing?.is_favorite),
        },
        { markLocalActivity: false }
      );
      if (saved.ok) {
        imported += 1;
        if (existing) updated += 1;
        else created += 1;
      }
      continue;
    }

    await localStore.cachePreviewAnime(userId, item);
    throwIfAborted(signal);
    const existing = await localStore.getEntry(userId, Number(item.animeId));
    throwIfAborted(signal);
    const saved = await localStore.saveEntry(
      userId,
      Number(item.animeId),
      {
        status: item.status,
        progress: item.progress ?? 0,
        score: item.score ?? null,
        notes: item.notes ?? null,
        startedAt: item.startedAt ?? null,
        completedAt: item.completedAt ?? null,
        repeatCount: item.repeatCount ?? 0,
        isFavorite: Boolean(existing?.is_favorite),
      },
      {
        markDirty: !isThirdPartyImport(fallbackSource),
        markLocalActivity: false,
      }
    );
    throwIfAborted(signal);

    if (saved.ok) {
      imported += 1;
      if (saved.unchanged) {
        // Already current locally.
      } else if (existing) {
        updated += 1;
      } else {
        created += 1;
      }
    }
  }

  return {
    ok: true,
    message:
      result?.message ??
      `Imported ${imported} ${fallbackSource} entr${imported === 1 ? "y" : "ies"}.`,
    summary: {
      ...(result?.summary ?? {}),
      sourceUsername: result.summary?.sourceUsername ?? fallbackSource,
      totalFound: result?.summary?.totalFound ?? items.length,
      selectedStatuses: result.summary?.selectedStatuses ?? [],
      selectedAnimeIds: selectedMediaKeys
        .map(String)
        .filter((key) => key.startsWith("ANIME:"))
        .map((key) => Number(key.slice(6))),
      selectedMediaKeys: selectedMediaKeys.map(String),
      imported,
      created,
      updated,
      skipped: Math.max(0, (result?.summary?.totalFound ?? items.length) - imported),
    },
  };
}

export function installApiClient() {
  if (window.api) {
    return;
  }

  const api: ApiClient = {
    searchMedia: (query, hideAdultContent = true, options) =>
      rpc("searchMedia", [query, hideAdultContent], {
        signal: options?.signal,
        timeoutMs: 30_000,
      }),
    getDiscoverMedia: (hideAdultContent = true) =>
      rpc("getDiscoverMedia", [hideAdultContent], { timeoutMs: 20_000 }),
    getDiscoverShelfAnime: (shelfId, page = 1, hideAdultContent = true, mediaType = "ANIME") =>
      rpc("getDiscoverShelfAnime", [shelfId, page, hideAdultContent, mediaType], {
        timeoutMs: 20_000,
      }),
    getStudioMedia: (studioId, page = 1, hideAdultContent = true) =>
      rpc("getStudioMedia", [studioId, page, hideAdultContent], { timeoutMs: 20_000 }),
    getArtistMedia: (artistSlug, page = 1, hideAdultContent = true) =>
      rpc("getArtistMedia", [artistSlug, page, hideAdultContent], { timeoutMs: 20_000 }),
    getAnimeThemeMusic: (anilistId, titles = []) =>
      rpc("getAnimeThemeMusic", [anilistId, titles], { timeoutMs: 20_000 }),
    previewAniListImport: (username) =>
      rpc("previewAniListImport", [username], { timeoutMs: 60_000 }),
    importAniList: async (username, selectedStatuses, selectedMediaKeys, options?: ImportOptions) => {
      try {
        throwIfAborted(options?.signal);
        const userId = await requireActiveUserId();
        throwIfAborted(options?.signal);
        const result = await rpc("importAniList", [username, selectedStatuses, selectedMediaKeys], {
          signal: options?.signal,
          timeoutMs: LONG_OPERATION_TIMEOUT_MS,
        });
        throwIfAborted(options?.signal);
        if (result?.localEntries || result?.localMangaEntries) {
          const summary = await localStore.replaceEntriesFromImport(userId, result);
          return {
            ...result,
            summary: {
              ...(result.summary ?? {}),
              ...summary,
              selectedMediaKeys,
            },
          };
        }
        return result;
      } catch (error) {
        if (isAbortError(error)) {
          return buildCancelledImportResult();
        }

        throw error;
      }
    },
    previewMalImport: async (username, options?: ImportOptions) => {
      try {
        const result = await runMalJob("startMalPreviewJob", [username], {
          signal: options?.signal,
        });
        malPreviewCache.set(username.trim().toLowerCase(), result);
        return result;
      } catch (error) {
        if (isAbortError(error)) return buildCancelledImportResult();
        throw error;
      }
    },
    importMal: async (username, selectedStatuses, selectedMediaKeys, options?: ImportOptions) => {
      try {
        throwIfAborted(options?.signal);
        const userId = await requireActiveUserId();
        throwIfAborted(options?.signal);
        const cacheKey = username.trim().toLowerCase();
        const previewResult =
          malPreviewCache.get(cacheKey) ??
          await runMalJob("startMalPreviewJob", [username], { signal: options?.signal });
        const result = await importLocalEntries(
          userId,
          previewResult,
          selectedMediaKeys,
          "MyAnimeList",
          options?.signal
        );
        malPreviewCache.delete(cacheKey);
        return {
          ...result,
          summary: {
            ...(previewResult.summary ?? {}),
            ...(result.summary ?? {}),
            selectedStatuses,
            selectedMediaKeys,
          },
        };
      } catch (error) {
        if (isAbortError(error)) {
          return buildCancelledImportResult();
        }

        throw error;
      }
    },
    previewTextImport: (text, hideAdultContent = true, mediaType = "ANIME", options?: ImportOptions) =>
      rpc("previewTextImport", [text, hideAdultContent, mediaType], {
        signal: options?.signal,
        timeoutMs: LONG_OPERATION_TIMEOUT_MS,
      }),
    previewPdfImport: (pdfBase64, hideAdultContent = true, mediaType = "ANIME", options?: ImportOptions) =>
      rpc("previewPdfImport", [pdfBase64, hideAdultContent, mediaType], {
        signal: options?.signal,
        timeoutMs: LONG_OPERATION_TIMEOUT_MS,
      }),
    importTextList: async (entries, selectedMediaKeys, options?: ImportOptions) => {
      try {
        throwIfAborted(options?.signal);
        const userId = await requireActiveUserId();
        return importLocalEntries(
          userId,
          {
            message: `Imported ${entries.length} text entr${entries.length === 1 ? "y" : "ies"}.`,
            localEntries: entries,
            summary: { sourceUsername: "Text file", totalFound: entries.length },
          },
          selectedMediaKeys,
          "text",
          options?.signal
        );
      } catch (error) {
        if (isAbortError(error)) {
          return buildCancelledImportResult();
        }

        throw error;
      }
    },
    getSettings: async () => {
      const userId = await getActiveUserId();
      return userId ? await localStore.getSettings(userId) : DEFAULT_LOCAL_SETTINGS;
    },
    updateSettings: async (settings) => {
      const userId = await requireActiveUserId();
      return await localStore.updateSettings(userId, settings);
    },
    recordEngagement: (payload) => rpc("recordEngagement", [payload]),
    getSyncStatus: async () => {
      const userId = await requireActiveUserId();
      const result = await rpc("getSyncStatus", [
        await localStore.getPendingSyncCount(userId),
        await localStore.getAutoSyncEnabled(userId),
      ]);
      activeSyncProvider = result?.provider === "anilist" || result?.provider === "mal"
        ? result.provider
        : null;
      return {
        ...result,
        pendingCount: await localStore.getPendingSyncCount(userId, activeSyncProvider),
      };
    },
    setAutoSync: async (enabled) => {
      const userId = await requireActiveUserId();
      const provider = await getActiveSyncProvider(userId);
      await localStore.setAutoSyncEnabled(userId, Boolean(enabled));
      if (enabled && (await localStore.getPendingSyncCount(userId, provider)) > 0) {
        scheduleLocalAutoSync(userId);
      }
      return rpc("setAutoSync", [
        Boolean(enabled),
        await localStore.getPendingSyncCount(userId, provider),
      ]);
    },
    runSyncNow: async () => {
      const userId = await requireActiveUserId();
      const provider = await getActiveSyncProvider(userId, true);
      const result = await rpc("runSyncNow", [await localStore.getSyncPayload(userId, provider)], {
        timeoutMs: LONG_OPERATION_TIMEOUT_MS,
      });
      const syncState = await localStore.markSynced(userId, result);
      return {
        ...result,
        pending: await localStore.getPendingSyncCount(userId, provider),
        ...(syncState.newlyExcluded > 0
          ? {
              excluded: syncState.newlyExcluded,
              message: `Excluded ${syncState.newlyExcluded} sync entr${syncState.newlyExcluded === 1 ? "y" : "ies"} after five failed attempts.`,
            }
          : {}),
      };
    },
    pullFromAniList: async () => {
      const userId = await requireActiveUserId();
      const result = await rpc("pullFromAniList", [], { timeoutMs: LONG_OPERATION_TIMEOUT_MS });
      if (result.ok) {
        const summary = await localStore.replaceEntriesFromImport(userId, result);
        const message = `Updated local Anime and Manga from AniList. ${summary.created} created, ${summary.updated} updated.${
          result.partial ? " Some remote entries could not be matched and were skipped." : ""
        }`;
        await localStore.recordPullActivity(userId, "anilist", message, summary, {
          partial: Boolean(result.partial),
          mappingFailures: result.summary?.mappingFailures,
        });
        return {
          ...result,
          message,
          summary: {
            ...(result.summary ?? {}),
            ...summary,
            totalFound: result.summary?.totalFound ?? result.localEntries?.length ?? 0,
          },
        };
      }
      return result;
    },
    pullFromMal: async () => {
      const userId = await requireActiveUserId();
      const result = await runMalJob("startMalPullJob", [], { operation: "pull-mal" });
      if (result.ok) {
        const summary = await localStore.replaceEntriesFromImport(userId, result);
        const message = `Updated local Anime and Manga from MyAnimeList. ${summary.created} created, ${summary.updated} updated.${
          result.partial ? " Some remote entries could not be matched and were skipped." : ""
        }`;
        await localStore.recordPullActivity(userId, "mal", message, summary, {
          partial: Boolean(result.partial),
          mappingFailures: result.summary?.mappingFailures,
        });
        return {
          ...result,
          message,
          summary: {
            ...(result.summary ?? {}),
            ...summary,
            totalFound: result.summary?.totalFound ?? result.localEntries?.length ?? 0,
          },
        };
      }
      return result;
    },
    getSyncActivity: async () => {
      const userId = await requireActiveUserId();
      const provider = await getActiveSyncProvider(userId);
      return { ok: true, ...(await localStore.getSyncActivity(userId, provider)) };
    },
    restoreSyncExclusion: async (payload) => {
      const userId = await requireActiveUserId();
      const provider = payload?.provider;
      const mediaType = payload?.mediaType === "MANGA" ? "MANGA" : "ANIME";
      const mediaId = Number(payload?.mediaId);
      if ((provider !== "anilist" && provider !== "mal") || !Number.isInteger(mediaId) || mediaId <= 0) {
        return { ok: false, message: "This excluded sync entry is invalid." };
      }
      return localStore.restoreSyncExclusion(userId, provider, mediaType, mediaId);
    },
    excludeSyncEntry: async (payload) => {
      const userId = await requireActiveUserId();
      const provider = payload?.provider;
      const mediaType = payload?.mediaType === "MANGA" ? "MANGA" : "ANIME";
      const mediaId = Number(payload?.mediaId);
      if ((provider !== "anilist" && provider !== "mal") || !Number.isInteger(mediaId) || mediaId <= 0) {
        return { ok: false, message: "This queued sync entry is invalid." };
      }
      return localStore.excludeSyncEntry(userId, provider, mediaType, mediaId);
    },
    getAnimeDetails: async (id) => {
      const userId = await getActiveUserId();
      try {
        const media = await rpc("getAnimeDetails", [id], { timeoutMs: 45_000 });
        if (userId && media?.id) {
          await localStore.cacheAnime(userId, media);
        }
        return media;
      } catch (error) {
        const cached = userId
          ? await localStore.getCachedMediaDetails(userId, "ANIME", id)
          : null;
        if (cached) return cached;
        throw error;
      }
    },
    getAnimeFranchiseStartDate: async (id) => {
      const result = await rpc("getAnimeFranchiseStartDate", [id], { timeoutMs: 45_000 });
      const userId = await getActiveUserId();
      if (userId && result?.franchiseStartDate?.year) {
        const cached = await localStore.getCachedMediaDetails(userId, "ANIME", id);
        if (cached) {
          await localStore.cacheAnime(userId, {
            ...cached,
            franchiseStartDate: result.franchiseStartDate,
          });
        }
      }
      return result;
    },
    getMediaDetails: async (mediaType, id) => {
      const userId = await getActiveUserId();
      try {
        const media = await rpc("getMediaDetails", [mediaType, id], { timeoutMs: 45_000 });
        if (userId && media?.id && mediaType === "ANIME") {
          await localStore.cacheAnime(userId, media);
        } else if (userId && media?.id) {
          await localStore.cacheManga(userId, media);
        }
        return media;
      } catch (error) {
        const cached = userId
          ? await localStore.getCachedMediaDetails(userId, mediaType, id)
          : null;
        if (cached) return cached;
        throw error;
      }
    },
    getCharacterDetails: (id) => rpc("getCharacterDetails", [id], { timeoutMs: 20_000 }),
    getStaffDetails: (id) => rpc("getStaffDetails", [id], { timeoutMs: 20_000 }),
    cacheMinimalAnime: async (media) => {
      const userId = await requireActiveUserId();
      return await localStore.cacheAnime(userId, media);
    },
    cacheMinimalManga: async (media) => {
      const userId = await requireActiveUserId();
      return await localStore.cacheManga(userId, media);
    },
    register,
    login,
    startAniListLogin,
    completeAniListLogin,
    startMalLogin,
    completeMalLogin,
    getAniListLinkStatus: () => rpc("getAniListLinkStatus"),
    linkAniListAccount,
    resolveAniListLinkConflict: async (action) => {
      const result = await rpc("resolveAniListLinkConflict", [action], {
        timeoutMs: LONG_OPERATION_TIMEOUT_MS,
      });
      await saveAuthImportLocally(result);
      return result;
    },
    unlinkAniListAccount: (password) => rpc("unlinkAniListAccount", [password]),
    getMalLinkStatus: () => rpc("getMalLinkStatus"),
    linkMalAccount,
    resolveMalLinkConflict: async (action) => {
      const result = await rpc("resolveMalLinkConflict", [action], {
        timeoutMs: LONG_OPERATION_TIMEOUT_MS,
      });
      await saveAuthImportLocally(result);
      startDeferredProviderImport(result, "MyAnimeList");
      return result;
    },
    unlinkMalAccount: (password) => rpc("unlinkMalAccount", [password]),
    setLocalPassword: (password) => rpc("setLocalPassword", [password]),
    logout,
    exportAccountData: async () => {
      const userId = await requireActiveUserId();
      const session = await getSession();
      const backup = await localStore.exportBackup(userId, session?.user?.username ?? "Seenary user");
      return { ok: true, export: { format: "seenary.account-export", version: 1, exportedAt: new Date().toISOString(), data: { portableBackup: backup } } };
    },
    deleteAccount: async (usernameConfirmation, password) => {
      void password; // The legacy SQLite account API predates password-confirmed deletion.
      const userId = await requireActiveUserId();
      const result = await rpc("deleteAccount", [usernameConfirmation]);
      if (result.ok) {
        if (localAutoSyncTimer !== null) window.clearTimeout(localAutoSyncTimer);
        localAutoSyncTimer = null;
        await localStore.deleteUserData(userId);
        await window.desktopConfig?.deleteLayoutOrders(userId).catch(() => undefined);
        activeUserId = null;
      }
      return result;
    },
    getSession,
    setTutorialDismissed: (dismissed) => rpc("setTutorialDismissed", [dismissed]),
    getMyList: async () => {
      const userId = await requireActiveUserId();
      let entries = await localStore.getList(userId);

      if (!entries.length) {
        const legacy = await rpc("exportLegacyMyList").catch(() => null);
        if (legacy?.ok && legacy.entries?.length) {
          await localStore.importLegacyEntries(userId, legacy.entries);
          entries = await localStore.getList(userId);
        }
      }

      const missingMetadataIds = entries
        .filter(
          (entry) => {
            const duration = Number(entry.duration);
            const needsDuration =
              Number(entry.progress) > 0 && (!Number.isFinite(duration) || duration <= 0);
            const needsAdultFlag =
              (entry.is_adult === null || entry.is_adult === undefined) &&
              (entry.details?.isAdult === null || entry.details?.isAdult === undefined);
            return needsDuration || needsAdultFlag;
          }
        )
        .map((entry) => entry.anime_id);

      if (missingMetadataIds.length) {
        const metadata = await rpc("getAnimeListMetadata", [missingMetadataIds]).catch(
          () => []
        );
        if (Array.isArray(metadata) && metadata.length) {
          await localStore.cacheAnimeListMetadata(userId, metadata);
          entries = await localStore.getList(userId);
        }
      }

      return { ok: true, entries };
    },
    getMyListEntry: async (animeId) => {
      const userId = await requireActiveUserId();
      return { ok: true, entry: await localStore.getEntry(userId, Number(animeId)) };
    },
    saveMyListEntry: async (animeId, data) => {
      const userId = await requireActiveUserId();
      const result = await localStore.saveEntry(userId, Number(animeId), data);
      if (result.ok && !result.unchanged && (await localStore.getAutoSyncEnabled(userId))) {
        scheduleLocalAutoSync(userId);
      }
      return result;
    },
    removeMyListEntry: async (animeId) => {
      const userId = await requireActiveUserId();
      const result = await localStore.removeEntry(userId, Number(animeId));
      if (result.ok && (await localStore.getAutoSyncEnabled(userId))) {
        scheduleLocalAutoSync(userId);
      }
      return result;
    },
    resolveMyListConflict: async () => ({
      ok: false,
      message: "Cloud conflict resolution is only available with Atlas.",
    }),
    getMyMangaList: async () => {
      const userId = await requireActiveUserId();
      return { ok: true, entries: await localStore.getMangaList(userId) };
    },
    getMyMangaListEntry: async (mangaId) => {
      const userId = await requireActiveUserId();
      return { ok: true, entry: await localStore.getMangaEntry(userId, Number(mangaId)) };
    },
    saveMyMangaListEntry: async (mangaId, data) => {
      const userId = await requireActiveUserId();
      const result = await localStore.saveMangaEntry(userId, Number(mangaId), data);
      if (result.ok && (await localStore.getAutoSyncEnabled(userId))) {
        scheduleLocalAutoSync(userId);
      }
      return result;
    },
    removeMyMangaListEntry: async (mangaId) => {
      const userId = await requireActiveUserId();
      const result = await localStore.removeMangaEntry(userId, Number(mangaId));
      if (result.ok && (await localStore.getAutoSyncEnabled(userId))) {
        scheduleLocalAutoSync(userId);
      }
      return result;
    },
    resolveMyMangaListConflict: async () => ({
      ok: false,
      message: "Cloud conflict resolution is only available with Atlas.",
    }),
    clearMyList: async (options: { queueProviderDeletion?: boolean } = {}) => {
      const userId = await requireActiveUserId();
      const result = await localStore.clearList(userId, options);
      if (options.queueProviderDeletion !== false && result.ok && result.removedCount > 0 && (await localStore.getAutoSyncEnabled(userId))) {
        scheduleLocalAutoSync(userId);
      }
      return result;
    },
    clearMyMangaList: async (options: { queueProviderDeletion?: boolean } = {}) => {
      const userId = await requireActiveUserId();
      const result = await localStore.clearMangaList(userId, options);
      if (options.queueProviderDeletion !== false && result.ok && result.removedCount > 0 && (await localStore.getAutoSyncEnabled(userId))) {
        scheduleLocalAutoSync(userId);
      }
      return result;
    },
    clearAllMediaLists: async (options: { queueProviderDeletion?: boolean } = {}) => {
      const userId = await requireActiveUserId();
      const result = await localStore.clearAllLists(userId, options);
      if (options.queueProviderDeletion !== false && result.ok && result.removedCount > 0 && (await localStore.getAutoSyncEnabled(userId))) {
        scheduleLocalAutoSync(userId);
      }
      return result;
    },
    exportLocalBackup: async (preferenceBundle) => {
      const userId = await requireActiveUserId();
      const session = await getSession();
      return await localStore.exportBackup(
        userId,
        session?.user?.username ?? "Seenary user",
        preferenceBundle
      );
    },
    importLocalBackup: async (backup) => {
      const userId = await requireActiveUserId();
      const result = await localStore.importBackup(userId, backup);
      if (
        result.ok &&
        (result.imported ?? 0) > 0 &&
        (await localStore.getAutoSyncEnabled(userId))
      ) {
        scheduleLocalAutoSync(userId);
      }
      return result;
    },
    repairCachedData: async () => {
      const userId = await requireActiveUserId();
      const localResult = await localStore.repairCachedData(userId);
      const desktopResult = window.desktopMaintenance
        ? await window.desktopMaintenance.repairCaches()
        : { ok: true, clearedWebCache: false };
      if (!desktopResult.ok) {
        return {
          ...localResult,
          ok: false,
          message: desktopResult.message || "Seenary could not clear the desktop web cache.",
        };
      }
      return {
        ok: true,
        message: desktopResult.clearedWebCache
          ? "Cached data was repaired. Your account, lists, settings, and sync data were preserved."
          : "Cached library data was repaired. This desktop version cannot clear its web cache, so that part was safely skipped. Your account, lists, settings, and sync data were preserved.",
        removedDetails: localResult.removedDetails,
        removedMedia: localResult.removedMedia,
        clearedWebCache: desktopResult.clearedWebCache,
        restartRecommended: true,
      };
    },
    onSyncProgress: (callback) => {
      localSyncProgressListeners.add(callback);
      return () => localSyncProgressListeners.delete(callback);
    },
    onAutoSyncComplete: (callback) => {
      localAutoSyncListeners.add(callback);
      return () => localAutoSyncListeners.delete(callback);
    },
  };

  window.api = api as typeof window.api;
}
