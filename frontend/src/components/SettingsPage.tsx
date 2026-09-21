import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type SVGProps } from "react";
import {
  ArrowTopRightOnSquareIcon,
  ArrowPathIcon,
  BookmarkIcon,
  BugAntIcon,
  ChartBarSquareIcon,
  CheckIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  CloudArrowDownIcon,
  CommandLineIcon,
  ClipboardDocumentIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  EyeSlashIcon,
  HomeIcon,
  KeyIcon,
  LanguageIcon,
  LinkIcon,
  PaintBrushIcon,
  PlayCircleIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { getPreferredTitle, type TitleLanguage } from "../utils/titlePreference";
import { getMigratedLocalStorageItem } from "../utils/localStorageMigration";
import { formatLocalDateTime as formatDateTime } from "../utils/dateFormat";
import type { ImportPreviewItem } from "../types/domain";
import {
  inspectSeenaryBackup,
  selectBackupSections,
  type BackupInspection,
} from "../utils/portablePreferences";
import { ModalShell } from "./ui/ModalShell";
import { Tooltip } from "./ui/Tooltip";

export type ThemeAccent = "violet" | "rose" | "amber" | "emerald" | "custom";
type OverlayBackground = "solid" | "glass" | "transparent";
export type NavbarStyle = "integrated" | "floating" | "minimal";
type BrowseCardStyle = "default" | "immersive" | "gallery";
type StartView = "home" | "list" | "search";
type AnimationLevel = "full" | "reduced" | "off";
export type CardDensity = "comfortable" | "balanced" | "compact";
export type DiscoverDensity = CardDensity;

export type AppSettings = {
  themeAccent: ThemeAccent;
  customAccentColor: string;
  titleLanguage: TitleLanguage;
  showTrendingCarousel: boolean;
  autoRotateTrending: boolean;
  autoScrollHomeShelves: boolean;
  hideAdultContent: boolean;
  overlayOpacity: number;
  overlayBackground: OverlayBackground;
  navbarStyle: NavbarStyle;
  browseCardStyle: BrowseCardStyle;
  backgroundDim: number;
  animationLevel: AnimationLevel;
  compactMode: boolean;
  discoverDensity: DiscoverDensity;
  homeDensity: CardDensity;
  myListDensity: CardDensity;
  startView: StartView;
  shareAnonymousUsageStatistics: boolean;
  analyticsConsentDecided: boolean;
};

type ImportPreviewGroup = {
  status: string;
  mediaType?: "ANIME" | "MANGA";
  items: ImportPreviewItem[];
};

type ImportPreviewResponse = {
  ok: boolean;
  message?: string;
  username?: string;
  preview?: {
    totalFound: number;
    groups: ImportPreviewGroup[];
    unmatched?: string[];
  };
};

type ImportProvider = "anilist" | "mal" | "txt" | "pdf";
type FileImportMediaType = "ANIME" | "MANGA";
type ImportFeedback = {
  provider: ImportProvider;
  kind: "success" | "error" | "warning";
  message: string;
  summary?: {
    sourceUsername: string;
    totalFound: number;
    selectedStatuses: string[];
    selectedAnimeIds: number[];
    imported: number;
    created: number;
    updated: number;
    skipped: number;
  };
};

type AniListLinkedAccount = {
  anilistUserId: number;
  anilistUsername: string;
  originalAniListUsername: string;
  lastImportAt: string | null;
  updatedAt: string;
};

type AniListLinkConflict = {
  anilistUserId: number;
  anilistUsername: string;
  sourceUser: {
    id: number;
    username: string;
  } | null;
  targetUser: {
    id: number;
    username: string;
  };
};

type MalLinkedAccount = {
  malUserId: number;
  malUsername: string;
  originalMalUsername: string;
  lastImportAt: string | null;
  updatedAt: string;
};

type MalLinkConflict = {
  malUserId: number;
  malUsername: string;
  sourceUser: {
    id: number;
    username: string;
  } | null;
  targetUser: {
    id: number;
    username: string;
  };
};

type SettingsPageProps = {
  username: string;
  settings: AppSettings;
  onUpdateSettings: (settings: Partial<AppSettings>) => void | Promise<void>;
  onShowTutorial: () => void | Promise<void>;
  onResetSettings: () => void | Promise<void>;
  onImportAniList: (
    username: string,
    selectedStatuses: string[],
    selectedMediaKeys: string[],
    options?: { signal?: AbortSignal }
  ) => Promise<{
    ok: boolean;
    cancelled?: boolean;
    message: string;
    summary?: {
      sourceUsername: string;
      totalFound: number;
      selectedStatuses: string[];
      selectedAnimeIds: number[];
      imported: number;
      created: number;
      updated: number;
      skipped: number;
    };
  }>;
  onImportMal: (
    username: string,
    selectedStatuses: string[],
    selectedMediaKeys: string[],
    options?: { signal?: AbortSignal }
  ) => Promise<{
    ok: boolean;
    cancelled?: boolean;
    message: string;
    summary?: {
      sourceUsername: string;
      totalFound: number;
      selectedStatuses: string[];
      selectedAnimeIds: number[];
      imported: number;
      created: number;
      updated: number;
      skipped: number;
      mapped?: number;
      unmapped?: number;
    };
  }>;
  onImportTextList: (
    entries: ImportPreviewItem[],
    selectedMediaKeys: string[],
    options?: { signal?: AbortSignal }
  ) => Promise<{
    ok: boolean;
    cancelled?: boolean;
    message: string;
    summary?: {
      sourceUsername: string;
      totalFound: number;
      selectedStatuses: string[];
      selectedAnimeIds: number[];
      imported: number;
      created: number;
      updated: number;
      skipped: number;
    };
  }>;
  onClearLists: (
    target: "anime" | "manga" | "all",
    queueProviderDeletion: boolean
  ) => Promise<{
    ok: boolean;
    message: string;
    removedCount?: number;
  }>;
  onDeleteAccount: (usernameConfirmation: string, password: string) => Promise<{
    ok: boolean;
    message: string;
  }>;
  onExportAccountData: () => Promise<void>;
  onExportLocalBackup: () => Promise<void>;
  onImportLocalBackup: (
    backup: unknown,
    options?: { restoreDesktopPreferences?: boolean }
  ) => Promise<{
    ok: boolean;
    message: string;
    imported?: number;
  }>;
  onLinkAniListAccount: () => Promise<{
    ok: boolean;
    message: string;
    linked: boolean;
    account?: AniListLinkedAccount | null;
    needsConflictResolution?: boolean;
    conflict?: AniListLinkConflict;
  }>;
  onLinkMalAccount: () => Promise<{
    ok: boolean;
    message: string;
    linked: boolean;
    account?: MalLinkedAccount | null;
    needsConflictResolution?: boolean;
    conflict?: MalLinkConflict;
  }>;
  onRunSyncNow: () => Promise<{
    ok: boolean;
    message: string;
    synced?: number;
    failed?: number;
    pending?: number;
  }>;
  onPullFromAniList: () => Promise<{
    ok: boolean;
    message: string;
    summary?: {
      sourceUsername: string;
      totalFound: number;
      imported: number;
      created: number;
      updated: number;
      skipped: number;
    };
  }>;
  onPullFromMal: () => Promise<{
    ok: boolean;
    message: string;
    summary?: {
      sourceUsername: string;
      totalFound: number;
      imported: number;
      created: number;
      updated: number;
      skipped: number;
      mapped?: number;
      unmapped?: number;
    };
  }>;
};

type SettingsSectionId = "appearance" | "home" | "content" | "account" | "sync" | "data" | "general";
type SyncActivityTab = "pending" | "completed" | "failed" | "pulled" | "excluded";
type DesktopShortcutState = {
  available: boolean;
  loading: boolean;
  enabled: boolean;
  accelerator: string;
  draftAccelerator: string;
  feedback: { kind: "success" | "error"; message: string } | null;
};
type DesktopStartupState = {
  available: boolean;
  loading: boolean;
  openAtLogin: boolean;
  feedback: { kind: "success" | "error"; message: string } | null;
};
type DesktopEnvironmentState = {
  loading: boolean;
  platform: string;
  architecture: string;
  displayBackend: "wayland" | "x11" | "other" | "unknown";
  desktopEnvironment: string | null;
  shortcutMethod: "native" | "unavailable";
};
type WindowPresetId = "compact" | "balanced" | "cinematic" | "custom";
type SelectableWindowPresetId = Exclude<WindowPresetId, "custom">;
type DesktopWindowState = {
  available: boolean;
  loading: boolean;
  preset: WindowPresetId;
  bounds: { x: number; y: number; width: number; height: number } | null;
  customBounds: { x: number; y: number; width: number; height: number } | null;
  feedback: { kind: "success" | "error"; message: string } | null;
};
type SyncActivityItem = {
  id: number | string;
  anime_id?: number | null;
  manga_id?: number | null;
  media_type?: "ANIME" | "MANGA";
  animeTitle?: string | null;
  anime_title?: string | null;
  title_preferred?: string | null;
  title_english?: string | null;
  title_romaji?: string | null;
  title_native?: string | null;
  operation: string;
  status: string;
  provider?: "anilist" | "mal";
  excluded_by?: "user" | "system";
  attempts?: number;
  last_error?: string | null;
  next_attempt_at?: string | null;
  created_at: string;
  updated_at?: string;
  message?: string | null;
  changedFields?: Array<{ field: string; from: unknown; to: unknown }>;
};
type SyncProgressEvent = {
  operation: "manual-sync" | "pull-anilist" | "pull-mal";
  stage: "fetching" | "mapping" | "saving" | "processing" | "complete" | "failed";
  label: string;
  current?: number | null;
  total?: number | null;
  updatedAt?: string;
};

const THEME_OPTIONS: Array<{
  value: Exclude<ThemeAccent, "custom">;
  label: string;
  color: string;
  glow: string;
}> = [
  { value: "violet", label: "Violet", color: "#a78bfa", glow: "shadow-violet-400/20" },
  { value: "rose", label: "Rose", color: "#fb7185", glow: "shadow-rose-400/20" },
  { value: "amber", label: "Amber", color: "#fbbf24", glow: "shadow-amber-400/20" },
  { value: "emerald", label: "Emerald", color: "#34d399", glow: "shadow-emerald-400/20" },
];

const TITLE_OPTIONS: Array<{
  value: TitleLanguage;
  label: string;
  description: string;
}> = [
  {
    value: "userPreferred",
    label: "AniList preferred",
    description: "Use AniList's preferred title when available.",
  },
  {
    value: "english",
    label: "English",
    description: "Prefer official English titles.",
  },
  {
    value: "romaji",
    label: "Romaji",
    description: "Prefer romanized Japanese titles.",
  },
  {
    value: "native",
    label: "Native",
    description: "Prefer native-language titles.",
  },
];

const OVERLAY_BACKGROUND_OPTIONS: Array<{
  value: OverlayBackground;
  label: string;
  description: string;
}> = [
  {
    value: "solid",
    label: "Solid",
    description: "Keep the app surface opaque and closest to the current look.",
  },
  {
    value: "glass",
    label: "Glass",
    description: "Let more desktop color through with a stronger blur.",
  },
  {
    value: "transparent",
    label: "Light glass",
    description: "Use the clearest overlay style while keeping text readable.",
  },
];

const NAVBAR_STYLE_OPTIONS: Array<{
  value: NavbarStyle;
  label: string;
  description: string;
}> = [
  {
    value: "integrated",
    label: "Integrated",
    description: "A steady full-width bar that feels connected to the app.",
  },
  {
    value: "floating",
    label: "Floating",
    description: "An inset glass surface that lifts the navbar above the page.",
  },
  {
    value: "minimal",
    label: "Minimal",
    description: "Separate navigation, search, and account controls with no full-width bar.",
  },
];

const BROWSE_CARD_STYLE_OPTIONS: Array<{
  value: BrowseCardStyle;
  label: string;
  description: string;
}> = [
  {
    value: "default",
    label: "Default",
    description: "Keep artwork and information in Seenary's familiar card layout.",
  },
  {
    value: "immersive",
    label: "Immersive",
    description: "Let artwork fill the card with details layered over a soft gradient.",
  },
  {
    value: "gallery",
    label: "Gallery",
    description: "Remove the heavy card shell for a lighter, poster-wall presentation.",
  },
];

const START_VIEW_OPTIONS: Array<{
  value: StartView;
  label: string;
  description: string;
}> = [
  {
    value: "home",
    label: "Home",
    description: "Open on discovery and your library shelves.",
  },
  {
    value: "list",
    label: "My List",
    description: "Open directly to your tracked anime.",
  },
  {
    value: "search",
    label: "Search",
    description: "Open home with the search field ready.",
  },
];

const ANIMATION_LEVEL_OPTIONS: Array<{
  value: AnimationLevel;
  label: string;
  description: string;
}> = [
  {
    value: "full",
    label: "Full",
    description: "Keep Seenary's full transitions, hover movement, and loading motion.",
  },
  {
    value: "reduced",
    label: "Reduced",
    description: "Calm down decorative motion while keeping quick interface feedback.",
  },
  {
    value: "off",
    label: "Off",
    description: "Remove non-essential animations and transitions.",
  },
];

const CARD_DENSITY_OPTIONS: Array<{
  value: CardDensity;
  label: string;
  description: string;
}> = [
  {
    value: "comfortable",
    label: "Comfortable",
    description: "Larger posters and wider spacing for slower, artwork-led browsing.",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "The default Discover page layout with a steady mix of artwork and scan speed.",
  },
  {
    value: "compact",
    label: "Compact",
    description: "Smaller cards and tighter shelves so more titles fit in the overlay.",
  },
];

const DISCOVER_DENSITY_OPTIONS = CARD_DENSITY_OPTIONS;

const WINDOW_PRESET_OPTIONS: Array<{
  value: WindowPresetId;
  label: string;
  description: string;
  selectable: boolean;
}> = [
  {
    value: "compact",
    label: "Compact",
    description: "A smaller overlay for quick checks beside another app.",
    selectable: true,
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "The default roomy layout for everyday browsing.",
    selectable: true,
  },
  {
    value: "cinematic",
    label: "Cinematic",
    description: "A wide overlay for artwork-heavy discovery and details.",
    selectable: true,
  },
  {
    value: "custom",
    label: "Custom",
    description: "Return to your last manually chosen size.",
    selectable: false,
  },
];

const IMPORT_STATUS_LABELS: Record<string, string> = {
  watching: "Watching",
  planned: "Planned",
  completed: "Completed",
  paused: "Paused",
  dropped: "Dropped",
};

const MANGA_IMPORT_STATUS_LABELS: Record<string, string> = {
  watching: "Reading",
  planned: "Plan to Read",
  completed: "Completed",
  paused: "Paused",
  dropped: "Dropped",
};

function getImportItemMediaType(item: ImportPreviewItem): "ANIME" | "MANGA" {
  return item.mediaType === "MANGA" ? "MANGA" : "ANIME";
}

function getImportItemKey(item: ImportPreviewItem) {
  const mediaType = getImportItemMediaType(item);
  const mediaId = Number(item.mediaId ?? item.mangaId ?? item.animeId);
  return `${mediaType}:${mediaId}`;
}

function getImportGroupKey(group: ImportPreviewGroup) {
  return `${group.mediaType === "MANGA" ? "MANGA" : "ANIME"}:${group.status}`;
}

const SHORTCUT_PRESETS = [
  "Control+Space",
  "Control+Shift+Space",
  "Alt+Space",
  "Control+Alt+Space",
  "Control+Alt+Shift+Space",
  "Control+Shift+Enter",
  "Alt+Shift+Space",
];

const APP_VERSION = __APP_VERSION__;
const GITHUB_ISSUES_URL = "https://github.com/DandelionEater/Seenary/issues";
const GITHUB_RELEASES_API =
  "https://api.github.com/repos/DandelionEater/Seenary/releases?per_page=20";
const SEENARY_DOWNLOAD_URL = "https://seenary.app";
const SETTINGS_OPEN_SECTION_KEY = "seenary.settings.open-section";
const SETTINGS_OPEN_SECTION_LEGACY_KEY = "media-tracker.settings.open-section";
const SETTINGS_SECTION_SCROLL_OFFSET = 88;
const MIN_DESKTOP_WINDOW_SIZE = { width: 900, height: 600 };
const SETTINGS_SECTION_IDS: SettingsSectionId[] = [
  "general",
  "appearance",
  "content",
  "home",
  "account",
  "sync",
  "data",
];

function compareReleaseVersions(left: string, right: string) {
  const parse = (value: string) => {
    const match = value.trim().replace(/^v/i, "").match(
      /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
    );
    return match
      ? { core: match.slice(1, 4).map(Number), prerelease: match[4] || "" }
      : null;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  }
  if (!a.prerelease || !b.prerelease) {
    return a.prerelease === b.prerelease ? 0 : a.prerelease ? -1 : 1;
  }
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

async function checkGitHubReleaseFromRenderer() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(GITHUB_RELEASES_API, {
      cache: "no-store",
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GitHub returned status ${response.status}.`);
    const releases = (await response.json()) as Array<{
      tag_name?: string;
      name?: string;
      body?: string;
      html_url?: string;
      draft?: boolean;
      prerelease?: boolean;
      published_at?: string;
    }>;
    const allowPrerelease = APP_VERSION.includes("-");
    const release = releases
      .filter((item) => item && !item.draft && (allowPrerelease || !item.prerelease))
      .filter((item) => compareReleaseVersions(item.tag_name || "", APP_VERSION) > 0)
      .sort((a, b) => compareReleaseVersions(b.tag_name || "", a.tag_name || ""))[0];

    return {
      ok: true,
      updateAvailable: Boolean(release),
      info: release
        ? {
            version: (release.tag_name || "").replace(/^v/i, ""),
            releaseName: release.name || release.tag_name || "Seenary update",
            releaseNotes: release.body || "",
            releaseDate: release.published_at || null,
            manualDownload: true,
            manualDownloadUrl: release.html_url || SEENARY_DOWNLOAD_URL,
          }
        : null,
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

function readStoredSettingsSection(): SettingsSectionId {
  if (typeof window === "undefined") {
    return "general";
  }

  try {
    const storedSection = getMigratedLocalStorageItem(
      SETTINGS_OPEN_SECTION_KEY,
      SETTINGS_OPEN_SECTION_LEGACY_KEY
    );
    const migratedSection =
      storedSection === "behavior"
        ? "home"
        : storedSection === "library"
          ? "data"
          : storedSection === "onboarding"
            ? "general"
            : storedSection;

    return SETTINGS_SECTION_IDS.includes(migratedSection as SettingsSectionId)
      ? (migratedSection as SettingsSectionId)
      : "general";
  } catch {
    return "general";
  }
}

export function SettingsPage({
  username,
  settings,
  onUpdateSettings,
  onShowTutorial,
  onResetSettings,
  onImportAniList,
  onImportMal,
  onImportTextList,
  onClearLists,
  onDeleteAccount,
  onExportAccountData,
  onExportLocalBackup,
  onImportLocalBackup,
  onLinkAniListAccount,
  onLinkMalAccount,
  onRunSyncNow,
  onPullFromAniList,
  onPullFromMal,
}: SettingsPageProps) {
  const settingsScrollRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Partial<Record<SettingsSectionId, HTMLElement | null>>>({});
  const textImportInputRef = useRef<HTMLInputElement | null>(null);
  const pdfImportInputRef = useRef<HTMLInputElement | null>(null);
  const backupImportInputRef = useRef<HTMLInputElement | null>(null);
  const activePreviewAbortRef = useRef<AbortController | null>(null);
  const activeImportAbortRef = useRef<AbortController | null>(null);
  const [openSection, setOpenSection] = useState<SettingsSectionId | null>(
    readStoredSettingsSection
  );
  const [importUsername, setImportUsername] = useState(username);
  const [malImportUsername, setMalImportUsername] = useState(username);
  const [importPreviewUsername, setImportPreviewUsername] = useState(username);
  const [importProvider, setImportProvider] = useState<ImportProvider>("anilist");
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreviewResponse["preview"] | null>(null);
  const [textImportFileName, setTextImportFileName] = useState("");
  const [textImportMediaType, setTextImportMediaType] = useState<FileImportMediaType>("ANIME");
  const [pdfImportMediaType, setPdfImportMediaType] = useState<FileImportMediaType>("ANIME");
  const [selectedImportKeys, setSelectedImportKeys] = useState<string[]>([]);
  const [openImportGroups, setOpenImportGroups] = useState<Record<string, boolean>>({});
  const [importFeedback, setImportFeedback] = useState<ImportFeedback | null>(null);
  const [clearFeedback, setClearFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [backupFeedback, setBackupFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [isExportingAccountData, setIsExportingAccountData] = useState(false);
  const [isImportingBackup, setIsImportingBackup] = useState(false);
  const [isCacheRepairConfirmOpen, setIsCacheRepairConfirmOpen] = useState(false);
  const [isRepairingCache, setIsRepairingCache] = useState(false);
  const [cacheRepairFeedback, setCacheRepairFeedback] = useState<{
    kind: "success" | "error";
    message: string;
    removedDetails?: number;
    removedMedia?: number;
    restartRecommended?: boolean;
  } | null>(null);
  const [backupPreview, setBackupPreview] = useState<{
    backup: unknown;
    inspection: BackupInspection;
    restoreLibrary: boolean;
    restorePreferences: boolean;
    restoreDesktopPreferences: boolean;
  } | null>(null);
  const [clearTarget, setClearTarget] = useState<"anime" | "manga" | "all" | null>(null);
  const [queueProviderDeletion, setQueueProviderDeletion] = useState(false);
  const [isClearingList, setIsClearingList] = useState(false);
  const [isDeleteAccountArmed, setIsDeleteAccountArmed] = useState(false);
  const [deleteAccountConfirmation, setDeleteAccountConfirmation] = useState("");
  const [deleteAccountPassword, setDeleteAccountPassword] = useState("");
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteAccountFeedback, setDeleteAccountFeedback] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState({
    loading: true,
    linked: false,
    provider: null as "anilist" | "mal" | null,
    providerLabel: null as string | null,
    syncTargetsLabel: null as string | null,
    autoSyncEnabled: true,
    pendingCount: 0,
    feedback: null as { kind: "success" | "error"; message: string } | null,
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPullingFromRemote, setIsPullingFromRemote] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgressEvent | null>(null);
  const [isSyncActivityOpen, setIsSyncActivityOpen] = useState(false);
  const [syncActivityTab, setSyncActivityTab] = useState<SyncActivityTab>("pending");
  const [desktopShortcut, setDesktopShortcut] = useState<DesktopShortcutState>({
    available: Boolean(window.desktopShortcuts),
    loading: Boolean(window.desktopShortcuts),
    enabled: true,
    accelerator: "Control+Space",
    draftAccelerator: "Control+Space",
    feedback: null,
  });
  const [isShortcutRecorderFocused, setIsShortcutRecorderFocused] = useState(false);
  const [desktopStartup, setDesktopStartup] = useState<DesktopStartupState>({
    available: Boolean(window.desktopStartup),
    loading: Boolean(window.desktopStartup),
    openAtLogin: false,
    feedback: null,
  });
  const [desktopEnvironment, setDesktopEnvironment] = useState<DesktopEnvironmentState>({
    loading: Boolean(window.desktopEnvironment),
    platform: "",
    architecture: "",
    displayBackend: "unknown",
    desktopEnvironment: null,
    shortcutMethod: "native",
  });
  const [bugReportCopyState, setBugReportCopyState] = useState<
    "idle" | "copied" | "error"
  >("idle");
  const [updateCheckState, setUpdateCheckState] = useState<{
    checking: boolean;
    feedback: {
      kind: "success" | "error";
      message: string;
      downloadUrl?: string;
    } | null;
  }>({ checking: false, feedback: null });
  const bugReportCopyResetRef = useRef<number | null>(null);
  const [desktopWindow, setDesktopWindow] = useState<DesktopWindowState>({
    available: Boolean(window.desktopWindow),
    loading: Boolean(window.desktopWindow),
    preset: "balanced",
    bounds: null,
    customBounds: null,
    feedback: null,
  });
  const [desktopWindowDraft, setDesktopWindowDraft] = useState({
    width: "",
    height: "",
  });

  useEffect(() => {
    return () => {
      void window.desktopShortcuts?.setShortcutRecordingActive(false);
      if (bugReportCopyResetRef.current !== null) {
        window.clearTimeout(bugReportCopyResetRef.current);
      }
    };
  }, []);
  const [syncActivity, setSyncActivity] = useState<{
    loading: boolean;
    pending: SyncActivityItem[];
    completed: SyncActivityItem[];
    failed: SyncActivityItem[];
    pulled: SyncActivityItem[];
    excluded: SyncActivityItem[];
  }>({
    loading: false,
    pending: [],
    completed: [],
    failed: [],
    pulled: [],
    excluded: [],
  });
  const [restoringSyncExclusionId, setRestoringSyncExclusionId] = useState<number | string | null>(null);
  const [excludingSyncEntryId, setExcludingSyncEntryId] = useState<number | string | null>(null);
  const [syncActivityActionFeedback, setSyncActivityActionFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [aniListLink, setAniListLink] = useState<{
    loading: boolean;
    linked: boolean;
    account: AniListLinkedAccount | null;
    feedback: {
      kind: "success" | "error";
      message: string;
    } | null;
    conflict: AniListLinkConflict | null;
  }>({
    loading: true,
    linked: false,
    account: null,
    feedback: null,
    conflict: null,
  });
  const [malLink, setMalLink] = useState<{
    loading: boolean;
    linked: boolean;
    account: MalLinkedAccount | null;
    feedback: {
      kind: "success" | "error";
      message: string;
    } | null;
    conflict: MalLinkConflict | null;
  }>({
    loading: true,
    linked: false,
    account: null,
    feedback: null,
    conflict: null,
  });
  const [localCredentialsConfirmed, setLocalCredentialsConfirmed] = useState<boolean | null>(null);
  const [unlinkProvider, setUnlinkProvider] = useState<"anilist" | "mal" | null>(null);
  const [unlinkPassword, setUnlinkPassword] = useState("");
  const [unlinkPasswordConfirmation, setUnlinkPasswordConfirmation] = useState("");
  const [isSettingUnlinkPassword, setIsSettingUnlinkPassword] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [unlinkFeedback, setUnlinkFeedback] = useState<string | null>(null);

  const titleLabel = useMemo(() => {
    return (
      TITLE_OPTIONS.find((option) => option.value === settings.titleLanguage)?.label ??
      "AniList preferred"
    );
  }, [settings.titleLanguage]);
  const overlayOpacity = Number.isFinite(Number(settings.overlayOpacity))
    ? Math.min(100, Math.max(70, Math.round(Number(settings.overlayOpacity))))
    : 100;
  const backgroundDim = Number.isFinite(Number(settings.backgroundDim))
    ? Math.min(100, Math.max(0, Math.round(Number(settings.backgroundDim))))
    : 65;
  const customAccentColor = normalizeAccentColor(settings.customAccentColor);
  const accentSummary =
    settings.themeAccent === "custom" ? "Accent Custom" : `Accent ${capitalize(settings.themeAccent)}`;
  const syncProviderLabel = syncStatus.providerLabel ?? "external account";
  const manualSyncTargetsLabel = syncStatus.syncTargetsLabel ?? syncProviderLabel;
  const isAniListSync = syncStatus.provider === "anilist";
  const syncTargetLabel = syncStatus.linked ? syncProviderLabel : "No linked account";

  function toggleSection(section: SettingsSectionId) {
    setOpenSection((current) => {
      const nextSection = current === section ? null : section;

      if (nextSection) {
        try {
          window.localStorage.setItem(SETTINGS_OPEN_SECTION_KEY, nextSection);
        } catch {
          // Keep settings usable even if local storage is unavailable.
        }
      }

      return nextSection;
    });
  }

  function rememberSectionRef(section: SettingsSectionId) {
    return (element: HTMLElement | null) => {
      sectionRefs.current[section] = element;
    };
  }

  function scrollToSettingsSection(section: SettingsSectionId) {
    const container = settingsScrollRef.current;
    const target = sectionRefs.current[section];

    if (!target) {
      return;
    }

    if (!container) {
      target.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextTop =
      targetRect.top - containerRect.top + container.scrollTop - SETTINGS_SECTION_SCROLL_OFFSET;

    container.scrollTo({
      top: Math.max(0, nextTop),
      behavior: "smooth",
    });
  }

  useEffect(() => {
    if (!openSection) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      scrollToSettingsSection(openSection);
    });
    const settledLayoutId = window.setTimeout(() => {
      scrollToSettingsSection(openSection);
    }, 260);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(settledLayoutId);
    };
  }, [openSection]);

  useEffect(() => {
    let cancelled = false;

    loadAniListLinkStatus(undefined, () => cancelled);
    loadMalLinkStatus(undefined, () => cancelled);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    loadSyncStatus();
  }, []);

  useEffect(() => {
    loadDesktopShortcut();
  }, []);

  useEffect(() => {
    loadDesktopStartup();
  }, []);

  useEffect(() => {
    loadDesktopEnvironment();
  }, []);

  useEffect(() => {
    if (!window.api.onSyncProgress) {
      return;
    }

    const removeListener = window.api.onSyncProgress((progress: SyncProgressEvent) => {
      setSyncProgress(progress);
      if (progress.operation === "pull-anilist" || progress.operation === "pull-mal") {
        setIsPullingFromRemote(!["complete", "failed"].includes(progress.stage));
      }
    });

    return () => {
      removeListener();
    };
  }, []);

  useEffect(() => {
    loadDesktopWindow();
  }, []);

  useEffect(() => {
    if (!window.desktopWindow?.onWindowStateChanged) {
      return;
    }

    return window.desktopWindow.onWindowStateChanged((state) => {
      if (!state.ok) {
        return;
      }

      setDesktopWindow((current) => ({
        ...current,
        available: true,
        loading: false,
        preset: getWindowPresetId(state.preset),
        bounds: state.bounds ?? current.bounds,
        customBounds: state.customBounds ?? current.customBounds,
        feedback: current.feedback,
      }));
    });
  }, []);

  useEffect(() => {
    if (!desktopWindow.bounds) {
      return;
    }

    setDesktopWindowDraft({
      width: String(desktopWindow.bounds.width),
      height: String(desktopWindow.bounds.height),
    });
  }, [desktopWindow.bounds]);

  async function loadDesktopWindow() {
    if (!window.desktopWindow) {
      return;
    }

    try {
      const result = await window.desktopWindow.getWindowState();

      setDesktopWindow((current) => ({
        ...current,
        available: Boolean(result.ok),
        loading: false,
        preset: getWindowPresetId(result.preset),
        bounds: result.bounds ?? null,
        customBounds: result.customBounds ?? current.customBounds,
        feedback: result.ok
          ? current.feedback
          : { kind: "error", message: result.message || "Failed to load window layout." },
      }));
    } catch {
      setDesktopWindow((current) => ({
        ...current,
        available: true,
        loading: false,
        feedback: { kind: "error", message: "Failed to load window layout." },
      }));
    }
  }

  async function applyDesktopWindowPreset(preset: SelectableWindowPresetId) {
    if (!window.desktopWindow || desktopWindow.loading) {
      return;
    }

    const customBoundsBeforePreset =
      desktopWindow.preset === "custom" && desktopWindow.bounds
        ? desktopWindow.bounds
        : desktopWindow.customBounds;

    setDesktopWindow((current) => ({
      ...current,
      loading: true,
      preset,
      customBounds: customBoundsBeforePreset ?? current.customBounds,
      feedback: null,
    }));

    try {
      const result = await window.desktopWindow.setWindowPreset(preset);

      setDesktopWindow((current) => ({
        ...current,
        available: true,
        loading: false,
        preset: getWindowPresetId(result.preset ?? preset),
        bounds: result.bounds ?? current.bounds,
        customBounds:
          result.customBounds ?? customBoundsBeforePreset ?? current.customBounds,
        feedback: {
          kind: result.ok ? "success" : "error",
          message: result.message || (result.ok ? "Window layout updated." : "Failed to update window layout."),
        },
      }));
    } catch {
      setDesktopWindow((current) => ({
        ...current,
        loading: false,
        feedback: { kind: "error", message: "Failed to update window layout." },
      }));
    }
  }

  async function applyDesktopWindowCustomSize(nextSize: Partial<{ width: number; height: number }>) {
    if (!window.desktopWindow) {
      return;
    }

    const currentBounds = desktopWindow.bounds ?? {
      x: 0,
      y: 0,
      width: 1280,
      height: 900,
    };
    const nextBounds = {
      ...currentBounds,
      width:
        typeof nextSize.width === "number" && Number.isFinite(nextSize.width)
          ? Math.max(MIN_DESKTOP_WINDOW_SIZE.width, Math.round(nextSize.width))
          : currentBounds.width,
      height:
        typeof nextSize.height === "number" && Number.isFinite(nextSize.height)
          ? Math.max(MIN_DESKTOP_WINDOW_SIZE.height, Math.round(nextSize.height))
          : currentBounds.height,
    };

    setDesktopWindow((current) => ({
      ...current,
      available: true,
      preset: "custom",
      bounds: nextBounds,
      customBounds: nextBounds,
      feedback: null,
    }));

    try {
      const result = await window.desktopWindow.setCustomBounds({
        width: nextBounds.width,
        height: nextBounds.height,
      });

      if (!result.ok) {
        setDesktopWindow((current) => ({
          ...current,
          loading: false,
          preset: getWindowPresetId(result.preset),
          bounds: result.bounds ?? current.bounds,
          customBounds: result.customBounds ?? current.customBounds,
          feedback: { kind: "error", message: result.message || "Failed to update custom size." },
        }));
        return;
      }

      setDesktopWindow((current) => ({
        ...current,
        available: true,
        loading: false,
        preset: getWindowPresetId(result.preset),
        bounds: result.bounds ?? current.bounds,
        customBounds: result.customBounds ?? current.customBounds,
        feedback: null,
      }));
    } catch {
      setDesktopWindow((current) => ({
        ...current,
        feedback: { kind: "error", message: "Failed to update custom size." },
      }));
    }
  }

  function handleDesktopWindowSizeInput(field: "width" | "height", value: string) {
    setDesktopWindowDraft((current) => ({
      ...current,
      [field]: value,
    }));

    const parsed = Number(value);
    const minimum = MIN_DESKTOP_WINDOW_SIZE[field];

    if (Number.isFinite(parsed) && parsed >= minimum) {
      applyDesktopWindowCustomSize(
        field === "width" ? { width: parsed } : { height: parsed }
      );
    }
  }

  function commitDesktopWindowSizeInput(field: "width" | "height", value: string) {
    const parsed = Number(value);
    const minimum = MIN_DESKTOP_WINDOW_SIZE[field];
    const nextValue = Number.isFinite(parsed) ? Math.max(minimum, Math.round(parsed)) : minimum;

    setDesktopWindowDraft((current) => ({
      ...current,
      [field]: String(nextValue),
    }));
    applyDesktopWindowCustomSize(
      field === "width" ? { width: nextValue } : { height: nextValue }
    );
  }

  async function loadDesktopStartup() {
    if (!window.desktopStartup) {
      return;
    }

    try {
      const result = await window.desktopStartup.getStartupSetting();

      setDesktopStartup((current) => ({
        ...current,
        available: result.available,
        loading: false,
        openAtLogin: result.openAtLogin,
        feedback:
          !result.available
            ? current.feedback
            : result.ok
            ? result.message
              ? { kind: "success", message: result.message }
              : current.feedback
            : { kind: "error", message: result.message || "Failed to load startup setting." },
      }));
    } catch {
      setDesktopStartup((current) => ({
        ...current,
        available: true,
        loading: false,
        feedback: { kind: "error", message: "Failed to load startup setting." },
      }));
    }
  }

  async function loadDesktopEnvironment() {
    if (!window.desktopEnvironment) {
      return;
    }

    try {
      const result = await window.desktopEnvironment.getInfo();

      setDesktopEnvironment({
        loading: false,
        platform: result.platform,
        architecture: result.architecture,
        displayBackend: result.displayBackend,
        desktopEnvironment: result.desktopEnvironment,
        shortcutMethod: result.capabilities.globalShortcuts,
      });
    } catch {
      setDesktopEnvironment((current) => ({ ...current, loading: false }));
    }
  }

  async function copyBugReportInfo() {
    const platform = formatDesktopPlatform(desktopEnvironment.platform);
    const lines = [
      "Seenary diagnostics",
      `Version: ${APP_VERSION}`,
      `Platform: ${platform}`,
      `Architecture: ${formatArchitecture(desktopEnvironment.architecture)}`,
    ];

    if (desktopEnvironment.platform === "linux") {
      lines.push(
        `Desktop: ${desktopEnvironment.desktopEnvironment || "Unknown"}`,
        `Display system: ${formatDisplayBackend(desktopEnvironment.displayBackend)}`
      );
    }

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setBugReportCopyState("copied");
    } catch {
      setBugReportCopyState("error");
    }

    if (bugReportCopyResetRef.current !== null) {
      window.clearTimeout(bugReportCopyResetRef.current);
    }
    bugReportCopyResetRef.current = window.setTimeout(() => {
      setBugReportCopyState("idle");
      bugReportCopyResetRef.current = null;
    }, 2400);
  }

  async function checkForDesktopUpdates() {
    if (!window.desktopUpdater || updateCheckState.checking) return;

    setUpdateCheckState({ checking: true, feedback: null });
    const startedAt = Date.now();
    try {
      let result;
      if (typeof window.desktopUpdater.checkForUpdates === "function") {
        try {
          result = await window.desktopUpdater.checkForUpdates();
        } catch (nativeError) {
          console.warn("Native update check unavailable; using GitHub fallback:", nativeError);
          result = await checkGitHubReleaseFromRenderer();
        }
      } else {
        result = await checkGitHubReleaseFromRenderer();
      }
      const remainingFeedbackDelay = 400 - (Date.now() - startedAt);
      if (remainingFeedbackDelay > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remainingFeedbackDelay));
      }
      setUpdateCheckState({
        checking: false,
        feedback: {
          kind: result.ok ? "success" : "error",
          message: result.ok
            ? result.updateAvailable
              ? `Seenary ${result.info?.version || "update"} is available.`
              : "You're using the latest available version."
            : ("message" in result ? result.message : null) ||
              "Seenary could not check for updates.",
          downloadUrl: result.updateAvailable
            ? result.info?.manualDownloadUrl || SEENARY_DOWNLOAD_URL
            : undefined,
        },
      });
    } catch (error) {
      const remainingFeedbackDelay = 400 - (Date.now() - startedAt);
      if (remainingFeedbackDelay > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remainingFeedbackDelay));
      }
      setUpdateCheckState({
        checking: false,
        feedback: {
          kind: "error",
          message:
            error instanceof Error
              ? `Seenary could not check for updates: ${error.message}`
              : "Seenary could not check for updates.",
        },
      });
    }
  }

  async function saveDesktopStartup(openAtLogin: boolean) {
    if (!window.desktopStartup || desktopStartup.loading) {
      return;
    }

    setDesktopStartup((current) => ({ ...current, loading: true }));

    try {
      const result = await window.desktopStartup.setStartupSetting(openAtLogin);

      setDesktopStartup({
        available: result.available,
        loading: false,
        openAtLogin: result.openAtLogin,
        feedback: {
          kind: result.ok ? "success" : "error",
          message: result.message || (result.ok ? "Startup setting updated." : "Failed to update startup setting."),
        },
      });
    } catch {
      setDesktopStartup((current) => ({
        ...current,
        loading: false,
        feedback: { kind: "error", message: "Failed to update startup setting." },
      }));
    }
  }

  async function loadDesktopShortcut() {
    if (!window.desktopShortcuts) {
      return;
    }

    try {
      const result = await window.desktopShortcuts.getHideShowShortcut();

      setDesktopShortcut((current) => ({
        ...current,
        available: true,
        loading: false,
        enabled: result.enabled,
        accelerator: result.accelerator,
        draftAccelerator: result.accelerator,
        feedback: result.ok
          ? current.feedback
          : { kind: "error", message: result.message || "Failed to load shortcut setting." },
      }));
    } catch {
      setDesktopShortcut((current) => ({
        ...current,
        available: true,
        loading: false,
        feedback: { kind: "error", message: "Failed to load shortcut setting." },
      }));
    }
  }

  async function saveDesktopShortcut(next: {
    enabled?: boolean;
    accelerator?: string;
  }) {
    if (!window.desktopShortcuts || desktopShortcut.loading) {
      return;
    }

    const enabled = next.enabled ?? desktopShortcut.enabled;
    const accelerator = (next.accelerator ?? desktopShortcut.draftAccelerator).trim();

    if (enabled && !hasAcceleratorActionKey(accelerator)) {
      setDesktopShortcut((current) => ({
        ...current,
        feedback: {
          kind: "error",
          message: "Add a letter, number, or key after the modifiers, such as Control+Shift+Alt+Space.",
        },
      }));
      return;
    }

    setDesktopShortcut((current) => ({ ...current, loading: true }));

    try {
      // Finish shortcut capture before saving. Awaiting this IPC prevents the
      // recorder's unregister operation from racing the new registration.
      setIsShortcutRecorderFocused(false);
      await window.desktopShortcuts.setShortcutRecordingActive(false);

      const result = await window.desktopShortcuts.setHideShowShortcut({
        enabled,
        accelerator,
      });

      setDesktopShortcut((current) => ({
        ...current,
        loading: false,
        enabled: result.enabled,
        accelerator: result.accelerator,
        draftAccelerator: result.accelerator || accelerator,
        feedback: {
          kind: result.ok ? "success" : "error",
          message: result.message || (result.ok ? "Shortcut updated." : "Failed to update shortcut."),
        },
      }));
    } catch {
      setDesktopShortcut((current) => ({
        ...current,
        loading: false,
        feedback: { kind: "error", message: "Failed to update shortcut." },
      }));
    }
  }

  function updateDraftShortcut(accelerator: string) {
    setDesktopShortcut((current) => ({
      ...current,
      draftAccelerator: accelerator,
      feedback: null,
    }));
  }

  function setShortcutRecorderFocused(focused: boolean) {
    setIsShortcutRecorderFocused(focused);
    void window.desktopShortcuts?.setShortcutRecordingActive(focused);
  }

  function appendDraftShortcutToken(token: string) {
    setDesktopShortcut((current) => ({
      ...current,
      draftAccelerator: appendAcceleratorToken(current.draftAccelerator, token),
      feedback: null,
    }));
  }

  function handleShortcutKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!desktopShortcut.enabled || desktopShortcut.loading) {
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      updateDraftShortcut(removeLastAcceleratorToken(desktopShortcut.draftAccelerator));
      return;
    }

    const token = keyEventToAcceleratorToken(event);

    if (!token) {
      return;
    }

    event.preventDefault();
    appendDraftShortcutToken(token);
  }

  function handleShortcutPreset(accelerator: string) {
    setDesktopShortcut((current) => ({
      ...current,
      enabled: true,
      draftAccelerator: accelerator,
      feedback: null,
    }));
    void saveDesktopShortcut({ enabled: true, accelerator });
  }

  async function loadSyncStatus() {
    try {
      const result = await window.api.getSyncStatus();

      setSyncStatus((current) => ({
        ...current,
        loading: false,
        linked: Boolean(result.linked),
        provider: result.provider ?? null,
        providerLabel: result.providerLabel ?? null,
        syncTargetsLabel: result.syncTargetsLabel ?? null,
        autoSyncEnabled: result.autoSyncEnabled ?? true,
        pendingCount: result.pendingCount ?? 0,
        feedback: result.ok
          ? current.feedback
          : { kind: "error", message: result.message || "Failed to load sync status." },
      }));
    } catch {
      setSyncStatus((current) => ({
        ...current,
        loading: false,
        feedback: { kind: "error", message: "Failed to load sync status." },
      }));
    }
  }

  async function loadAniListLinkStatus(
    feedback?: { kind: "success" | "error"; message: string },
    isCancelled = () => false
  ) {
    try {
      const result = await window.api.getAniListLinkStatus();

      if (isCancelled()) {
        return;
      }

      if (result.localCredentialsConfirmed !== undefined) {
        setLocalCredentialsConfirmed(result.localCredentialsConfirmed);
      }

      setAniListLink((current) => ({
        ...current,
        loading: false,
        linked: Boolean(result.ok && result.linked),
        account: result.account ?? null,
        conflict: null,
        feedback: result.ok
          ? feedback ?? current.feedback
          : { kind: "error", message: result.message || "Failed to load AniList link status." },
      }));
    } catch {
      if (!isCancelled()) {
        setAniListLink((current) => ({
          ...current,
          loading: false,
          conflict: null,
          feedback: { kind: "error", message: "Failed to load AniList link status." },
        }));
      }
    }
  }

  async function loadMalLinkStatus(
    feedback?: { kind: "success" | "error"; message: string },
    isCancelled = () => false
  ) {
    try {
      const result = await window.api.getMalLinkStatus();

      if (isCancelled()) {
        return;
      }

      if (result.localCredentialsConfirmed !== undefined) {
        setLocalCredentialsConfirmed(result.localCredentialsConfirmed);
      }

      setMalLink((current) => ({
        ...current,
        loading: false,
        linked: Boolean(result.ok && result.linked),
        account: result.account ?? null,
        conflict: null,
        feedback: result.ok
          ? feedback ?? current.feedback
          : { kind: "error", message: result.message || "Failed to load MyAnimeList link status." },
      }));
    } catch {
      if (!isCancelled()) {
        setMalLink((current) => ({
          ...current,
          loading: false,
          conflict: null,
          feedback: { kind: "error", message: "Failed to load MyAnimeList link status." },
        }));
      }
    }
  }

  async function updateAutoSync(enabled: boolean) {
    try {
      const result = await window.api.setAutoSync(enabled);

      setSyncStatus((current) => ({
        ...current,
        loading: false,
        linked: Boolean(result.linked),
        provider: result.provider ?? null,
        providerLabel: result.providerLabel ?? null,
        syncTargetsLabel: result.syncTargetsLabel ?? current.syncTargetsLabel,
        autoSyncEnabled: result.autoSyncEnabled ?? enabled,
        pendingCount: result.pendingCount ?? current.pendingCount,
        feedback: {
          kind: result.ok ? "success" : "error",
          message: result.ok
            ? enabled
              ? `Automatic ${result.providerLabel ?? "external"} sync enabled.`
              : `Automatic ${result.providerLabel ?? "external"} sync disabled.`
            : result.message || "Failed to update sync setting.",
        },
      }));
    } catch {
      setSyncStatus((current) => ({
        ...current,
        feedback: { kind: "error", message: "Failed to update sync setting." },
      }));
    }
  }

  async function confirmClearLists() {
    if (!clearTarget || isClearingList) return;

    try {
      setIsClearingList(true);
      const result = await onClearLists(
        clearTarget,
        queueProviderDeletion && syncStatus.linked
      );
      setClearFeedback({
        kind: result.ok ? "success" : "error",
        message: result.message,
      });
    } catch (error) {
      setClearFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Seenary could not clear the selected list.",
      });
    } finally {
      setIsClearingList(false);
      setClearTarget(null);
      setQueueProviderDeletion(false);
    }
  }

  async function runSyncNow() {
    try {
      setIsSyncing(true);
      setSyncProgress({
        operation: "manual-sync",
        stage: "processing",
        label: "Preparing queued sync changes...",
        current: 0,
        total: syncStatus.pendingCount || null,
      });
      const result = await onRunSyncNow();
      await loadSyncStatus();

      setSyncStatus((current) => ({
        ...current,
        pendingCount: result.pending ?? current.pendingCount,
        feedback: {
          kind: result.ok ? "success" : "error",
          message: result.message,
        },
      }));

      if (isSyncActivityOpen) {
        await loadSyncActivity(syncActivityTab);
      }
    } finally {
      window.setTimeout(() => {
        setIsSyncing(false);
        setSyncProgress((current) =>
          current?.operation === "manual-sync" ? null : current
        );
      }, 700);
    }
  }

  async function pullFromRemote() {
    const operation = syncStatus.provider === "mal" ? "pull-mal" : "pull-anilist";

    try {
      setIsPullingFromRemote(true);
      setSyncProgress({
        operation,
        stage: "fetching",
        label: `Preparing ${syncTargetLabel} update...`,
        current: 0,
        total: null,
      });
      const result =
        syncStatus.provider === "mal"
          ? await onPullFromMal()
          : await onPullFromAniList();
      if (!result.ok) {
        setIsPullingFromRemote(false);
        setSyncProgress(null);
      }
      await loadSyncStatus();

      setSyncStatus((current) => ({
        ...current,
        feedback: {
          kind: result.ok ? "success" : "error",
          message: result.message,
        },
      }));

      if (isSyncActivityOpen) {
        await loadSyncActivity(syncActivityTab);
      }
    } catch (error) {
      setIsPullingFromRemote(false);
      setSyncProgress((current) => current?.operation === operation ? null : current);
      throw error;
    }
  }

  async function loadSyncActivity(tab: SyncActivityTab = syncActivityTab) {
    try {
      setSyncActivity((current) => ({ ...current, loading: true }));
      const result = await window.api.getSyncActivity();

      if (!result.ok) {
        setSyncStatus((current) => ({
          ...current,
          feedback: { kind: "error", message: result.message || "Failed to load sync activity." },
        }));
        return;
      }

      setSyncActivity({
        loading: false,
        pending: result.pending ?? [],
        completed: result.completed ?? [],
        failed: result.failed ?? [],
        pulled: result.pulled ?? [],
        excluded: result.excluded ?? [],
      });
      setSyncActivityTab(tab);
    } finally {
      setSyncActivity((current) => ({ ...current, loading: false }));
    }
  }

  async function openSyncActivity(tab: SyncActivityTab) {
    setSyncActivityActionFeedback(null);
    setIsSyncActivityOpen(true);
    setSyncActivityTab(tab);
    await loadSyncActivity(tab);
  }

  async function restoreSyncExclusion(item: SyncActivityItem) {
    const mediaType = item.media_type === "MANGA" || item.manga_id ? "MANGA" : "ANIME";
    const mediaId = Number(mediaType === "MANGA" ? item.manga_id : item.anime_id);
    const provider = item.provider ?? (item.operation.includes("mal") ? "mal" : "anilist");
    try {
      setRestoringSyncExclusionId(item.id);
      setSyncActivityActionFeedback(null);
      if (typeof window.api.restoreSyncExclusion !== "function") {
        throw new Error("Restart Seenary to finish loading the sync exclusion controls.");
      }
      const result = await window.api.restoreSyncExclusion({
        id: item.id,
        provider,
        mediaType,
        mediaId,
      });
      setSyncStatus((current) => ({
        ...current,
        feedback: { kind: result.ok ? "success" : "error", message: result.message },
      }));
      setSyncActivityActionFeedback({
        kind: result.ok ? "success" : "error",
        message: result.message,
      });
      if (result.ok) {
        await Promise.all([loadSyncActivity("excluded"), loadSyncStatus()]);
      }
    } catch (error) {
      setSyncActivityActionFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to restore the sync entry.",
      });
    } finally {
      setRestoringSyncExclusionId(null);
    }
  }

  async function excludeSyncEntry(item: SyncActivityItem) {
    const mediaType = item.media_type === "MANGA" || item.manga_id ? "MANGA" : "ANIME";
    const mediaId = Number(mediaType === "MANGA" ? item.manga_id : item.anime_id);
    const provider = item.provider ?? (item.operation.includes("mal") ? "mal" : "anilist");
    try {
      setExcludingSyncEntryId(item.id);
      setSyncActivityActionFeedback(null);
      if (typeof window.api.excludeSyncEntry !== "function") {
        throw new Error("Restart Seenary to finish loading the sync exclusion controls.");
      }
      const result = await window.api.excludeSyncEntry({
        id: item.id,
        provider,
        mediaType,
        mediaId,
      });
      setSyncStatus((current) => ({
        ...current,
        feedback: { kind: result.ok ? "success" : "error", message: result.message },
      }));
      setSyncActivityActionFeedback({
        kind: result.ok ? "success" : "error",
        message: result.message,
      });
      if (result.ok) {
        await Promise.all([loadSyncActivity("pending"), loadSyncStatus()]);
      }
    } catch (error) {
      setSyncActivityActionFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to exclude the sync entry.",
      });
    } finally {
      setExcludingSyncEntryId(null);
    }
  }

  async function linkAniListAccount() {
    try {
      setAniListLink((current) => ({
        ...current,
        loading: true,
        conflict: null,
        feedback: { kind: "success", message: "Opening AniList in your browser..." },
      }));

      const result = await onLinkAniListAccount();

      if (result.ok && !result.needsConflictResolution) {
        await Promise.all([
          loadAniListLinkStatus({ kind: "success", message: result.message }),
          loadMalLinkStatus(),
          loadSyncStatus(),
        ]);
        return;
      }

      setAniListLink({
        loading: false,
        linked: Boolean(result.ok && result.linked),
        account: result.account ?? null,
        conflict: result.needsConflictResolution ? result.conflict ?? null : null,
        feedback: {
          kind: result.ok ? "success" : "error",
          message: result.message,
        },
      });
    } catch {
      setAniListLink((current) => ({
        ...current,
        loading: false,
        conflict: null,
        feedback: { kind: "error", message: "Failed to link AniList account." },
      }));
    }
  }

  async function resolveAniListConflict(action: "transfer" | "merge") {
    try {
      setAniListLink((current) => ({
        ...current,
        loading: true,
        feedback: {
          kind: "success",
          message: action === "merge" ? "Merging accounts..." : "Transferring AniList link...",
        },
      }));

      const result = await window.api.resolveAniListLinkConflict(action);

      if (result.ok) {
        await Promise.all([
          loadAniListLinkStatus({ kind: "success", message: result.message }),
          loadMalLinkStatus(),
          loadSyncStatus(),
        ]);
        return;
      }

      setAniListLink({
        loading: false,
        linked: Boolean(result.linked),
        account: result.account ?? null,
        conflict: aniListLink.conflict,
        feedback: {
          kind: "error",
          message: result.message,
        },
      });
    } catch {
      setAniListLink((current) => ({
        ...current,
        loading: false,
        feedback: { kind: "error", message: "Failed to resolve AniList link conflict." },
      }));
    }
  }

  async function linkMalAccount() {
    try {
      setMalLink((current) => ({
        ...current,
        loading: true,
        conflict: null,
        feedback: { kind: "success", message: "Opening MyAnimeList in your browser..." },
      }));

      const result = await onLinkMalAccount();

      if (result.ok && !result.needsConflictResolution) {
        await Promise.all([
          loadMalLinkStatus({ kind: "success", message: result.message }),
          loadAniListLinkStatus(),
          loadSyncStatus(),
        ]);
        return;
      }

      setMalLink({
        loading: false,
        linked: Boolean(result.ok && result.linked),
        account: result.account ?? null,
        conflict: result.needsConflictResolution ? result.conflict ?? null : null,
        feedback: {
          kind: result.ok ? "success" : "error",
          message: result.message,
        },
      });
    } catch {
      setMalLink((current) => ({
        ...current,
        loading: false,
        conflict: null,
        feedback: { kind: "error", message: "Failed to link MyAnimeList account." },
      }));
    }
  }

  async function resolveMalConflict(action: "transfer" | "merge") {
    try {
      setMalLink((current) => ({
        ...current,
        loading: true,
        feedback: {
          kind: "success",
          message:
            action === "merge" ? "Merging accounts..." : "Transferring MyAnimeList link...",
        },
      }));

      const result = await window.api.resolveMalLinkConflict(action);

      if (result.ok) {
        await Promise.all([
          loadMalLinkStatus({ kind: "success", message: result.message }),
          loadAniListLinkStatus(),
          loadSyncStatus(),
        ]);
        return;
      }

      setMalLink({
        loading: false,
        linked: Boolean(result.linked),
        account: result.account ?? null,
        conflict: malLink.conflict,
        feedback: {
          kind: "error",
          message: result.message,
        },
      });
    } catch {
      setMalLink((current) => ({
        ...current,
        loading: false,
        feedback: { kind: "error", message: "Failed to resolve MyAnimeList link conflict." },
      }));
    }
  }

  function openUnlinkModal(provider: "anilist" | "mal") {
    setUnlinkProvider(provider);
    setUnlinkPassword("");
    setUnlinkPasswordConfirmation("");
    setIsSettingUnlinkPassword(localCredentialsConfirmed === false);
    setUnlinkFeedback(null);
  }

  function closeUnlinkModal() {
    if (isUnlinking) return;
    setUnlinkProvider(null);
    setUnlinkPassword("");
    setUnlinkPasswordConfirmation("");
    setUnlinkFeedback(null);
  }

  async function unlinkExternalAccount() {
    if (!unlinkProvider || isUnlinking) return;
    if (isSettingUnlinkPassword && unlinkPassword !== unlinkPasswordConfirmation) {
      setUnlinkFeedback("The passwords do not match.");
      return;
    }

    setIsUnlinking(true);
    setUnlinkFeedback(null);

    try {
      if (isSettingUnlinkPassword) {
        const passwordResult = await window.api.setLocalPassword(unlinkPassword);
        if (!passwordResult.ok) {
          setUnlinkFeedback(passwordResult.message);
          return;
        }
        setLocalCredentialsConfirmed(true);
        setIsSettingUnlinkPassword(false);
      }

      const result =
        unlinkProvider === "mal"
          ? await window.api.unlinkMalAccount(unlinkPassword)
          : await window.api.unlinkAniListAccount(unlinkPassword);

      if (!result.ok) {
        setUnlinkFeedback(result.message);
        return;
      }

      setLocalCredentialsConfirmed(true);
      const feedback = { kind: "success" as const, message: result.message };
      const provider = unlinkProvider;
      setUnlinkProvider(null);
      setUnlinkPassword("");
      setUnlinkPasswordConfirmation("");
      await Promise.all([
        loadAniListLinkStatus(provider === "anilist" ? feedback : undefined),
        loadMalLinkStatus(provider === "mal" ? feedback : undefined),
        loadSyncStatus(),
      ]);
    } catch {
      setUnlinkFeedback("Failed to unlink the account. Try again.");
    } finally {
      setIsUnlinking(false);
    }
  }

  const selectedImportKeySet = useMemo(
    () => new Set(selectedImportKeys),
    [selectedImportKeys]
  );
  const selectedImportStatuses = useMemo(() => {
    if (!importPreview) {
      return [];
    }

    return importPreview.groups
      .filter((group) => group.items.some((item) => selectedImportKeySet.has(getImportItemKey(item))))
      .map((group) => group.status)
      .filter((status, index, statuses) => statuses.indexOf(status) === index);
  }, [importPreview, selectedImportKeySet]);

  function resetActiveImportAttempt() {
    activePreviewAbortRef.current?.abort();
    activePreviewAbortRef.current = null;
    activeImportAbortRef.current?.abort();
    activeImportAbortRef.current = null;
    setIsPreviewLoading(false);
    setIsImporting(false);
    setPreviewError(null);
    setImportPreview(null);
    setSelectedImportKeys([]);
    setOpenImportGroups({});

    if (textImportInputRef.current) {
      textImportInputRef.current.value = "";
    }

    if (pdfImportInputRef.current) {
      pdfImportInputRef.current.value = "";
    }
  }

  async function openImportPreview() {
    const trimmedUsername = importUsername.trim();
    if (!trimmedUsername) {
      return;
    }

    try {
      setImportProvider("anilist");
      setIsPreviewLoading(true);
      setPreviewError(null);
      setImportFeedback(null);
      setImportPreview(null);
      setImportPreviewUsername(trimmedUsername);
      setSelectedImportKeys([]);
      setOpenImportGroups({});
      setIsImportModalOpen(true);

      const result = (await window.api.previewAniListImport(
        trimmedUsername
      )) as ImportPreviewResponse;

      if (!result.ok || !result.preview) {
        setPreviewError(result.message || "Failed to preview AniList list.");
        return;
      }

      setImportPreview(result.preview);
      setSelectedImportKeys(
        result.preview.groups.flatMap((group) => group.items.map(getImportItemKey))
      );
      setOpenImportGroups(
        Object.fromEntries(
          result.preview.groups.map((group, index) => [getImportGroupKey(group), index < 2])
        )
      );
    } catch (error) {
      console.error("Failed to preview AniList import:", error);
      setPreviewError(getErrorMessage(error, "Failed to preview AniList list."));
    } finally {
      setIsPreviewLoading(false);
    }
  }

  async function openMalImportPreview() {
    const trimmedUsername = malImportUsername.trim();
    if (!trimmedUsername) return;

    const controller = new AbortController();
    activePreviewAbortRef.current?.abort();
    activePreviewAbortRef.current = controller;

    try {
      setImportProvider("mal");
      setIsPreviewLoading(true);
      setPreviewError(null);
      setImportFeedback(null);
      setImportPreview(null);
      setImportPreviewUsername(trimmedUsername);
      setSelectedImportKeys([]);
      setOpenImportGroups({});
      setIsImportModalOpen(true);

      const result = (await window.api.previewMalImport(trimmedUsername, {
        signal: controller.signal,
      })) as ImportPreviewResponse & { cancelled?: boolean };

      if (activePreviewAbortRef.current !== controller || controller.signal.aborted) return;
      if (result.cancelled) return;

      if (!result.ok || !result.preview) {
        setPreviewError(result.message || "Failed to preview MyAnimeList list.");
        return;
      }

      setImportPreviewUsername(result.username || trimmedUsername);
      setImportPreview(result.preview);
      setSelectedImportKeys(
        result.preview.groups.flatMap((group) => group.items.map(getImportItemKey))
      );
      setOpenImportGroups(
        Object.fromEntries(
          result.preview.groups.map((group, index) => [getImportGroupKey(group), index < 2])
        )
      );
    } catch (error) {
      console.error("Failed to preview MyAnimeList import:", error);
      setPreviewError(getErrorMessage(error, "Failed to preview MyAnimeList list."));
    } finally {
      if (activePreviewAbortRef.current === controller) {
        activePreviewAbortRef.current = null;
        setIsPreviewLoading(false);
      }
    }
  }

  async function openTextImportPreview(file: File | null) {
    if (!file) {
      return;
    }

    const controller = new AbortController();
    activePreviewAbortRef.current?.abort();
    activePreviewAbortRef.current = controller;

    try {
      setImportProvider("txt");
      setTextImportFileName(file.name);
      setIsPreviewLoading(true);
      setPreviewError(null);
      setImportFeedback(null);
      setImportPreview(null);
      setImportPreviewUsername(file.name);
      setSelectedImportKeys([]);
      setOpenImportGroups({});
      setIsImportModalOpen(true);

      const text = await file.text();
      if (controller.signal.aborted) {
        return;
      }

      const result = (await window.api.previewTextImport(
        text,
        settings.hideAdultContent,
        textImportMediaType,
        { signal: controller.signal }
      )) as ImportPreviewResponse;

      if (activePreviewAbortRef.current !== controller || controller.signal.aborted) {
        return;
      }

      if (!result.ok || !result.preview) {
        setPreviewError(result.message || "Failed to preview text list.");
        return;
      }

      setImportPreview(result.preview);
      setSelectedImportKeys(
        result.preview.groups.flatMap((group) => group.items.map(getImportItemKey))
      );
      setOpenImportGroups(
        Object.fromEntries(
          result.preview.groups.map((group, index) => [getImportGroupKey(group), index < 2])
        )
      );
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }

      console.error("Failed to preview text import:", error);
      setPreviewError(getErrorMessage(error, "Failed to preview text list."));
    } finally {
      if (activePreviewAbortRef.current === controller) {
        activePreviewAbortRef.current = null;
        setIsPreviewLoading(false);
      }

      if (textImportInputRef.current) {
        textImportInputRef.current.value = "";
      }
    }
  }

  async function openPdfImportPreview(file: File | null) {
    if (!file) {
      return;
    }

    const controller = new AbortController();
    activePreviewAbortRef.current?.abort();
    activePreviewAbortRef.current = controller;

    try {
      setImportProvider("pdf");
      setTextImportFileName(file.name);
      setIsPreviewLoading(true);
      setPreviewError(null);
      setImportFeedback(null);
      setImportPreview(null);
      setImportPreviewUsername(file.name);
      setSelectedImportKeys([]);
      setOpenImportGroups({});
      setIsImportModalOpen(true);

      const pdfBase64 = await fileToBase64(file);
      if (controller.signal.aborted) {
        return;
      }

      const result = (await window.api.previewPdfImport(
        pdfBase64,
        settings.hideAdultContent,
        pdfImportMediaType,
        { signal: controller.signal }
      )) as ImportPreviewResponse;

      if (activePreviewAbortRef.current !== controller || controller.signal.aborted) {
        return;
      }

      if (!result.ok || !result.preview) {
        setPreviewError(result.message || "Failed to preview PDF list.");
        return;
      }

      setImportPreview(result.preview);
      setSelectedImportKeys(
        result.preview.groups.flatMap((group) => group.items.map(getImportItemKey))
      );
      setOpenImportGroups(
        Object.fromEntries(
          result.preview.groups.map((group, index) => [getImportGroupKey(group), index < 2])
        )
      );
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }

      console.error("Failed to preview PDF import:", error);
      setPreviewError(getErrorMessage(error, "Failed to preview PDF list."));
    } finally {
      if (activePreviewAbortRef.current === controller) {
        activePreviewAbortRef.current = null;
        setIsPreviewLoading(false);
      }

      if (pdfImportInputRef.current) {
        pdfImportInputRef.current.value = "";
      }
    }
  }

  async function importBackupFile(file: File | null) {
    if (!file || isImportingBackup) {
      return;
    }

    try {
      setIsImportingBackup(true);
      setBackupFeedback(null);
      const text = await file.text();
      const backup = JSON.parse(text);
      const inspection = inspectSeenaryBackup(backup);
      if (!inspection.valid) {
        setBackupFeedback({ kind: "error", message: inspection.message });
        return;
      }
      setBackupPreview({
        backup,
        inspection,
        restoreLibrary: true,
        restorePreferences: inspection.hasPortablePreferences,
        restoreDesktopPreferences: false,
      });
    } catch {
      setBackupFeedback({
        kind: "error",
        message: "Could not read this backup file.",
      });
    } finally {
      setIsImportingBackup(false);
      if (backupImportInputRef.current) {
        backupImportInputRef.current.value = "";
      }
    }
  }

  async function confirmBackupImport() {
    if (!backupPreview || isImportingBackup) return;
    try {
      setIsImportingBackup(true);
      setBackupFeedback(null);
      const selectedBackup = selectBackupSections(backupPreview.backup, backupPreview);
      const result = await onImportLocalBackup(selectedBackup, {
        restoreDesktopPreferences: backupPreview.restoreDesktopPreferences,
      });
      setBackupFeedback({
        kind: result.ok ? "success" : "error",
        message: result.message,
      });
      if (result.ok) {
        if (backupPreview.restoreDesktopPreferences) {
          await Promise.all([loadDesktopWindow(), loadDesktopStartup(), loadDesktopShortcut()]);
        }
        setBackupPreview(null);
      }
    } catch {
      setBackupFeedback({ kind: "error", message: "Could not import this backup file." });
    } finally {
      setIsImportingBackup(false);
    }
  }

  async function repairCachedData() {
    if (isRepairingCache) return;
    try {
      setIsRepairingCache(true);
      setCacheRepairFeedback(null);
      const result = await window.api.repairCachedData();
      setCacheRepairFeedback({
        kind: result.ok ? "success" : "error",
        message: result.message,
        removedDetails: result.removedDetails,
        removedMedia: result.removedMedia,
        restartRecommended: result.restartRecommended,
      });
      if (result.ok) setIsCacheRepairConfirmOpen(false);
    } catch (error) {
      setCacheRepairFeedback({
        kind: "error",
        message: getErrorMessage(error, "Seenary could not repair cached data."),
      });
    } finally {
      setIsRepairingCache(false);
    }
  }

  function restartAfterCacheRepair() {
    if (window.desktopMaintenance) {
      window.desktopMaintenance.restartApp();
      return;
    }
    window.location.reload();
  }

  return (
    <div
      data-global-scroll-root
      ref={settingsScrollRef}
      className="scroll-container h-full overflow-y-auto px-6 py-24 text-white"
    >
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-white/35">
              Preferences
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-white">
              Settings
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">
              Organize the app around general behavior, visual customization,
              content preferences, accounts, sync, and local data.
            </p>
          </div>

          <button
            type="button"
            onClick={onResetSettings}
            className="inline-flex items-center gap-2 self-start rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white/75 transition hover:bg-white/8 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/55"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Reset defaults
          </button>
        </header>

        <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">
          <ScopeBadge label="Account" description="Follows your Seenary account across devices" />
          <ScopeBadge label="Portable" description="Saved on this device and included in backups" />
          <ScopeBadge label="Desktop only" description="Applies only to this installed desktop app" />
        </div>

        <div className="space-y-4">
          <div ref={rememberSectionRef("general")} className="scroll-mt-24">
            <AccordionSection
              icon={SparklesIcon}
              title="General"
              scope="Mixed scopes"
              description="App information, startup behavior, shortcuts, and Tutorial access."
              summary={[
                `Version ${APP_VERSION}`,
                settings.shareAnonymousUsageStatistics
                  ? "Anonymous statistics on"
                  : "Anonymous statistics off",
                ...(window.desktopStartup && desktopStartup.available
                  ? [desktopStartup.openAtLogin ? "Launches at login" : "Manual launch"]
                  : []),
                ...(desktopShortcut.available
                  ? [
                      desktopShortcut.loading
                        ? "Shortcut loading..."
                        : desktopShortcut.enabled && desktopShortcut.accelerator
                          ? `Shortcut ${desktopShortcut.accelerator}`
                          : "Shortcut disabled",
                    ]
                  : []),
                "Welcome replay",
              ]}
              open={openSection === "general"}
              onToggle={() => toggleSection("general")}
            >
            <div className="space-y-5">
              <p className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-xs leading-5 text-white/55">
                Tutorial and visual preferences are portable device settings. Analytics consent belongs to your Seenary account. Startup, window, and shortcut controls apply only to this desktop installation.
              </p>
              <div>
                <SectionHeading
                  icon={SparklesIcon}
                  title="About Seenary"
                  description="Quick app information for this install."
                />

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <InfoCard label="Version" value={APP_VERSION} />
                  <InfoCard label="Profile" value={username} />
                  {desktopEnvironment.platform && (
                    <>
                      <InfoCard
                        label="Platform"
                        value={formatDesktopPlatform(desktopEnvironment.platform)}
                      />
                      <InfoCard
                        label="Architecture"
                        value={formatArchitecture(desktopEnvironment.architecture)}
                      />
                    </>
                  )}
                  {desktopEnvironment.platform === "linux" && (
                    <>
                      <InfoCard
                        label="Desktop"
                        value={desktopEnvironment.desktopEnvironment || "Unknown"}
                      />
                      <InfoCard
                        label="Display system"
                        value={
                          desktopEnvironment.loading
                            ? "Detecting..."
                            : formatDisplayBackend(desktopEnvironment.displayBackend)
                        }
                      />
                    </>
                  )}
                </div>

                {window.desktopUpdater && (
                  <div className="mt-4 rounded-3xl border border-white/10 bg-white/[0.025] p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white/80">App updates</p>
                        <p className="mt-1 text-xs leading-5 text-white/45">
                          Check GitHub for a newer Seenary release without opening the tray menu.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void checkForDesktopUpdates()}
                        disabled={updateCheckState.checking}
                        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl border border-[var(--app-accent)]/30 bg-[var(--app-accent-soft)] px-4 py-2.5 text-sm font-medium text-white/85 transition hover:border-[var(--app-accent)]/50 hover:bg-[var(--app-accent-soft)]/80 hover:text-white focus:outline-none focus:ring-2 focus:ring-[var(--app-accent)]/55 disabled:cursor-wait disabled:opacity-60"
                      >
                        <ArrowPathIcon
                          className={`h-4 w-4 ${updateCheckState.checking ? "animate-spin" : ""}`}
                        />
                        {updateCheckState.checking ? "Checking..." : "Check for updates"}
                      </button>
                    </div>
                    {updateCheckState.feedback && (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <p
                          role="status"
                          className={`text-xs ${
                            updateCheckState.feedback.kind === "success"
                              ? "text-emerald-200/75"
                              : "text-rose-200/80"
                          }`}
                        >
                          {updateCheckState.feedback.message}
                        </p>
                        {updateCheckState.feedback.downloadUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              window.open(
                                updateCheckState.feedback?.downloadUrl,
                                "_blank",
                                "noopener,noreferrer"
                              )
                            }
                            className="text-xs font-semibold text-[var(--app-accent)] underline decoration-[var(--app-accent)]/40 underline-offset-4 hover:text-white"
                          >
                            Get update
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {desktopEnvironment.platform && (
                  <div className="mt-4 flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/[0.025] p-4 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      onClick={() => void copyBugReportInfo()}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-white/70 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/55"
                    >
                      {bugReportCopyState === "copied" ? (
                        <CheckIcon className="h-4 w-4 text-emerald-300" />
                      ) : (
                        <ClipboardDocumentIcon className="h-4 w-4" />
                      )}
                      {bugReportCopyState === "copied"
                        ? "Information copied"
                        : bugReportCopyState === "error"
                          ? "Copy failed"
                          : "Copy app & system information"}
                    </button>

                    <a
                      href={GITHUB_ISSUES_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--app-accent)]/30 bg-[var(--app-accent-soft)] px-4 py-2.5 text-sm font-medium text-white/85 transition hover:border-[var(--app-accent)]/50 hover:bg-[var(--app-accent-soft)]/80 hover:text-white focus:outline-none focus:ring-2 focus:ring-[var(--app-accent)]/55"
                    >
                      <BugAntIcon className="h-4 w-4" />
                      Report on GitHub
                      <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                    </a>
                  </div>
                )}
              </div>

              <div>
                <SectionHeading
                  icon={ShieldCheckIcon}
                  title="Privacy and anonymous statistics"
                  description="Control Seenary's optional, privacy-first engagement measurement."
                />

                <div className="space-y-3">
                  <ToggleSetting
                    icon={ChartBarSquareIcon}
                    title="Share anonymous usage statistics"
                    description="After 15 seconds of visible, focused use and an interaction, share at most one anonymous record for that UTC day."
                    checked={settings.shareAnonymousUsageStatistics}
                    onChange={(checked) =>
                      onUpdateSettings({
                        shareAnonymousUsageStatistics: checked,
                        analyticsConsentDecided: true,
                      })
                    }
                  />

                  <div className="grid gap-3 rounded-3xl border border-white/10 bg-black/15 p-5 text-xs leading-5 text-white/45 md:grid-cols-2">
                    <div>
                      <p className="font-semibold text-white/75">What is included</p>
                      <p className="mt-1">
                        UTC date, operating-system platform, and Seenary version. The
                        server derives a pseudonymous key that changes every month.
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold text-white/75">What is never included</p>
                      <p className="mt-1">
                        Titles, library, progress, searches, providers, history, account
                        name, stored IP address, device IDs, hardware details, or a
                        fingerprint.
                      </p>
                    </div>
                    <p className="md:col-span-2">
                      Background launches, update checks, sync, and API traffic do not
                      count. Daily pseudonymous rows are removed after finalized monthly
                      totals pass a 45-day correction window. Turning this off stops new
                      records immediately.
                    </p>
                  </div>
                </div>
              </div>

              {window.desktopStartup && (
                <div>
                  <SectionHeading
                    icon={RocketLaunchIcon}
                    title="Startup"
                    description="Choose whether Seenary should open when you sign in."
                  />

                  <div className="space-y-3">
                    <ToggleSetting
                      icon={RocketLaunchIcon}
                      title="Launch Seenary at login"
                      description={
                        desktopStartup.available
                          ? "Open the desktop app automatically after you sign in to your computer."
                          : "This option is available after installing the desktop app."
                      }
                      checked={desktopStartup.openAtLogin}
                      disabled={!desktopStartup.available || desktopStartup.loading}
                      onChange={saveDesktopStartup}
                    />

                    {desktopStartup.feedback && (
                      <p
                        className={`rounded-2xl border px-3 py-2 text-sm ${
                          desktopStartup.feedback.kind === "success"
                            ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                            : "border-rose-400/20 bg-rose-400/10 text-rose-100"
                        }`}
                      >
                        {desktopStartup.feedback.message}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {desktopShortcut.available && (
                <div>
                  <SectionHeading
                    icon={CommandLineIcon}
                    title="Desktop shortcut"
                    description={
                      desktopEnvironment.shortcutMethod === "unavailable"
                        ? "Global hide/show shortcuts are unavailable on Wayland in this release."
                        : "Choose the global shortcut that hides or shows the desktop app."
                    }
                  />

                  <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="font-semibold text-white">Hide/show Seenary</p>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/45">
                          Use Electron accelerator format, such as Control+Shift+Space or Alt+Space.
                          {desktopEnvironment.shortcutMethod === "unavailable"
                            ? " This remains available when Seenary runs through X11."
                            : " Turn it off if the shortcut conflicts with another app."}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={
                          desktopShortcut.loading ||
                          desktopEnvironment.shortcutMethod === "unavailable"
                        }
                        onClick={() => saveDesktopShortcut({ enabled: !desktopShortcut.enabled })}
                        className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-white/55 ${
                          desktopShortcut.enabled
                            ? "border border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/8"
                            : "border border-white/10 bg-white text-black hover:opacity-90"
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        {desktopShortcut.enabled ? "Disable shortcut" : "Enable shortcut"}
                      </button>
                    </div>

                    <div className="mt-5 flex flex-col gap-3 md:flex-row">
                      <div className="relative min-w-0 flex-1">
                        <input
                          value={desktopShortcut.draftAccelerator}
                          disabled={
                            !desktopShortcut.enabled ||
                            desktopShortcut.loading ||
                            desktopEnvironment.shortcutMethod === "unavailable"
                          }
                          onFocus={() => setShortcutRecorderFocused(true)}
                          onBlur={() => setShortcutRecorderFocused(false)}
                          onKeyDown={handleShortcutKeyDown}
                          onChange={(event) => updateDraftShortcut(normalizeAcceleratorInput(event.target.value))}
                          className={`min-w-0 w-full rounded-2xl border bg-black/20 px-4 py-3 pr-12 text-sm text-white outline-none placeholder:text-white/30 disabled:cursor-not-allowed disabled:opacity-50 ${
                            isShortcutRecorderFocused
                              ? "border-white/25"
                              : "border-white/10"
                          }`}
                          placeholder="Press a shortcut combination"
                          aria-label="Hide/show shortcut"
                        />
                        {desktopShortcut.draftAccelerator && (
                          <Tooltip content="Clear shortcut" className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2" positioned>
                          <button
                            type="button"
                            disabled={
                              !desktopShortcut.enabled ||
                              desktopShortcut.loading ||
                              desktopEnvironment.shortcutMethod === "unavailable"
                            }
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => updateDraftShortcut("")}
                            className="flex h-full w-full items-center justify-center rounded-full text-white/45 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label="Clear shortcut"
                          >
                            <XMarkIcon className="h-4 w-4" />
                          </button>
                          </Tooltip>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={
                          !desktopShortcut.enabled ||
                          desktopShortcut.loading ||
                          desktopEnvironment.shortcutMethod === "unavailable"
                        }
                        onClick={() => saveDesktopShortcut({ enabled: true })}
                        className="rounded-2xl border border-white/10 bg-white px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Save shortcut
                      </button>
                    </div>

                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {SHORTCUT_PRESETS.map((accelerator) => (
                        <button
                          key={accelerator}
                          type="button"
                          disabled={
                            desktopShortcut.loading ||
                            desktopEnvironment.shortcutMethod === "unavailable"
                          }
                          onClick={() => handleShortcutPreset(accelerator)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                            normalizeAcceleratorInput(desktopShortcut.draftAccelerator) === accelerator
                              ? "border-white/25 bg-white/12 text-white"
                              : "border-white/10 bg-white/[0.04] text-white/55 hover:bg-white/8 hover:text-white"
                          } disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          {accelerator}
                        </button>
                      ))}
                    </div>

                    {desktopShortcut.feedback && (
                      <p
                        className={`mt-4 rounded-2xl border px-3 py-2 text-sm ${
                          desktopShortcut.feedback.kind === "success"
                            ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                            : "border-rose-400/20 bg-rose-400/10 text-rose-100"
                        }`}
                      >
                        {desktopShortcut.feedback.message}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <ActionCard
                  icon={SparklesIcon}
                  title="Replay Tutorial"
                  description="Revisit the basics of navigating, discovering, and tracking your media."
                  actionLabel="Open Tutorial"
                  onAction={onShowTutorial}
                />

                <ActionCard
                  icon={ArrowPathIcon}
                  title="Reset preferences"
                  description="Return the settings panel to the default app behavior and visual style."
                  actionLabel="Reset defaults"
                  onAction={onResetSettings}
                />
              </div>
            </div>
            </AccordionSection>
          </div>

          <div ref={rememberSectionRef("appearance")} className="scroll-mt-24">
            <AccordionSection
              icon={PaintBrushIcon}
              title="Appearance"
              scope="Portable"
              description="Visual customization for the app."
              summary={[
                accentSummary,
                `${overlayOpacity}% opacity`,
                `${getNavbarStyleLabel(settings.navbarStyle)} navbar`,
                `${getBrowseCardStyleLabel(settings.browseCardStyle)} cards`,
                `${backgroundDim}% dim`,
                `${getAnimationLevelLabel(settings.animationLevel)} motion`,
                settings.compactMode ? "Compact mode on" : "Compact mode off",
                `${getCardDensityLabel(settings.homeDensity)} Personal page`,
                `${getDiscoverDensityLabel(settings.discoverDensity)} Discover page`,
                `${getCardDensityLabel(settings.myListDensity)} My List page`,
              ]}
              open={openSection === "appearance"}
              onToggle={() => toggleSection("appearance")}
            >
            <div className="space-y-6">
              <div>
                <SectionHeading
                  icon={PaintBrushIcon}
                  title="Theme color"
                  description="Pick the accent color used for selected controls and highlights."
                />

                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  {THEME_OPTIONS.map((option) => {
                    const selected = settings.themeAccent === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onUpdateSettings({ themeAccent: option.value })}
                        className={`rounded-3xl border p-4 text-left shadow-xl transition hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-white/55 ${
                          selected
                            ? `border-white/25 bg-white/10 ${option.glow}`
                            : "border-white/10 bg-white/[0.03]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span
                            className="h-8 w-8 rounded-2xl border border-white/20"
                            style={{ backgroundColor: option.color }}
                          />
                          {selected && (
                            <span
                              className="rounded-full px-1.5 py-1 text-black"
                              style={{ backgroundColor: option.color }}
                            >
                              <CheckIcon className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </div>
                        <p className="mt-4 text-sm font-semibold text-white">
                          {option.label}
                        </p>
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSettings({
                        themeAccent: "custom",
                        customAccentColor,
                      })
                    }
                    className={`rounded-3xl border p-4 text-left shadow-xl transition ${
                      settings.themeAccent === "custom"
                        ? "border-white/25 bg-white/10"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/8"
                    }`}
                    style={
                      settings.themeAccent === "custom"
                        ? {
                            boxShadow: `0 20px 25px -5px ${customAccentColor}33, 0 8px 10px -6px ${customAccentColor}33`,
                          }
                        : undefined
                    }
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className="h-8 w-8 rounded-2xl border border-white/20 focus:outline-none focus:ring-2 focus:ring-white/55"
                        style={{ backgroundColor: customAccentColor }}
                      />
                      {settings.themeAccent === "custom" && (
                        <span
                          className="rounded-full px-1.5 py-1 text-black"
                          style={{ backgroundColor: customAccentColor }}
                        >
                          <CheckIcon className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </div>
                    <p className="mt-4 text-sm font-semibold text-white">Custom</p>
                    <input
                      type="color"
                      value={customAccentColor}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        onUpdateSettings({
                          themeAccent: "custom",
                          customAccentColor: event.target.value,
                        })
                      }
                      className="mt-3 h-8 w-full cursor-pointer rounded-xl border border-white/10 bg-black/30 p-1"
                      aria-label="Custom accent color"
                    />
                  </button>
                </div>
              </div>

              <div>
                <SectionHeading
                  icon={PaintBrushIcon}
                  title="Overlay surface"
                  description="Tune how Seenary sits over the rest of your desktop."
                />

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {OVERLAY_BACKGROUND_OPTIONS.map((option) => {
                    const selected = settings.overlayBackground === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onUpdateSettings({ overlayBackground: option.value })}
                        className={`rounded-3xl border p-5 text-left transition hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-white/55 ${
                          selected
                            ? "border-white/25 bg-white/10"
                            : "border-white/10 bg-white/[0.03]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-semibold text-white">{option.label}</p>
                            <p className="mt-2 text-sm leading-6 text-white/45">
                              {option.description}
                            </p>
                          </div>
                          {selected && (
                            <span className="rounded-full bg-[var(--app-accent)] px-1.5 py-1 text-black">
                              <CheckIcon className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <SectionHeading
                  icon={PaintBrushIcon}
                  title="Navbar style"
                  description="Choose how the top controls sit over Seenary. Navigation and search behavior stay the same."
                />

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {NAVBAR_STYLE_OPTIONS.map((option) => {
                    const selected = settings.navbarStyle === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onUpdateSettings({ navbarStyle: option.value })}
                        className={`rounded-3xl border p-4 text-left transition hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-white/55 ${
                          selected
                            ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)]"
                            : "border-white/10 bg-white/[0.03]"
                        }`}
                      >
                        <NavbarStylePreview style={option.value} />
                        <div className="mt-4 flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-white">{option.label}</p>
                            <p className="mt-1.5 text-sm leading-5 text-white/45">
                              {option.description}
                            </p>
                          </div>
                          {selected && (
                            <span className="shrink-0 rounded-full bg-[var(--app-accent)] px-1.5 py-1 text-black">
                              <CheckIcon className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <SectionHeading
                  icon={PaintBrushIcon}
                  title="Browsing card style"
                  description="Change poster cards on Personal, Discover, and search. My List stays unchanged."
                />

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {BROWSE_CARD_STYLE_OPTIONS.map((option) => {
                    const selected = settings.browseCardStyle === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onUpdateSettings({ browseCardStyle: option.value })}
                        className={`rounded-3xl border p-4 text-left transition hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-white/55 ${
                          selected
                            ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)]"
                            : "border-white/10 bg-white/[0.03]"
                        }`}
                      >
                        <BrowseCardStylePreview style={option.value} />
                        <div className="mt-4 flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-white">{option.label}</p>
                            <p className="mt-1.5 text-sm leading-5 text-white/45">
                              {option.description}
                            </p>
                          </div>
                          {selected && (
                            <span className="shrink-0 rounded-full bg-[var(--app-accent)] px-1.5 py-1 text-black">
                              <CheckIcon className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-semibold text-white">Overlay opacity</p>
                      <p className="mt-2 text-sm leading-6 text-white/45">
                        Lower values reveal more of whatever is behind the app.
                      </p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-sm font-semibold text-white/75">
                      {overlayOpacity}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={70}
                    max={100}
                    step={5}
                    value={overlayOpacity}
                    onChange={(event) =>
                      onUpdateSettings({ overlayOpacity: Number(event.target.value) })
                    }
                    className="mt-5 w-full accent-[var(--app-accent)]"
                  />
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-semibold text-white">Background dim</p>
                      <p className="mt-2 text-sm leading-6 text-white/45">
                        Darken the desktop behind glass surfaces without changing the app shell.
                      </p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-sm font-semibold text-white/75">
                      {backgroundDim}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={backgroundDim}
                    onChange={(event) =>
                      onUpdateSettings({ backgroundDim: Number(event.target.value) })
                    }
                    className="mt-5 w-full accent-[var(--app-accent)]"
                  />
                </div>
              </div>

              <div>
                <SectionHeading
                  icon={SparklesIcon}
                  title="Motion"
                  description="Choose how lively Seenary should feel while you browse."
                />

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {ANIMATION_LEVEL_OPTIONS.map((option) => {
                    const selected = settings.animationLevel === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onUpdateSettings({ animationLevel: option.value })}
                        className={`rounded-3xl border p-5 text-left transition hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-white/55 ${
                          selected
                            ? "border-white/25 bg-white/10"
                            : "border-white/10 bg-white/[0.03]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-semibold text-white">{option.label}</p>
                            <p className="mt-2 text-sm leading-6 text-white/45">
                              {option.description}
                            </p>
                          </div>
                          {selected && (
                            <span className="rounded-full bg-[var(--app-accent)] px-1.5 py-1 text-black">
                              <CheckIcon className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <ToggleSetting
                icon={PaintBrushIcon}
                title="Compact mode"
                description="Slightly shrink text and controls, shorten the navbar, and slim down scrollbars so more fits on screen."
                checked={settings.compactMode}
                onChange={(checked) => onUpdateSettings({ compactMode: checked })}
              />

              <div>
                <SectionHeading
                  icon={SparklesIcon}
                  title="Personal page density"
                  description="Choose how much room Personal page shelves give each saved anime card."
                />

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {CARD_DENSITY_OPTIONS.map((option) => {
                    const selected = settings.homeDensity === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onUpdateSettings({ homeDensity: option.value })}
                        className={`rounded-3xl border p-5 text-left transition hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-white/55 ${
                          selected
                            ? "border-white/25 bg-white/10"
                            : "border-white/10 bg-white/[0.03]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-white">{option.label}</p>
                            <p className="mt-3 text-sm leading-6 text-white/50">
                              {option.description}
                            </p>
                          </div>
                          {selected && (
                            <span className="rounded-full bg-[var(--app-accent)] px-1.5 py-1 text-black">
                              <CheckIcon className="h-4 w-4" />
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <SectionHeading
                  icon={SparklesIcon}
                  title="Discover page density"
                  description="Choose how much space each Discover page title gets while browsing."
                />

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {DISCOVER_DENSITY_OPTIONS.map((option) => {
                    const selected = settings.discoverDensity === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onUpdateSettings({ discoverDensity: option.value })}
                        className={`rounded-3xl border p-5 text-left transition hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-white/55 ${
                          selected
                            ? "border-white/25 bg-white/10"
                            : "border-white/10 bg-white/[0.03]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-semibold text-white">{option.label}</p>
                            <p className="mt-2 text-sm leading-6 text-white/45">
                              {option.description}
                            </p>
                          </div>
                          {selected && (
                            <span className="rounded-full bg-[var(--app-accent)] px-1.5 py-1 text-black">
                              <CheckIcon className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <SectionHeading
                  icon={BookmarkIcon}
                  title="My List page density"
                  description="Choose how much detail each My List page entry shows while managing your library."
                />

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {CARD_DENSITY_OPTIONS.map((option) => {
                    const selected = settings.myListDensity === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onUpdateSettings({ myListDensity: option.value })}
                        className={`rounded-3xl border p-5 text-left transition hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-white/55 ${
                          selected
                            ? "border-white/25 bg-white/10"
                            : "border-white/10 bg-white/[0.03]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-white">{option.label}</p>
                            <p className="mt-3 text-sm leading-6 text-white/50">
                              {option.description}
                            </p>
                          </div>
                          {selected && (
                            <span className="rounded-full bg-[var(--app-accent)] px-1.5 py-1 text-black">
                              <CheckIcon className="h-4 w-4" />
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {window.desktopWindow && (
                <div>
                  <SectionHeading
                    icon={PaintBrushIcon}
                    title="Window layout"
                    description="Change size without losing Seenary's place, or return to your last custom size."
                  />

                  {desktopEnvironment.displayBackend === "wayland" && (
                    <p className="mb-3 rounded-2xl border border-cyan-300/15 bg-cyan-300/8 px-4 py-3 text-sm leading-6 text-cyan-50/75">
                      Seenary will try live size changes and verify whether your Wayland compositor
                      accepted them. Window placement remains managed by your desktop.
                    </p>
                  )}

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    {WINDOW_PRESET_OPTIONS.map((option) => {
                      const selected = desktopWindow.preset === option.value;

                      if (option.value === "custom") {
                        return (
                          <button
                            key={option.value}
                            type="button"
                            disabled={desktopWindow.loading}
                            onClick={() => {
                              const customBounds =
                                desktopWindow.customBounds ?? desktopWindow.bounds;
                              if (customBounds) {
                                applyDesktopWindowCustomSize({
                                  width: customBounds.width,
                                  height: customBounds.height,
                                });
                              }
                            }}
                            className={`rounded-3xl border p-5 text-left transition hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-white/55 disabled:cursor-not-allowed disabled:opacity-60 ${
                              selected
                                ? "border-white/25 bg-white/10"
                                : "border-white/10 bg-white/[0.03]"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p className="font-semibold text-white">{option.label}</p>
                                <p className="mt-2 text-sm leading-6 text-white/45">
                                  {option.description}
                                </p>
                              </div>
                              {selected && (
                                <span className="rounded-full bg-[var(--app-accent)] px-1.5 py-1 text-black">
                                  <CheckIcon className="h-3.5 w-3.5" />
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      }

                      return (
                        <button
                          key={option.value}
                          type="button"
                          disabled={desktopWindow.loading}
                          onClick={() => {
                            if (option.value !== "custom") {
                              applyDesktopWindowPreset(option.value);
                            }
                          }}
                          className={`rounded-3xl border p-5 text-left transition focus:outline-none focus:ring-2 focus:ring-white/55 disabled:cursor-not-allowed disabled:opacity-60 ${
                            selected
                              ? "border-white/25 bg-white/10"
                              : "border-white/10 bg-white/[0.03]"
                          } ${option.selectable ? "hover:bg-white/8" : "cursor-default"}`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="font-semibold text-white">{option.label}</p>
                              <p className="mt-2 text-sm leading-6 text-white/45">
                                {option.description}
                              </p>
                            </div>
                            {selected && (
                              <span className="rounded-full bg-[var(--app-accent)] px-1.5 py-1 text-black">
                                <CheckIcon className="h-3.5 w-3.5" />
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {desktopWindow.preset === "custom" && (
                    <div className="mt-3 rounded-3xl border border-white/10 bg-white/[0.03] px-5 py-4">
                      <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-[minmax(0,1fr)_8rem_8rem]">
                        <p className="text-sm text-white/45">
                          <span className="font-semibold text-white">Custom size</span>
                          <span className="mx-2 text-white/25">/</span>
                          Minimum {MIN_DESKTOP_WINDOW_SIZE.width} x{" "}
                          {MIN_DESKTOP_WINDOW_SIZE.height} px
                        </p>

                        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                          Width
                          <input
                            type="number"
                            min={MIN_DESKTOP_WINDOW_SIZE.width}
                            step={1}
                            value={desktopWindowDraft.width}
                            onChange={(event) =>
                              handleDesktopWindowSizeInput("width", event.target.value)
                            }
                            onBlur={(event) =>
                              commitDesktopWindowSizeInput("width", event.target.value)
                            }
                            className="mt-2 h-10 w-full rounded-2xl border border-white/10 bg-black/20 px-3 text-sm font-semibold text-white outline-none transition focus:border-white/25"
                          />
                        </label>

                        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                          Height
                          <input
                            type="number"
                            min={MIN_DESKTOP_WINDOW_SIZE.height}
                            step={1}
                            value={desktopWindowDraft.height}
                            onChange={(event) =>
                              handleDesktopWindowSizeInput("height", event.target.value)
                            }
                            onBlur={(event) =>
                              commitDesktopWindowSizeInput("height", event.target.value)
                            }
                            className="mt-2 h-10 w-full rounded-2xl border border-white/10 bg-black/20 px-3 text-sm font-semibold text-white outline-none transition focus:border-white/25"
                          />
                        </label>
                      </div>
                    </div>
                  )}

                  {desktopWindow.feedback && (
                    <p
                      className={`mt-3 rounded-2xl border px-3 py-2 text-sm ${
                        desktopWindow.feedback.kind === "success"
                          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                          : "border-rose-400/20 bg-rose-400/10 text-rose-100"
                      }`}
                    >
                      {desktopWindow.feedback.message}
                    </p>
                  )}
                </div>
              )}

            </div>
            </AccordionSection>
          </div>

          <div ref={rememberSectionRef("content")} className="scroll-mt-24">
            <AccordionSection
              icon={EyeSlashIcon}
              title="Content"
              scope="Portable"
              description="Control anime title display and what appears in discovery surfaces."
              summary={[
                titleLabel,
                settings.hideAdultContent ? "18+ hidden" : "18+ visible",
              ]}
              open={openSection === "content"}
              onToggle={() => toggleSection("content")}
            >
            <div className="space-y-6">
              <div>
                <SectionHeading
                  icon={LanguageIcon}
                  title="Anime title language"
                  description="Choose which title version should be preferred throughout the app."
                />

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {TITLE_OPTIONS.map((option) => {
                    const selected = settings.titleLanguage === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onUpdateSettings({ titleLanguage: option.value })}
                        className={`rounded-3xl border p-5 text-left transition hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-white/55 ${
                          selected
                            ? "border-white/25 bg-white/10"
                            : "border-white/10 bg-white/[0.03]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-semibold text-white">{option.label}</p>
                            <p className="mt-2 text-sm leading-6 text-white/45">
                              {option.description}
                            </p>
                          </div>
                          {selected && (
                            <span className="rounded-full bg-[var(--app-accent)] px-1.5 py-1 text-black">
                              <CheckIcon className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <SectionHeading
                  icon={EyeSlashIcon}
                  title="Discovery filters"
                  description="Choose which AniList content can appear while browsing."
                />

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <ToggleSetting
                    icon={EyeSlashIcon}
                    title="Hide 18+ content"
                    description="Hide adult anime from search results and trending picks."
                    checked={settings.hideAdultContent}
                    onChange={(checked) =>
                      onUpdateSettings({ hideAdultContent: checked })
                    }
                  />
                </div>
              </div>
            </div>
            </AccordionSection>
          </div>

          <div ref={rememberSectionRef("home")} className="scroll-mt-24">
            <AccordionSection
              icon={HomeIcon}
              title="Home"
              scope="Portable"
              description="How the home screen behaves when you land in the app."
              summary={[
                `Starts on ${getStartViewLabel(settings.startView)}`,
                settings.showTrendingCarousel ? "Carousel on" : "Carousel off",
                settings.autoRotateTrending ? "Auto rotate" : "Manual",
                settings.autoScrollHomeShelves ? "Shelves move" : "Shelves still",
              ]}
              open={openSection === "home"}
              onToggle={() => toggleSection("home")}
            >
            <div className="space-y-6">
              <div>
                <SectionHeading
                  icon={HomeIcon}
                  title="Startup view"
                  description="Choose what Seenary shows first after you log in."
                />

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {START_VIEW_OPTIONS.map((option) => {
                    const selected = settings.startView === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onUpdateSettings({ startView: option.value })}
                        className={`rounded-3xl border p-5 text-left transition hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-white/55 ${
                          selected
                            ? "border-white/25 bg-white/10"
                            : "border-white/10 bg-white/[0.03]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-semibold text-white">{option.label}</p>
                            <p className="mt-2 text-sm leading-6 text-white/45">
                              {option.description}
                            </p>
                          </div>
                          {selected && (
                            <span className="rounded-full bg-[var(--app-accent)] px-1.5 py-1 text-black">
                              <CheckIcon className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <SectionHeading
                  icon={HomeIcon}
                  title="Home behavior"
                  description="Choose how the home page should greet you when the app opens."
                />

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <ToggleSetting
                    icon={SparklesIcon}
                    title="Trending carousel"
                    description="Show the large trending anime showcase at the top of home."
                    checked={settings.showTrendingCarousel}
                    onChange={(checked) =>
                      onUpdateSettings({ showTrendingCarousel: checked })
                    }
                  />

                  <ToggleSetting
                    icon={PlayCircleIcon}
                    title="Auto-rotate carousel"
                    description="Let trending picks advance automatically while home is open."
                    checked={settings.autoRotateTrending}
                    disabled={!settings.showTrendingCarousel}
                    onChange={(checked) =>
                      onUpdateSettings({ autoRotateTrending: checked })
                    }
                  />

                  <ToggleSetting
                    icon={ArrowPathIcon}
                    title="Auto-scroll shelves"
                    description="Occasionally move Continue Watching and Planned Picks when you are not hovering them."
                    checked={settings.autoScrollHomeShelves}
                    onChange={(checked) =>
                      onUpdateSettings({ autoScrollHomeShelves: checked })
                    }
                  />
                </div>

                <div className="mt-4 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-sm font-semibold text-white">Quick note</p>
                  <p className="mt-2 text-sm leading-6 text-white/45">
                    Carousel rotation only matters when the trending shelf is visible.
                    If you turn the carousel off, the home page starts directly with
                    your own library sections.
                  </p>
                </div>
              </div>

            </div>
            </AccordionSection>
          </div>

          <div ref={rememberSectionRef("account")} className="scroll-mt-24">
            <AccordionSection
              icon={LinkIcon}
              title="Sign-in methods"
              scope="Account"
              description="Manage your local password and connected external accounts."
              summary={[
                aniListLink.loading
                  ? "Checking AniList"
                  : aniListLink.linked
                    ? `AniList ${aniListLink.account?.anilistUsername ?? "linked"}`
                    : "AniList not linked",
                malLink.loading
                  ? "Checking MAL"
                  : malLink.linked
                    ? `MAL ${malLink.account?.malUsername ?? "linked"}`
                    : "MAL not linked",
              ]}
              open={openSection === "account"}
              onToggle={() => toggleSection("account")}
            >
            <div className="mb-5 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-start gap-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-2.5 text-white/65">
                  <KeyIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-white">
                    {localCredentialsConfirmed === true
                      ? "Local password confirmed"
                      : localCredentialsConfirmed === false
                        ? "Local password needed"
                        : "Local password not yet verified"}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-white/45">
                    {localCredentialsConfirmed === true
                      ? "Your local password can safely authorize account unlinking."
                      : localCredentialsConfirmed === false
                        ? "This profile was created through an external sign-in. You will create a local password before unlinking it."
                        : "Sign in once with your existing local password, or create a replacement during unlinking."}
                  </p>
                </div>
              </div>
            </div>
            <div>
              <SectionHeading
                icon={LinkIcon}
                title="AniList account"
                description="Link your local profile to AniList so sync can use a verified account identity later."
              />

              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-semibold text-white">
                      {aniListLink.linked
                        ? `Connected as ${aniListLink.account?.anilistUsername ?? "AniList user"}`
                        : "No AniList account linked"}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/45">
                      {aniListLink.linked
                        ? "This local account is ready for authenticated AniList operations."
                        : "Authorize AniList in your browser and attach it to this Seenary account."}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {aniListLink.linked && (
                      <button
                        type="button"
                        onClick={() => openUnlinkModal("anilist")}
                        disabled={aniListLink.loading}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm font-semibold text-rose-100 transition hover:bg-rose-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <XMarkIcon className="h-4 w-4" />
                        Unlink
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={linkAniListAccount}
                      disabled={aniListLink.loading}
                      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-white/55 ${
                        aniListLink.loading
                          ? "cursor-not-allowed border border-white/5 bg-white/[0.03] text-white/35"
                          : "border border-white/10 bg-white text-black hover:opacity-90"
                      }`}
                    >
                      <LinkIcon className="h-4 w-4" />
                      {aniListLink.loading
                        ? "Checking..."
                        : aniListLink.linked
                          ? "Relink AniList"
                          : "Link AniList"}
                    </button>
                  </div>
                </div>

                {aniListLink.account && (
                  <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <LinkStat label="AniList ID" value={String(aniListLink.account.anilistUserId)} />
                    <LinkStat
                      label="Original name"
                      value={aniListLink.account.originalAniListUsername}
                    />
                    <LinkStat
                      label="Last import"
                      value={
                        aniListLink.account.lastImportAt
                          ? formatDateTime(aniListLink.account.lastImportAt)
                          : "Not yet"
                      }
                    />
                  </div>
                )}

                {aniListLink.conflict && (
                  <div className="mt-5 rounded-3xl border border-amber-300/20 bg-amber-300/10 p-4">
                    <p className="text-sm font-semibold text-white">
                      AniList account already linked
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/70">
                      {aniListLink.conflict.anilistUsername} is linked to{" "}
                      <span className="font-semibold text-white">
                        {aniListLink.conflict.sourceUser?.username ?? "another local account"}
                      </span>
                      . Transfer moves only the AniList connection here. Merge brings over
                      non-duplicate list entries and removes that old local account.
                    </p>

                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={aniListLink.loading}
                        onClick={() => resolveAniListConflict("transfer")}
                        className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Transfer link here
                      </button>
                      <button
                        type="button"
                        disabled={aniListLink.loading}
                        onClick={() => resolveAniListConflict("merge")}
                        className="rounded-2xl border border-white/10 bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Merge into this account
                      </button>
                    </div>
                  </div>
                )}

                {aniListLink.feedback && (
                  <div
                    className={`mt-5 rounded-3xl border p-4 ${
                      aniListLink.feedback.kind === "success"
                        ? "border-emerald-400/20 bg-emerald-400/10"
                        : "border-rose-400/20 bg-rose-400/10"
                    }`}
                  >
                    <p className="text-sm font-semibold text-white">
                      {aniListLink.feedback.message}
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-5">
              <SectionHeading
                icon={LinkIcon}
                title="MyAnimeList account"
                description="Link your local profile to MyAnimeList so the app can recognize your MAL identity."
              />

              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-semibold text-white">
                      {malLink.linked
                        ? `Connected as ${malLink.account?.malUsername ?? "MyAnimeList user"}`
                        : "No MyAnimeList account linked"}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/45">
                      {malLink.linked
                        ? "This local account can be matched back to your MyAnimeList profile."
                        : "Authorize MyAnimeList in your browser and attach it to this Seenary account as a fallback source."}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {malLink.linked && (
                      <button
                        type="button"
                        onClick={() => openUnlinkModal("mal")}
                        disabled={malLink.loading}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm font-semibold text-rose-100 transition hover:bg-rose-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <XMarkIcon className="h-4 w-4" />
                        Unlink
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={linkMalAccount}
                      disabled={malLink.loading}
                      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-white/55 ${
                        malLink.loading
                          ? "cursor-not-allowed border border-white/5 bg-white/[0.03] text-white/35"
                          : "border border-white/10 bg-white text-black hover:opacity-90"
                      }`}
                    >
                      <LinkIcon className="h-4 w-4" />
                      {malLink.loading
                        ? "Checking..."
                        : malLink.linked
                          ? "Relink MyAnimeList"
                          : "Link MyAnimeList"}
                    </button>
                  </div>
                </div>

                {malLink.account && (
                  <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <LinkStat label="MAL ID" value={String(malLink.account.malUserId)} />
                    <LinkStat label="Original name" value={malLink.account.originalMalUsername} />
                    <LinkStat
                      label="Last import"
                      value={
                        malLink.account.lastImportAt
                          ? formatDateTime(malLink.account.lastImportAt)
                          : "Not yet"
                      }
                    />
                  </div>
                )}

                {malLink.conflict && (
                  <div className="mt-5 rounded-3xl border border-amber-300/20 bg-amber-300/10 p-4">
                    <p className="text-sm font-semibold text-white">
                      MyAnimeList account already linked
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/70">
                      {malLink.conflict.malUsername} is linked to{" "}
                      <span className="font-semibold text-white">
                        {malLink.conflict.sourceUser?.username ?? "another local account"}
                      </span>
                      . Transfer moves only the MyAnimeList connection here. Merge brings over
                      non-duplicate list entries and removes that old local account.
                    </p>

                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={malLink.loading}
                        onClick={() => resolveMalConflict("transfer")}
                        className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Transfer link here
                      </button>
                      <button
                        type="button"
                        disabled={malLink.loading}
                        onClick={() => resolveMalConflict("merge")}
                        className="rounded-2xl border border-white/10 bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Merge into this account
                      </button>
                    </div>
                  </div>
                )}

                {malLink.feedback && (
                  <div
                    className={`mt-5 rounded-3xl border p-4 ${
                      malLink.feedback.kind === "success"
                        ? "border-emerald-400/20 bg-emerald-400/10"
                        : "border-rose-400/20 bg-rose-400/10"
                    }`}
                  >
                    <p className="text-sm font-semibold text-white">
                      {malLink.feedback.message}
                    </p>
                  </div>
                )}
              </div>
            </div>
            </AccordionSection>
          </div>

          <div ref={rememberSectionRef("sync")} className="scroll-mt-24">
            <AccordionSection
              icon={ArrowPathIcon}
              title={syncStatus.linked ? `${manualSyncTargetsLabel} Sync` : "External Sync"}
              scope="Account"
              description={
                syncStatus.linked
                  ? `Push local Anime and Manga changes to ${manualSyncTargetsLabel}.`
                  : "Link an external account before syncing local list changes."
              }
              summary={[
                syncStatus.linked
                  ? syncStatus.autoSyncEnabled
                    ? "Auto on"
                    : "Auto off"
                  : "Auto unavailable",
                `${syncStatus.pendingCount} queued`,
                syncStatus.linked ? manualSyncTargetsLabel : "Unavailable",
              ]}
              open={openSection === "sync"}
              onToggle={() => toggleSection("sync")}
            >
            <div className="space-y-5">
              <SectionHeading
                icon={ArrowPathIcon}
                title="Sync controls"
                description={
                  syncStatus.linked
                    ? `Local Anime and Manga edits are queued first, then pushed to ${manualSyncTargetsLabel} in one sync run.`
                    : "Sync is unavailable until you link AniList or MyAnimeList."
                }
              />

              <div className="space-y-3">
                <ToggleSetting
                  icon={ArrowPathIcon}
                  title="Automatic sync"
                  description={
                    syncStatus.linked
                      ? "Push queued local changes after a short delay."
                      : "Link AniList or MyAnimeList before automatic sync can run."
                  }
                  checked={syncStatus.autoSyncEnabled}
                  disabled={!syncStatus.linked || syncStatus.loading}
                  onChange={updateAutoSync}
                  centerIcon
                />

                <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="shrink-0 rounded-2xl border border-white/10 bg-white/5 p-2 text-white/65">
                      <ArrowPathIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-white">Manual sync</p>
                      <p className="mt-1 text-sm leading-6 text-white/45">
                        {syncStatus.pendingCount > 0
                          ? `${syncStatus.pendingCount} queued change${syncStatus.pendingCount === 1 ? "" : "s"} waiting to sync or retry.`
                          : syncStatus.linked
                            ? `No queued ${manualSyncTargetsLabel} changes right now.`
                            : "Sync is unavailable because no external account is linked."}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-3 sm:justify-end">
                    <ProgressActionButton
                      onClick={runSyncNow}
                      disabled={!syncStatus.linked || isSyncing}
                      active={isSyncing}
                      progress={syncProgress?.operation === "manual-sync" ? syncProgress : null}
                    >
                      {isSyncing ? "Syncing..." : "Sync now"}
                    </ProgressActionButton>

                    <button
                      type="button"
                      onClick={() => openSyncActivity("pending")}
                      className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white/75 transition hover:bg-white/8 hover:text-white"
                    >
                      View activity
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="shrink-0 rounded-2xl border border-white/10 bg-white/5 p-2 text-white/65">
                      <ArrowPathIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-white">Update from {syncTargetLabel}</p>
                      <p className="mt-1 text-sm leading-6 text-white/45">
                        {!syncStatus.linked
                          ? "Link an external account before pulling remote list updates."
                          : isAniListSync
                          ? "Pull your Anime and Manga library from AniList and replace local list fields that differ."
                          : "Pull your Anime and Manga library from MyAnimeList and replace local list fields that differ."}
                      </p>
                    </div>
                  </div>

                  <div className="flex min-w-0 shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                    <p className="max-w-sm text-xs leading-5 text-white/50 sm:text-right" aria-live="polite">
                      {syncProgress?.operation === (isAniListSync ? "pull-anilist" : "pull-mal")
                        ? <>{syncProgress.label}{Number(syncProgress.total) > 0
                          ? ` ${Number(syncProgress.current || 0).toLocaleString()} of ${Number(syncProgress.total).toLocaleString()} titles.`
                          : ""}</>
                        : null}
                    </p>
                    <ProgressActionButton
                      onClick={pullFromRemote}
                      disabled={!syncStatus.linked || isPullingFromRemote}
                      active={isPullingFromRemote}
                      progress={
                        syncProgress?.operation === (isAniListSync ? "pull-anilist" : "pull-mal")
                          ? syncProgress
                          : null
                      }
                    >
                      {isPullingFromRemote ? "Updating..." : `Update from ${syncTargetLabel}`}
                    </ProgressActionButton>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <button
                  type="button"
                  onClick={() => openSyncActivity("pending")}
                  className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-left transition hover:bg-white/[0.04]"
                >
                  <p className="text-[11px] uppercase tracking-[0.22em] text-white/35">Queued</p>
                  <p className="mt-1 text-xl font-semibold text-white">{syncStatus.pendingCount}</p>
                </button>
                <button
                  type="button"
                  onClick={() => openSyncActivity("completed")}
                  className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-left transition hover:bg-white/[0.04]"
                >
                  <p className="text-[11px] uppercase tracking-[0.22em] text-white/35">Completed</p>
                  <p className="mt-1 text-sm font-semibold text-white">Open log</p>
                </button>
                <button
                  type="button"
                  onClick={() => openSyncActivity("failed")}
                  className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-left transition hover:bg-white/[0.04]"
                >
                  <p className="text-[11px] uppercase tracking-[0.22em] text-white/35">Failed</p>
                  <p className="mt-1 text-sm font-semibold text-white">Open log</p>
                </button>
              </div>

              {syncStatus.feedback && (
                <div
                  className={`rounded-3xl border p-4 ${
                    syncStatus.feedback.kind === "success"
                      ? "border-emerald-400/20 bg-emerald-400/10"
                      : "border-rose-400/20 bg-rose-400/10"
                  }`}
                >
                  <p className="text-sm font-semibold text-white">
                    {syncStatus.feedback.message}
                  </p>
                </div>
              )}
            </div>
            </AccordionSection>
          </div>

          <div ref={rememberSectionRef("data")} className="scroll-mt-24">
            <AccordionSection
              icon={CloudArrowDownIcon}
              title="Import & Data"
              scope="Account and portable"
              description="Bring anime data into the app and manage local list data."
              summary={["Portable backups", "AniList import", "Clear lists"]}
              open={openSection === "data"}
              onToggle={() => toggleSection("data")}
            >
            <div className="space-y-6">
              <div className="rounded-3xl border border-cyan-300/15 bg-cyan-300/8 p-5">
                <p className="font-semibold text-white">Portable data and backups</p>
                <p className="mt-2 text-sm leading-6 text-white/70">
                  Export your Anime and Manga library, preferences, layouts, and sync recovery
                  state to a portable file that can move between Seenary installations.
                </p>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={isExportingAccountData}
                    onClick={async () => {
                      try {
                        setIsExportingAccountData(true);
                        setBackupFeedback(null);
                        await onExportAccountData();
                        setBackupFeedback({ kind: "success", message: "Account data exported." });
                      } catch (error) {
                        setBackupFeedback({ kind: "error", message: error instanceof Error ? error.message : "Failed to export account data." });
                      } finally {
                        setIsExportingAccountData(false);
                      }
                    }}
                    className="rounded-2xl border border-cyan-200/25 bg-cyan-200/10 px-5 py-3 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/15 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isExportingAccountData ? "Exporting account..." : "Export account data"}
                  </button>
                  <button
                    type="button"
                    disabled={isExportingBackup}
                    onClick={async () => {
                      try {
                        setIsExportingBackup(true);
                        setBackupFeedback(null);
                        await onExportLocalBackup();
                        setBackupFeedback({
                          kind: "success",
                          message: "Backup exported.",
                        });
                      } catch {
                        setBackupFeedback({
                          kind: "error",
                          message: "Failed to export backup.",
                        });
                      } finally {
                        setIsExportingBackup(false);
                      }
                    }}
                    className={`rounded-2xl px-5 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-white/55 ${
                      isExportingBackup
                        ? "cursor-not-allowed border border-white/5 bg-white/[0.03] text-white/35"
                        : "border border-white/10 bg-white text-black hover:opacity-90"
                    }`}
                  >
                    {isExportingBackup ? "Exporting..." : "Export backup"}
                  </button>

                  <input
                    ref={backupImportInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(event) => importBackupFile(event.target.files?.[0] ?? null)}
                  />

                  <button
                    type="button"
                    disabled={isImportingBackup}
                    onClick={() => backupImportInputRef.current?.click()}
                    className={`rounded-2xl border px-5 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-white/55 ${
                      isImportingBackup
                        ? "cursor-not-allowed border-white/5 bg-white/[0.03] text-white/35"
                        : "border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/8 hover:text-white"
                    }`}
                  >
                    {isImportingBackup ? "Importing..." : "Import backup"}
                  </button>
                </div>

                {backupFeedback && (
                  <div
                    className={`mt-5 rounded-3xl border p-4 ${
                      backupFeedback.kind === "success"
                        ? "border-emerald-400/20 bg-emerald-400/10"
                        : "border-rose-400/20 bg-rose-400/10"
                    }`}
                  >
                    <p className="text-sm font-semibold text-white">{backupFeedback.message}</p>
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-semibold text-white">Repair cached data</p>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-white/65">
                      Clears downloaded web resources, expired detail payloads, and unneeded media
                      records. Your login, Anime and Manga lists, settings, sync queue, and history
                      stay intact.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isRepairingCache}
                    onClick={() => setIsCacheRepairConfirmOpen(true)}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-3 text-sm font-semibold text-white/80 transition hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-50"
                  >
                    <ArrowPathIcon className={`h-4 w-4 ${isRepairingCache ? "animate-spin" : ""}`} />
                    {isRepairingCache ? "Repairing..." : "Repair cached data"}
                  </button>
                </div>

                <p className="mt-4 text-xs leading-5 text-white/40">
                  Seenary also removes detail payloads older than 30 days automatically. It never
                  periodically clears account or library storage.
                </p>

                {cacheRepairFeedback && (
                  <div
                    role="status"
                    className={`mt-4 rounded-2xl border p-4 ${
                      cacheRepairFeedback.kind === "success"
                        ? "border-emerald-400/20 bg-emerald-400/10"
                        : "border-rose-400/20 bg-rose-400/10"
                    }`}
                  >
                    <p className="text-sm font-semibold text-white">
                      {cacheRepairFeedback.message}
                    </p>
                    {cacheRepairFeedback.kind === "success" && (
                      <p className="mt-1 text-xs text-white/55">
                        Removed {cacheRepairFeedback.removedDetails || 0} detail payloads and{" "}
                        {cacheRepairFeedback.removedMedia || 0} unneeded media records.
                      </p>
                    )}
                    {cacheRepairFeedback.restartRecommended && (
                      <button
                        type="button"
                        onClick={restartAfterCacheRepair}
                        className="mt-3 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-black transition hover:opacity-90"
                      >
                        Restart Seenary
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div>
                <SectionHeading
                  icon={CloudArrowDownIcon}
                  title="Import from AniList"
                  description="Preview your AniList library first, then choose exact titles to bring over."
                />

                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-white/70">
                        AniList username
                      </span>
                      <input
                        type="text"
                        value={importUsername}
                        onChange={(event) => setImportUsername(event.target.value)}
                        onKeyDown={(event) => {
                          if (
                            event.key === "Enter" &&
                            !isPreviewLoading &&
                            importUsername.trim()
                          ) {
                            event.preventDefault();
                            openImportPreview();
                          }
                        }}
                        placeholder="Enter AniList username"
                        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-white/20 focus:bg-white/[0.07]"
                      />
                    </label>

                    <button
                      type="button"
                      disabled={isPreviewLoading || !importUsername.trim()}
                      onClick={openImportPreview}
                      className={`mt-7 inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-white/55 ${
                        isPreviewLoading || !importUsername.trim()
                          ? "cursor-not-allowed border border-white/5 bg-white/[0.03] text-white/35"
                          : "border border-white/10 bg-white text-black hover:opacity-90"
                      }`}
                    >
                      {isPreviewLoading && importProvider === "anilist" && (
                        <ArrowPathIcon className="h-4 w-4 animate-spin" />
                      )}
                      {isPreviewLoading && importProvider === "anilist"
                        ? "Matching titles..."
                        : "Choose what to import"}
                    </button>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-white/45">
                    This imports anime statuses, progress, score, notes, and cached title data.
                    Existing local entries with the same AniList anime id are updated. Nothing gets deleted.
                  </p>

                  <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/8 px-4 py-3">
                    <p className="text-sm leading-6 text-white/70">
                      Make sure your AniList account is <span className="font-semibold text-white">public</span>,
                      otherwise this username import will not be able to read your list. Private-account import
                      will need a login-based method instead.
                    </p>
                  </div>

                  {importFeedback?.provider === "anilist" && (
                    <ImportFeedbackPanel feedback={importFeedback} />
                  )}
                </div>
              </div>

              <div>
                <SectionHeading
                  icon={CloudArrowDownIcon}
                  title="Import from MyAnimeList"
                  description="Preview any public MyAnimeList library, then choose exact Anime and Manga titles to bring over."
                />

                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-white/70">
                        MyAnimeList username
                      </span>
                      <input
                        type="text"
                        value={malImportUsername}
                        onChange={(event) => setMalImportUsername(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !isPreviewLoading && malImportUsername.trim()) {
                            event.preventDefault();
                            openMalImportPreview();
                          }
                        }}
                        placeholder="Enter MyAnimeList username"
                        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-white/20 focus:bg-white/[0.07]"
                      />
                    </label>

                    <button
                      type="button"
                      disabled={isPreviewLoading || !malImportUsername.trim()}
                      onClick={openMalImportPreview}
                      className={`mt-7 inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-white/55 ${
                        isPreviewLoading || !malImportUsername.trim()
                          ? "cursor-not-allowed border border-white/5 bg-white/[0.03] text-white/35"
                          : "border border-white/10 bg-white text-black hover:opacity-90"
                      }`}
                    >
                      {isPreviewLoading && importProvider === "mal" && (
                        <ArrowPathIcon className="h-4 w-4 animate-spin" />
                      )}
                      {isPreviewLoading && importProvider === "mal"
                        ? "Matching titles..."
                        : "Choose what to import"}
                    </button>
                  </div>

                  <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/8 px-4 py-3">
                    <p className="text-sm leading-6 text-white/70">
                      The MAL list must be public. Anime and Manga are matched to canonical AniList records before import, so entries without a safe match may be skipped. Private-list access and ongoing synchronization still require linking the account.
                    </p>
                  </div>

                  {importFeedback?.provider === "mal" && (
                    <ImportFeedbackPanel feedback={importFeedback} />
                  )}
                </div>
              </div>

              <div>
                <SectionHeading
                  icon={DocumentTextIcon}
                  title="Import from text file"
                  description="Bring in a simple notepad list and choose whether its titles are Anime or Manga."
                />

                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <FileImportMediaSelector
                    value={textImportMediaType}
                    onChange={setTextImportMediaType}
                    label="Interpret this text file as"
                  />
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-semibold text-white">
                        {textImportFileName || "Choose a .txt file"}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/45">
                        Lines without progress are imported as completed. Lines like 3/12 use episode progress in Anime mode and chapter progress in Manga mode.
                      </p>
                    </div>

                    <input
                      ref={textImportInputRef}
                      type="file"
                      accept=".txt,text/plain"
                      className="hidden"
                      onChange={(event) => openTextImportPreview(event.target.files?.[0] ?? null)}
                    />

                    <button
                      type="button"
                      disabled={isPreviewLoading}
                      onClick={() => textImportInputRef.current?.click()}
                      className={`inline-flex w-full items-center justify-center rounded-2xl px-5 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-white/55 md:w-auto md:shrink-0 ${
                        isPreviewLoading
                          ? "cursor-not-allowed border border-white/5 bg-white/[0.03] text-white/35"
                          : "border border-white/10 bg-white text-black hover:opacity-90"
                      }`}
                    >
                      {isPreviewLoading && importProvider === "txt"
                        ? "Matching titles..."
                        : "Choose text file"}
                    </button>
                  </div>

                  <div className="mt-4 rounded-2xl border border-sky-300/15 bg-sky-300/8 px-4 py-3">
                    <p className="text-sm leading-6 text-white/70">
                      Seenary will match every line against AniList {textImportMediaType === "MANGA" ? "Manga" : "Anime"} records only. Review every match before importing.
                    </p>
                  </div>

                  {importFeedback?.provider === "txt" && (
                    <ImportFeedbackPanel feedback={importFeedback} />
                  )}
                </div>
              </div>

              <div>
                <SectionHeading
                  icon={DocumentTextIcon}
                  title="Import from PDF"
                  description="Extract Anime or Manga titles from a text-based PDF, then review every match before importing."
                />

                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <FileImportMediaSelector
                    value={pdfImportMediaType}
                    onChange={setPdfImportMediaType}
                    label="Interpret this PDF as"
                  />
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-white">
                        Choose a .pdf file
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/45">
                        Best for browser-exported pages and other PDFs with selectable text.
                      </p>
                      <p className="mt-2 text-sm leading-6 text-amber-100/75">
                        PDF import is experimental. Scanned image PDFs may not contain readable titles.
                      </p>
                    </div>

                    <input
                      ref={pdfImportInputRef}
                      type="file"
                      accept=".pdf,application/pdf"
                      className="hidden"
                      onChange={(event) => openPdfImportPreview(event.target.files?.[0] ?? null)}
                    />

                    <button
                      type="button"
                      disabled={isPreviewLoading}
                      onClick={() => pdfImportInputRef.current?.click()}
                      className={`inline-flex w-full items-center justify-center rounded-2xl px-5 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-white/55 md:w-auto md:shrink-0 ${
                        isPreviewLoading
                          ? "cursor-not-allowed border border-white/5 bg-white/[0.03] text-white/35"
                          : "border border-white/10 bg-white text-black hover:opacity-90"
                      }`}
                    >
                      {isPreviewLoading && importProvider === "pdf"
                        ? "Reading PDF..."
                        : "Choose PDF"}
                    </button>
                  </div>

                  <div className="mt-4 rounded-2xl border border-sky-300/15 bg-sky-300/8 px-4 py-3">
                    <p className="text-sm leading-6 text-white/70">
                      Seenary extracts readable PDF text and matches likely title lines against AniList {pdfImportMediaType === "MANGA" ? "Manga" : "Anime"} records only.
                    </p>
                  </div>

                  {importFeedback?.provider === "pdf" && (
                    <ImportFeedbackPanel feedback={importFeedback} />
                  )}
                </div>
              </div>

              <div>
                <SectionHeading
                  icon={TrashIcon}
                  title="Danger zone"
                  description="Permanently clear media lists or delete your Seenary account."
                />

                <div className="space-y-4 rounded-3xl border border-rose-400/15 bg-rose-400/8 p-5">
                  <div>
                    <p className="font-semibold text-white">Clear list data</p>
                    <p className="mt-2 text-sm leading-6 text-white/70">
                      Choose exactly which local list to clear. Your Seenary account remains active.
                    </p>
                  </div>

                  <div
                    className={`rounded-2xl border p-4 ${
                      !syncStatus.linked
                        ? "border-white/10 bg-black/20"
                        : syncStatus.autoSyncEnabled
                          ? "border-rose-300/25 bg-rose-500/10"
                          : "border-amber-300/25 bg-amber-300/10"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">Provider deletion timing</p>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                          !syncStatus.linked
                            ? "border-white/10 bg-white/5 text-white/55"
                            : syncStatus.autoSyncEnabled
                              ? "border-rose-300/25 bg-rose-400/15 text-rose-100"
                              : "border-amber-300/25 bg-amber-300/15 text-amber-100"
                        }`}
                      >
                      {syncStatus.loading
                        ? "Checking auto sync"
                        : !syncStatus.linked
                          ? "Auto sync unavailable"
                          : syncStatus.autoSyncEnabled
                            ? "Auto sync on"
                            : "Auto sync off"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-white/65">
                      {syncStatus.loading
                        ? "Checking linked-service and automatic-sync status before list clearing is enabled."
                        : !syncStatus.linked
                          ? "No external list is linked, so clearing affects Seenary only."
                        : syncStatus.autoSyncEnabled
                          ? `Automatic sync is on. If you choose provider deletion in the approval step, queued deletions are sent to ${manualSyncTargetsLabel} automatically.`
                          : `Automatic sync is off. If you choose provider deletion, the jobs wait until you use Sync now or enable automatic sync again.`}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {([
                      ["anime", "Clear Anime list"],
                      ["manga", "Clear Manga list"],
                      ["all", "Clear all media"],
                    ] as const).map(([target, label]) => (
                      <button
                        key={target}
                        type="button"
                        disabled={isClearingList || syncStatus.loading}
                        onClick={() => {
                          setClearFeedback(null);
                          setQueueProviderDeletion(false);
                          setClearTarget(target);
                        }}
                        className={`rounded-2xl border px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-white/55 ${
                          isClearingList || syncStatus.loading
                            ? "cursor-not-allowed border-white/5 bg-white/[0.03] text-white/35"
                            : target === "all"
                              ? "border-rose-300/30 bg-rose-500/25 text-rose-50 hover:bg-rose-500/35"
                              : "border-rose-400/20 bg-rose-500/15 text-rose-100 hover:bg-rose-500/20"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {clearFeedback && (
                    <div
                      className={`rounded-2xl border p-4 ${
                        clearFeedback.kind === "success"
                          ? "border-emerald-400/20 bg-emerald-400/10"
                          : "border-rose-400/20 bg-rose-400/10"
                      }`}
                    >
                      <p className="text-sm font-semibold text-white">{clearFeedback.message}</p>
                    </div>
                  )}

                  <div className="border-t border-rose-300/15 pt-5">
                    <p className="font-semibold text-white">Delete account</p>
                    <p className="mt-2 text-sm leading-6 text-white/70">
                      Permanently removes this Seenary profile, its cloud Anime and Manga library,
                      sync history, linked-service credentials, sessions, and account settings. Your AniList
                      and MyAnimeList accounts and their lists are not deleted. General preferences for this
                      installation remain available for another account and can be reset separately.
                    </p>

                    {!isDeleteAccountArmed ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteAccountFeedback(null);
                          setDeleteAccountConfirmation("");
                          setDeleteAccountPassword("");
                          setIsDeleteAccountArmed(true);
                        }}
                        className="mt-4 rounded-2xl border border-rose-300/30 bg-rose-600/30 px-4 py-2.5 text-sm font-semibold text-rose-50 transition hover:bg-rose-600/40"
                      >
                        Delete my account
                      </button>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-rose-300/25 bg-black/25 p-4">
                        <label className="block text-sm font-semibold text-rose-50" htmlFor="delete-account-confirmation">
                          Type <span className="select-all text-white">{username}</span> to confirm
                        </label>
                        <input
                          id="delete-account-confirmation"
                          value={deleteAccountConfirmation}
                          disabled={isDeletingAccount}
                          onChange={(event) => setDeleteAccountConfirmation(event.target.value)}
                          autoComplete="off"
                          spellCheck={false}
                          className="mt-3 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-rose-300/45 focus:ring-2 focus:ring-rose-300/15"
                          placeholder={username}
                        />
                        <label className="mt-4 block text-sm font-semibold text-rose-50" htmlFor="delete-account-password">
                          Confirm your Seenary password
                        </label>
                        <input
                          id="delete-account-password"
                          type="password"
                          value={deleteAccountPassword}
                          disabled={isDeletingAccount}
                          onChange={(event) => setDeleteAccountPassword(event.target.value)}
                          autoComplete="current-password"
                          className="mt-3 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-rose-300/45 focus:ring-2 focus:ring-rose-300/15"
                          placeholder="Seenary password"
                        />
                        <div className="mt-4 flex flex-wrap gap-3">
                          <button
                            type="button"
                            disabled={isDeletingAccount || deleteAccountConfirmation !== username || !deleteAccountPassword}
                            onClick={async () => {
                              setIsDeletingAccount(true);
                              setDeleteAccountFeedback(null);
                              try {
                                const result = await onDeleteAccount(deleteAccountConfirmation, deleteAccountPassword);
                                if (!result.ok) setDeleteAccountFeedback(result.message);
                              } catch (error) {
                                setDeleteAccountFeedback(
                                  error instanceof Error
                                    ? error.message
                                    : "Seenary could not delete the account."
                                );
                              } finally {
                                setIsDeletingAccount(false);
                              }
                            }}
                            className="rounded-2xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-35"
                          >
                            {isDeletingAccount ? "Deleting account..." : "Delete account permanently"}
                          </button>
                          <button
                            type="button"
                            disabled={isDeletingAccount}
                            onClick={() => {
                              setIsDeleteAccountArmed(false);
                              setDeleteAccountConfirmation("");
                              setDeleteAccountPassword("");
                              setDeleteAccountFeedback(null);
                            }}
                            className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white/70 transition hover:bg-white/8 hover:text-white"
                          >
                            Cancel
                          </button>
                        </div>
                        {deleteAccountFeedback && (
                          <p className="mt-3 text-sm font-medium text-rose-200">{deleteAccountFeedback}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            </AccordionSection>
          </div>
        </div>
      </div>

      <ModalShell
        open={isCacheRepairConfirmOpen}
        onClose={() => !isRepairingCache && setIsCacheRepairConfirmOpen(false)}
        ariaLabel="Confirm cached data repair"
        panelClassName="max-w-lg p-6"
        closeOnBackdrop={!isRepairingCache}
        showCloseButton
      >
        <div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--app-accent)]/25 bg-[var(--app-accent-soft)] text-white">
            <ArrowPathIcon className={`h-6 w-6 ${isRepairingCache ? "animate-spin" : ""}`} />
          </div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.26em] text-white/40">
            Safe maintenance
          </p>
          <h2 className="mt-2 text-2xl font-bold text-white">Repair cached data?</h2>
          <p className="mt-3 text-sm leading-6 text-white/60">
            Seenary will remove only data it can download or rebuild. Your account, linked-service
            authorization, lists, preferences, sync queue, and activity history will be preserved.
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              disabled={isRepairingCache}
              onClick={() => setIsCacheRepairConfirmOpen(false)}
              className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white/70 transition hover:bg-white/8 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isRepairingCache}
              onClick={() => void repairCachedData()}
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:opacity-90 disabled:cursor-wait disabled:opacity-50"
            >
              {isRepairingCache && <ArrowPathIcon className="h-4 w-4 animate-spin" />}
              {isRepairingCache ? "Repairing..." : "Repair cache"}
            </button>
          </div>
        </div>
      </ModalShell>

      <ModalShell
        open={Boolean(clearTarget)}
        onClose={() => {
          if (!isClearingList) {
            setClearTarget(null);
            setQueueProviderDeletion(false);
          }
        }}
        ariaLabel="Confirm permanent list clearing"
        panelClassName="max-w-[clamp(32rem,60vw,56rem)] p-6"
        closeOnBackdrop={!isClearingList}
        showCloseButton
      >
        {clearTarget && (
          <div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-300/25 bg-rose-500/15 text-rose-100">
              <TrashIcon className="h-6 w-6" />
            </div>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.26em] text-rose-200/70">
              Permanent action
            </p>
            <h2 className="mt-2 text-2xl font-bold text-white">
              Clear {clearTarget === "anime"
                ? "every Anime entry"
                : clearTarget === "manga"
                  ? "every Manga entry"
                  : "all Anime and Manga entries"}?
            </h2>
            <p className="mt-3 text-sm leading-6 text-white/60">
              This removes the selected list data from Seenary. It cannot be undone unless you have
              a backup that contains these entries.
            </p>

            {syncStatus.linked && (
              <div className="mt-5">
                <p className="text-sm font-semibold text-white">Where should deletion apply?</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={isClearingList}
                    aria-pressed={!queueProviderDeletion}
                    onClick={() => setQueueProviderDeletion(false)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      !queueProviderDeletion
                        ? "border-[var(--app-accent)]/45 bg-[var(--app-accent-soft)]"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                    } disabled:opacity-50`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-white">Seenary only</span>
                      {!queueProviderDeletion && (
                        <span className="rounded-full bg-[var(--app-accent)] p-1 text-black">
                          <CheckIcon className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </span>
                    <span className="mt-2 block text-xs leading-5 text-white/55">
                      Remove local entries without creating provider-deletion jobs.
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={isClearingList}
                    aria-pressed={queueProviderDeletion}
                    onClick={() => setQueueProviderDeletion(true)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      queueProviderDeletion
                        ? "border-rose-300/35 bg-rose-500/12"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                    } disabled:opacity-50`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-white">
                        Seenary + {manualSyncTargetsLabel}
                      </span>
                      {queueProviderDeletion && (
                        <span className="rounded-full bg-rose-400 p-1 text-black">
                          <CheckIcon className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </span>
                    <span className="mt-2 block text-xs leading-5 text-white/55">
                      Remove local entries and queue matching deletions for the linked provider.
                    </span>
                  </button>
                </div>
              </div>
            )}

            <div
              className={`mt-5 rounded-2xl border p-4 ${
                !syncStatus.linked
                  ? "border-white/10 bg-white/[0.03]"
                  : syncStatus.autoSyncEnabled
                    ? "border-rose-300/25 bg-rose-500/10"
                    : "border-amber-300/25 bg-amber-300/10"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-white">Automatic sync</p>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                    !syncStatus.linked
                      ? "border-white/10 bg-white/5 text-white/55"
                      : syncStatus.autoSyncEnabled
                        ? "border-rose-300/25 bg-rose-400/15 text-rose-100"
                        : "border-amber-300/25 bg-amber-300/15 text-amber-100"
                  }`}
                >
                  {!syncStatus.linked
                    ? "Unavailable"
                    : syncStatus.autoSyncEnabled
                      ? "On"
                      : "Off"}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-white/65">
                {!syncStatus.linked
                  ? "No external service is linked. This action affects Seenary only."
                  : !queueProviderDeletion
                    ? "You selected Seenary only. No provider-deletion jobs will be created, regardless of the automatic-sync setting."
                  : syncStatus.autoSyncEnabled
                    ? `Deletion jobs will be queued and automatically sent to ${manualSyncTargetsLabel}. Matching entries can be removed from that linked list too.`
                    : `Deletion jobs will still be queued for ${manualSyncTargetsLabel}. They can remove matching remote entries later if you use Sync now or turn automatic sync back on.`}
              </p>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={isClearingList}
                onClick={() => {
                  setClearTarget(null);
                  setQueueProviderDeletion(false);
                }}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white/70 transition hover:bg-white/8 hover:text-white disabled:opacity-50"
              >
                Keep my list
              </button>
              <button
                type="button"
                disabled={isClearingList}
                onClick={confirmClearLists}
                className="rounded-2xl border border-rose-300/25 bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-wait disabled:opacity-50"
              >
                {isClearingList
                  ? "Clearing..."
                  : queueProviderDeletion && syncStatus.linked
                    ? "Clear and queue provider deletions"
                    : "Clear from Seenary"}
              </button>
            </div>
          </div>
        )}
      </ModalShell>

      {isImportModalOpen && (
      <ImportSelectionModal
        provider={importProvider}
        username={importPreviewUsername.trim()}
        preview={importPreview}
        previewError={previewError}
        isPreviewLoading={isPreviewLoading}
        isImporting={isImporting}
        selectedKeys={selectedImportKeys}
        openGroups={openImportGroups}
        titleLanguage={settings.titleLanguage}
        fileMediaType={importProvider === "pdf" ? pdfImportMediaType : textImportMediaType}
        onClose={() => setIsImportModalOpen(false)}
        onToggleGroup={(status) =>
          setOpenImportGroups((current) => ({ ...current, [status]: !current[status] }))
        }
        onToggleItem={(itemKey) =>
          setSelectedImportKeys((current) =>
            current.includes(itemKey)
              ? current.filter((value) => value !== itemKey)
              : [...current, itemKey]
          )
        }
        onSelectAll={() =>
          setSelectedImportKeys(
            importPreview?.groups.flatMap((group) => group.items.map(getImportItemKey)) ?? []
          )
        }
        onDeselectAll={() => setSelectedImportKeys([])}
        onSelectGroup={(groupKey) =>
          setSelectedImportKeys((current) => {
            const ids =
              importPreview?.groups.find((group) => getImportGroupKey(group) === groupKey)?.items.map(getImportItemKey) ??
              [];
            return Array.from(new Set([...current, ...ids]));
          })
        }
        onDeselectGroup={(groupKey) =>
          setSelectedImportKeys((current) => {
            const ids = new Set(
              importPreview?.groups.find((group) => getImportGroupKey(group) === groupKey)?.items.map(getImportItemKey) ?? []
            );
            return current.filter((itemKey) => !ids.has(itemKey));
          })
        }
        onConfirm={async () => {
          const controller = new AbortController();
          const feedbackProvider = importProvider;
          activeImportAbortRef.current = controller;

          try {
            setIsImporting(true);
            const result =
              feedbackProvider === "txt" || feedbackProvider === "pdf"
                ? await onImportTextList(
                    importPreview?.groups.flatMap((group) => group.items) ?? [],
                    selectedImportKeys,
                    { signal: controller.signal }
                  )
                : feedbackProvider === "mal"
                  ? await onImportMal(
                      malImportUsername.trim(),
                      selectedImportStatuses,
                      selectedImportKeys,
                      { signal: controller.signal }
                    )
                  : await onImportAniList(
                    importUsername.trim(),
                    selectedImportStatuses,
                    selectedImportKeys,
                    { signal: controller.signal }
                  );

            if (result.cancelled) {
              setImportFeedback({
                provider: feedbackProvider,
                kind: "warning",
                message: result.message,
                summary: result.summary,
              });
              return;
            }

            setImportFeedback({
              provider: feedbackProvider,
              kind: result.ok ? "success" : "error",
              message: result.message,
              summary: result.summary,
            });

            if (result.ok) {
              setIsImportModalOpen(false);
            }
          } catch (error) {
            console.error("Failed to import selected anime:", error);
            setImportFeedback({
              provider: feedbackProvider,
              kind: "error",
              message: getErrorMessage(error, "Import failed. Try again in a moment."),
            });
          } finally {
            setIsImporting(false);
            if (activeImportAbortRef.current === controller) {
              activeImportAbortRef.current = null;
            }
          }
        }}
        onCancelImport={() => {
          resetActiveImportAttempt();
          setIsImportModalOpen(false);
        }}
      />
      )}

      <ProviderUnlinkModal
        provider={unlinkProvider}
        localCredentialsConfirmed={localCredentialsConfirmed}
        password={unlinkPassword}
        passwordConfirmation={unlinkPasswordConfirmation}
        settingPassword={isSettingUnlinkPassword}
        busy={isUnlinking}
        feedback={unlinkFeedback}
        onPasswordChange={setUnlinkPassword}
        onPasswordConfirmationChange={setUnlinkPasswordConfirmation}
        onSettingPasswordChange={(value) => {
          setIsSettingUnlinkPassword(value);
          setUnlinkPassword("");
          setUnlinkPasswordConfirmation("");
          setUnlinkFeedback(null);
        }}
        onClose={closeUnlinkModal}
        onConfirm={unlinkExternalAccount}
      />

      <ModalShell
        open={Boolean(backupPreview)}
        onClose={() => !isImportingBackup && setBackupPreview(null)}
        ariaLabel="Preview backup import"
        panelClassName="max-w-xl p-6"
        closeOnBackdrop={!isImportingBackup}
        showCloseButton
      >
        {backupPreview && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/35">
              Portable backup
            </p>
            <h2 className="mt-3 text-2xl font-bold text-white">Review before importing</h2>
            <p className="mt-2 text-sm leading-6 text-white/55">
              {backupPreview.inspection.message}
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ImportStat label="Version" value={`v${backupPreview.inspection.version}`} />
              <ImportStat label="Anime" value={backupPreview.inspection.animeEntries} />
              <ImportStat label="Manga" value={backupPreview.inspection.mangaEntries} />
              <ImportStat
                label="Preferences"
                value={backupPreview.inspection.hasPortablePreferences ? "Included" : "None"}
              />
            </div>

            {(backupPreview.inspection.username || backupPreview.inspection.exportedAt) && (
              <p className="mt-4 text-xs text-white/40">
                {backupPreview.inspection.username
                  ? `Exported for ${backupPreview.inspection.username}`
                  : "Seenary backup"}
                {backupPreview.inspection.exportedAt
                  ? ` · ${formatDateTime(backupPreview.inspection.exportedAt)}`
                  : ""}
              </p>
            )}

            <div className="mt-5 space-y-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <input
                  type="checkbox"
                  checked={backupPreview.restoreLibrary}
                  onChange={(event) =>
                    setBackupPreview((current) =>
                      current ? { ...current, restoreLibrary: event.target.checked } : current
                    )
                  }
                  className="mt-0.5 h-4 w-4 accent-[var(--app-accent)]"
                />
                <span>
                  <span className="block text-sm font-semibold text-white">Library data</span>
                  <span className="mt-1 block text-xs text-white/50">
                    Merge Anime, Manga, list progress, notes, and sync recovery state.
                  </span>
                </span>
              </label>

              {backupPreview.inspection.hasPortablePreferences && (
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <input
                    type="checkbox"
                    checked={backupPreview.restorePreferences}
                    onChange={(event) =>
                      setBackupPreview((current) =>
                        current
                          ? {
                              ...current,
                              restorePreferences: event.target.checked,
                              restoreDesktopPreferences: event.target.checked
                                ? current.restoreDesktopPreferences
                                : false,
                            }
                          : current
                      )
                    }
                    className="mt-0.5 h-4 w-4 accent-[var(--app-accent)]"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-white">
                      Preferences and layouts
                    </span>
                    <span className="mt-1 block text-xs text-white/50">
                      Restore appearance, content, navigation, My List, and layout choices.
                    </span>
                  </span>
                </label>
              )}
            </div>

            {backupPreview.inspection.hasDesktopPreferences &&
              (window.desktopShortcuts || window.desktopWindow || window.desktopStartup) && (
              <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <input
                  type="checkbox"
                  checked={backupPreview.restoreDesktopPreferences}
                  disabled={!backupPreview.restorePreferences}
                  onChange={(event) =>
                    setBackupPreview((current) =>
                      current
                        ? { ...current, restoreDesktopPreferences: event.target.checked }
                        : current
                    )
                  }
                  className="mt-0.5 h-4 w-4 accent-[var(--app-accent)]"
                />
                <span>
                  <span className="block text-sm font-semibold text-white">
                    Restore device preferences
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-white/50">
                    Applies the desktop shortcut, window size preset, and launch-at-login choice.
                    Window position and account credentials are never imported.
                  </span>
                </span>
              </label>
            )}

            {backupPreview.inspection.hasDesktopPreferences &&
              !window.desktopShortcuts &&
              !window.desktopWindow &&
              !window.desktopStartup && (
                <p className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-white/50">
                  This backup contains desktop-device preferences. They will remain untouched because
                  this Seenary session is running in a web browser.
                </p>
              )}

            <p className="mt-5 rounded-2xl border border-cyan-300/15 bg-cyan-300/8 p-3 text-xs leading-5 text-cyan-50/75">
              Library entries are merged safely. Portable preferences and layouts included in the
              backup replace their matching local preferences.
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={isImportingBackup}
                onClick={() => setBackupPreview(null)}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white/70 transition hover:bg-white/8 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  isImportingBackup ||
                  (!backupPreview.restoreLibrary && !backupPreview.restorePreferences)
                }
                onClick={confirmBackupImport}
                className="rounded-2xl bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:opacity-90 disabled:cursor-wait disabled:opacity-50"
              >
                {isImportingBackup ? "Importing..." : "Import backup"}
              </button>
            </div>
          </div>
        )}
      </ModalShell>

      <SyncActivityModal
        isOpen={isSyncActivityOpen}
        activeTab={syncActivityTab}
        activity={syncActivity}
        titleLanguage={settings.titleLanguage}
        onClose={() => setIsSyncActivityOpen(false)}
        onChangeTab={(tab) => {
          setSyncActivityTab(tab);
          loadSyncActivity(tab);
        }}
        restoringId={restoringSyncExclusionId}
        onRestore={restoreSyncExclusion}
        excludingId={excludingSyncEntryId}
        onExclude={excludeSyncEntry}
        actionFeedback={syncActivityActionFeedback}
      />
    </div>
  );
}

function AccordionSection({
  icon: Icon,
  title,
  scope,
  description,
  summary,
  open,
  onToggle,
  children,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  scope: string;
  description: string;
  summary: string[];
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] shadow-xl">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition hover:bg-white/[0.03] focus:outline-none focus:ring-2 focus:ring-[var(--app-accent)]/55"
      >
        <div className="flex min-w-0 items-start gap-4">
          <div className={`rounded-2xl border p-3 transition ${
            open
              ? "border-[var(--app-accent)]/30 bg-[var(--app-accent-soft)] text-white/80"
              : "border-white/10 bg-white/5 text-white/70"
          }`}>
            <Icon className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-white">{title}</h2>
              <span className="rounded-full border border-cyan-200/15 bg-cyan-200/8 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-50/65">
                {scope}
              </span>
              {summary.map((item) => (
                <span
                  key={`${title}-${item}`}
                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/50"
                >
                  {item}
                </span>
              ))}
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/40">
              {description}
            </p>
          </div>
        </div>

        <span
          className={`rounded-2xl border border-white/10 bg-white/5 p-2 text-white/55 transition-transform duration-300 ${
            open ? "rotate-180 border-[var(--app-accent)]/25 bg-[var(--app-accent-soft)] text-white/80" : ""
          }`}
        >
          <ChevronDownIcon className="h-5 w-5" />
        </span>
      </button>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0.7 }}
      >
        <div className="overflow-hidden">
          <div
            className={`border-t border-white/10 px-6 pb-6 pt-5 transition duration-300 ${
              open ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
            }`}
          >
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

function ScopeBadge({ label, description }: { label: string; description: string }) {
  return (
    <span title={description} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 normal-case tracking-normal text-white/60">
      <strong className="text-white/80">{label}:</strong> {description}
    </span>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <div className="rounded-2xl border border-[var(--app-accent)]/20 bg-[var(--app-accent-soft)] p-2.5 text-white/80">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="text-sm text-white/40">{description}</p>
      </div>
    </div>
  );
}

function ToggleSetting({
  icon: Icon,
  title,
  description,
  checked,
  disabled = false,
  onChange,
  centerIcon = false,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void | Promise<void>;
  centerIcon?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-4 rounded-3xl border p-5 text-left transition focus:outline-none focus:ring-2 focus:ring-[var(--app-accent)]/55 ${
        disabled
          ? "cursor-not-allowed border-white/5 bg-white/[0.02] opacity-45"
          : checked
          ? "border-[var(--app-accent)]/35 bg-[var(--app-accent-soft)] hover:bg-[var(--app-accent-soft)]"
          : "border-white/10 bg-white/[0.03] hover:bg-white/8"
      }`}
    >
      <div className={`flex min-w-0 gap-3 ${centerIcon ? "items-center" : "items-start"}`}>
        <div className={`rounded-2xl border p-2 ${
          checked
            ? "border-[var(--app-accent)]/25 bg-[var(--app-accent-soft)] text-white/80"
            : "border-white/10 bg-white/5 text-white/65"
        }`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-white">{title}</p>
          <p className="mt-1 text-sm leading-6 text-white/45">{description}</p>
        </div>
      </div>

      <span
        className={`relative h-7 w-12 shrink-0 rounded-full border transition ${
          checked
            ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)]"
            : "border-white/10 bg-white/8"
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full transition ${
            checked ? "left-6 bg-[var(--app-accent)]" : "left-1 bg-white/45"
          }`}
        />
      </span>
    </button>
  );
}

function ActionCard({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void | Promise<void>;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <div className="w-fit rounded-2xl border border-white/10 bg-white/5 p-2 text-white/65">
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-4 font-semibold text-white">{title}</p>
      <p className="mt-2 text-sm leading-6 text-white/45">{description}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-5 rounded-2xl border border-white/10 bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-white/55"
      >
        {actionLabel}
      </button>
    </div>
  );
}

function formatDesktopPlatform(platform: string) {
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  if (platform === "darwin") return "macOS";
  return platform || "Unknown";
}

function formatArchitecture(architecture: string) {
  if (architecture === "x64") return "x64";
  if (architecture === "ia32") return "x32";
  if (architecture === "arm64") return "ARM64";
  if (architecture === "arm") return "ARM32";
  return architecture || "Unknown";
}

function formatDisplayBackend(
  displayBackend: DesktopEnvironmentState["displayBackend"]
) {
  if (displayBackend === "wayland") return "Wayland (native)";
  if (displayBackend === "x11") return "X11 / Xwayland";
  return "Unknown";
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/35">
        {label}
      </p>
      <p className="mt-3 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function ImportStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/15 px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.22em] text-white/35">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function ImportFeedbackPanel({ feedback }: { feedback: ImportFeedback }) {
  return (
    <div
      className={`mt-5 rounded-3xl border p-4 ${
        feedback.kind === "success"
          ? "border-emerald-400/20 bg-emerald-400/10"
          : feedback.kind === "warning"
            ? "border-amber-300/20 bg-amber-300/10"
          : "border-rose-400/20 bg-rose-400/10"
      }`}
    >
      <p className="text-sm font-semibold text-white">
        {feedback.message}
      </p>

      {feedback.summary && (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <ImportStat label="Found" value={feedback.summary.totalFound} />
          <ImportStat label="Imported" value={feedback.summary.imported} />
          <ImportStat label="Created" value={feedback.summary.created} />
          <ImportStat label="Updated" value={feedback.summary.updated} />
          <ImportStat label="Skipped" value={feedback.summary.skipped} />
        </div>
      )}
    </div>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function LinkStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/15 px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.22em] text-white/35">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function ProviderUnlinkModal({
  provider,
  localCredentialsConfirmed,
  password,
  passwordConfirmation,
  settingPassword,
  busy,
  feedback,
  onPasswordChange,
  onPasswordConfirmationChange,
  onSettingPasswordChange,
  onClose,
  onConfirm,
}: {
  provider: "anilist" | "mal" | null;
  localCredentialsConfirmed: boolean | null;
  password: string;
  passwordConfirmation: string;
  settingPassword: boolean;
  busy: boolean;
  feedback: string | null;
  onPasswordChange: (value: string) => void;
  onPasswordConfirmationChange: (value: string) => void;
  onSettingPasswordChange: (value: boolean) => void;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  if (!provider) return null;

  const providerName = provider === "mal" ? "MyAnimeList" : "AniList";
  const mustCreatePassword = localCredentialsConfirmed === false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6 py-10">
      <button
        type="button"
        aria-label="Close unlink account dialog"
        onClick={onClose}
        className="absolute inset-0 bg-black/82"
      />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onConfirm();
        }}
        className="relative z-10 w-full max-w-lg rounded-3xl border border-white/10 bg-[#111111]/95 p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-white/35">Sign-in methods</p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-white">
              Unlink {providerName}?
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-white/60 transition hover:bg-white/8 hover:text-white disabled:opacity-50"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-5 text-sm leading-6 text-white/55">
          Your Seenary library and activity stay here. Future sync with {providerName} stops, and
          queued changes for it are removed.
        </p>

        <label className="mt-5 block">
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-white/40">
            {settingPassword ? "New local password" : "Local password"}
          </span>
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            autoComplete={settingPassword ? "new-password" : "current-password"}
            placeholder={settingPassword ? "At least 8 characters" : "Confirm it is you"}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[var(--app-accent)]/60 focus:ring-2 focus:ring-[var(--app-accent)]/20"
          />
        </label>

        {settingPassword && (
          <label className="mt-4 block">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-white/40">
              Confirm new password
            </span>
            <input
              type="password"
              value={passwordConfirmation}
              onChange={(event) => onPasswordConfirmationChange(event.target.value)}
              autoComplete="new-password"
              placeholder="Enter it again"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[var(--app-accent)]/60 focus:ring-2 focus:ring-[var(--app-accent)]/20"
            />
          </label>
        )}

        {localCredentialsConfirmed === null && (
          <button
            type="button"
            onClick={() => onSettingPasswordChange(!settingPassword)}
            disabled={busy}
            className="mt-4 text-left text-sm font-semibold text-[var(--app-accent)] transition hover:opacity-80 disabled:opacity-50"
          >
            {settingPassword ? "Use my existing local password" : "I never set one — create or replace it"}
          </button>
        )}

        {mustCreatePassword && (
          <p className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/8 p-3 text-sm leading-6 text-amber-100/75">
            This profile currently relies on external sign-in. Create a local password so you can
            still access it after unlinking.
          </p>
        )}

        {feedback && (
          <p className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-3 text-sm font-semibold text-rose-100">
            {feedback}
          </p>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white/70 transition hover:bg-white/8 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !password || (settingPassword && !passwordConfirmation)}
            className="rounded-2xl border border-rose-200/20 bg-rose-300 px-4 py-2.5 text-sm font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy
              ? "Unlinking..."
              : settingPassword
                ? "Set password and unlink"
                : `Unlink ${providerName}`}
          </button>
        </div>
      </form>
    </div>
  );
}

function SyncActivityModal({
  isOpen,
  activeTab,
  activity,
  titleLanguage,
  onClose,
  onChangeTab,
  restoringId,
  onRestore,
  excludingId,
  onExclude,
  actionFeedback,
}: {
  isOpen: boolean;
  activeTab: SyncActivityTab;
  activity: {
    loading: boolean;
    pending: SyncActivityItem[];
    completed: SyncActivityItem[];
    failed: SyncActivityItem[];
    pulled: SyncActivityItem[];
    excluded: SyncActivityItem[];
  };
  titleLanguage: TitleLanguage;
  onClose: () => void;
  onChangeTab: (tab: SyncActivityTab) => void;
  restoringId: number | string | null;
  onRestore: (item: SyncActivityItem) => void;
  excludingId: number | string | null;
  onExclude: (item: SyncActivityItem) => void;
  actionFeedback: { kind: "success" | "error"; message: string } | null;
}) {
  if (!isOpen) return null;

  const items = activity[activeTab];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6 py-10">
      <button
        type="button"
        aria-label="Close sync activity overlay"
        onClick={onClose}
        className="absolute inset-0 bg-black/82"
      />

      <div className="relative z-10 flex h-[min(82vh,760px)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#111111]/95 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-white/35">
              Third-party sync
            </p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-white">
              Sync activity
            </h2>
            <p className="mt-2 text-sm leading-6 text-white/50">
              Review queued changes, successful syncs, failed attempts, exclusions, and pulled updates.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-white/60 transition hover:bg-white/8 hover:text-white"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-white/10 px-6 py-3">
          <div className="flex flex-wrap gap-2">
            {(["pending", "completed", "failed", "excluded", "pulled"] as SyncActivityTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => onChangeTab(tab)}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold capitalize transition ${
                  activeTab === tab
                    ? "bg-white text-black"
                    : "border border-white/10 bg-white/[0.04] text-white/65 hover:bg-white/8 hover:text-white"
                }`}
              >
                {getSyncActivityTabLabel(tab)} ({activity[tab].length})
              </button>
            ))}
          </div>
          {actionFeedback && (
            <p
              className={`mt-3 rounded-2xl border px-3 py-2 text-sm font-semibold ${
                actionFeedback.kind === "success"
                  ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
                  : "border-rose-300/20 bg-rose-300/10 text-rose-100"
              }`}
            >
              {actionFeedback.message}
            </p>
          )}
        </div>

        <div className="scroll-container min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {activity.loading ? (
            <div className="flex h-full items-center justify-center text-white/60">
              Loading sync activity...
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-white/45">
              {activeTab === "pulled" ? "No pulled updates yet." : `No ${activeTab} sync items.`}
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div
                  key={`${activeTab}-${item.id}`}
                  className="rounded-3xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">
                        {getSyncActivityTitle(item, titleLanguage)}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-white/70">
                          {formatOperation(item.operation)}
                        </span>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getOperationAccent(item.operation)}`}>
                          {formatOperationProvider(item.operation)}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-white/55">
                        {formatDateTime(item.updated_at || item.created_at || "")}
                      </p>
                      {activeTab === "pending" && item.next_attempt_at && (
                        <p className="mt-1 text-xs text-amber-200/70">
                          Retry {formatDateTime(item.next_attempt_at)}
                        </p>
                      )}
                      {activeTab === "pending" && Number(item.attempts || 0) > 0 && (
                        <p className="mt-1 text-xs font-semibold text-rose-200/75">
                          Failed attempts: {item.attempts} / 5
                        </p>
                      )}
                      {activeTab === "excluded" && (
                        <>
                          <p className="mt-1 text-xs font-semibold text-amber-100/80">
                            {item.excluded_by === "user"
                              ? "Excluded by user"
                              : "Excluded automatically"}
                          </p>
                          <p className="mt-1 text-xs text-amber-200/70">
                            {item.attempts ?? 5} failed attempt{item.attempts === 1 ? "" : "s"}
                          </p>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {(item.changedFields || []).map((change) => (
                      <span
                        key={`${item.id}-${change.field}`}
                        className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white/70"
                      >
                        {formatFieldName(change.field)}: {formatValue(change.from)} {"->"}{" "}
                        {formatValue(change.to)}
                      </span>
                    ))}
                  </div>

                  {(item.message || item.last_error) && (() => {
                    const isFailure = item.status === "failed" || Boolean(item.last_error);
                    const isPartial = item.status === "partial";
                    const isPull = item.operation.startsWith("pull_");
                    return (
                    <div
                      className={`mt-4 rounded-2xl border px-3 py-2 text-sm ${
                        isFailure
                          ? "border-rose-400/20 bg-rose-400/10 text-rose-100"
                          : isPartial
                            ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
                          : "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                      }`}
                    >
                      <p className="font-semibold">
                        {isFailure
                          ? isPull
                            ? "Pull failed"
                            : "Sync failed"
                          : isPartial
                            ? "Pull partially completed"
                            : isPull
                              ? "Pull completed"
                              : "Sync completed"}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-white/75">
                        {formatSyncActivityMessage(item.message || item.last_error)}
                      </p>
                    </div>
                    );
                  })()}

                  {activeTab === "excluded" && (
                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        onClick={() => onRestore(item)}
                        disabled={restoringId === item.id}
                        className="rounded-2xl border border-white/10 bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/85 disabled:cursor-wait disabled:opacity-50"
                      >
                        {restoringId === item.id ? "Restoring..." : "Restore sync"}
                      </button>
                    </div>
                  )}

                  {activeTab === "pending" && Number(item.attempts || 0) > 0 && (
                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        onClick={() => onExclude(item)}
                        disabled={excludingId === item.id}
                        className="rounded-2xl border border-amber-200/20 bg-amber-200/10 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-200/20 disabled:cursor-wait disabled:opacity-50"
                      >
                        {excludingId === item.id ? "Excluding..." : "Exclude from sync"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FileImportMediaSelector({
  value,
  onChange,
  label,
}: {
  value: FileImportMediaType;
  onChange: (value: FileImportMediaType) => void;
  label: string;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/20 p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm font-semibold text-white/75">{label}</p>
      <div
        className="grid grid-cols-2 rounded-2xl border border-white/10 bg-black/25 p-1"
        role="radiogroup"
        aria-label={label}
      >
        {(["ANIME", "MANGA"] as FileImportMediaType[]).map((mediaType) => (
          <button
            key={mediaType}
            type="button"
            role="radio"
            aria-checked={value === mediaType}
            onClick={() => onChange(mediaType)}
            className={`min-w-24 rounded-xl px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-white/55 ${
              value === mediaType
                ? "bg-[var(--app-accent)] text-black"
                : "text-white/50 hover:bg-white/8 hover:text-white"
            }`}
          >
            {mediaType === "MANGA" ? "Manga" : "Anime"}
          </button>
        ))}
      </div>
    </div>
  );
}

function getImportModalCopy(
  provider: "anilist" | "mal" | "txt" | "pdf",
  username: string,
  preview: ImportPreviewResponse["preview"] | null,
  isPreviewLoading: boolean,
  fileMediaType: FileImportMediaType
) {
  const sourceName =
    username ||
    (provider === "txt"
      ? "your text file"
      : provider === "pdf"
        ? "your PDF"
      : provider === "mal"
        ? "your MyAnimeList account"
        : "your AniList account");

  if (provider === "txt" || provider === "pdf") {
    const mediaLabel = fileMediaType === "MANGA" ? "Manga" : "Anime";
    const unitLabel = fileMediaType === "MANGA" ? "chapters" : "episodes";
    const matchedCount =
      preview?.groups.reduce((sum, group) => sum + group.items.length, 0) ?? 0;
    const totalFound = preview?.totalFound ?? 0;
    const sourceType = provider === "pdf" ? "PDF" : "text file";

    return {
      title: isPreviewLoading ? `Matching ${mediaLabel} titles` : `Choose exact ${mediaLabel} to import`,
      description: isPreviewLoading
        ? `Reading ${sourceName} and matching extracted title lines exclusively to AniList ${mediaLabel} records.`
        : preview
          ? `${mediaLabel} import: matched ${matchedCount} of ${totalFound} line${totalFound === 1 ? "" : "s"} from ${sourceName}. Review every match before importing.`
          : `${mediaLabel} import. Review every match before importing.`,
      loadingTitle: `Matching titles from your ${sourceType}`,
      loadingDescription:
        `Seenary checks each extracted line against AniList ${mediaLabel} records so the preview can show covers, ${unitLabel}, and the exact ${mediaLabel} that will be imported. Larger ${sourceType}s can take a few minutes.`,
    };
  }

  if (provider === "mal") {
    return {
      title: isPreviewLoading ? "Matching Anime and Manga" : "Choose Anime and Manga to import",
      description: isPreviewLoading
        ? `Reading ${sourceName} and matching its public Anime and Manga entries to AniList records.`
        : `Previewing ${sourceName}. Anime and Manga are separated into clearly labeled groups; tick only the titles you want.`,
      loadingTitle: "Matching titles from your MyAnimeList account",
      loadingDescription:
        "Seenary matches the public MyAnimeList library against AniList so the preview can show covers and the exact Anime and Manga records that will be imported. Large libraries can take a while.",
    };
  }

  return {
    title: isPreviewLoading ? "Loading Anime and Manga" : "Choose Anime and Manga to import",
    description: isPreviewLoading
      ? `Reading ${sourceName} and preparing its public Anime and Manga lists.`
      : `Previewing ${sourceName}. Anime and Manga are separated into clearly labeled groups; tick only the titles you want.`,
    loadingTitle: "Loading titles from the AniList account",
    loadingDescription:
      "Seenary is reading both public AniList lists so the preview can show covers, episode, chapter, and volume progress for the exact titles that will be imported.",
  };
}

function formatElapsedSeconds(seconds: number) {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}m ${remainingSeconds}s`;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",").pop() || "" : result);
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function ImportSelectionModal({
  provider,
  username,
  preview,
  previewError,
  isPreviewLoading,
  isImporting,
  selectedKeys,
  openGroups,
  titleLanguage,
  fileMediaType,
  onClose,
  onToggleGroup,
  onToggleItem,
  onSelectAll,
  onDeselectAll,
  onSelectGroup,
  onDeselectGroup,
  onConfirm,
  onCancelImport,
}: {
  provider: "anilist" | "mal" | "txt" | "pdf";
  username: string;
  preview: ImportPreviewResponse["preview"] | null;
  previewError: string | null;
  isPreviewLoading: boolean;
  isImporting: boolean;
  selectedKeys: string[];
  openGroups: Record<string, boolean>;
  titleLanguage: TitleLanguage;
  fileMediaType: FileImportMediaType;
  onClose: () => void;
  onToggleGroup: (status: string) => void;
  onToggleItem: (itemKey: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onSelectGroup: (status: string) => void;
  onDeselectGroup: (status: string) => void;
  onConfirm: () => void | Promise<void>;
  onCancelImport: () => void;
}) {
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [isQuitImportConfirmOpen, setIsQuitImportConfirmOpen] = useState(false);
  const [visibleGroupItems, setVisibleGroupItems] = useState<Record<string, number>>({});
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  const requestClose = useCallback(() => {
    if (isImporting || isPreviewLoading) {
      setIsQuitImportConfirmOpen(true);
      return;
    }

    onClose();
  }, [isImporting, isPreviewLoading, onClose]);

  useEffect(() => {
    if (!isPreviewLoading) return;

    const startedAt = Date.now();
    const updateLoadingSeconds = () => {
      setLoadingSeconds(Math.floor((Date.now() - startedAt) / 1000));
    };
    const initialUpdateId = window.setTimeout(updateLoadingSeconds, 0);
    const intervalId = window.setInterval(() => {
      updateLoadingSeconds();
    }, 1000);

    return () => {
      window.clearTimeout(initialUpdateId);
      window.clearInterval(intervalId);
    };
  }, [isPreviewLoading]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;

      event.preventDefault();
      if (isQuitImportConfirmOpen) {
        setIsQuitImportConfirmOpen(false);
        return;
      }

      requestClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isQuitImportConfirmOpen, requestClose]);

  const guessedImportItems = useMemo(
    () => preview?.groups.flatMap((group) => group.items.filter((item) => item.guessed)) ?? [],
    [preview]
  );

  const copy = getImportModalCopy(provider, username, preview, isPreviewLoading, fileMediaType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6 py-10">
      <button
        type="button"
        aria-label="Close import overlay"
        onClick={requestClose}
        className="absolute inset-0 bg-black/82"
      />

      <div className="relative z-10 flex h-[min(86vh,880px)] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#111111]/95 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-white/35">
              {provider === "txt"
                ? "Text file import"
                : provider === "pdf"
                  ? "PDF import"
                : provider === "mal"
                  ? "MyAnimeList import"
                  : "AniList import"}
            </p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-white">
              {copy.title}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/50">
              {copy.description}
            </p>
          </div>

          <button
            type="button"
            onClick={requestClose}
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-white/60 transition hover:bg-white/8 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/55"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="scroll-container min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {isPreviewLoading ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center text-white/65">
              <ArrowPathIcon className="h-7 w-7 animate-spin text-white/35" />
              <p className="mt-5 text-sm font-semibold text-white/75">
                {copy.loadingTitle}
              </p>
              <p className="mt-2 max-w-md text-sm leading-6 text-white/42">
                {copy.loadingDescription}
              </p>
              <div className="mt-6 w-full max-w-sm overflow-hidden rounded-full bg-white/10">
                <div className="import-activity-bar h-2 w-1/3 rounded-full bg-[var(--app-accent)] shadow-[0_0_18px_var(--app-accent)]" />
              </div>
              <p className="mt-3 text-xs text-white/35">
                Still matching titles - {formatElapsedSeconds(loadingSeconds)} elapsed
              </p>
            </div>
          ) : previewError ? (
            <div className="rounded-3xl border border-rose-400/20 bg-rose-400/10 p-5 text-sm text-white/80">
              {previewError}
            </div>
          ) : !preview ? (
            <div className="rounded-3xl border border-amber-300/20 bg-amber-300/10 p-5 text-sm text-white/80">
              No import preview was returned. Try again in a moment, or try a shorter text file.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onSelectAll}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/75 transition hover:bg-white/8 hover:text-white"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={onDeselectAll}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/75 transition hover:bg-white/8 hover:text-white"
                >
                  Deselect all
                </button>
              </div>

              {(provider === "txt" || provider === "pdf") && preview.unmatched?.length ? (
                <div className="rounded-3xl border border-amber-300/20 bg-amber-300/10 p-4">
                  <p className="text-sm font-semibold text-white">
                    {preview.unmatched.length} line{preview.unmatched.length === 1 ? "" : "s"} skipped
                  </p>
                  <p className="mt-2 text-sm leading-6 text-white/65">
                    These lines could not be matched confidently. You can import the matched titles now and add the skipped ones manually later.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {preview.unmatched.slice(0, 12).map((line) => (
                      <span
                        key={line}
                        className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white/70"
                      >
                        {line}
                      </span>
                    ))}
                    {preview.unmatched.length > 12 && (
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white/45">
                        +{preview.unmatched.length - 12} more
                      </span>
                    )}
                  </div>
                </div>
              ) : null}

              {(provider === "txt" || provider === "pdf") && guessedImportItems.length ? (
                <div className="rounded-3xl border border-sky-300/20 bg-sky-300/10 p-4">
                  <p className="text-sm font-semibold text-white">
                    {guessedImportItems.length} guessed entr{guessedImportItems.length === 1 ? "y" : "ies"}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-white/65">
                    These messy lines were interpreted before matching. Review them before importing.
                  </p>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {guessedImportItems.slice(0, 8).map((item) => {
                      const title = getPreferredTitle(item.title, titleLanguage);
                      const fromTitle = item.guessedFrom || item.sourceTitle || "Unknown input";
                      const interpretedTitle = item.interpretedTitle || title;

                      return (
                        <div
                          key={`${item.animeId}-${fromTitle}`}
                          className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2"
                        >
                          <p className="line-clamp-1 text-xs text-white/45">{fromTitle}</p>
                          <p className="mt-1 line-clamp-1 text-sm font-semibold text-white">
                            {interpretedTitle}
                          </p>
                          {interpretedTitle !== title && (
                            <p className="mt-1 line-clamp-1 text-xs text-white/45">
                              Matched: {title}
                            </p>
                          )}
                        </div>
                      );
                    })}
                    {guessedImportItems.length > 8 && (
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/45">
                        +{guessedImportItems.length - 8} more guessed
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {preview.groups.map((group) => {
                const groupKey = getImportGroupKey(group);
                const isManga = group.mediaType === "MANGA";
                const groupSelectedCount = group.items.filter((item) =>
                  selectedKeySet.has(getImportItemKey(item))
                ).length;
                const isOpen = openGroups[groupKey] ?? false;
                const visibleCount = visibleGroupItems[groupKey] ?? 60;
                const visibleItems = group.items.slice(0, visibleCount);

                return (
                  <section
                    key={groupKey}
                    className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
                      <button
                        type="button"
                        onClick={() => onToggleGroup(groupKey)}
                        className="flex min-w-0 items-center gap-3 text-left"
                      >
                        <span
                          className={`rounded-2xl border border-white/10 bg-white/5 p-2 text-white/55 transition-transform ${
                            isOpen ? "rotate-180" : ""
                          }`}
                        >
                          <ChevronDownIcon className="h-5 w-5" />
                        </span>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold text-white">
                              {isManga ? "Manga · " : "Anime · "}
                              {(isManga ? MANGA_IMPORT_STATUS_LABELS : IMPORT_STATUS_LABELS)[group.status] ?? capitalize(group.status)}
                            </h3>
                            <span className="rounded-full bg-white/8 px-2.5 py-1 text-xs text-white/45">
                              {groupSelectedCount} / {group.items.length} selected
                            </span>
                          </div>
                        </div>
                      </button>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectGroup(groupKey)}
                          className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/75 transition hover:bg-white/8 hover:text-white"
                        >
                          Select group
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeselectGroup(groupKey)}
                          className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/75 transition hover:bg-white/8 hover:text-white"
                        >
                          Clear group
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <>
                      <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
                        {visibleItems.map((item) => {
                          const itemKey = getImportItemKey(item);
                          const itemIsManga = getImportItemMediaType(item) === "MANGA";
                          const selected = selectedKeySet.has(itemKey);
                          const title = getPreferredTitle(item.title, titleLanguage);

                          return (
                            <button
                              key={itemKey}
                              type="button"
                              onClick={() => onToggleItem(itemKey)}
                              className={`flex items-start gap-4 rounded-3xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-white/55 ${
                                selected
                                  ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)]"
                                  : "border-white/10 bg-white/[0.03] hover:bg-white/8"
                              }`}
                            >
                              <div className="h-24 w-16 shrink-0 overflow-hidden rounded-2xl bg-white/5">
                                {item.coverImage?.large ? (
                                  <img
                                    src={item.coverImage.large}
                                    alt={title}
                                    loading="lazy"
                                    decoding="async"
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="h-full w-full bg-white/5" />
                                )}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                <p className="line-clamp-2 text-sm font-semibold text-white">
                                  {title}
                                </p>
                                {(provider === "txt" || provider === "pdf") && item.sourceTitle && item.sourceTitle !== title && (
                                  <p className="mt-1 line-clamp-1 text-xs text-white/35">
                                    From: {item.sourceTitle}
                                  </p>
                                )}
                                <p className="mt-1 text-xs text-white/45">
                                  {[
                                        item.format,
                                        item.season && item.seasonYear
                                          ? `${capitalize(item.season)} ${item.seasonYear}`
                                          : item.seasonYear
                                          ? String(item.seasonYear)
                                          : null,
                                      ]
                                        .filter(Boolean)
                                        .join(" - ")}
                                    </p>
                                  </div>

                                  <span
                                    className={`rounded-full p-1 ${
                                      selected
                                        ? "bg-white text-black"
                                        : "bg-white/8 text-white/30"
                                    }`}
                                  >
                                    <CheckCircleIcon className="h-4 w-4" />
                                  </span>
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2">
                                  <span className="rounded-full bg-black/15 px-2.5 py-1 text-[11px] text-white/70">
                                    {itemIsManga ? "Chapters" : "Progress"} {itemIsManga
                                      ? item.chapters ? `${item.progress} / ${item.chapters}` : item.progress
                                      : item.episodes ? `${item.progress} / ${item.episodes}` : item.progress}
                                  </span>
                                  {itemIsManga && (
                                    <span className="rounded-full bg-black/15 px-2.5 py-1 text-[11px] text-white/70">
                                      Volumes {item.volumes ? `${item.volumeProgress ?? 0} / ${item.volumes}` : item.volumeProgress ?? 0}
                                    </span>
                                  )}
                                  {typeof item.score === "number" && item.score > 0 && (
                                    <span className="rounded-full bg-black/15 px-2.5 py-1 text-[11px] text-white/70">
                                      Score {item.score}
                                    </span>
                                  )}
                                </div>

                                {item.notes?.trim() && (
                                  <p className="mt-3 line-clamp-2 text-xs leading-5 text-white/50">
                                    {item.notes.trim()}
                                  </p>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      {visibleCount < group.items.length && (
                        <div className="border-t border-white/10 p-4 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              setVisibleGroupItems((current) => ({
                                ...current,
                                [groupKey]: Math.min(group.items.length, visibleCount + 60),
                              }))
                            }
                            className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/70 transition hover:bg-white/8 hover:text-white"
                          >
                            Show {Math.min(60, group.items.length - visibleCount)} more
                          </button>
                        </div>
                      )}
                      </>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-white/10 px-6 py-4">
          <div className="flex items-center justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <p className="text-sm text-white/60">
              {selectedKeys.length > 0
                ? provider === "anilist" || provider === "mal"
                  ? `${selectedKeys.filter((key) => key.startsWith("ANIME:")).length} Anime · ${selectedKeys.filter((key) => key.startsWith("MANGA:")).length} Manga selected`
                  : `${selectedKeys.length} ${fileMediaType === "MANGA" ? "Manga" : "Anime"} selected`
                : provider === "anilist" || provider === "mal"
                  ? "Choose at least one title to import"
                  : `Choose at least one ${fileMediaType === "MANGA" ? "Manga" : "Anime"} title to import`}
            </p>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={requestClose}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white/75 transition hover:bg-white/8 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/55"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!preview || selectedKeys.length === 0 || isImporting || isPreviewLoading}
                onClick={onConfirm}
                className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-white/55 ${
                  !preview || selectedKeys.length === 0 || isImporting || isPreviewLoading
                    ? "cursor-not-allowed border border-white/5 bg-white/[0.03] text-white/35"
                    : "border border-white/10 bg-white text-black hover:opacity-90"
                }`}
              >
                {isImporting ? "Importing..." : "Import selected"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {isQuitImportConfirmOpen && (
        <div className="absolute inset-0 z-20 flex items-center justify-center px-6">
          <button
            type="button"
            aria-label="Keep import window open"
            onClick={() => setIsQuitImportConfirmOpen(false)}
            className="absolute inset-0 bg-black/55"
          />

          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="quit-import-title"
            aria-describedby="quit-import-description"
            className="relative z-10 w-full max-w-md rounded-3xl border border-white/10 bg-[#151515] p-6 text-white shadow-2xl"
          >
            <div className="flex items-start gap-4">
              <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3 text-amber-100">
                <ExclamationTriangleIcon className="h-6 w-6" />
              </div>

              <div>
                <h3 id="quit-import-title" className="text-lg font-semibold">
                  {isPreviewLoading ? "Cancel matching?" : "Cancel import?"}
                </h3>
                <p
                  id="quit-import-description"
                  className="mt-2 text-sm leading-6 text-white/60"
                >
                  {isPreviewLoading
                    ? "Seenary is still matching titles. Cancelling will close this preview and stop waiting for the matching result."
                    : "An import is still running. Cancelling will stop the current import request and skip any remaining entries that have not been saved yet."}
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setIsQuitImportConfirmOpen(false);
                  onCancelImport();
                }}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white/75 transition hover:bg-white/8 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/55"
              >
                {isPreviewLoading ? "Cancel matching" : "Cancel import"}
              </button>

              <button
                type="button"
                onClick={() => setIsQuitImportConfirmOpen(false)}
                className="rounded-2xl border border-white/10 bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-white/55"
              >
                Keep importing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getStartViewLabel(value: StartView) {
  return START_VIEW_OPTIONS.find((option) => option.value === value)?.label ?? "Home";
}

function normalizeAccentColor(value: string | null | undefined) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#a78bfa";
}

function getAnimationLevelLabel(value: AnimationLevel) {
  return ANIMATION_LEVEL_OPTIONS.find((option) => option.value === value)?.label ?? "Full";
}

function getNavbarStyleLabel(value: NavbarStyle) {
  return NAVBAR_STYLE_OPTIONS.find((option) => option.value === value)?.label ?? "Integrated";
}

function getBrowseCardStyleLabel(value: BrowseCardStyle) {
  return BROWSE_CARD_STYLE_OPTIONS.find((option) => option.value === value)?.label ?? "Default";
}

function BrowseCardStylePreview({ style }: { style: BrowseCardStyle }) {
  return (
    <div className="flex h-28 items-center justify-center overflow-hidden rounded-2xl border border-white/8 bg-black/35 p-3">
      <div
        className={`relative flex h-full w-16 flex-col overflow-hidden rounded-xl ${
          style === "gallery"
            ? "bg-transparent"
            : "border border-white/12 bg-white/[0.05] shadow-xl"
        }`}
      >
        <div className={`relative min-h-0 flex-1 overflow-hidden bg-linear-to-br from-[var(--app-accent)]/55 via-slate-700 to-black ${style === "gallery" ? "rounded-xl shadow-xl" : ""}`}>
          <span className="absolute right-1.5 top-1.5 h-3 w-3 rounded-md bg-black/55" />
          {style === "immersive" && (
            <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black via-black/70 to-transparent px-2 pb-2 pt-8">
              <span className="block h-1.5 w-10 rounded-full bg-white/80" />
              <span className="mt-1 block h-1 w-7 rounded-full bg-white/35" />
            </div>
          )}
        </div>
        {style !== "immersive" && (
          <div className={`px-1.5 pb-1.5 pt-2 ${style === "gallery" ? "bg-transparent" : "bg-white/[0.04]"}`}>
            <span className="block h-1.5 w-10 rounded-full bg-white/80" />
            <span className="mt-1 block h-1 w-7 rounded-full bg-white/35" />
          </div>
        )}
      </div>
    </div>
  );
}

function NavbarStylePreview({ style }: { style: NavbarStyle }) {
  const floating = style === "floating";
  const minimal = style === "minimal";

  return (
    <div className="relative h-16 overflow-hidden rounded-2xl border border-white/8 bg-black/35">
      {!minimal && (
        <div
          className={`absolute flex items-center gap-2 border-white/10 bg-white/[0.07] px-2 backdrop-blur ${
            floating
              ? "inset-x-2 top-2 h-10 rounded-xl border"
              : "inset-x-0 top-0 h-11 border-b"
          }`}
        >
          <NavbarPreviewContents />
        </div>
      )}
      {minimal && (
        <div className="absolute inset-x-2 top-2 flex h-10 items-center justify-between gap-2">
          <div className="flex h-full items-center gap-1 rounded-xl border border-white/10 bg-white/[0.07] px-2 backdrop-blur">
            <span className="h-2.5 w-2.5 rounded-full bg-white/45" />
            <span className="h-2.5 w-4 rounded-full bg-white/25" />
          </div>
          <span className="h-full flex-1 rounded-xl border border-white/10 bg-white/[0.07] backdrop-blur" />
          <div className="flex h-full items-center gap-1 rounded-xl border border-white/10 bg-white/[0.07] px-2 backdrop-blur">
            <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/45" />
          </div>
        </div>
      )}
    </div>
  );
}

function NavbarPreviewContents() {
  return (
    <>
      <span className="h-2.5 w-2.5 rounded-full bg-white/45" />
      <span className="h-2.5 w-4 rounded-full bg-white/25" />
      <span className="mx-auto h-5 w-2/5 rounded-lg border border-white/10 bg-white/8" />
      <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
      <span className="h-2.5 w-2.5 rounded-full bg-white/45" />
    </>
  );
}

function getDiscoverDensityLabel(value: DiscoverDensity) {
  return DISCOVER_DENSITY_OPTIONS.find((option) => option.value === value)?.label ?? "Balanced";
}

function getCardDensityLabel(value: CardDensity) {
  return CARD_DENSITY_OPTIONS.find((option) => option.value === value)?.label ?? "Balanced";
}

function getWindowPresetId(value: unknown): WindowPresetId {
  return WINDOW_PRESET_OPTIONS.some((option) => option.value === value)
    ? (value as WindowPresetId)
    : "balanced";
}

function normalizeAcceleratorInput(value: string) {
  return value
    .split("+")
    .map((part) => normalizeAcceleratorToken(part))
    .filter(Boolean)
    .join("+");
}

function appendAcceleratorToken(accelerator: string, token: string) {
  const normalizedToken = normalizeAcceleratorToken(token);

  if (!normalizedToken) {
    return normalizeAcceleratorInput(accelerator);
  }

  const tokens = normalizeAcceleratorInput(accelerator)
    .split("+")
    .filter(Boolean);

  if (!tokens.includes(normalizedToken)) {
    tokens.push(normalizedToken);
  }

  return tokens.join("+");
}

function removeLastAcceleratorToken(accelerator: string) {
  const tokens = normalizeAcceleratorInput(accelerator)
    .split("+")
    .filter(Boolean);

  tokens.pop();

  return tokens.join("+");
}

function keyEventToAcceleratorToken(event: ReactKeyboardEvent<HTMLInputElement>) {
  if (event.repeat) {
    return null;
  }

  return normalizeAcceleratorToken(event.key);
}

function normalizeAcceleratorToken(value: string) {
  if (value === " ") {
    return "Space";
  }

  const token = value.trim();

  if (!token) {
    return "";
  }

  const lowerToken = token.toLowerCase();

  if (lowerToken === "control" || lowerToken === "ctrl") {
    return "Control";
  }

  if (lowerToken === "alt" || lowerToken === "option") {
    return "Alt";
  }

  if (lowerToken === "shift") {
    return "Shift";
  }

  if (lowerToken === "meta" || lowerToken === "command" || lowerToken === "cmd") {
    return "Meta";
  }

  if (lowerToken === " " || lowerToken === "space" || lowerToken === "spacebar") {
    return "Space";
  }

  if (lowerToken === "escape" || lowerToken === "esc") {
    return "Escape";
  }

  if (lowerToken === "arrowup") {
    return "Up";
  }

  if (lowerToken === "arrowdown") {
    return "Down";
  }

  if (lowerToken === "arrowleft") {
    return "Left";
  }

  if (lowerToken === "arrowright") {
    return "Right";
  }

  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lowerToken)) {
    return lowerToken.toUpperCase();
  }

  if (/^[a-z0-9]$/.test(lowerToken)) {
    return lowerToken.toUpperCase();
  }

  return token.charAt(0).toUpperCase() + token.slice(1);
}

function hasAcceleratorActionKey(accelerator: string) {
  const modifierTokens = new Set(["Control", "Alt", "Shift", "Meta"]);

  return normalizeAcceleratorInput(accelerator)
    .split("+")
    .some((token) => token && !modifierTokens.has(token));
}

function getSyncActivityTabLabel(tab: SyncActivityTab) {
  return tab === "pending" ? "Queued" : capitalize(tab);
}

function getSyncActivityTitle(item: SyncActivityItem, titleLanguage: TitleLanguage) {
  const fallback =
    item.animeTitle ||
    item.anime_title ||
    `${item.media_type === "MANGA" || item.manga_id ? "Manga" : "Anime"} #${
      item.manga_id ?? item.anime_id ?? "unknown"
    }`;

  return getPreferredTitle(
    {
      userPreferred: item.title_preferred || fallback,
      english: item.title_english,
      romaji: item.title_romaji,
      native: item.title_native,
    },
    titleLanguage
  );
}

function ProgressActionButton({
  children,
  onClick,
  disabled,
  active,
  progress,
  className = "",
}: {
  children: ReactNode;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  active?: boolean;
  progress?: SyncProgressEvent | null;
  className?: string;
}) {
  const hasTotal = Number(progress?.total) > 0;
  const isIndeterminate = Boolean(active && !hasTotal);
  const percent = hasTotal
    ? Math.min(100, Math.max(0, (Number(progress?.current || 0) / Number(progress?.total)) * 100))
    : isIndeterminate
      ? 8
      : 0;
  const labelPercent = hasTotal ? Math.round(percent) : 0;
  const isDisabled = Boolean(disabled);

  return (
    <div className={`inline-flex min-w-0 ${className}`}>
      <button
        type="button"
        onClick={onClick}
        disabled={isDisabled}
        className={`relative overflow-hidden rounded-2xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-white/55 ${
          isDisabled && !active
            ? "cursor-not-allowed border border-white/5 bg-white/[0.03] text-white/35"
            : `border border-white/10 bg-white text-black ${active ? "cursor-progress" : "hover:opacity-90"}`
        }`}
      >
        {active && (
          <span
            className={`absolute inset-y-0 left-0 bg-emerald-300/35 transition-all duration-300 ${
              isIndeterminate ? "animate-pulse" : ""
            }`}
            style={{ width: `${percent}%` }}
          />
        )}
        <span className={`relative z-10 inline-flex items-center gap-2 ${active ? "invisible" : ""}`}>
          {children}
        </span>
        {active && (
          <span className="absolute inset-0 z-10 inline-flex items-center justify-center gap-2">
            {hasTotal ? (
              `${labelPercent}%`
            ) : (
              <>
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
                Working...
              </>
            )}
          </span>
        )}
      </button>
    </div>
  );
}

function formatOperation(value: string) {
  switch (value) {
    case "upsert_anilist_entry":
      return "Pushed list entry";
    case "upsert_mal_entry":
    case "upsert_anilist_manga_entry":
    case "upsert_mal_manga_entry":
      return "Pushed list entry";
    case "delete_anilist_entry":
      return "Deleted list entry";
    case "delete_mal_entry":
    case "delete_anilist_manga_entry":
    case "delete_mal_manga_entry":
      return "Deleted list entry";
    case "pull_from_anilist":
    case "pull_from_anilist_manga":
      return "Pulled remote update";
    case "pull_from_mal":
    case "pull_from_mal_manga":
      return "Pulled remote update";
    case "pull_from_anilist_unmapped":
    case "pull_from_mal_unmapped":
      return "Pull mapping conflict";
    case "pull_summary_anilist":
    case "pull_summary_mal":
      return "Pull summary";
    default:
      return value
        .replace(/_/g, " ")
        .replace(/^./, (char) => char.toUpperCase());
  }
}

function formatOperationProvider(value: string) {
  if (value.includes("mal")) {
    return "MyAnimeList";
  }

  if (value.includes("anilist")) {
    return "AniList";
  }

  return "Sync";
}

function getOperationAccent(value: string) {
  if (value.includes("mal")) {
    return "bg-indigo-400/10 text-indigo-100";
  }

  if (value.includes("anilist")) {
    return "bg-sky-400/10 text-sky-100";
  }

  return "bg-white/8 text-white/60";
}

function formatFieldName(value: string) {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "empty";
  }

  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }

  return String(value);
}

function formatSyncActivityMessage(value: string | null | undefined) {
  const message = String(value || "").trim();

  if (message.toLowerCase() === "invalid q") {
    return "MyAnimeList rejected the title search query while matching this title.";
  }

  return message;
}
