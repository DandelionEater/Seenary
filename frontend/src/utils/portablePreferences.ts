import type { MediaType } from "../types/domain";

export const PORTABLE_PREFERENCES_VERSION = 1;

export type PortableMediaPreferences = {
  view: "list" | "grid" | "board";
  sortMode: "alphabetical" | "personalScore";
  openSections: Record<"watching" | "planned" | "completed" | "paused" | "dropped", boolean>;
  sectionOrder: string[];
};

export type PortablePreferences = {
  version: 1;
  navigation: {
    libraryMediaType: MediaType;
    homeMode: "personal" | "discover";
  };
  layouts: {
    personalLayoutOrder?: string[];
    mangaPersonalLayoutOrder?: string[];
    discoverLayoutOrder?: string[];
    myListSectionOrder?: string[];
    mangaMyListSectionOrder?: string[];
  };
  myList: {
    anime: PortableMediaPreferences;
    manga: PortableMediaPreferences;
  };
};

type DesktopWindowPreset = "compact" | "balanced" | "cinematic" | "custom";

export type DesktopPreferences = {
  shortcut?: { enabled: boolean; accelerator: string };
  window?: {
    preset: DesktopWindowPreset;
    width?: number;
    height?: number;
  };
  startup?: { openAtLogin: boolean };
};

function normalizeDesktopPreferences(value: unknown): DesktopPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const result: DesktopPreferences = {};
  if (record.shortcut && typeof record.shortcut === "object" && !Array.isArray(record.shortcut)) {
    const shortcut = record.shortcut as Record<string, unknown>;
    const accelerator = typeof shortcut.accelerator === "string"
      ? shortcut.accelerator.trim().slice(0, 100)
      : "";
    if (accelerator) {
      result.shortcut = { enabled: shortcut.enabled === true, accelerator };
    }
  }
  if (record.window && typeof record.window === "object" && !Array.isArray(record.window)) {
    const windowPreference = record.window as Record<string, unknown>;
    const preset = ["compact", "balanced", "cinematic", "custom"].includes(
      String(windowPreference.preset)
    )
      ? String(windowPreference.preset) as DesktopWindowPreset
      : null;
    if (preset) {
      const width = Number(windowPreference.width);
      const height = Number(windowPreference.height);
      result.window = {
        preset,
        ...(Number.isFinite(width) ? { width: Math.min(10000, Math.max(900, Math.round(width))) } : {}),
        ...(Number.isFinite(height) ? { height: Math.min(10000, Math.max(600, Math.round(height))) } : {}),
      };
    }
  }
  if (record.startup && typeof record.startup === "object" && !Array.isArray(record.startup)) {
    const startup = record.startup as Record<string, unknown>;
    if (typeof startup.openAtLogin === "boolean") {
      result.startup = { openAtLogin: startup.openAtLogin };
    }
  }
  return result;
}

export type BackupInspection = {
  valid: boolean;
  message: string;
  version: number;
  exportedAt: string | null;
  username: string | null;
  animeEntries: number;
  mangaEntries: number;
  hasPortablePreferences: boolean;
  hasDesktopPreferences: boolean;
};

export function inspectSeenaryBackup(value: unknown): BackupInspection {
  const backup = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const data = backup.data && typeof backup.data === "object" && !Array.isArray(backup.data)
    ? backup.data as Record<string, unknown>
    : null;
  const version = Number(backup.version ?? 1);
  const cloudState = backup.state && typeof backup.state === "object" && !Array.isArray(backup.state)
    ? backup.state as Record<string, unknown>
    : null;
  const isLocal = backup.format === "seenary.local-backup" && Boolean(data) &&
    Number.isInteger(version) && version >= 1 && version <= 4;
  const isCloud = backup.format === "seenary.cloud-backup" && version === 1 && Boolean(cloudState);
  const valid = isLocal || isCloud;
  const entryCount = (candidate: unknown) =>
    candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? Object.keys(candidate).length
      : 0;

  return {
    valid,
    message: valid
      ? isCloud
        ? "Seenary cloud backup is ready to restore. Library choices can be resumed after closing this screen."
        : version < 4
        ? `Seenary backup v${version} will be migrated to v4 during import.`
        : "Seenary backup v4 is ready to import."
      : version > 4
        ? `This backup uses a newer format (v${version}) than this Seenary build supports.`
        : "This does not look like a valid Seenary backup file.",
    version,
    exportedAt: typeof backup.exportedAt === "string" ? backup.exportedAt : null,
    username: typeof backup.username === "string" ? backup.username : null,
    animeEntries: isCloud
      ? Object.values((cloudState?.entries as Record<string, { type?: string }> | undefined) ?? {}).filter((entry) => entry?.type === "ANIME").length
      : entryCount(data?.entries),
    mangaEntries: isCloud
      ? Object.values((cloudState?.entries as Record<string, { type?: string }> | undefined) ?? {}).filter((entry) => entry?.type === "MANGA").length
      : entryCount(data?.mangaEntries),
    hasPortablePreferences: Boolean(data?.portablePreferences || data?.settings),
    hasDesktopPreferences: Boolean(data?.desktopPreferences),
  };
}

export function selectBackupSections(
  value: unknown,
  options: { restoreLibrary: boolean; restorePreferences: boolean }
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const backup = value as Record<string, unknown>;
  if (backup.format === "seenary.cloud-backup") {
    const selected = { ...backup };
    if (!options.restoreLibrary) delete selected.state;
    if (!options.restorePreferences) delete selected.data;
    return selected;
  }
  const sourceData = backup.data && typeof backup.data === "object" && !Array.isArray(backup.data)
    ? backup.data as Record<string, unknown>
    : {};
  const data = { ...sourceData };
  if (!options.restoreLibrary) {
    for (const key of [
      "anime",
      "entries",
      "manga",
      "mangaEntries",
      "dirtyEntries",
      "deletedEntries",
      "dirtyMangaEntries",
      "deletedMangaEntries",
      "syncHistory",
      "syncFailures",
    ]) {
      delete data[key];
    }
  }
  if (!options.restorePreferences) {
    delete data.settings;
    delete data.portablePreferences;
    delete data.desktopPreferences;
    delete data.autoSyncEnabled;
  }
  return { ...backup, data };
}

const STORAGE_KEYS = {
  libraryMediaType: "seenary.library-lens.media",
  homeMode: "seenary.home-tab",
  personalLayoutOrder: "seenary.personal-layout-order",
  mangaPersonalLayoutOrder: "seenary.manga-personal-layout-order",
  discoverLayoutOrder: "seenary.discover-layout-order",
  myListOpenSections: "seenary.my-list.open-sections",
  myListSortMode: "seenary.my-list.sort-mode",
  myListSectionOrder: "seenary.my-list.section-order",
  myListView: "seenary.my-list.view",
} as const;

const LEGACY_STORAGE_KEYS = {
  libraryMediaType: "seenary.my-list.media-type",
  homeMode: "media-tracker.home-tab",
  personalLayoutOrder: "media-tracker.personal-layout-order",
  discoverLayoutOrder: "media-tracker.discover-layout-order",
  myListOpenSections: "media-tracker.my-list.open-sections",
  myListSortMode: "media-tracker.my-list.sort-mode",
  myListSectionOrder: "media-tracker.my-list.section-order",
} as const;

const DEFAULT_STATUS_ORDER = ["watching", "planned", "completed", "paused", "dropped"];
const DEFAULT_OPEN_SECTIONS: PortableMediaPreferences["openSections"] = {
  watching: true,
  planned: true,
  completed: false,
  paused: false,
  dropped: false,
};

function mediaKey(key: string, mediaType: MediaType) {
  return mediaType === "MANGA" ? `${key}.manga` : key;
}

function readString(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readStringWithLegacy(key: string, legacyKey?: string) {
  return readString(key) ?? (legacyKey ? readString(legacyKey) : null);
}

function readJson(key: string): unknown {
  try {
    const value = readString(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function readJsonWithLegacy(key: string, legacyKey?: string): unknown {
  const value = readStringWithLegacy(key, legacyKey);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeOrder(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) return [...fallback];
  const order = value
    .filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 100)
    .slice(0, 100);
  return [...new Set([...order, ...fallback.filter((item) => !order.includes(item))])];
}

function normalizeMediaPreferences(value: unknown, mediaType: MediaType): PortableMediaPreferences {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<PortableMediaPreferences>
    : {};
  const storedView = readString(mediaKey(STORAGE_KEYS.myListView, mediaType));
  const viewValue = record.view ?? storedView;
  const storedSort = readStringWithLegacy(
    mediaKey(STORAGE_KEYS.myListSortMode, mediaType),
    mediaKey(LEGACY_STORAGE_KEYS.myListSortMode, mediaType)
  );
  const sortValue = record.sortMode ?? storedSort;
  const storedOpen = readJsonWithLegacy(
    mediaKey(STORAGE_KEYS.myListOpenSections, mediaType),
    mediaKey(LEGACY_STORAGE_KEYS.myListOpenSections, mediaType)
  );
  const openValue = record.openSections ?? storedOpen;
  const openRecord = openValue && typeof openValue === "object" && !Array.isArray(openValue)
    ? openValue as Partial<PortableMediaPreferences["openSections"]>
    : {};
  const storedOrder = readJsonWithLegacy(
    mediaKey(STORAGE_KEYS.myListSectionOrder, mediaType),
    mediaKey(LEGACY_STORAGE_KEYS.myListSectionOrder, mediaType)
  );

  return {
    view: viewValue === "grid" || viewValue === "board" ? viewValue : "list",
    sortMode: sortValue === "personalScore" ? "personalScore" : "alphabetical",
    openSections: {
      watching: typeof openRecord.watching === "boolean" ? openRecord.watching : DEFAULT_OPEN_SECTIONS.watching,
      planned: typeof openRecord.planned === "boolean" ? openRecord.planned : DEFAULT_OPEN_SECTIONS.planned,
      completed: typeof openRecord.completed === "boolean" ? openRecord.completed : DEFAULT_OPEN_SECTIONS.completed,
      paused: typeof openRecord.paused === "boolean" ? openRecord.paused : DEFAULT_OPEN_SECTIONS.paused,
      dropped: typeof openRecord.dropped === "boolean" ? openRecord.dropped : DEFAULT_OPEN_SECTIONS.dropped,
    },
    sectionOrder: normalizeOrder(record.sectionOrder ?? storedOrder, DEFAULT_STATUS_ORDER),
  };
}

export function normalizePortablePreferences(value: unknown): PortablePreferences {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<PortablePreferences>
    : {};
  const navigation = record.navigation ?? {} as PortablePreferences["navigation"];
  const layouts = record.layouts && typeof record.layouts === "object" ? record.layouts : {};
  const currentLibraryMediaType =
    readStringWithLegacy(STORAGE_KEYS.libraryMediaType, LEGACY_STORAGE_KEYS.libraryMediaType) === "MANGA"
      ? "MANGA"
      : "ANIME";
  const currentHomeMode =
    readStringWithLegacy(STORAGE_KEYS.homeMode, LEGACY_STORAGE_KEYS.homeMode) === "discover"
      ? "discover"
      : "personal";

  return {
    version: PORTABLE_PREFERENCES_VERSION,
    navigation: {
      libraryMediaType:
        navigation.libraryMediaType === "MANGA" || navigation.libraryMediaType === "ANIME"
          ? navigation.libraryMediaType
          : currentLibraryMediaType,
      homeMode:
        navigation.homeMode === "discover" || navigation.homeMode === "personal"
          ? navigation.homeMode
          : currentHomeMode,
    },
    layouts: {
      personalLayoutOrder: normalizeOrder(
        layouts.personalLayoutOrder,
        normalizeOrder(
          readJsonWithLegacy(STORAGE_KEYS.personalLayoutOrder, LEGACY_STORAGE_KEYS.personalLayoutOrder)
        )
      ),
      mangaPersonalLayoutOrder: normalizeOrder(
        layouts.mangaPersonalLayoutOrder,
        normalizeOrder(readJson(STORAGE_KEYS.mangaPersonalLayoutOrder))
      ),
      discoverLayoutOrder: normalizeOrder(
        layouts.discoverLayoutOrder,
        normalizeOrder(
          readJsonWithLegacy(STORAGE_KEYS.discoverLayoutOrder, LEGACY_STORAGE_KEYS.discoverLayoutOrder)
        )
      ),
      myListSectionOrder: normalizeOrder(
        layouts.myListSectionOrder,
        normalizeOrder(
          readJsonWithLegacy(STORAGE_KEYS.myListSectionOrder, LEGACY_STORAGE_KEYS.myListSectionOrder),
          DEFAULT_STATUS_ORDER
        )
      ),
      mangaMyListSectionOrder: normalizeOrder(
        layouts.mangaMyListSectionOrder,
        normalizeOrder(
          readJsonWithLegacy(
            mediaKey(STORAGE_KEYS.myListSectionOrder, "MANGA"),
            mediaKey(LEGACY_STORAGE_KEYS.myListSectionOrder, "MANGA")
          ),
          DEFAULT_STATUS_ORDER
        )
      ),
    },
    myList: {
      anime: normalizeMediaPreferences(record.myList?.anime, "ANIME"),
      manga: normalizeMediaPreferences(record.myList?.manga, "MANGA"),
    },
  };
}

export async function collectBackupPreferences(userId: number) {
  const localLayouts = {
    personalLayoutOrder: normalizeOrder(
      readJsonWithLegacy(STORAGE_KEYS.personalLayoutOrder, LEGACY_STORAGE_KEYS.personalLayoutOrder)
    ),
    mangaPersonalLayoutOrder: normalizeOrder(readJson(STORAGE_KEYS.mangaPersonalLayoutOrder)),
    discoverLayoutOrder: normalizeOrder(
      readJsonWithLegacy(STORAGE_KEYS.discoverLayoutOrder, LEGACY_STORAGE_KEYS.discoverLayoutOrder)
    ),
    myListSectionOrder: normalizeOrder(
      readJsonWithLegacy(STORAGE_KEYS.myListSectionOrder, LEGACY_STORAGE_KEYS.myListSectionOrder),
      DEFAULT_STATUS_ORDER
    ),
    mangaMyListSectionOrder: normalizeOrder(
      readJson(mediaKey(STORAGE_KEYS.myListSectionOrder, "MANGA")),
      DEFAULT_STATUS_ORDER
    ),
  };
  const desktopLayouts = await window.desktopConfig?.getLayoutOrders(userId).catch(() => null);
  const layouts = desktopLayouts?.ok
    ? {
        personalLayoutOrder: desktopLayouts.personalLayoutOrder ?? localLayouts.personalLayoutOrder,
        mangaPersonalLayoutOrder:
          desktopLayouts.mangaPersonalLayoutOrder ?? localLayouts.mangaPersonalLayoutOrder,
        discoverLayoutOrder: desktopLayouts.discoverLayoutOrder ?? localLayouts.discoverLayoutOrder,
        myListSectionOrder: desktopLayouts.myListSectionOrder ?? localLayouts.myListSectionOrder,
        mangaMyListSectionOrder:
          desktopLayouts.mangaMyListSectionOrder ?? localLayouts.mangaMyListSectionOrder,
      }
    : localLayouts;

  const portablePreferences = normalizePortablePreferences({
    version: PORTABLE_PREFERENCES_VERSION,
    navigation: {
      libraryMediaType:
        readStringWithLegacy(STORAGE_KEYS.libraryMediaType, LEGACY_STORAGE_KEYS.libraryMediaType) === "MANGA"
          ? "MANGA"
          : "ANIME",
      homeMode:
        readStringWithLegacy(STORAGE_KEYS.homeMode, LEGACY_STORAGE_KEYS.homeMode) === "discover"
          ? "discover"
          : "personal",
    },
    layouts,
    myList: {
      anime: normalizeMediaPreferences(null, "ANIME"),
      manga: normalizeMediaPreferences(null, "MANGA"),
    },
  });

  const [shortcut, windowState, startup] = await Promise.all([
    window.desktopShortcuts?.getHideShowShortcut().catch(() => null),
    window.desktopWindow?.getWindowState().catch(() => null),
    window.desktopStartup?.getStartupSetting().catch(() => null),
  ]);
  const desktopPreferences: DesktopPreferences = {};
  if (shortcut?.ok) {
    desktopPreferences.shortcut = {
      enabled: Boolean(shortcut.enabled),
      accelerator: String(shortcut.accelerator || "Control+Space"),
    };
  }
  if (windowState?.ok && windowState.preset) {
    const dimensions = windowState.customBounds ?? windowState.bounds;
    desktopPreferences.window = {
      preset: windowState.preset,
      ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {}),
    };
  }
  if (startup?.ok && startup.available) {
    desktopPreferences.startup = { openAtLogin: Boolean(startup.openAtLogin) };
  }

  return {
    portablePreferences,
    ...(Object.keys(desktopPreferences).length ? { desktopPreferences } : {}),
  };
}

function writePreference(key: string, value: string) {
  window.localStorage.setItem(key, value);
}

export async function applyBackupPreferences(
  userId: number,
  value: unknown,
  desktopValue: unknown,
  options: { restoreDesktopPreferences?: boolean } = {}
) {
  const preferences = normalizePortablePreferences(value);
  writePreference(STORAGE_KEYS.libraryMediaType, preferences.navigation.libraryMediaType);
  writePreference(STORAGE_KEYS.homeMode, preferences.navigation.homeMode);
  writePreference(STORAGE_KEYS.personalLayoutOrder, JSON.stringify(preferences.layouts.personalLayoutOrder));
  writePreference(
    STORAGE_KEYS.mangaPersonalLayoutOrder,
    JSON.stringify(preferences.layouts.mangaPersonalLayoutOrder)
  );
  writePreference(STORAGE_KEYS.discoverLayoutOrder, JSON.stringify(preferences.layouts.discoverLayoutOrder));

  for (const [mediaType, mediaPreferences] of [
    ["ANIME", preferences.myList.anime],
    ["MANGA", preferences.myList.manga],
  ] as const) {
    writePreference(mediaKey(STORAGE_KEYS.myListView, mediaType), mediaPreferences.view);
    writePreference(mediaKey(STORAGE_KEYS.myListSortMode, mediaType), mediaPreferences.sortMode);
    writePreference(
      mediaKey(STORAGE_KEYS.myListOpenSections, mediaType),
      JSON.stringify(mediaPreferences.openSections)
    );
    writePreference(
      mediaKey(STORAGE_KEYS.myListSectionOrder, mediaType),
      JSON.stringify(mediaPreferences.sectionOrder)
    );
  }

  window.desktopConfig?.setLayoutOrders(userId, preferences.layouts);
  let desktopRestored = 0;
  if (options.restoreDesktopPreferences && desktopValue && typeof desktopValue === "object") {
    const desktop = normalizeDesktopPreferences(desktopValue);
    if (desktop.shortcut && window.desktopShortcuts) {
      const result = await window.desktopShortcuts.setHideShowShortcut(desktop.shortcut);
      if (result.ok) desktopRestored += 1;
    }
    if (desktop.window && window.desktopWindow) {
      if (desktop.window.preset === "custom") {
        if (desktop.window.width && desktop.window.height) {
          const result = await window.desktopWindow.setCustomBounds({
            width: desktop.window.width,
            height: desktop.window.height,
          });
          if (result.ok) desktopRestored += 1;
        }
      } else {
        const result = await window.desktopWindow.setWindowPreset(desktop.window.preset);
        if (result.ok) desktopRestored += 1;
      }
    }
    if (desktop.startup && window.desktopStartup) {
      const result = await window.desktopStartup.setStartupSetting(desktop.startup.openAtLogin);
      if (result.ok) desktopRestored += 1;
    }
  }

  return { preferences, desktopRestored };
}
