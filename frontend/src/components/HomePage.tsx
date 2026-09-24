import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  ArrowTrendingUpIcon,
  BookmarkIcon,
  BookOpenIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  CheckIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  FireIcon,
  HeartIcon,
  HomeIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlayCircleIcon,
  PlusIcon,
  SparklesIcon,
  StarIcon,
  TvIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { getPreferredTitle, type TitleLanguage } from "../utils/titlePreference";
import { getMigratedLocalStorageItem } from "../utils/localStorageMigration";
import { LibraryLens, type LibraryDestination } from "./LibraryLens";
import { LayoutEditorToolbar, ReorderableSection } from "./ui/LayoutEditor";
import { MediaShelf } from "./ui/MediaShelf";
import { AsyncStatePanel } from "./ui/AsyncStatePanel";
import { Tooltip } from "./ui/Tooltip";
import {
  formatEnum,
  formatCompactNumber as formatNumber,
  formatNumber as formatExactNumber,
  formatScore10,
} from "../utils/mediaFormatting";
import type { MediaType, TrackedMangaEntry } from "../types/domain";
import {
  dismissRecentMedia,
  readRecentMediaHistory,
  type RecentMediaHistoryEntry,
} from "../utils/recentMediaHistory";

const HOME_DISCOVER_STATE_STORAGE_KEY = "seenary.discover-state";
const HOME_DISCOVER_STATE_LEGACY_STORAGE_KEY = "media-tracker.discover-state";
const HOME_DISCOVER_STATE_VERSION = 2;
const HOME_PERSONAL_LAYOUT_STORAGE_KEY = "seenary.personal-layout-order";
const HOME_PERSONAL_LAYOUT_LEGACY_STORAGE_KEY = "media-tracker.personal-layout-order";
const HOME_MANGA_PERSONAL_LAYOUT_STORAGE_KEY = "seenary.manga-personal-layout-order";
const HOME_DISCOVER_LAYOUT_STORAGE_KEY = "seenary.discover-layout-order";
const HOME_DISCOVER_LAYOUT_LEGACY_STORAGE_KEY = "media-tracker.discover-layout-order";
const TRENDING_CYCLE_MS = 6500;
const HOME_DISCOVER_CACHE_TTL_MS = 20 * 60 * 1000;
const DISCOVER_CAROUSEL_LAYOUT_ID = "carousel";
const DEFAULT_DISCOVER_LAYOUT_ORDER = [
  DISCOVER_CAROUSEL_LAYOUT_ID,
  "seasonal",
  "upcoming",
  "popular",
  "rated",
] as const;
const DEFAULT_PERSONAL_LAYOUT_ORDER = [
  "overview",
  "stats",
  "activity",
  "continue",
  "planned",
  "sinceLiked",
] as const;

type PersonalLayoutSectionId = (typeof DEFAULT_PERSONAL_LAYOUT_ORDER)[number];
type PersonalGridWidgetId =
  | "spotlight"
  | "account"
  | "stats"
  | "activity"
  | "continue"
  | "planned"
  | "sinceLiked";
type ShelfOrientation = "horizontal" | "vertical";
type PersonalGridItem = {
  id: PersonalGridWidgetId;
  columns: number;
  rows: number;
  orientation?: ShelfOrientation;
};
type DiscoverDensity = "comfortable" | "balanced" | "compact";
type HomeDensity = "comfortable" | "balanced" | "compact";

const PERSONAL_GRID_STORAGE_VERSION = 1;
const PERSONAL_GRID_WIDGET_LABELS: Record<PersonalGridWidgetId, string> = {
  spotlight: "Spotlight",
  account: "Account Overview",
  stats: "Status Summary",
  activity: "Last Activity",
  continue: "Continue Watching",
  planned: "Planned Picks",
  sinceLiked: "Since You Liked",
};
const MANGA_PERSONAL_GRID_WIDGET_LABELS: Record<PersonalGridWidgetId, string> = {
  spotlight: "Spotlight",
  account: "Reading Overview",
  stats: "Status Summary",
  activity: "Last Activity",
  continue: "Continue Reading",
  planned: "Plan to Read",
  sinceLiked: "Since You Liked",
};
const PERSONAL_GRID_CONSTRAINTS: Record<
  PersonalGridWidgetId,
  { minColumns: number; maxColumns: number; minRows: number; maxRows: number }
> = {
  spotlight: { minColumns: 5, maxColumns: 12, minRows: 5, maxRows: 9 },
  account: { minColumns: 4, maxColumns: 12, minRows: 5, maxRows: 10 },
  stats: { minColumns: 3, maxColumns: 12, minRows: 2, maxRows: 5 },
  activity: { minColumns: 3, maxColumns: 12, minRows: 3, maxRows: 12 },
  continue: { minColumns: 3, maxColumns: 12, minRows: 5, maxRows: 14 },
  planned: { minColumns: 3, maxColumns: 12, minRows: 5, maxRows: 14 },
  sinceLiked: { minColumns: 5, maxColumns: 12, minRows: 6, maxRows: 16 },
};
const PERSONAL_GRID_SHELF_IDS = new Set<PersonalGridWidgetId>([
  "stats",
  "activity",
  "continue",
  "planned",
]);
const PERSONAL_GRID_HORIZONTAL_ROWS: Partial<Record<PersonalGridWidgetId, number>> = {
  stats: 2,
  activity: 3,
  continue: 5,
  planned: 5,
};
const DEFAULT_PERSONAL_GRID_LAYOUT: PersonalGridItem[] = [
  { id: "spotlight", columns: 7, rows: 6 },
  { id: "account", columns: 5, rows: 6 },
  { id: "stats", columns: 12, rows: 2, orientation: "horizontal" },
  { id: "activity", columns: 12, rows: 3, orientation: "horizontal" },
  { id: "continue", columns: 12, rows: 5, orientation: "horizontal" },
  { id: "planned", columns: 12, rows: 5, orientation: "horizontal" },
  { id: "sinceLiked", columns: 12, rows: 10 },
];

const DISCOVER_DENSITY_STYLES: Record<
  DiscoverDensity,
  {
    railGapClass: string;
    railCardClass: string;
    railFallbackWidth: number;
    bodyClass: string;
    titleClass: string;
    metaClass: string;
    iconButtonClass: string;
    iconClass: string;
  }
> = {
  comfortable: {
    railGapClass: "gap-5",
    railCardClass: "min-w-52 max-w-52",
    railFallbackWidth: 208,
    bodyClass: "p-4",
    titleClass: "line-clamp-2 min-h-12 text-base font-semibold leading-6 text-white",
    metaClass: "mt-3 flex max-w-full flex-wrap gap-1.5",
    iconButtonClass: "right-2.5 top-2.5 h-9 w-9 rounded-2xl",
    iconClass: "h-4 w-4",
  },
  balanced: {
    railGapClass: "gap-4",
    railCardClass: "min-w-44 max-w-44",
    railFallbackWidth: 176,
    bodyClass: "p-3",
    titleClass: "line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-white",
    metaClass: "mt-3 flex max-w-full flex-wrap gap-1.5",
    iconButtonClass: "right-2 top-2 h-8 w-8 rounded-xl",
    iconClass: "h-4 w-4",
  },
  compact: {
    railGapClass: "gap-3",
    railCardClass: "min-w-36 max-w-36",
    railFallbackWidth: 144,
    bodyClass: "p-2.5",
    titleClass: "line-clamp-2 min-h-8 text-xs font-semibold leading-4 text-white",
    metaClass: "mt-2 flex max-w-full flex-wrap gap-1",
    iconButtonClass: "right-1.5 top-1.5 h-7 w-7 rounded-lg",
    iconClass: "h-3.5 w-3.5",
  },
};

const DISCOVER_LIST_GRID_CLASS =
  "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5";

const HOME_DENSITY_STYLES: Record<
  HomeDensity,
  {
    railGapClass: string;
    railGapPixels: number;
    railVisibleCards: number;
    gridClass: string;
    compactGridClass: string;
    compactCardClass: string;
    compactPosterClass: string;
    mediumPosterClass: string;
    mediumTitleClass: string;
    mediumMetaClass: string;
  }
> = {
  comfortable: {
    railGapClass: "gap-5",
    railGapPixels: 20,
    railVisibleCards: 5,
    gridClass: "grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-5",
    compactGridClass: "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3",
    compactCardClass: "min-h-34 p-4",
    compactPosterClass: "h-28 w-20",
    mediumPosterClass: "h-72 w-full",
    mediumTitleClass: "line-clamp-2 text-base font-semibold leading-5 text-white",
    mediumMetaClass: "mt-3 flex flex-wrap gap-1.5",
  },
  balanced: {
    railGapClass: "gap-4",
    railGapPixels: 16,
    railVisibleCards: 6,
    gridClass: "grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6",
    compactGridClass: "grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3",
    compactCardClass: "min-h-30 p-3.5",
    compactPosterClass: "h-24 w-16",
    mediumPosterClass: "h-64 w-full",
    mediumTitleClass: "line-clamp-2 text-sm font-semibold leading-5 text-white",
    mediumMetaClass: "mt-2.5 flex flex-wrap gap-1.5",
  },
  compact: {
    railGapClass: "gap-3",
    railGapPixels: 12,
    railVisibleCards: 7,
    gridClass: "grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7",
    compactGridClass: "grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-4",
    compactCardClass: "min-h-24 p-2.5",
    compactPosterClass: "h-20 w-14",
    mediumPosterClass: "h-52 w-full",
    mediumTitleClass: "line-clamp-2 text-xs font-semibold leading-4 text-white",
    mediumMetaClass: "mt-2 flex flex-wrap gap-1",
  },
};

type TrackedAnimeEntry = {
  anime_id: number;
  status: "planned" | "watching" | "completed" | "paused" | "dropped";
  is_favorite?: number | boolean;
  progress: number;
  score: number | null;
  notes: string | null;
  title_romaji?: string | null;
  title_english?: string | null;
  title_native?: string | null;
  title_preferred?: string | null;
  cover_image_large?: string | null;
  banner_image?: string | null;
  episodes?: number | null;
  format?: string | null;
  average_score?: number | null;
  mean_score?: number | null;
  popularity?: number | null;
  favourites?: number | null;
  duration?: number | null;
  source?: string | null;
  country_of_origin?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  genres?: string[];
  season?: string | null;
  season_year?: number | null;
  updated_at?: string | null;
  local_updated_at?: string | null;
  provider_updated_at?: string | null;
  recommendations?: RecommendationEntry[];
};

type RecommendationEntry = {
  rating?: number | null;
  mediaRecommendation?: RecommendationMedia | null;
};

type RecommendationMedia = {
  id: number;
  type?: MediaType | string | null;
  title?: {
    romaji?: string | null;
    english?: string | null;
    native?: string | null;
    userPreferred?: string | null;
  } | null;
  coverImage?: {
    large?: string | null;
  } | null;
  description?: string | null;
  format?: string | null;
  status?: string | null;
  episodes?: number | null;
  season?: string | null;
  seasonYear?: number | null;
  averageScore?: number | null;
};

function latestActivityTime(entry: {
  local_updated_at?: string | null;
  provider_updated_at?: string | null;
  updated_at?: string | null;
}) {
  return Math.max(
    Date.parse(entry.local_updated_at || "") || 0,
    Date.parse(entry.provider_updated_at || "") || 0,
    Date.parse(entry.updated_at || "") || 0
  );
}

function mostRecentlyActiveWithArtwork<T extends {
  banner_image?: string | null;
  cover_image_large?: string | null;
  local_updated_at?: string | null;
  provider_updated_at?: string | null;
  updated_at?: string | null;
}>(entries: T[]) {
  return entries
    .filter((entry) => entry.banner_image || entry.cover_image_large)
    .reduce<T | null>((latest, entry) =>
      !latest || latestActivityTime(entry) > latestActivityTime(latest) ? entry : latest, null);
}

type RecommendationSource = {
  animeId: number;
  title: {
    romaji?: string | null;
    english?: string | null;
    native?: string | null;
    userPreferred?: string | null;
  };
  coverImage?: string | null;
  format?: string | null;
  score?: number | null;
};

type RecommendationCandidate = {
  animeId: number;
  title?: RecommendationMedia["title"];
  coverImage?: RecommendationMedia["coverImage"];
  description?: string | null;
  format?: string | null;
  episodes?: number | null;
  season?: string | null;
  seasonYear?: number | null;
  averageScore?: number | null;
  strength: number;
  sourceCount: number;
  sourceTitles: string[];
  source?: RecommendationSource | null;
  sourceStrength: number;
};

type TrendingAnime = {
  id: number;
  isAdult?: boolean;
  title?: {
    romaji?: string | null;
    english?: string | null;
    native?: string | null;
    userPreferred?: string | null;
  };
  coverImage?: {
    large?: string | null;
  };
  bannerImage?: string | null;
  episodes?: number | null;
  format?: string | null;
  status?: string | null;
  season?: string | null;
  seasonYear?: number | null;
  averageScore?: number | null;
  meanScore?: number | null;
  popularity?: number | null;
  favourites?: number | null;
  nextAiringEpisode?: {
    episode?: number | null;
    airingAt?: number | null;
  } | null;
};

type HomeTab = "personal" | "discover";

type DiscoverShelf = {
  id: string;
  title: string;
  description: string;
  pills: string[];
  items: TrendingAnime[];
};

type DiscoverMediaCatalog = {
  anime: { trending: TrendingAnime[]; shelves: DiscoverShelf[] };
  manga: { trending: TrendingAnime[]; shelves: DiscoverShelf[] };
};

type HomeAnimeCacheEntry<T> = {
  data: T;
  savedAt: number;
};

const discoverMediaCache = new Map<string, HomeAnimeCacheEntry<DiscoverMediaCatalog>>();
const discoverMediaRequests = new Map<string, Promise<DiscoverMediaCatalog>>();

function getHomeAnimeCacheKey(hideAdultContent: boolean) {
  return hideAdultContent ? "safe" : "all";
}

function readFreshHomeAnimeCache<T>(
  cache: Map<string, HomeAnimeCacheEntry<T>>,
  key: string
) {
  const cached = cache.get(key);
  if (!cached || Date.now() - cached.savedAt > HOME_DISCOVER_CACHE_TTL_MS) {
    return null;
  }

  return cached.data;
}

function writeHomeAnimeCache<T>(
  cache: Map<string, HomeAnimeCacheEntry<T>>,
  key: string,
  data: T
) {
  cache.set(key, {
    data,
    savedAt: Date.now(),
  });
}

function getDiscoverShelfStateKey(mediaType: MediaType, shelfId: string) {
  return `${mediaType}:${shelfId}`;
}

type DiscoverPageInfo = {
  currentPage: number;
  lastPage: number;
  hasNextPage: boolean;
  total?: number | null;
  perPage?: number | null;
};

type DiscoverShelfPageState = {
  shelf: DiscoverShelf;
  items: TrendingAnime[];
  pageInfo: DiscoverPageInfo | null;
  page: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  scrollTop: number;
  warning?: string | null;
  loadMoreError?: string | null;
};

type SavedDiscoverState = {
  version: number;
  savedAt: number;
  activeDiscoverShelfId: string | null;
  discoverShelfPages: Record<string, DiscoverShelfPageState>;
  overviewScrollTop: number;
  overviewRailScrolls: Record<string, number>;
};

type HomePageProps = {
  userId: number;
  hasResults: boolean;
  showTutorial: boolean;
  onDismissTutorial: () => void | Promise<void>;
  trackedEntries: TrackedAnimeEntry[];
  trackedMangaEntries: TrackedMangaEntry[];
  mediaType: MediaType;
  activeHomeTab: HomeTab;
  onMediaTypeChange: (mediaType: MediaType) => void;
  onLibraryDestinationChange: (destination: LibraryDestination) => void;
  onLibraryLensVisibilityChange: (isVisible: boolean) => void;
  onSelectMedia: (mediaId: number, mediaType: MediaType) => void;
  onSelectAnime: (animeId: number) => void;
  onQuickAddAnime: (anime: QuickAddAnime) => void;
  onEditEntry: (entry: TrackedAnimeEntry) => void;
  titleLanguage: TitleLanguage;
  showTrendingCarousel: boolean;
  autoRotateTrending: boolean;
  autoScrollHomeShelves: boolean;
  animationLevel: "full" | "reduced" | "off";
  discoverDensity: DiscoverDensity;
  homeDensity: HomeDensity;
  hideAdultContent: boolean;
  initialScrollTop: number;
  onScrollContainerChange: (element: HTMLDivElement | null) => void;
  onScrollPositionChange: (scrollTop: number) => void;
  children?: ReactNode;
};

type QuickAddAnime = {
  id: number;
  title: {
    romaji?: string;
    english?: string;
    native?: string;
    userPreferred?: string;
  };
  coverImage: {
    large: string;
  };
  episodes?: number | null;
  format?: string | null;
  averageScore?: number | null;
  season?: string | null;
  seasonYear?: number | null;
};

export function HomePage({
  userId,
  hasResults,
  showTutorial,
  onDismissTutorial,
  trackedEntries,
  trackedMangaEntries,
  mediaType,
  activeHomeTab,
  onMediaTypeChange,
  onLibraryDestinationChange,
  onLibraryLensVisibilityChange,
  onSelectMedia,
  onSelectAnime,
  onQuickAddAnime,
  onEditEntry,
  titleLanguage,
  showTrendingCarousel,
  autoRotateTrending,
  autoScrollHomeShelves,
  animationLevel,
  discoverDensity,
  homeDensity,
  hideAdultContent,
  initialScrollTop,
  onScrollContainerChange,
  onScrollPositionChange,
  children,
}: HomePageProps) {
  const [tutorialStep, setTutorialStep] = useState(0);

  useEffect(() => {
    if (showTutorial) {
      setTutorialStep(0);
    }
  }, [showTutorial]);
  const [recentMediaHistory, setRecentMediaHistory] = useState(() =>
    readRecentMediaHistory(userId)
  );
  const [personalLayoutOrder, setPersonalLayoutOrder] = useState<PersonalLayoutSectionId[]>(
    readPersonalLayoutOrder
  );
  const personalLayoutOrderRef = useRef(personalLayoutOrder);
  const [personalGridLayout, setPersonalGridLayout] = useState<PersonalGridItem[]>(() =>
    readPersonalGridLayout(userId)
  );
  const personalGridLayoutRef = useRef(personalGridLayout);
  const [selectedPersonalGridWidget, setSelectedPersonalGridWidget] =
    useState<PersonalGridWidgetId | null>(null);
  const [draggedPersonalGridWidget, setDraggedPersonalGridWidget] =
    useState<PersonalGridWidgetId | null>(null);
  const personalGridEditSnapshotRef = useRef<PersonalGridItem[] | null>(null);
  const [mangaPersonalGridLayout, setMangaPersonalGridLayout] = useState<
    PersonalGridItem[]
  >(() => readMangaPersonalGridLayout(userId));
  const mangaPersonalGridLayoutRef = useRef(mangaPersonalGridLayout);
  const [selectedMangaPersonalGridWidget, setSelectedMangaPersonalGridWidget] =
    useState<PersonalGridWidgetId | null>(null);
  const [draggedMangaPersonalGridWidget, setDraggedMangaPersonalGridWidget] =
    useState<PersonalGridWidgetId | null>(null);
  const mangaPersonalGridEditSnapshotRef = useRef<PersonalGridItem[] | null>(null);
  const [mangaPersonalLayoutOrder, setMangaPersonalLayoutOrder] = useState<
    PersonalLayoutSectionId[]
  >(readMangaPersonalLayoutOrder);
  const mangaPersonalLayoutOrderRef = useRef(mangaPersonalLayoutOrder);
  const [isEditingPersonalLayout, setIsEditingPersonalLayout] = useState(false);
  const [discoverLayoutOrder, setDiscoverLayoutOrder] = useState<string[]>(
    readDiscoverLayoutOrder
  );
  const discoverLayoutOrderRef = useRef(discoverLayoutOrder);
  const [isEditingDiscoverLayout, setIsEditingDiscoverLayout] = useState(false);
  const [draggedDiscoverSectionId, setDraggedDiscoverSectionId] = useState<string | null>(null);
  const [trendingAnime, setTrendingAnime] = useState<TrendingAnime[]>([]);
  const [isTrendingLoading, setIsTrendingLoading] = useState(false);
  const [activeTrendingIndex, setActiveTrendingIndex] = useState(0);
  const [trendingCycleKey, setTrendingCycleKey] = useState(0);
  const [isTrendingPaused, setIsTrendingPaused] = useState(false);
  const [discoverShelves, setDiscoverShelves] = useState<DiscoverShelf[]>([]);
  const [isDiscoverLoading, setIsDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverRetryKey, setDiscoverRetryKey] = useState(0);
  const [favoriteRecommendationsByAnimeId, setFavoriteRecommendationsByAnimeId] = useState<
    Record<number, RecommendationEntry[]>
  >({});
  const requestedFavoriteRecommendationIds = useRef(new Set<number>());
  const [favoriteRecommendationsByMangaId, setFavoriteRecommendationsByMangaId] = useState<
    Record<number, RecommendationEntry[]>
  >({});
  const requestedFavoriteMangaRecommendationIds = useRef(new Set<number>());
  const savedDiscoverState = useMemo(() => readSavedDiscoverState(), []);
  const [activeDiscoverShelfId, setActiveDiscoverShelfId] = useState<string | null>(
    savedDiscoverState?.activeDiscoverShelfId ?? null
  );
  const [discoverShelfPages, setDiscoverShelfPages] = useState<
    Record<string, DiscoverShelfPageState>
  >(savedDiscoverState?.discoverShelfPages ?? {});
  const privacySafeTrendingAnime = useMemo(
    () => (hideAdultContent ? trendingAnime.filter((anime) => !anime.isAdult) : trendingAnime),
    [hideAdultContent, trendingAnime]
  );
  const privacySafeDiscoverShelves = useMemo(
    () =>
      hideAdultContent
        ? discoverShelves
            .map((shelf) => ({
              ...shelf,
              items: shelf.items.filter((anime) => !anime.isAdult),
            }))
            .filter((shelf) => shelf.items.length > 0)
        : discoverShelves,
    [discoverShelves, hideAdultContent]
  );
  const privacySafeDiscoverShelfPages = useMemo(
    () =>
      hideAdultContent
        ? Object.fromEntries(
            Object.entries(discoverShelfPages).map(([id, state]) => [
              id,
              {
                ...state,
                items: state.items.filter((anime) => !anime.isAdult),
                shelf: {
                  ...state.shelf,
                  items: state.shelf.items.filter((anime) => !anime.isAdult),
                },
              },
            ])
          )
        : discoverShelfPages,
    [discoverShelfPages, hideAdultContent]
  );
  const visibleRecentMediaHistory = useMemo(
    () =>
      recentMediaHistory.filter(
        (entry) =>
          entry.mediaType === mediaType && (!hideAdultContent || !entry.isAdult)
      ),
    [hideAdultContent, mediaType, recentMediaHistory]
  );
  const discoverShelfPagesRef = useRef(discoverShelfPages);
  const homeScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setRecentMediaHistory(readRecentMediaHistory(userId));
    const nextGridLayout = readPersonalGridLayout(userId);
    personalGridLayoutRef.current = nextGridLayout;
    setPersonalGridLayout(nextGridLayout);
    setSelectedPersonalGridWidget(null);
    setDraggedPersonalGridWidget(null);
    personalGridEditSnapshotRef.current = null;
    const nextMangaGridLayout = readMangaPersonalGridLayout(userId);
    mangaPersonalGridLayoutRef.current = nextMangaGridLayout;
    setMangaPersonalGridLayout(nextMangaGridLayout);
    setSelectedMangaPersonalGridWidget(null);
    setDraggedMangaPersonalGridWidget(null);
    mangaPersonalGridEditSnapshotRef.current = null;
  }, [userId]);

  useEffect(() => {
    personalGridLayoutRef.current = personalGridLayout;
    persistPersonalGridLayout(userId, personalGridLayout);
  }, [personalGridLayout, userId]);

  useEffect(() => {
    mangaPersonalGridLayoutRef.current = mangaPersonalGridLayout;
    persistMangaPersonalGridLayout(userId, mangaPersonalGridLayout);
  }, [mangaPersonalGridLayout, userId]);

  function handleDismissRecentMedia(entry: RecentMediaHistoryEntry) {
    setRecentMediaHistory(
      dismissRecentMedia(userId, entry.mediaType, entry.mediaId)
    );
  }
  const discoverRailRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const discoverOverviewScrollTop = useRef(savedDiscoverState?.overviewScrollTop ?? 0);
  const discoverOverviewRailScrolls = useRef<Record<string, number>>(
    savedDiscoverState?.overviewRailScrolls ?? {}
  );
  const previousDiscoverMediaType = useRef(mediaType);
  const trendingTimerStartedAt = useRef<number | null>(null);
  const trendingRemainingMs = useRef(TRENDING_CYCLE_MS);
  const isRestoringScroll = useRef(false);
  const latestInitialScrollTop = useRef(initialScrollTop);
  const restoringScrollTarget = useRef(initialScrollTop);
  latestInitialScrollTop.current = initialScrollTop;

  useEffect(() => {
    discoverShelfPagesRef.current = discoverShelfPages;
  }, [discoverShelfPages]);

  useEffect(() => {
    if (previousDiscoverMediaType.current === mediaType) return;
    previousDiscoverMediaType.current = mediaType;
    setActiveDiscoverShelfId(null);
  }, [mediaType]);

  useEffect(() => {
    if (!window.desktopConfig) return;
    const desktopConfig = window.desktopConfig;

    let cancelled = false;

    async function loadDesktopLayoutOrders() {
      try {
        const result = await desktopConfig.getLayoutOrders(userId);
        if (cancelled || !result.ok) return;

        const missingLayouts: {
          personalLayoutOrder?: string[];
          mangaPersonalLayoutOrder?: string[];
          discoverLayoutOrder?: string[];
        } = {};

        if (result.personalLayoutOrder) {
          const order = normalizePersonalLayoutOrder(result.personalLayoutOrder);
          personalLayoutOrderRef.current = order;
          persistPersonalLayoutOrder(order);
          setPersonalLayoutOrder(order);
          if (JSON.stringify(result.personalLayoutOrder) !== JSON.stringify(order)) {
            missingLayouts.personalLayoutOrder = order;
          }
        } else {
          missingLayouts.personalLayoutOrder = personalLayoutOrderRef.current;
        }

        if (result.mangaPersonalLayoutOrder) {
          const order = normalizePersonalLayoutOrder(result.mangaPersonalLayoutOrder);
          mangaPersonalLayoutOrderRef.current = order;
          persistMangaPersonalLayoutOrder(order);
          setMangaPersonalLayoutOrder(order);
          if (JSON.stringify(result.mangaPersonalLayoutOrder) !== JSON.stringify(order)) {
            missingLayouts.mangaPersonalLayoutOrder = order;
          }
        } else {
          missingLayouts.mangaPersonalLayoutOrder = mangaPersonalLayoutOrderRef.current;
        }

        if (result.discoverLayoutOrder) {
          const order = result.discoverLayoutOrder.filter(
            (sectionId): sectionId is string => typeof sectionId === "string"
          );
          discoverLayoutOrderRef.current = order;
          persistDiscoverLayoutOrder(order);
          setDiscoverLayoutOrder(order);
        } else {
          missingLayouts.discoverLayoutOrder = discoverLayoutOrderRef.current;
        }

        if (Object.keys(missingLayouts).length > 0) {
          desktopConfig.setLayoutOrders(userId, missingLayouts);
        }
      } catch (error) {
        console.warn("Failed to load desktop layout configuration:", error);
      }
    }

    void loadDesktopLayoutOrders();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const rememberHomeScrollElement = useCallback((element: HTMLDivElement | null) => {
    homeScrollRef.current = element;
    onScrollContainerChange(element);
  }, [onScrollContainerChange]);

  useLayoutEffect(() => {
    let frame = 0;
    let timeout = 0;
    let cancelled = false;
    let attempts = 0;
    const targetScrollTop = latestInitialScrollTop.current;

    restoringScrollTarget.current = targetScrollTop;
    isRestoringScroll.current = targetScrollTop > 0;

    function restoreScroll() {
      if (cancelled) return;

      const container = homeScrollRef.current;
      if (!container) {
        isRestoringScroll.current = false;
        return;
      }

      container.scrollTop = targetScrollTop;
      const isAtTarget = Math.abs(container.scrollTop - targetScrollTop) < 2;
      const isAtTopTarget = targetScrollTop <= 0;

      if (isAtTarget || isAtTopTarget || attempts >= 40) {
        isRestoringScroll.current = false;
        onScrollPositionChange(targetScrollTop);
        return;
      }

      attempts += 1;
      timeout = window.setTimeout(() => {
        frame = window.requestAnimationFrame(restoreScroll);
      }, 50);
    }

    frame = window.requestAnimationFrame(restoreScroll);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      isRestoringScroll.current = false;
    };
  }, [hasResults, onScrollPositionChange]);

  useEffect(() => {
    if (activeHomeTab !== "personal") {
      setIsEditingPersonalLayout(false);
    }

    if (activeHomeTab !== "discover") {
      setIsEditingDiscoverLayout(false);
      setDraggedDiscoverSectionId(null);
    }
  }, [activeHomeTab]);

  useEffect(() => {
    setIsEditingPersonalLayout(false);
    setSelectedPersonalGridWidget(null);
    setDraggedPersonalGridWidget(null);
    setSelectedMangaPersonalGridWidget(null);
    setDraggedMangaPersonalGridWidget(null);
    setIsEditingDiscoverLayout(false);
    setDraggedDiscoverSectionId(null);
  }, [mediaType]);

  function saveDiscoverLayoutOrder(order: string[]) {
    discoverLayoutOrderRef.current = order;
    persistDiscoverLayoutOrder(order);
    setDiscoverLayoutOrder(order);
    const result = window.desktopConfig?.setLayoutOrders(userId, {
      discoverLayoutOrder: order,
    });
    if (result && !result.ok) {
      console.warn(result.message || "Failed to save Discover layout.");
    }
  }

  function handleResetPersonalLayout() {
    if (mediaType === "ANIME" || mediaType === "MANGA") {
      const nextLayout = cloneDefaultPersonalGridLayout();
      if (mediaType === "MANGA") {
        mangaPersonalGridLayoutRef.current = nextLayout;
        setMangaPersonalGridLayout(nextLayout);
        setSelectedMangaPersonalGridWidget(null);
        setDraggedMangaPersonalGridWidget(null);
        return;
      }
      personalGridLayoutRef.current = nextLayout;
      setPersonalGridLayout(nextLayout);
      setSelectedPersonalGridWidget(null);
      setDraggedPersonalGridWidget(null);
      return;
    }

  }

  function handleResetDiscoverLayout() {
    const defaultOrder = getDefaultDiscoverLayoutOrder(discoverShelves);
    saveDiscoverLayoutOrder(defaultOrder);
    setDraggedDiscoverSectionId(null);
  }

  function handleDiscoverSectionDragStart(
    sectionId: string,
    event: DragEvent<HTMLDivElement>
  ) {
    setDraggedDiscoverSectionId(sectionId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", sectionId);
  }

  function handleDiscoverSectionDragOver(
    sectionId: string,
    event: DragEvent<HTMLDivElement>
  ) {
    event.preventDefault();

    const activeSectionId = draggedDiscoverSectionId;
    if (!activeSectionId || activeSectionId === sectionId) {
      return;
    }

    saveDiscoverLayoutOrder(
      moveLayoutSection(
        normalizeDiscoverLayoutOrder(discoverLayoutOrderRef.current, discoverShelves),
        activeSectionId,
        sectionId
      )
    );
  }

  function handleDiscoverSectionDragEnd() {
    setDraggedDiscoverSectionId(null);
  }

  function handleTogglePersonalLayoutEdit() {
    if (mediaType === "ANIME" || mediaType === "MANGA") {
      const isManga = mediaType === "MANGA";
      if (isEditingPersonalLayout) {
        if (isManga) {
          persistMangaPersonalGridLayout(userId, mangaPersonalGridLayoutRef.current);
          setSelectedMangaPersonalGridWidget(null);
          setDraggedMangaPersonalGridWidget(null);
          mangaPersonalGridEditSnapshotRef.current = null;
        } else {
          persistPersonalGridLayout(userId, personalGridLayoutRef.current);
          setSelectedPersonalGridWidget(null);
          setDraggedPersonalGridWidget(null);
          personalGridEditSnapshotRef.current = null;
        }
      } else {
        if (isManga) {
          mangaPersonalGridEditSnapshotRef.current =
            mangaPersonalGridLayoutRef.current.map((item) => ({ ...item }));
        } else {
          personalGridEditSnapshotRef.current = personalGridLayoutRef.current.map(
            (item) => ({ ...item })
          );
        }
      }
      setIsEditingPersonalLayout((current) => !current);
      return;
    }

  }

  function handleCancelPersonalGridEdit() {
    const isManga = mediaType === "MANGA";
    const snapshot = isManga
      ? mangaPersonalGridEditSnapshotRef.current
      : personalGridEditSnapshotRef.current;
    if (snapshot) {
      const restored = normalizePersonalGridLayout(snapshot);
      if (isManga) {
        mangaPersonalGridLayoutRef.current = restored;
        setMangaPersonalGridLayout(restored);
        persistMangaPersonalGridLayout(userId, restored);
      } else {
        personalGridLayoutRef.current = restored;
        setPersonalGridLayout(restored);
        persistPersonalGridLayout(userId, restored);
      }
    }

    personalGridEditSnapshotRef.current = null;
    mangaPersonalGridEditSnapshotRef.current = null;
    setSelectedPersonalGridWidget(null);
    setDraggedPersonalGridWidget(null);
    setSelectedMangaPersonalGridWidget(null);
    setDraggedMangaPersonalGridWidget(null);
    setIsEditingPersonalLayout(false);
  }

  function updatePersonalGridLayout(
    updater: (current: PersonalGridItem[]) => PersonalGridItem[]
  ) {
    if (mediaType === "MANGA") {
      setMangaPersonalGridLayout((current) => {
        const next = normalizePersonalGridLayout(updater(current));
        mangaPersonalGridLayoutRef.current = next;
        return next;
      });
      return;
    }
    setPersonalGridLayout((current) => {
      const next = normalizePersonalGridLayout(updater(current));
      personalGridLayoutRef.current = next;
      return next;
    });
  }

  function handlePersonalGridResize(
    widgetId: PersonalGridWidgetId,
    columns: number,
    rows: number
  ) {
    updatePersonalGridLayout((current) =>
      current.map((item) =>
        item.id === widgetId ? { ...item, columns, rows } : item
      )
    );
  }

  function handlePersonalGridOrientation(widgetId: PersonalGridWidgetId) {
    if (!PERSONAL_GRID_SHELF_IDS.has(widgetId)) return;

    updatePersonalGridLayout((current) =>
      current.map((item) => {
        if (item.id !== widgetId) return item;
        const orientation = item.orientation === "vertical" ? "horizontal" : "vertical";
        if (item.id === "stats") {
          return orientation === "vertical"
            ? { ...item, orientation, columns: Math.min(item.columns, 4), rows: 5 }
            : { ...item, orientation, columns: Math.max(item.columns, 10), rows: 2 };
        }
        const columns =
          orientation === "vertical" && item.columns > 6
            ? 6
            : orientation === "horizontal" && item.columns < 6
              ? 6
              : item.columns;
        const rows =
          orientation === "vertical"
            ? Math.max(item.rows, 7)
            : PERSONAL_GRID_HORIZONTAL_ROWS[item.id] ?? 5;
        return { ...item, orientation, columns, rows };
      })
    );
  }

  function handlePersonalGridMove(widgetId: PersonalGridWidgetId, direction: -1 | 1) {
    updatePersonalGridLayout((current) => {
      const currentIndex = current.findIndex((item) => item.id === widgetId);
      const targetIndex = currentIndex + direction;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }
      const next = [...current];
      const [item] = next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  }

  function handlePersonalGridDragStart(
    widgetId: PersonalGridWidgetId,
    event: DragEvent<HTMLDivElement>
  ) {
    if (mediaType === "MANGA") {
      setSelectedMangaPersonalGridWidget(widgetId);
      setDraggedMangaPersonalGridWidget(widgetId);
    } else {
      setSelectedPersonalGridWidget(widgetId);
      setDraggedPersonalGridWidget(widgetId);
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", widgetId);
  }

  function handlePersonalGridDragOver(
    widgetId: PersonalGridWidgetId,
    event: DragEvent<HTMLDivElement>
  ) {
    event.preventDefault();
    const activeWidget =
      mediaType === "MANGA"
        ? draggedMangaPersonalGridWidget
        : draggedPersonalGridWidget;
    if (!activeWidget || activeWidget === widgetId) return;

    updatePersonalGridLayout((current) =>
      movePersonalGridWidget(current, activeWidget, widgetId)
    );
  }

  function handlePersonalGridDragEnd() {
    setDraggedPersonalGridWidget(null);
    setDraggedMangaPersonalGridWidget(null);
  }

  function handleToggleDiscoverLayoutEdit() {
    if (isEditingDiscoverLayout) {
      persistDiscoverLayoutOrder(discoverLayoutOrderRef.current);
    }

    setIsEditingDiscoverLayout((current) => !current);
  }

  function pauseTrendingRotation() {
    if (!autoRotateTrending || isTrendingPaused) return;

    if (trendingTimerStartedAt.current !== null) {
      const elapsed = Date.now() - trendingTimerStartedAt.current;
      trendingRemainingMs.current = Math.max(0, trendingRemainingMs.current - elapsed);
    }

    setIsTrendingPaused(true);
  }

  function resumeTrendingRotation() {
    if (!isTrendingPaused) return;
    setIsTrendingPaused(false);
  }

  function saveDiscoverOverviewPosition() {
    discoverOverviewScrollTop.current = homeScrollRef.current?.scrollTop ?? 0;
    discoverOverviewRailScrolls.current = Object.fromEntries(
      Object.entries(discoverRailRefs.current).map(([shelfId, rail]) => [
        shelfId,
        rail?.scrollLeft ?? 0,
      ])
    );
  }

  const saveDiscoverStateSnapshot = useCallback((
    nextActiveDiscoverShelfId = activeDiscoverShelfId,
    nextDiscoverShelfPages = discoverShelfPages
  ) => {
    const scrollTop = homeScrollRef.current?.scrollTop ?? 0;
    const activeStateKey = nextActiveDiscoverShelfId
      ? getDiscoverShelfStateKey(mediaType, nextActiveDiscoverShelfId)
      : null;
    const pagesWithScroll =
      activeStateKey && nextDiscoverShelfPages[activeStateKey]
        ? {
            ...nextDiscoverShelfPages,
            [activeStateKey]: {
              ...nextDiscoverShelfPages[activeStateKey],
              scrollTop,
            },
          }
        : nextDiscoverShelfPages;
    const pages = Object.fromEntries(
      Object.entries(pagesWithScroll).flatMap(([stateKey, state]) => {
        if (state.isLoading) {
          return [];
        }

        return [[
          stateKey,
          {
            ...state,
            page: state.pageInfo?.currentPage ?? state.page,
            isLoading: false,
            isLoadingMore: false,
            loadMoreError: null,
          },
        ]];
      })
    );
    const persistedActiveShelfId =
      nextActiveDiscoverShelfId &&
      Object.keys(pages).some((stateKey) => stateKey.endsWith(`:${nextActiveDiscoverShelfId}`))
        ? nextActiveDiscoverShelfId
        : null;

    window.localStorage.setItem(
      HOME_DISCOVER_STATE_STORAGE_KEY,
      JSON.stringify({
        version: HOME_DISCOVER_STATE_VERSION,
        savedAt: Date.now(),
        activeDiscoverShelfId: persistedActiveShelfId,
        discoverShelfPages: pages,
        overviewScrollTop: discoverOverviewScrollTop.current,
        overviewRailScrolls: discoverOverviewRailScrolls.current,
      } satisfies SavedDiscoverState)
    );
  }, [activeDiscoverShelfId, discoverShelfPages, mediaType]);

  function restoreDiscoverOverviewPosition() {
    window.requestAnimationFrame(() => {
      if (homeScrollRef.current) {
        homeScrollRef.current.scrollTop = discoverOverviewScrollTop.current;
      }

      for (const [shelfId, scrollLeft] of Object.entries(
        discoverOverviewRailScrolls.current
      )) {
        const rail = discoverRailRefs.current[shelfId];
        if (rail) {
          rail.scrollLeft = scrollLeft;
        }
      }
    });
  }

  function saveActiveDiscoverListPosition() {
    if (!activeDiscoverShelfId) return;

    const stateKey = getDiscoverShelfStateKey(mediaType, activeDiscoverShelfId);
    const scrollTop = homeScrollRef.current?.scrollTop ?? 0;
    setDiscoverShelfPages((current) => {
      const existing = current[stateKey];
      if (!existing) return current;

      return {
        ...current,
        [stateKey]: {
          ...existing,
          scrollTop,
        },
      };
    });
  }

  async function loadDiscoverShelfPage(
    shelf: DiscoverShelf,
    page: number,
    scrollTop = 0,
    append = false
  ) {
    const stateKey = getDiscoverShelfStateKey(mediaType, shelf.id);
    setDiscoverShelfPages((current) => ({
      ...current,
      [stateKey]: {
        shelf,
        items: current[stateKey]?.items ?? shelf.items,
        pageInfo: current[stateKey]?.pageInfo ?? null,
        page,
        isLoading: !append,
        isLoadingMore: append,
        scrollTop,
        warning: current[stateKey]?.warning ?? null,
        loadMoreError: null,
      },
    }));

    try {
      const data = await window.api.getDiscoverShelfAnime(
        shelf.id,
        page,
        hideAdultContent,
        mediaType
      );

      setDiscoverShelfPages((current) => ({
        ...current,
        [stateKey]: {
          shelf: {
            id: data.id ?? shelf.id,
            title: data.title ?? shelf.title,
            description: data.description ?? shelf.description,
            pills: Array.isArray(data.pills) ? data.pills : shelf.pills,
            items: Array.isArray(data.items) ? data.items : shelf.items,
          },
          items: append
            ? mergeAnimeItems(current[stateKey]?.items ?? [], data.items ?? [])
            : Array.isArray(data.items)
            ? data.items
            : [],
          pageInfo: data.pageInfo ?? null,
          page,
          isLoading: false,
          isLoadingMore: false,
          scrollTop,
          warning: typeof data.warning === "string" ? data.warning : null,
          loadMoreError: null,
        },
      }));
    } catch (error) {
      console.error("Failed to load discover shelf page:", error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : "AniList did not return the next page. Try again.";
      setDiscoverShelfPages((current) => ({
        ...current,
        [stateKey]: {
          ...(current[stateKey] ?? {
            shelf,
            items: shelf.items,
            pageInfo: null,
            page,
            isLoadingMore: false,
            scrollTop,
          }),
          isLoading: false,
          isLoadingMore: false,
          warning: append ? current[stateKey]?.warning ?? null : message,
          loadMoreError: append ? message : null,
        },
      }));
    }
  }

  function handleOpenDiscoverShelf(shelf: DiscoverShelf) {
    saveDiscoverOverviewPosition();
    setActiveDiscoverShelfId(shelf.id);

    const stateKey = getDiscoverShelfStateKey(mediaType, shelf.id);
    const existing = discoverShelfPages[stateKey];
    if (!existing) {
      void loadDiscoverShelfPage(shelf, 1, 0);
      window.requestAnimationFrame(() => {
        if (homeScrollRef.current) {
          homeScrollRef.current.scrollTop = 0;
        }
      });
      return;
    }

    window.requestAnimationFrame(() => {
      if (homeScrollRef.current) {
        homeScrollRef.current.scrollTop = existing.scrollTop;
      }
    });
  }

  function handleCloseDiscoverShelf() {
    saveActiveDiscoverListPosition();
    setActiveDiscoverShelfId(null);
    restoreDiscoverOverviewPosition();
  }

  function handleLoadMoreDiscoverShelf(shelf: DiscoverShelf) {
    const state = discoverShelfPages[getDiscoverShelfStateKey(mediaType, shelf.id)];
    if (!state?.pageInfo?.hasNextPage || state.isLoading || state.isLoadingMore) {
      return;
    }

    void loadDiscoverShelfPage(
      shelf,
      state.pageInfo.currentPage + 1,
      homeScrollRef.current?.scrollTop ?? state.scrollTop,
      true
    );
  }

  function handleRetryDiscover() {
    const cacheKey = getHomeAnimeCacheKey(hideAdultContent);
    discoverMediaRequests.delete(cacheKey);
    discoverMediaCache.delete(cacheKey);
    setTrendingAnime([]);
    setDiscoverShelves([]);
    setDiscoverError(null);
    setDiscoverRetryKey((current) => current + 1);
  }

  function handleSelectAnimeFromHome(animeId: number) {
    saveActiveDiscoverListPosition();
    saveDiscoverStateSnapshot();
    onSelectAnime(animeId);
  }

  function handleSelectDiscoverMedia(mediaId: number) {
    saveActiveDiscoverListPosition();
    saveDiscoverStateSnapshot();
    onSelectMedia(mediaId, mediaType);
  }

  useEffect(() => {
    if (!discoverShelves.length) {
      return;
    }

    setDiscoverLayoutOrder((current) => {
      const nextOrder = normalizeDiscoverLayoutOrder(current, discoverShelves);
      return nextOrder;
    });
  }, [discoverShelves]);

  useEffect(() => {
    saveDiscoverStateSnapshot();
  }, [saveDiscoverStateSnapshot]);

  useEffect(() => {
    if (activeHomeTab !== "discover") return;

    window.requestAnimationFrame(() => {
      if (
        activeDiscoverShelfId &&
        discoverShelfPagesRef.current[
          getDiscoverShelfStateKey(mediaType, activeDiscoverShelfId)
        ]
      ) {
        return;
      }

      for (const [shelfId, scrollLeft] of Object.entries(
        discoverOverviewRailScrolls.current
      )) {
        const rail = discoverRailRefs.current[shelfId];
        if (rail) {
          rail.scrollLeft = scrollLeft;
        }
      }
    });
  }, [activeDiscoverShelfId, activeHomeTab, mediaType]);

  useEffect(() => {
    let mounted = true;
    const cacheKey = getHomeAnimeCacheKey(hideAdultContent);

    function applyCatalog(catalog: DiscoverMediaCatalog) {
      const activeCatalog = mediaType === "MANGA" ? catalog.manga : catalog.anime;
      setTrendingAnime(showTrendingCarousel ? activeCatalog.trending : []);
      setDiscoverShelves(activeCatalog.shelves);
      setActiveTrendingIndex(0);
      setTrendingCycleKey(0);
      setIsTrendingPaused(false);
      setDiscoverError(null);
      setIsTrendingLoading(false);
      setIsDiscoverLoading(false);
      trendingRemainingMs.current = TRENDING_CYCLE_MS;
    }

    async function loadDiscoverMedia() {
      const cached = readFreshHomeAnimeCache(discoverMediaCache, cacheKey);
      if (cached) {
        applyCatalog(cached);
        return;
      }

      setIsTrendingLoading(showTrendingCarousel);
      setIsDiscoverLoading(true);
      setDiscoverError(null);

      try {
        let request = discoverMediaRequests.get(cacheKey);

        if (!request) {
          request = (async (): Promise<DiscoverMediaCatalog> => {
            const result = await window.api.getDiscoverMedia(hideAdultContent);
            return {
              anime: {
                trending: Array.isArray(result?.anime?.trending)
                  ? (result.anime.trending as TrendingAnime[])
                  : [],
                shelves: Array.isArray(result?.anime?.shelves)
                  ? (result.anime.shelves as DiscoverShelf[])
                  : [],
              },
              manga: {
                trending: Array.isArray(result?.manga?.trending)
                  ? (result.manga.trending as TrendingAnime[])
                  : [],
                shelves: Array.isArray(result?.manga?.shelves)
                  ? (result.manga.shelves as DiscoverShelf[])
                  : [],
              },
            };
          })();
          discoverMediaRequests.set(cacheKey, request);
        }

        const data = await request;
        writeHomeAnimeCache(discoverMediaCache, cacheKey, data);

        if (mounted) {
          applyCatalog(data);
        }
      } catch (error) {
        console.error("Failed to load Anime and Manga discovery:", error);
        if (mounted) {
          const fallback = discoverMediaCache.get(cacheKey)?.data;
          const fallbackCatalog = fallback
            ? mediaType === "MANGA"
              ? fallback.manga
              : fallback.anime
            : null;
          setTrendingAnime(
            showTrendingCarousel ? fallbackCatalog?.trending ?? [] : []
          );
          setDiscoverShelves(fallbackCatalog?.shelves ?? []);
          setDiscoverError(
            fallbackCatalog?.shelves.length
              ? "Some discovery content could not refresh."
              : "AniList may be temporarily unavailable. Try again in a moment."
          );
        }
      } finally {
        discoverMediaRequests.delete(cacheKey);
        if (mounted) {
          setIsTrendingLoading(false);
          setIsDiscoverLoading(false);
        }
      }
    }

    if (!hasResults && !showTutorial && activeHomeTab === "discover") {
      void loadDiscoverMedia();
    }

    return () => {
      mounted = false;
    };
  }, [
    activeHomeTab,
    discoverRetryKey,
    hasResults,
    hideAdultContent,
    mediaType,
    showTrendingCarousel,
    showTutorial,
  ]);

  useEffect(() => {
    if (!autoRotateTrending || privacySafeTrendingAnime.length <= 1 || isTrendingPaused) {
      trendingTimerStartedAt.current = null;
      return;
    }

    trendingTimerStartedAt.current = Date.now();

    const timer = window.setTimeout(() => {
      trendingRemainingMs.current = TRENDING_CYCLE_MS;
      trendingTimerStartedAt.current = null;
      setActiveTrendingIndex((current) => (current + 1) % privacySafeTrendingAnime.length);
      setTrendingCycleKey((current) => current + 1);
    }, trendingRemainingMs.current);

    return () => window.clearTimeout(timer);
  }, [
    autoRotateTrending,
    privacySafeTrendingAnime.length,
    activeTrendingIndex,
    trendingCycleKey,
    isTrendingPaused,
  ]);

  function handleSelectTrendingIndex(index: number) {
    trendingRemainingMs.current = TRENDING_CYCLE_MS;
    trendingTimerStartedAt.current = null;
    setActiveTrendingIndex(index);
    setTrendingCycleKey((current) => current + 1);
  }

  useEffect(() => {
    if (
      hasResults ||
      showTutorial ||
      mediaType !== "ANIME" ||
      activeHomeTab !== "personal"
    ) {
      return;
    }

    const favoriteEntries = trackedEntries.filter(
      (entry) => Boolean(entry.is_favorite) && entry.status !== "dropped"
    );
    const availableSourceCount = favoriteEntries.filter((entry) => {
      const loadedRecommendations = favoriteRecommendationsByAnimeId[entry.anime_id];
      return (loadedRecommendations ?? entry.recommendations ?? []).length > 0;
    }).length;

    if (availableSourceCount >= 4) return;

    const missingEntries = favoriteEntries
      .filter(
        (entry) =>
          !(entry.recommendations?.length) &&
          !Object.hasOwn(favoriteRecommendationsByAnimeId, entry.anime_id) &&
          !requestedFavoriteRecommendationIds.current.has(entry.anime_id)
      )
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));

    if (!missingEntries.length) return;

    let cancelled = false;

    async function loadNextFavoriteRecommendations() {
      const entry = missingEntries[0];
      requestedFavoriteRecommendationIds.current.add(entry.anime_id);

      try {
        const media = await window.api.getAnimeDetails(entry.anime_id);
        if (cancelled) return;

        setFavoriteRecommendationsByAnimeId((current) => ({
          ...current,
          [entry.anime_id]: media.recommendations?.nodes ?? [],
        }));
      } catch {
        if (cancelled) return;

        setFavoriteRecommendationsByAnimeId((current) => ({
          ...current,
          [entry.anime_id]: [],
        }));
      }
    }

    void loadNextFavoriteRecommendations();

    return () => {
      cancelled = true;
    };
  }, [
    activeHomeTab,
    favoriteRecommendationsByAnimeId,
    hasResults,
    mediaType,
    showTutorial,
    trackedEntries,
  ]);

  useEffect(() => {
    if (
      hasResults ||
      showTutorial ||
      mediaType !== "MANGA" ||
      activeHomeTab !== "personal"
    ) {
      return;
    }

    const favoriteEntries = trackedMangaEntries.filter(
      (entry) => Boolean(entry.is_favorite) && entry.status !== "dropped"
    );
    const availableSourceCount = favoriteEntries.filter((entry) => {
      const loadedRecommendations = favoriteRecommendationsByMangaId[entry.manga_id];
      return (loadedRecommendations ?? entry.recommendations ?? []).length > 0;
    }).length;

    if (availableSourceCount >= 4) return;

    const missingEntries = favoriteEntries
      .filter(
        (entry) =>
          !(entry.recommendations?.length) &&
          !Object.hasOwn(favoriteRecommendationsByMangaId, entry.manga_id) &&
          !requestedFavoriteMangaRecommendationIds.current.has(entry.manga_id)
      )
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));

    if (!missingEntries.length) return;

    let cancelled = false;

    async function loadNextFavoriteMangaRecommendations() {
      const entry = missingEntries[0];
      requestedFavoriteMangaRecommendationIds.current.add(entry.manga_id);

      try {
        const media = await window.api.getMediaDetails("MANGA", entry.manga_id);
        if (cancelled) return;

        setFavoriteRecommendationsByMangaId((current) => ({
          ...current,
          [entry.manga_id]: (media.recommendations?.nodes ?? []) as RecommendationEntry[],
        }));
      } catch {
        if (cancelled) return;

        setFavoriteRecommendationsByMangaId((current) => ({
          ...current,
          [entry.manga_id]: [],
        }));
      }
    }

    void loadNextFavoriteMangaRecommendations();
    return () => {
      cancelled = true;
    };
  }, [
    activeHomeTab,
    favoriteRecommendationsByMangaId,
    hasResults,
    mediaType,
    showTutorial,
    trackedMangaEntries,
  ]);

  const watching = useMemo(
    () => trackedEntries.filter((entry) => entry.status === "watching"),
    [trackedEntries]
  );
  const planned = useMemo(
    () => trackedEntries.filter((entry) => entry.status === "planned"),
    [trackedEntries]
  );
  const completed = useMemo(
    () => trackedEntries.filter((entry) => entry.status === "completed"),
    [trackedEntries]
  );
  const paused = useMemo(
    () => trackedEntries.filter((entry) => entry.status === "paused"),
    [trackedEntries]
  );
  const dropped = useMemo(
    () => trackedEntries.filter((entry) => entry.status === "dropped"),
    [trackedEntries]
  );
  const favoriteCount = useMemo(
    () => trackedEntries.filter((entry) => Boolean(entry.is_favorite)).length,
    [trackedEntries]
  );
  const watchedEpisodes = useMemo(
    () =>
      trackedEntries.reduce((sum, entry) => {
        return sum + Math.max(0, entry.progress || 0);
      }, 0),
    [trackedEntries]
  );
  const totalEpisodes = useMemo(
    () =>
      trackedEntries.reduce((sum, entry) => {
        const episodes = Number(entry.episodes);

        if (!Number.isFinite(episodes) || episodes <= 0) {
          return sum;
        }

        return sum + episodes;
      }, 0),
    [trackedEntries]
  );
  const watchedMinutes = useMemo(
    () =>
      trackedEntries.reduce((sum, entry) => {
        const progress = Math.max(0, entry.progress || 0);
        const duration = Number(entry.duration);

        if (!progress || !Number.isFinite(duration) || duration <= 0) {
          return sum;
        }

        return sum + progress * duration;
      }, 0),
    [trackedEntries]
  );
  const averagePersonalScore = useMemo(() => {
    const scoredEntries = trackedEntries.filter(
      (entry) => typeof entry.score === "number" && entry.score > 0
    );

    if (!scoredEntries.length) return null;

    const total = scoredEntries.reduce((sum, entry) => sum + (entry.score ?? 0), 0);
    return total / scoredEntries.length;
  }, [trackedEntries]);
  const recommendationReadyEntries = useMemo(
    () =>
      trackedEntries.map((entry) => {
        const loadedRecommendations = favoriteRecommendationsByAnimeId[entry.anime_id];

        return loadedRecommendations
          ? { ...entry, recommendations: loadedRecommendations }
          : entry;
      }),
    [favoriteRecommendationsByAnimeId, trackedEntries]
  );
  const favoriteBasedRecommendations = useMemo(
    () => buildPersonalizedRecommendations(recommendationReadyEntries, titleLanguage, {
      favoriteSourcesOnly: true,
    }),
    [recommendationReadyEntries, titleLanguage]
  );
  const recommendationReadyMangaEntries = useMemo(
    () =>
      trackedMangaEntries.map((entry) => ({
        ...entry,
        anime_id: entry.manga_id,
        recommendations:
          favoriteRecommendationsByMangaId[entry.manga_id] ?? entry.recommendations ?? [],
      })) as unknown as TrackedAnimeEntry[],
    [favoriteRecommendationsByMangaId, trackedMangaEntries]
  );
  const favoriteBasedMangaRecommendations = useMemo(
    () =>
      buildPersonalizedRecommendations(recommendationReadyMangaEntries, titleLanguage, {
        favoriteSourcesOnly: true,
        mediaType: "MANGA",
      }),
    [recommendationReadyMangaEntries, titleLanguage]
  );
  const trackedAnimeIds = useMemo(
    () => new Set(trackedEntries.map((entry) => entry.anime_id)),
    [trackedEntries]
  );
  const trackedEntryByAnimeId = useMemo(
    () => new Map(trackedEntries.map((entry) => [entry.anime_id, entry])),
    [trackedEntries]
  );
  const spotlight = useMemo(() => {
    return (
      mostRecentlyActiveWithArtwork(watching) ||
      mostRecentlyActiveWithArtwork(planned) ||
      mostRecentlyActiveWithArtwork(trackedEntries) ||
      null
    );
  }, [planned, trackedEntries, watching]);

  if (showTutorial) {
    return (
      <Tutorial
        step={tutorialStep}
        onStepChange={setTutorialStep}
        onSkip={onDismissTutorial}
        onFinish={(destination) => {
          void onDismissTutorial();
          onLibraryDestinationChange(destination);
        }}
      />
    );
  }

  if (hasResults) {
    return <>{children}</>;
  }

  const personalGridWidgets: Record<
    PersonalGridWidgetId,
    (item: PersonalGridItem) => ReactNode
  > = {
    spotlight: (item) => (
      <SpotlightPanel
        entry={spotlight}
        onSelectAnime={handleSelectAnimeFromHome}
        titleLanguage={titleLanguage}
        compact={item.rows <= 5 || item.columns <= 5}
      />
    ),
    account: (item) => (
      <AccountOverviewPanel
        total={trackedEntries.length}
        totalEpisodes={totalEpisodes}
        watchedEpisodes={watchedEpisodes}
        watchedMinutes={watchedMinutes}
        averageScore={averagePersonalScore}
        favorites={favoriteCount}
        columns={item.columns}
        rows={item.rows}
      />
    ),
    stats: (item) => (
      <section
        className={`grid h-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] shadow-lg ${
          item.orientation === "vertical"
            ? "grid-cols-1 divide-y divide-white/10"
            : "grid-cols-5 divide-x divide-white/10"
        }`}
      >
        <StatTile icon={PlayCircleIcon} label="Watching" value={watching.length} strip />
        <StatTile icon={BookmarkIcon} label="Planned" value={planned.length} strip />
        <StatTile icon={CheckCircleIcon} label="Completed" value={completed.length} strip />
        <StatTile icon={ClockIcon} label="Paused" value={paused.length} strip />
        <StatTile icon={BrokenHeartIcon} label="Dropped" value={dropped.length} strip />
      </section>
    ),
    activity: (item) => (
      <RecentActivityShelf
        entries={visibleRecentMediaHistory}
        density={homeDensity}
        titleLanguage={titleLanguage}
        orientation={item.orientation ?? "horizontal"}
        onSelectMedia={handleSelectAnimeFromHome}
        onDismiss={handleDismissRecentMedia}
      />
    ),
    continue: (item) => {
      const vertical = item.orientation === "vertical";
      return (
        <HomeShelf
          title="Continue Watching"
          icon={PlayCircleIcon}
          entries={watching.slice(0, 15)}
          emptyText="Move something into Watching and it will appear here."
          onSelectAnime={handleSelectAnimeFromHome}
          variant={vertical ? "list" : "medium"}
          density={homeDensity}
          titleLanguage={titleLanguage}
          carousel={!vertical}
          verticalScroll={vertical}
          autoScroll={autoScrollHomeShelves && !isEditingPersonalLayout && !vertical}
          fitGridHeight={!vertical}
        />
      );
    },
    planned: (item) => {
      const vertical = item.orientation === "vertical";
      return (
        <HomeShelf
          title="Planned Picks"
          icon={BookmarkIcon}
          entries={planned.slice(0, 15)}
          emptyText="Add titles as Planned to build a clean watch queue."
          onSelectAnime={handleSelectAnimeFromHome}
          variant={vertical ? "list" : "medium"}
          density={homeDensity}
          titleLanguage={titleLanguage}
          carousel={!vertical}
          verticalScroll={vertical}
          autoScroll={autoScrollHomeShelves && !isEditingPersonalLayout && !vertical}
          fitGridHeight={!vertical}
        />
      );
    },
    sinceLiked: (item) => (
      <SinceYouLikedSection
        entries={favoriteBasedRecommendations}
        onSelectMedia={handleSelectAnimeFromHome}
        titleLanguage={titleLanguage}
        mediaType="ANIME"
        maxItems={item.rows >= 10 ? 4 : item.rows >= 8 ? 3 : 2}
      />
    ),
  };
  const emptyPersonalOverview = (
    <>
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1.45fr_0.9fr]">
        <SpotlightPanel
          entry={spotlight}
          onSelectAnime={handleSelectAnimeFromHome}
          titleLanguage={titleLanguage}
        />

        <AccountOverviewPanel
          total={trackedEntries.length}
          totalEpisodes={totalEpisodes}
          watchedEpisodes={watchedEpisodes}
          watchedMinutes={watchedMinutes}
          averageScore={averagePersonalScore}
          favorites={favoriteCount}
        />
      </section>
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile icon={PlayCircleIcon} label="Watching" value={watching.length} />
        <StatTile icon={BookmarkIcon} label="Planned" value={planned.length} />
        <StatTile icon={CheckCircleIcon} label="Completed" value={completed.length} />
        <StatTile icon={ClockIcon} label="Paused" value={paused.length} />
        <StatTile icon={BrokenHeartIcon} label="Dropped" value={dropped.length} />
      </section>
      <EmptyHomeState />
    </>
  );
  const discoverShelvesById = new Map(
    privacySafeDiscoverShelves.map((shelf) => [shelf.id, shelf])
  );
  const discoverLayoutSections: Record<string, ReactNode> = {
    [DISCOVER_CAROUSEL_LAYOUT_ID]: showTrendingCarousel ? (
      <TrendingCarousel
        key={`${mediaType}-${hideAdultContent ? "safe" : "all"}`}
        items={privacySafeTrendingAnime}
        activeIndex={activeTrendingIndex}
        onSelectIndex={handleSelectTrendingIndex}
        onSelectAnime={handleSelectDiscoverMedia}
        titleLanguage={titleLanguage}
        autoRotate={autoRotateTrending && !isEditingDiscoverLayout}
        animateEntryChanges={animationLevel !== "off"}
        cycleKey={trendingCycleKey}
        isPaused={isTrendingPaused}
        isLoading={isTrendingLoading}
        onPause={pauseTrendingRotation}
        onResume={resumeTrendingRotation}
      />
    ) : null,
    ...Object.fromEntries(
      privacySafeDiscoverShelves.map((shelf) => [
        shelf.id,
        <DiscoverAnimeShelf
          key={shelf.id}
          shelf={shelf}
          mediaType={mediaType}
          onSelectAnime={handleSelectDiscoverMedia}
          onQuickAddAnime={onQuickAddAnime}
          onEditEntry={onEditEntry}
          onSeeAll={handleOpenDiscoverShelf}
          trackedAnimeIds={trackedAnimeIds}
          trackedEntryByAnimeId={trackedEntryByAnimeId}
          titleLanguage={titleLanguage}
          autoScroll={autoScrollHomeShelves && !isEditingDiscoverLayout}
          density={discoverDensity}
          railRef={(element) => {
            discoverRailRefs.current[
              getDiscoverShelfStateKey(mediaType, shelf.id)
            ] = element;
          }}
        />,
      ])
    ),
  };
  const visibleDiscoverLayoutOrder = normalizeDiscoverLayoutOrder(
    discoverLayoutOrder,
    privacySafeDiscoverShelves
  ).filter((sectionId) => sectionId !== DISCOVER_CAROUSEL_LAYOUT_ID || showTrendingCarousel);

  return (
    <div
      data-global-scroll-root
      ref={rememberHomeScrollElement}
      onScroll={(event) => {
        const scrollTop = event.currentTarget.scrollTop;

        if (isRestoringScroll.current && scrollTop < restoringScrollTarget.current) {
          return;
        }

        onScrollPositionChange(scrollTop);

        if (mediaType === "ANIME" && activeHomeTab === "discover" && !activeDiscoverShelfId) {
          discoverOverviewScrollTop.current = scrollTop;
        }
      }}
      className="scroll-container h-full overflow-y-auto px-6 py-24 text-white"
    >
      <div className="mx-auto max-w-6xl space-y-10">
        <section className="flex flex-col gap-5 border-b border-white/10 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.24em] text-white/35">Home</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">
              {activeHomeTab === "personal"
                ? mediaType === "MANGA"
                  ? "Manga overview"
                  : "Anime overview"
                : mediaType === "MANGA"
                  ? "Discover manga"
                  : "Discover anime"}
            </h1>
          </div>

          <LibraryLens
            mediaType={mediaType}
            destination={activeHomeTab}
            onMediaChange={onMediaTypeChange}
            onDestinationChange={onLibraryDestinationChange}
            onVisibilityChange={onLibraryLensVisibilityChange}
          />
        </section>

        {activeHomeTab === "personal" && mediaType === "MANGA" ? (
          <MangaHomePreview
            entries={trackedMangaEntries}
            recommendations={favoriteBasedMangaRecommendations}
            gridLayout={mangaPersonalGridLayout}
            isEditingLayout={isEditingPersonalLayout}
            selectedWidget={selectedMangaPersonalGridWidget}
            draggedWidget={draggedMangaPersonalGridWidget}
            titleLanguage={titleLanguage}
            recentActivity={visibleRecentMediaHistory}
            onSelectManga={(mangaId) => onSelectMedia(mangaId, "MANGA")}
            onDismissRecentMedia={handleDismissRecentMedia}
            onToggleLayoutEdit={handleTogglePersonalLayoutEdit}
            onResetLayout={handleResetPersonalLayout}
            onCancelLayout={handleCancelPersonalGridEdit}
            onSelectWidget={setSelectedMangaPersonalGridWidget}
            onMoveWidget={handlePersonalGridMove}
            onResizeWidget={handlePersonalGridResize}
            onToggleOrientation={handlePersonalGridOrientation}
            onDragStart={handlePersonalGridDragStart}
            onDragOver={handlePersonalGridDragOver}
            onDragEnd={handlePersonalGridDragEnd}
            density={homeDensity}
            autoScroll={autoScrollHomeShelves}
          />
        ) : activeHomeTab === "personal" ? (
          <>
            <HomeLayoutToolbar
              title='"Personal" layout'
              isEditing={isEditingPersonalLayout}
              onToggleEdit={handleTogglePersonalLayoutEdit}
              onReset={handleResetPersonalLayout}
              onCancel={handleCancelPersonalGridEdit}
              idleDescription="Arrange, resize, and rotate your dashboard widgets."
              editingDescription="Select a widget to move, resize, or change its orientation."
            />

            {trackedEntries.length || visibleRecentMediaHistory.length || isEditingPersonalLayout ? (
              <PersonalGridDashboard
                layout={personalGridLayout}
                isEditing={isEditingPersonalLayout}
                selectedWidget={selectedPersonalGridWidget}
                draggedWidget={draggedPersonalGridWidget}
                renderWidget={(item) => personalGridWidgets[item.id](item)}
                onSelectWidget={setSelectedPersonalGridWidget}
                onMoveWidget={handlePersonalGridMove}
                onResizeWidget={handlePersonalGridResize}
                onToggleOrientation={handlePersonalGridOrientation}
                onDragStart={handlePersonalGridDragStart}
                onDragOver={handlePersonalGridDragOver}
                onDragEnd={handlePersonalGridDragEnd}
              />
            ) : (
              emptyPersonalOverview
            )}
          </>
        ) : activeDiscoverShelfId ? (
          <DiscoverShelfListPage
            state={
              privacySafeDiscoverShelfPages[
                getDiscoverShelfStateKey(mediaType, activeDiscoverShelfId)
              ]
            }
            fallbackShelf={privacySafeDiscoverShelves.find(
              (shelf) => shelf.id === activeDiscoverShelfId
            )}
            onBack={handleCloseDiscoverShelf}
            mediaType={mediaType}
            onSelectAnime={handleSelectDiscoverMedia}
            onQuickAddAnime={onQuickAddAnime}
            onEditEntry={onEditEntry}
            onLoadMore={handleLoadMoreDiscoverShelf}
            trackedAnimeIds={trackedAnimeIds}
            trackedEntryByAnimeId={trackedEntryByAnimeId}
            titleLanguage={titleLanguage}
            density={discoverDensity}
          />
        ) : (
          <>
            <HomeLayoutToolbar
              title='"Discover" layout'
              isEditing={isEditingDiscoverLayout}
              onToggleEdit={handleToggleDiscoverLayoutEdit}
              onReset={handleResetDiscoverLayout}
            />

            {isDiscoverLoading && !privacySafeDiscoverShelves.length ? (
              <DiscoverShelvesSkeleton
                density={discoverDensity}
                showTrendingCarousel={showTrendingCarousel}
              />
            ) : privacySafeDiscoverShelves.length ? (
              <>
                {discoverError && (
                  <DiscoverLoadError
                    message={discoverError}
                    isRetrying={isDiscoverLoading}
                    onRetry={handleRetryDiscover}
                    compact
                  />
                )}

                {visibleDiscoverLayoutOrder.map((sectionId) => (
                  <LayoutEditBlock
                    key={sectionId}
                    sectionId={sectionId}
                    label={
                      sectionId === DISCOVER_CAROUSEL_LAYOUT_ID
                        ? "Trending carousel"
                        : discoverShelvesById.get(sectionId)?.title ?? "Discover shelf"
                    }
                    isEditing={isEditingDiscoverLayout}
                    isDragging={draggedDiscoverSectionId === sectionId}
                    onDragStart={handleDiscoverSectionDragStart}
                    onDragOver={handleDiscoverSectionDragOver}
                    onDragEnd={handleDiscoverSectionDragEnd}
                  >
                    {discoverLayoutSections[sectionId]}
                  </LayoutEditBlock>
                ))}
              </>
            ) : (
              <DiscoverLoadError
                message={
                  discoverError ??
                  "AniList may be temporarily unavailable. Try again in a moment."
                }
                isRetrying={isDiscoverLoading}
                onRetry={handleRetryDiscover}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DiscoverLoadError({
  message,
  isRetrying,
  onRetry,
  compact = false,
}: {
  message: string;
  isRetrying: boolean;
  onRetry: () => void;
  compact?: boolean;
}) {
  if (!compact) {
    return <AsyncStatePanel icon={ExclamationTriangleIcon} title="There was a problem loading content." message={message} busy={isRetrying} actionLabel={isRetrying ? "Retrying..." : "Retry"} onAction={onRetry} />;
  }

  return (
    <section
      className={`rounded-3xl border border-white/10 bg-white/4 shadow-xl ${
        compact ? "px-5 py-4" : "px-6 py-10"
      }`}
      role="status"
    >
      <div
        className={
          compact
            ? "flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
            : "mx-auto flex max-w-xl flex-col items-center text-center"
        }
      >
        <div className={compact ? "flex items-center gap-3" : ""}>
          <div
            className={`inline-flex shrink-0 items-center justify-center rounded-2xl border border-amber-300/20 bg-amber-300/10 text-amber-100 ${
              compact ? "h-11 w-11" : "h-14 w-14"
            }`}
          >
            <ExclamationTriangleIcon className={compact ? "h-5 w-5" : "h-7 w-7"} />
          </div>

          <div className={compact ? "min-w-0" : "mt-5"}>
            <h2 className="text-lg font-semibold text-white">
              There was a problem loading content.
            </h2>
            <p className="mt-1 text-sm leading-6 text-white/55">{message}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          className={`inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-white/55 disabled:cursor-not-allowed disabled:opacity-60 ${
            compact ? "w-full md:w-auto" : "mt-6"
          }`}
        >
          <ArrowPathIcon className={`h-4 w-4 ${isRetrying ? "animate-spin" : ""}`} />
          {isRetrying ? "Retrying..." : "Retry"}
        </button>
      </div>
    </section>
  );
}

function RecentActivityShelf({
  entries,
  density,
  titleLanguage,
  orientation = "horizontal",
  onSelectMedia,
  onDismiss,
}: {
  entries: RecentMediaHistoryEntry[];
  density: HomeDensity;
  titleLanguage: TitleLanguage;
  orientation?: ShelfOrientation;
  onSelectMedia: (mediaId: number) => void;
  onDismiss: (entry: RecentMediaHistoryEntry) => void;
}) {
  const densityStyles = HOME_DENSITY_STYLES[density];
  const visibleCards = density === "compact" ? 5 : 4;
  const isVertical = orientation === "vertical";

  return (
    <MediaShelf
      title="Last activity"
      icon={ClockIcon}
      items={entries}
      emptyText="Titles you open will appear here."
      gridClassName={isVertical ? "grid grid-cols-1 gap-3" : densityStyles.compactGridClass}
      carousel={!isVertical}
      verticalScroll={isVertical}
      autoScroll={false}
      gapClassName={densityStyles.railGapClass}
      gapPixels={densityStyles.railGapPixels}
      visibleCards={visibleCards}
      getKey={(entry) => `${entry.mediaType}:${entry.mediaId}`}
      renderItem={(entry) => (
        <RecentActivityCard
          entry={entry}
          titleLanguage={titleLanguage}
          onSelect={() => onSelectMedia(entry.mediaId)}
          onDismiss={() => onDismiss(entry)}
        />
      )}
    />
  );
}

function RecentActivityCard({
  entry,
  titleLanguage,
  onSelect,
  onDismiss,
}: {
  entry: RecentMediaHistoryEntry;
  titleLanguage: TitleLanguage;
  onSelect: () => void;
  onDismiss: () => void;
}) {
  const title = getPreferredTitle(entry.title, titleLanguage);
  const amount =
    entry.mediaType === "MANGA"
      ? entry.chapters
        ? `${entry.chapters} ch`
        : entry.volumes
          ? `${entry.volumes} vols`
          : null
      : entry.episodes
        ? `${entry.episodes} eps`
        : null;
  const meta = [entry.format ? formatEnum(entry.format) : null, amount]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-xl transition hover:bg-white/8 focus-within:ring-2 focus-within:ring-white/55">
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center gap-3 p-3 pr-11 text-left focus:outline-none"
      >
        <div className="h-20 w-14 shrink-0 overflow-hidden rounded-2xl bg-white/5">
          {entry.coverImage ? (
            <img
              src={entry.coverImage}
              alt={title}
              className="h-full w-full object-cover object-top transition duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="grid h-full w-full place-items-center">
              {entry.mediaType === "MANGA" ? (
                <BookOpenIcon className="h-5 w-5 text-white/20" />
              ) : (
                <TvIcon className="h-5 w-5 text-white/20" />
              )}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-white">
            {title}
          </h3>
          {meta && <p className="mt-1 truncate text-xs text-white/45">{meta}</p>}
        </div>
      </button>
      <Tooltip
        content={`Dismiss ${title}`}
        className="absolute right-2.5 top-2.5"
        positioned
      >
        <button
          type="button"
          onClick={onDismiss}
          aria-label={`Dismiss ${title} from last activity`}
          className="rounded-xl p-1.5 text-white/35 opacity-70 transition hover:bg-white/10 hover:text-white focus:opacity-100 focus:outline-none"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </Tooltip>
    </article>
  );
}

function MangaHomePreview({
  entries,
  recommendations,
  recentActivity,
  gridLayout,
  isEditingLayout,
  selectedWidget,
  draggedWidget,
  titleLanguage,
  onSelectManga,
  onDismissRecentMedia,
  onToggleLayoutEdit,
  onResetLayout,
  onCancelLayout,
  onSelectWidget,
  onMoveWidget,
  onResizeWidget,
  onToggleOrientation,
  onDragStart,
  onDragOver,
  onDragEnd,
  density,
  autoScroll,
}: {
  entries: TrackedMangaEntry[];
  recommendations: RecommendationCandidate[];
  recentActivity: RecentMediaHistoryEntry[];
  gridLayout: PersonalGridItem[];
  isEditingLayout: boolean;
  selectedWidget: PersonalGridWidgetId | null;
  draggedWidget: PersonalGridWidgetId | null;
  titleLanguage: TitleLanguage;
  onSelectManga: (mangaId: number) => void;
  onDismissRecentMedia: (entry: RecentMediaHistoryEntry) => void;
  onToggleLayoutEdit: () => void;
  onResetLayout: () => void;
  onCancelLayout: () => void;
  onSelectWidget: (widgetId: PersonalGridWidgetId) => void;
  onMoveWidget: (widgetId: PersonalGridWidgetId, direction: -1 | 1) => void;
  onResizeWidget: (
    widgetId: PersonalGridWidgetId,
    columns: number,
    rows: number
  ) => void;
  onToggleOrientation: (widgetId: PersonalGridWidgetId) => void;
  onDragStart: (widgetId: PersonalGridWidgetId, event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (widgetId: PersonalGridWidgetId, event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  density: HomeDensity;
  autoScroll: boolean;
}) {
  const reading = entries.filter((entry) => entry.status === "watching");
  const planned = entries.filter((entry) => entry.status === "planned");
  const completed = entries.filter((entry) => entry.status === "completed");
  const paused = entries.filter((entry) => entry.status === "paused");
  const dropped = entries.filter((entry) => entry.status === "dropped");
  const chaptersRead = entries.reduce((total, entry) => total + Number(entry.progress ?? 0), 0);
  const volumesRead = entries.reduce(
    (total, entry) => total + Number(entry.volume_progress ?? 0),
    0
  );
  const favorites = entries.filter((entry) => Boolean(entry.is_favorite)).length;
  const rereads = entries.reduce((total, entry) => total + Number(entry.repeat_count ?? 0), 0);
  const scoredEntries = entries.filter(
    (entry) => typeof entry.score === "number" && entry.score > 0
  );
  const averageScore = scoredEntries.length
    ? scoredEntries.reduce((total, entry) => total + Number(entry.score), 0) /
      scoredEntries.length
    : null;
  const spotlight =
    mostRecentlyActiveWithArtwork(reading) ||
    mostRecentlyActiveWithArtwork(planned) ||
    mostRecentlyActiveWithArtwork(entries) ||
    null;
  const widgets: Record<PersonalGridWidgetId, (item: PersonalGridItem) => ReactNode> = {
    spotlight: (item) => (
      <MangaSpotlightPanel
        entry={spotlight}
        onSelectManga={onSelectManga}
        titleLanguage={titleLanguage}
        compact={item.rows <= 5 || item.columns <= 5}
      />
    ),
    account: (item) => (
      <MangaAccountOverviewPanel
        total={entries.length}
        chaptersRead={chaptersRead}
        volumesRead={volumesRead}
        averageScore={averageScore}
        favorites={favorites}
        rereads={rereads}
        columns={item.columns}
        rows={item.rows}
      />
    ),
    stats: (item) => (
      <section
        className={`grid h-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] shadow-lg ${
          item.orientation === "vertical"
            ? "grid-cols-1 divide-y divide-white/10"
            : "grid-cols-5 divide-x divide-white/10"
        }`}
      >
        <StatTile icon={BookOpenIcon} label="Reading" value={reading.length} strip />
        <StatTile icon={BookmarkIcon} label="Plan to Read" value={planned.length} strip />
        <StatTile icon={CheckCircleIcon} label="Completed" value={completed.length} strip />
        <StatTile icon={ClockIcon} label="Paused" value={paused.length} strip />
        <StatTile icon={BrokenHeartIcon} label="Dropped" value={dropped.length} strip />
      </section>
    ),
    activity: (item) => (
      <RecentActivityShelf
        entries={recentActivity}
        density={density}
        titleLanguage={titleLanguage}
        orientation={item.orientation ?? "horizontal"}
        onSelectMedia={onSelectManga}
        onDismiss={onDismissRecentMedia}
      />
    ),
    continue: (item) => {
      const vertical = item.orientation === "vertical";
      return (
        <MangaHomeShelf
          title="Continue Reading"
          icon={BookOpenIcon}
          entries={reading.slice(0, 15)}
          emptyText="Move something into Reading and it will appear here."
          onSelectManga={onSelectManga}
          density={density}
          titleLanguage={titleLanguage}
          variant={vertical ? "gridCompact" : "medium"}
          carousel={!vertical}
          verticalScroll={vertical}
          autoScroll={autoScroll && !isEditingLayout && !vertical}
          fitGridHeight={!vertical}
        />
      );
    },
    planned: (item) => {
      const vertical = item.orientation === "vertical";
      return (
        <MangaHomeShelf
          title="Plan to Read"
          icon={BookmarkIcon}
          entries={planned.slice(0, 15)}
          emptyText="Add Manga as Plan to Read to build your reading queue."
          onSelectManga={onSelectManga}
          density={density}
          titleLanguage={titleLanguage}
          variant={vertical ? "gridCompact" : "medium"}
          carousel={!vertical}
          verticalScroll={vertical}
          autoScroll={autoScroll && !isEditingLayout && !vertical}
          fitGridHeight={!vertical}
        />
      );
    },
    sinceLiked: (item) => (
      <SinceYouLikedSection
        entries={recommendations}
        onSelectMedia={onSelectManga}
        titleLanguage={titleLanguage}
        mediaType="MANGA"
        maxItems={item.rows >= 10 ? 4 : item.rows >= 8 ? 3 : 2}
      />
    ),
  };

  return (
    <div className="space-y-10">
      <HomeLayoutToolbar
        title='"Manga Personal" layout'
        isEditing={isEditingLayout}
        onToggleEdit={onToggleLayoutEdit}
        onReset={onResetLayout}
        onCancel={onCancelLayout}
        idleDescription="Arrange, resize, and rotate your Manga dashboard widgets."
        editingDescription="Select a widget to move, resize, or change its orientation."
      />

      {entries.length || recentActivity.length || isEditingLayout ? (
        <PersonalGridDashboard
          layout={gridLayout}
          widgetLabels={MANGA_PERSONAL_GRID_WIDGET_LABELS}
          isEditing={isEditingLayout}
          selectedWidget={selectedWidget}
          draggedWidget={draggedWidget}
          renderWidget={(item) => widgets[item.id](item)}
          onSelectWidget={onSelectWidget}
          onMoveWidget={onMoveWidget}
          onResizeWidget={onResizeWidget}
          onToggleOrientation={onToggleOrientation}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        />
      ) : (
        <EmptyMangaHomeState />
      )}

      {!entries.length && isEditingLayout && <EmptyMangaHomeState />}
    </div>
  );
}

function MangaSpotlightPanel({
  entry,
  onSelectManga,
  titleLanguage,
  compact = false,
}: {
  entry: TrackedMangaEntry | null;
  onSelectManga: (mangaId: number) => void;
  titleLanguage: TitleLanguage;
  compact?: boolean;
}) {
  if (!entry) {
    return (
      <section className={`relative h-full min-h-0 overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-xl ${compact ? "p-5" : "p-8"}`}>
        <div className="absolute inset-0 bg-linear-to-br from-white/8 via-transparent to-black/30" />
        <div className="relative flex h-full flex-col justify-end">
          <p className="text-sm uppercase tracking-[0.3em] text-white/35">Manga</p>
          <h2 className={`mt-3 max-w-xl font-bold tracking-tight text-white ${compact ? "text-2xl" : "text-3xl"}`}>
            Add your first Manga and build a reading dashboard.
          </h2>
        </div>
      </section>
    );
  }

  const title = getMangaEntryTitle(entry, titleLanguage);
  const focusLabel =
    entry.status === "watching"
      ? "Now Reading"
      : entry.status === "planned"
        ? "Up Next"
        : "From Your List";
  return (
    <button
      type="button"
      onClick={() => onSelectManga(entry.manga_id)}
      className="group relative h-full min-h-0 w-full overflow-hidden rounded-3xl border border-white/10 bg-white/5 text-left shadow-xl focus:outline-none focus:ring-2 focus:ring-white/55"
    >
      <HeroBackdrop
        bannerImage={entry.banner_image ?? null}
        coverImage={entry.cover_image_large ?? null}
        title={title}
        className="absolute inset-0"
        drift
      />
      <div className="absolute inset-0 bg-linear-to-r from-[#0f0f0f] via-[#0f0f0f]/75 to-[#0f0f0f]/20" />
      <div className="absolute inset-0 bg-linear-to-t from-[#0f0f0f] via-transparent to-transparent" />
      <div className={`relative flex h-full min-h-0 flex-col justify-end ${compact ? "p-5" : "p-6 md:p-8"}`}>
        <span className={`${compact ? "mb-3" : "mb-4"} inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs uppercase tracking-[0.18em] text-white/65 backdrop-blur`}>
          <BookOpenIcon className="h-4 w-4" /> {focusLabel}
        </span>
        <h2 className={`max-w-2xl font-bold tracking-tight text-white ${compact ? "text-2xl" : "text-3xl"}`}>{title}</h2>
        <div className={`${compact ? "mt-3" : "mt-4"} flex flex-wrap gap-2`}>
          <MetaPill>{formatMangaHomeStatus(entry.status)}</MetaPill>
          <MetaPill>{formatMangaProgress(entry)}</MetaPill>
          {entry.average_score ? <MetaPill>{entry.average_score}% avg</MetaPill> : null}
        </div>
      </div>
    </button>
  );
}

function MangaAccountOverviewPanel({
  total,
  chaptersRead,
  volumesRead,
  averageScore,
  favorites,
  rereads,
  columns = 5,
  rows = 6,
}: {
  total: number;
  chaptersRead: number;
  volumesRead: number;
  averageScore: number | null;
  favorites: number;
  rereads: number;
  columns?: number;
  rows?: number;
}) {
  const compact = rows <= 5;
  const narrow = columns <= 4;
  return (
    <section className={`flex h-full min-h-0 flex-col rounded-3xl border border-white/10 bg-white/5 shadow-xl ${compact ? "p-4" : "p-5"}`}>
      <div className="flex items-center gap-3">
        <div className={`rounded-2xl border border-white/10 bg-white/5 text-white/70 ${compact ? "p-2" : "p-2.5"}`}>
          <BookOpenIcon className="h-5 w-5" />
        </div>
        <div>
          <h2 className={`${compact ? "text-base" : "text-lg"} font-semibold text-white`}>Reading Overview</h2>
          {!(compact && narrow) && <p className={`${compact ? "text-xs" : "text-sm"} text-white/40`}>Your Manga list at a glance</p>}
        </div>
      </div>
      <div className={`${compact ? "mt-3 gap-2" : "mt-6 gap-3"} grid min-h-0 flex-1 ${compact && !narrow ? "grid-cols-3" : "grid-cols-2"}`}>
        {[
          ["Library", formatNumber(total), formatExactCount(total, "title")],
          ["Volumes read", formatNumber(volumesRead), formatExactCount(volumesRead, "volume read", "volumes read")],
          ["Avg score", averageScore === null ? "—" : formatScore10(averageScore)],
          ["Chapters read", formatNumber(chaptersRead), formatExactCount(chaptersRead, "chapter read", "chapters read")],
          ["Favorites", formatNumber(favorites), formatExactCount(favorites, "favorite")],
          ["Rereads", formatNumber(rereads), formatExactCount(rereads, "reread")],
        ].map(([label, value, exactValue]) => (
          <OverviewMetric key={label} label={label} value={value} exactValue={exactValue} compact={compact} />
        ))}
      </div>
    </section>
  );
}

function MangaHomeShelf({
  title,
  icon: Icon,
  entries,
  emptyText,
  onSelectManga,
  density,
  titleLanguage,
  variant = "medium",
  carousel = false,
  verticalScroll = false,
  autoScroll = false,
  fitGridHeight = false,
}: {
  title: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  entries: TrackedMangaEntry[];
  emptyText: string;
  onSelectManga: (mangaId: number) => void;
  density: HomeDensity;
  titleLanguage: TitleLanguage;
  variant?: "medium" | "gridCompact";
  carousel?: boolean;
  verticalScroll?: boolean;
  autoScroll?: boolean;
  fitGridHeight?: boolean;
}) {
  const densityStyles = HOME_DENSITY_STYLES[density];
  const shouldUseCarousel = carousel && variant === "medium" && entries.length > 0;
  return (
    <MediaShelf title={title} icon={Icon} items={entries} emptyText={emptyText} gridClassName={densityStyles.compactGridClass} carousel={shouldUseCarousel} verticalScroll={verticalScroll} autoScroll={autoScroll} gapClassName={densityStyles.railGapClass} gapPixels={densityStyles.railGapPixels} visibleCards={densityStyles.railVisibleCards} getKey={(entry) => entry.manga_id} renderItem={(entry) => <MangaHomeCard entry={entry} onSelectManga={onSelectManga} density={density} titleLanguage={titleLanguage} variant={variant} fitGridHeight={fitGridHeight} />} fillHeight={fitGridHeight} />
  );
}

function MangaHomeCard({
  entry,
  onSelectManga,
  density,
  titleLanguage,
  variant,
  fitGridHeight = false,
}: {
  entry: TrackedMangaEntry;
  onSelectManga: (mangaId: number) => void;
  density: HomeDensity;
  titleLanguage: TitleLanguage;
  variant: "medium" | "gridCompact";
  fitGridHeight?: boolean;
}) {
  const title = getMangaEntryTitle(entry, titleLanguage);
  const densityStyles = HOME_DENSITY_STYLES[density];
  const score = getMangaDisplayScore(entry);
  const mediumTitleHeightClass = density === "compact" ? "min-h-8" : "min-h-10";

  if (variant === "gridCompact") {
    return (
      <button
        type="button"
        onClick={() => onSelectManga(entry.manga_id)}
        className={`group flex w-full items-center gap-4 rounded-3xl border border-white/10 bg-white/5 text-left shadow-xl transition hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-white/55 ${densityStyles.compactCardClass}`}
      >
        <div className={`${densityStyles.compactPosterClass} shrink-0 overflow-hidden rounded-2xl bg-white/5`}>
          {entry.cover_image_large ? (
            <img src={entry.cover_image_large} alt={title} className="h-full w-full object-cover object-top transition group-hover:scale-105" />
          ) : (
            <BookOpenIcon className="m-auto h-full w-6 text-white/20" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-white">{title}</h3>
          <p className="mt-1 truncate text-xs text-white/45">
            {formatMangaHomeStatus(entry.status)} · {formatMangaProgress(entry)}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {score && <SmallInfoPill icon={StarIcon}>{score}</SmallInfoPill>}
            {entry.format && <SmallInfoPill icon={BookOpenIcon}>{formatEnum(entry.format)}</SmallInfoPill>}
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelectManga(entry.manga_id)}
      className={`browse-home-card group w-full text-left focus:outline-none focus:ring-2 focus:ring-white/55 ${
        fitGridHeight ? "grid-height-home-card flex h-full min-h-0 flex-col" : "block"
      }`}
    >
      <div className={`browse-home-card-poster overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-xl ${fitGridHeight ? "min-h-0 flex-1" : ""}`}>
        {entry.cover_image_large ? (
          <img src={entry.cover_image_large} alt={title} className={`${fitGridHeight ? "h-full w-full" : densityStyles.mediumPosterClass} object-cover object-top transition duration-300 group-hover:scale-[1.04]`} />
        ) : (
          <div className={`${fitGridHeight ? "h-full w-full" : densityStyles.mediumPosterClass} flex items-center justify-center bg-white/5`}>
            <BookOpenIcon className="h-8 w-8 text-white/20" />
          </div>
        )}
      </div>
      <div className="browse-home-card-body mt-3">
        <div className={`flex ${mediumTitleHeightClass} items-end`}>
          <h3 className={densityStyles.mediumTitleClass}>{title}</h3>
        </div>
        <p className="mt-1 truncate text-sm text-white/45">{formatMangaProgress(entry)}</p>
        <div className={densityStyles.mediumMetaClass}>
          {entry.format && <SmallInfoPill icon={BookOpenIcon}>{formatEnum(entry.format)}</SmallInfoPill>}
          {score && <SmallInfoPill icon={StarIcon}>{score}</SmallInfoPill>}
          {Boolean(entry.is_favorite) && (
            <SmallInfoPill icon={HeartIcon}>Favorite</SmallInfoPill>
          )}
        </div>
      </div>
    </button>
  );
}

function EmptyMangaHomeState() {
  return (
    <section className="rounded-3xl border border-dashed border-white/10 bg-white/3 px-6 py-12 text-center">
      <BookOpenIcon className="mx-auto h-9 w-9 text-white/25" />
      <h2 className="mt-4 text-lg font-semibold text-white">Your Manga dashboard is ready.</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-white/45">
        Add a Manga to start tracking chapters, volumes, reading plans, favorites, and recommendations here.
      </p>
    </section>
  );
}

function PersonalGridDashboard({
  layout,
  widgetLabels = PERSONAL_GRID_WIDGET_LABELS,
  isEditing,
  selectedWidget,
  draggedWidget,
  renderWidget,
  onSelectWidget,
  onMoveWidget,
  onResizeWidget,
  onToggleOrientation,
  onDragStart,
  onDragOver,
  onDragEnd,
}: {
  layout: PersonalGridItem[];
  widgetLabels?: Record<PersonalGridWidgetId, string>;
  isEditing: boolean;
  selectedWidget: PersonalGridWidgetId | null;
  draggedWidget: PersonalGridWidgetId | null;
  renderWidget: (item: PersonalGridItem) => ReactNode;
  onSelectWidget: (widgetId: PersonalGridWidgetId) => void;
  onMoveWidget: (widgetId: PersonalGridWidgetId, direction: -1 | 1) => void;
  onResizeWidget: (
    widgetId: PersonalGridWidgetId,
    columns: number,
    rows: number
  ) => void;
  onToggleOrientation: (widgetId: PersonalGridWidgetId) => void;
  onDragStart: (widgetId: PersonalGridWidgetId, event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (widgetId: PersonalGridWidgetId, event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const resizeSessionRef = useRef<{
    widgetId: PersonalGridWidgetId;
    pointerId: number;
    startX: number;
    startY: number;
    startColumns: number;
    startRows: number;
    columnStep: number;
    rowStep: number;
    orientation?: ShelfOrientation;
  } | null>(null);
  const gridStyle = isEditing
    ? {
        backgroundImage:
          "linear-gradient(to right, rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)",
        backgroundSize: "calc(100% / 12) 4.75rem",
      }
    : undefined;

  function handleResizeStart(
    item: PersonalGridItem,
    event: React.PointerEvent<HTMLButtonElement>
  ) {
    const grid = gridRef.current;
    if (!grid) return;

    event.preventDefault();
    event.stopPropagation();
    const styles = window.getComputedStyle(grid);
    const columnGap = Number.parseFloat(styles.columnGap) || 0;
    const rowGap = Number.parseFloat(styles.rowGap) || 0;
    const columnWidth = (grid.getBoundingClientRect().width - columnGap * 11) / 12;
    const rowHeight = Number.parseFloat(styles.gridAutoRows) || 56;

    resizeSessionRef.current = {
      widgetId: item.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startColumns: item.columns,
      startRows: item.rows,
      columnStep: columnWidth + columnGap,
      rowStep: rowHeight + rowGap,
      orientation: item.orientation,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleResizeMove(event: React.PointerEvent<HTMLButtonElement>) {
    const session = resizeSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    const constraints = PERSONAL_GRID_CONSTRAINTS[session.widgetId];
    const isShelf = PERSONAL_GRID_SHELF_IDS.has(session.widgetId);
    const minColumns =
      session.widgetId === "stats" && session.orientation !== "vertical"
        ? Math.max(10, constraints.minColumns)
        : isShelf && session.orientation !== "vertical"
        ? Math.max(6, constraints.minColumns)
        : constraints.minColumns;
    const minRows =
      isShelf && session.widgetId !== "stats" && session.orientation === "vertical"
        ? Math.max(7, constraints.minRows)
        : constraints.minRows;
    const maxRows =
      isShelf && session.orientation !== "vertical"
        ? (PERSONAL_GRID_HORIZONTAL_ROWS[session.widgetId] ?? constraints.maxRows)
        : constraints.maxRows;
    const columns = Math.max(
      minColumns,
      Math.min(
        constraints.maxColumns,
        session.startColumns +
          Math.round((event.clientX - session.startX) / session.columnStep)
      )
    );
    const rows = Math.max(
      minRows,
      Math.min(
        maxRows,
        session.startRows +
          Math.round((event.clientY - session.startY) / session.rowStep)
      )
    );

    onResizeWidget(session.widgetId, columns, rows);
  }

  function handleResizeEnd(event: React.PointerEvent<HTMLButtonElement>) {
    const session = resizeSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    resizeSessionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      ref={gridRef}
      className={`personal-grid-dashboard grid grid-cols-1 gap-4 transition lg:grid-cols-12 lg:grid-flow-row-dense ${
        isEditing
          ? "rounded-[2rem] border border-white/10 bg-white/[0.015] p-3 shadow-inner"
          : ""
      }`}
      style={gridStyle}
    >
      {layout.map((item, index) => {
        const selected = selectedWidget === item.id;
        const isShelf = PERSONAL_GRID_SHELF_IDS.has(item.id);

        return (
          <div
            key={item.id}
            draggable={isEditing}
            onClick={() => isEditing && onSelectWidget(item.id)}
            onDragStart={(event) => onDragStart(item.id, event)}
            onDragOver={(event) => onDragOver(item.id, event)}
            onDragEnd={onDragEnd}
            style={
              {
                "--personal-grid-columns": item.columns,
                "--personal-grid-rows": item.rows,
              } as React.CSSProperties
            }
            className={`personal-grid-widget relative min-w-0 overflow-hidden transition-all duration-200 ${
              isEditing
                ? `cursor-pointer rounded-[1.75rem] border border-dashed ${
                    selected
                      ? "border-(--app-accent)/70 bg-(--app-accent)/[0.045] shadow-[0_0_0_3px_var(--app-accent-soft)]"
                      : "border-white/15 bg-black/15 hover:border-white/30 hover:bg-white/[0.025]"
                  }`
                : ""
            } ${draggedWidget === item.id ? "scale-[0.985] opacity-40" : "opacity-100"}`}
          >
            {isEditing && (
              <>
                <div className="pointer-events-none absolute left-4 top-4 z-20 rounded-xl border border-white/10 bg-[#151515]/92 px-2.5 py-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-white/65 shadow-lg backdrop-blur">
                    {widgetLabels[item.id]}
                </div>

                {selected && (
                  <div
                    className="absolute right-4 top-4 z-30 flex flex-wrap items-center justify-end gap-1.5 rounded-2xl border border-white/12 bg-[#151515]/96 p-1.5 shadow-2xl backdrop-blur-xl"
                    onClick={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => onMoveWidget(item.id, -1)}
                      disabled={index === 0}
                      aria-label={`Move ${PERSONAL_GRID_WIDGET_LABELS[item.id]} earlier`}
                      className="grid h-8 w-8 place-items-center rounded-xl text-white/55 transition hover:bg-white/10 hover:text-white disabled:opacity-25"
                    >
                      <ArrowLeftIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMoveWidget(item.id, 1)}
                      disabled={index === layout.length - 1}
                      aria-label={`Move ${PERSONAL_GRID_WIDGET_LABELS[item.id]} later`}
                      className="grid h-8 w-8 place-items-center rounded-xl text-white/55 transition hover:bg-white/10 hover:text-white disabled:opacity-25"
                    >
                      <ArrowRightIcon className="h-4 w-4" />
                    </button>
                    <span className="mx-0.5 h-5 w-px bg-white/10" />
                    <span className="min-w-12 text-center text-[0.65rem] font-semibold text-white/45">
                      {item.columns} × {item.rows}
                    </span>
                    {isShelf && (
                      <>
                        <span className="mx-0.5 h-5 w-px bg-white/10" />
                        <button
                          type="button"
                          onClick={() => onToggleOrientation(item.id)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-[0.68rem] font-semibold text-white/60 transition hover:bg-white/10 hover:text-white"
                        >
                          <ArrowPathIcon className="h-3.5 w-3.5" />
                          {item.orientation === "vertical" ? "Vertical" : "Horizontal"}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {selected && (
                  <button
                    type="button"
                    draggable={false}
                    aria-label={`Resize ${PERSONAL_GRID_WIDGET_LABELS[item.id]}`}
                    onPointerDown={(event) => handleResizeStart(item, event)}
                    onPointerMove={handleResizeMove}
                    onPointerUp={handleResizeEnd}
                    onPointerCancel={handleResizeEnd}
                    onClick={(event) => event.stopPropagation()}
                    className="absolute bottom-3 right-3 z-30 hidden h-9 w-9 cursor-nwse-resize touch-none place-items-center rounded-xl border border-(--app-accent)/30 bg-[#151515]/96 text-(--app-accent) shadow-2xl transition hover:bg-(--app-accent-soft) lg:grid"
                  >
                    <svg
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      aria-hidden="true"
                      className="h-4 w-4"
                    >
                      <path d="M3 17 17 3M9 17l8-8M15 17l2-2" />
                    </svg>
                  </button>
                )}
              </>
            )}

            <div
              className={`${isEditing ? "pointer-events-none select-none" : ""} h-full [&>*]:h-full [&>*]:w-full`}
            >
              {renderWidget(item)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HomeLayoutToolbar({
  title,
  isEditing,
  onToggleEdit,
  onReset,
  onCancel,
  idleDescription,
  editingDescription,
}: {
  title: string;
  isEditing: boolean;
  onToggleEdit: () => void;
  onReset: () => void;
  onCancel?: () => void;
  idleDescription?: string;
  editingDescription?: string;
}) {
  return (
    <LayoutEditorToolbar
      title={title}
      isEditing={isEditing}
      idleDescription={idleDescription}
      editingDescription={editingDescription}
      onToggleEdit={onToggleEdit}
      onReset={onReset}
      onCancel={onCancel}
    />
  );
}

function LayoutEditBlock({
  sectionId,
  label,
  isEditing,
  isDragging,
  onDragStart,
  onDragOver,
  onDragEnd,
  children,
}: {
  sectionId: string;
  label: string;
  isEditing: boolean;
  isDragging: boolean;
  onDragStart: (sectionId: string, event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (sectionId: string, event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  children: ReactNode;
}) {
  return <ReorderableSection id={sectionId} label={label} isEditing={isEditing} isDragging={isDragging} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>{children}</ReorderableSection>;
}

function AccountOverviewPanel({
  total,
  totalEpisodes,
  watchedEpisodes,
  watchedMinutes,
  averageScore,
  favorites,
  columns = 5,
  rows = 6,
}: {
  total: number;
  totalEpisodes: number;
  watchedEpisodes: number;
  watchedMinutes: number;
  averageScore: number | null;
  favorites: number;
  columns?: number;
  rows?: number;
}) {
  const compact = rows <= 5;
  const narrow = columns <= 4;
  const metrics = [
    {
      label: "Library",
      value: formatNumber(total),
      exactValue: formatExactCount(total, "title"),
    },
    {
      label: "Total Episodes",
      value: formatNumber(totalEpisodes),
      exactValue: `${formatExactNumber(totalEpisodes)} total episodes`,
    },
    {
      label: "Avg Score",
      value: averageScore ? formatScore10(averageScore) : "-",
    },
    {
      label: "Episodes Seen",
      value: formatNumber(watchedEpisodes),
      exactValue: formatExactCount(watchedEpisodes, "episode seen", "episodes seen"),
    },
    {
      label: "Favorites",
      value: formatNumber(favorites),
      exactValue: formatExactCount(favorites, "favorite"),
    },
    {
      label: "Time Watched",
      value: formatWatchedTime(watchedMinutes),
      exactValue: formatExactWatchedTime(watchedMinutes),
      secondaryExactValue: formatTotalWatchedTime(watchedMinutes),
    },
  ];
  return (
    <section className={`flex flex-col rounded-3xl border border-white/10 bg-white/5 shadow-xl ${compact ? "p-4" : "p-6"}`}>
      <div className="flex items-center gap-3">
        <div className={`rounded-2xl border border-white/10 bg-white/5 text-white/70 ${compact ? "p-2" : "p-2.5"}`}>
          <ChartBarIcon className={compact ? "h-4 w-4" : "h-5 w-5"} />
        </div>
        <div>
          <h2 className={`${compact ? "text-base" : "text-lg"} font-semibold text-white`}>Account Overview</h2>
          {!(compact && narrow) && <p className={`${compact ? "text-xs" : "text-sm"} text-white/40`}>Your list at a glance</p>}
        </div>
      </div>

      <div className={`${compact ? "mt-3 gap-2" : "mt-6 gap-3"} grid min-h-0 flex-1 ${compact && !narrow ? "grid-cols-3" : "grid-cols-2"}`}>
        {metrics.map((metric) => (
          <OverviewMetric
            key={metric.label}
            {...metric}
            compact={compact}
          />
        ))}
      </div>
    </section>
  );
}

function OverviewMetric({
  label,
  value,
  exactValue,
  secondaryExactValue,
  compact = false,
}: {
  label: string;
  value: string;
  exactValue?: string;
  secondaryExactValue?: string;
  compact?: boolean;
}) {
  const metric = (
    <div
      className={`flex h-full w-full flex-col items-start justify-center rounded-2xl border border-white/10 bg-white/4 text-left ${compact ? "p-3" : "p-4"}`}
      aria-label={
        exactValue
          ? `${label}: ${exactValue}${secondaryExactValue ? `. ${secondaryExactValue}` : ""}`
          : undefined
      }
    >
      <p className={`${compact ? "text-xl" : "text-2xl"} truncate font-semibold text-white`}>{value}</p>
      <p className={`${compact ? "text-[0.6rem]" : "text-xs"} mt-1 truncate uppercase tracking-[0.16em] text-white/35`}>{label}</p>
    </div>
  );

  if (!exactValue) return metric;

  return (
    <Tooltip
      content={
        secondaryExactValue ? (
          <span className="flex flex-col gap-1">
            <span>{exactValue}</span>
            <span className="text-white/45">{secondaryExactValue}</span>
          </span>
        ) : exactValue
      }
      as="div"
      className="block"
      focusable
    >
      {metric}
    </Tooltip>
  );
}

function DiscoverAnimeShelf({
  shelf,
  mediaType,
  onSelectAnime,
  onQuickAddAnime,
  onEditEntry,
  onSeeAll,
  trackedAnimeIds,
  trackedEntryByAnimeId,
  titleLanguage,
  autoScroll,
  density,
  railRef,
}: {
  shelf: DiscoverShelf;
  mediaType: MediaType;
  onSelectAnime: (animeId: number) => void;
  onQuickAddAnime: (anime: QuickAddAnime) => void;
  onEditEntry: (entry: TrackedAnimeEntry) => void;
  onSeeAll: (shelf: DiscoverShelf) => void;
  trackedAnimeIds: Set<number>;
  trackedEntryByAnimeId: Map<number, TrackedAnimeEntry>;
  titleLanguage: TitleLanguage;
  autoScroll: boolean;
  density: DiscoverDensity;
  railRef: (element: HTMLDivElement | null) => void;
}) {
  const localRailRef = useRef<HTMLDivElement | null>(null);
  const manualPauseUntil = useRef(0);
  const [isInteracting, setIsInteracting] = useState(false);
  const densityStyles = DISCOVER_DENSITY_STYLES[density];

  function rememberRail(element: HTMLDivElement | null) {
    localRailRef.current = element;
    railRef(element);
  }

  const scrollRail = useCallback((source: "manual" | "auto" = "manual") => {
    const rail = localRailRef.current;
    if (!rail) return;

    if (source === "manual") {
      manualPauseUntil.current = Date.now() + 12000;
    }

    const firstCard = rail.querySelector<HTMLElement>("[data-discover-shelf-card]");
    const cardWidth = firstCard?.offsetWidth ?? densityStyles.railFallbackWidth;
    const gap = density === "comfortable" ? 20 : density === "compact" ? 12 : 16;
    const distance = cardWidth + gap;
    const maxScrollLeft = rail.scrollWidth - rail.clientWidth;

    if (rail.scrollLeft >= maxScrollLeft - distance * 0.5) {
      rail.scrollTo({ left: 0, behavior: "smooth" });
      return;
    }

    rail.scrollBy({ left: distance, behavior: "smooth" });
  }, [density, densityStyles.railFallbackWidth]);

  useEffect(() => {
    if (!autoScroll || shelf.items.length <= 5) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const timer = window.setInterval(() => {
      if (isInteracting || Date.now() < manualPauseUntil.current) {
        return;
      }

      scrollRail("auto");
    }, 8500);

    return () => window.clearInterval(timer);
  }, [autoScroll, isInteracting, scrollRail, shelf.items.length]);

  return (
    <section>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-(--app-accent)/20 bg-(--app-accent-soft) p-2.5 text-white/80">
              <SparklesIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{shelf.title}</h2>
              <p className="text-sm text-white/40">{shelf.description}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {shelf.pills.map((pill) => (
            <MetaPill key={`${shelf.id}-${pill}`}>{pill}</MetaPill>
          ))}
          <button
            type="button"
            onClick={() => onSeeAll(shelf)}
            className="rounded-full border border-(--app-accent)/25 bg-(--app-accent) px-4 py-1.5 text-xs font-semibold text-black shadow-lg shadow-(--app-accent)/15 transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-(--app-accent)/55"
          >
            See all
          </button>
        </div>
      </div>

      <div
        ref={rememberRail}
        onMouseEnter={() => setIsInteracting(true)}
        onMouseLeave={() => setIsInteracting(false)}
        onFocusCapture={() => setIsInteracting(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setIsInteracting(false);
          }
        }}
        className={`scroll-container flex items-start overflow-x-auto overflow-y-hidden pb-2 ${densityStyles.railGapClass}`}
      >
        {shelf.items.map((anime) => (
          <div
            key={`${shelf.id}-${anime.id}`}
            data-discover-shelf-card
            className="shrink-0 self-start"
          >
            <DiscoverAnimeCard
              anime={anime}
              mediaType={mediaType}
              onSelectAnime={onSelectAnime}
              onQuickAddAnime={onQuickAddAnime}
              onEditEntry={onEditEntry}
              titleLanguage={titleLanguage}
              density={density}
              isTracked={mediaType === "ANIME" && trackedAnimeIds.has(anime.id)}
              trackedEntry={
                mediaType === "ANIME" ? trackedEntryByAnimeId.get(anime.id) : undefined
              }
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function DiscoverShelfListPage({
  state,
  fallbackShelf,
  mediaType,
  onBack,
  onSelectAnime,
  onQuickAddAnime,
  onEditEntry,
  onLoadMore,
  trackedAnimeIds,
  trackedEntryByAnimeId,
  titleLanguage,
  density,
}: {
  state?: DiscoverShelfPageState;
  fallbackShelf?: DiscoverShelf;
  mediaType: MediaType;
  onBack: () => void;
  onSelectAnime: (animeId: number) => void;
  onQuickAddAnime: (anime: QuickAddAnime) => void;
  onEditEntry: (entry: TrackedAnimeEntry) => void;
  onLoadMore: (shelf: DiscoverShelf) => void;
  trackedAnimeIds: Set<number>;
  trackedEntryByAnimeId: Map<number, TrackedAnimeEntry>;
  titleLanguage: TitleLanguage;
  density: DiscoverDensity;
}) {
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const shelf = state?.shelf ?? fallbackShelf;
  const items = state?.items ?? fallbackShelf?.items ?? [];
  const pageInfo = state?.pageInfo;
  const hasNextPage = Boolean(pageInfo?.hasNextPage);
  useEffect(() => {
    if (
      !shelf ||
      !hasNextPage ||
      state?.isLoading ||
      state?.isLoadingMore ||
      state?.loadMoreError
    ) return;

    const target = loadMoreRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onLoadMore(shelf);
        }
      },
      { rootMargin: "600px 0px" }
    );

    observer.observe(target);

    return () => observer.disconnect();
  }, [
    hasNextPage,
    onLoadMore,
    shelf,
    state?.isLoading,
    state?.isLoadingMore,
    state?.loadMoreError,
  ]);

  if (!shelf) {
    return (
      <section className="rounded-3xl border border-dashed border-white/10 bg-white/3 px-5 py-8 text-sm text-white/45">
        Discovery list could not be opened.
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/4 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/55"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back
          </button>
          <h2 className="text-3xl font-bold tracking-tight text-white">{shelf.title}</h2>
          <p className="mt-2 text-sm text-white/45">{shelf.description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          {shelf.pills.map((pill) => (
            <MetaPill key={`list-${shelf.id}-${pill}`}>{pill}</MetaPill>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-white/45">
          {state?.isLoading
            ? "Loading titles..."
            : `${formatNumber(items.length)} loaded${
                pageInfo?.total ? ` of ${formatNumber(pageInfo.total)}` : ""
              }`}
        </p>
      </div>

      {state?.warning && (
        <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100/80">
          {state.warning}
        </div>
      )}

      {state?.loadMoreError && (
        <div className="rounded-2xl border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100/80">
          {state.loadMoreError}
        </div>
      )}

      {state?.isLoading && !items.length ? (
        <DiscoverGridSkeleton density={density} />
      ) : (
        <div className={DISCOVER_LIST_GRID_CLASS}>
          {items.map((anime) => (
            <DiscoverAnimeCard
              key={`${shelf.id}-full-${anime.id}`}
              anime={anime}
              mediaType={mediaType}
              onSelectAnime={onSelectAnime}
              onQuickAddAnime={onQuickAddAnime}
              onEditEntry={onEditEntry}
              titleLanguage={titleLanguage}
              variant="grid"
              density={density}
              isTracked={mediaType === "ANIME" && trackedAnimeIds.has(anime.id)}
              trackedEntry={
                mediaType === "ANIME" ? trackedEntryByAnimeId.get(anime.id) : undefined
              }
            />
          ))}
        </div>
      )}

      {hasNextPage && (
        <div ref={loadMoreRef} className="flex justify-center py-4">
          <button
            type="button"
            disabled={Boolean(state?.isLoadingMore)}
            onClick={() => onLoadMore(shelf)}
            className="rounded-full border border-white/10 bg-white/4 px-4 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/55 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {state?.isLoadingMore
              ? "Loading more..."
              : state?.loadMoreError
                ? "Retry loading more"
                : "Load more"}
          </button>
        </div>
      )}
    </section>
  );
}

function DiscoverAnimeCard({
  anime,
  mediaType,
  onSelectAnime,
  onQuickAddAnime,
  onEditEntry,
  titleLanguage,
  variant = "rail",
  density,
  isTracked = false,
  trackedEntry,
}: {
  anime: TrendingAnime;
  mediaType: MediaType;
  onSelectAnime: (animeId: number) => void;
  onQuickAddAnime: (anime: QuickAddAnime) => void;
  onEditEntry: (entry: TrackedAnimeEntry) => void;
  titleLanguage: TitleLanguage;
  variant?: "rail" | "grid";
  density: DiscoverDensity;
  isTracked?: boolean;
  trackedEntry?: TrackedAnimeEntry;
}) {
  const title = getTrendingTitle(anime, titleLanguage);
  const densityStyles = DISCOVER_DENSITY_STYLES[density];
  const score = anime.averageScore || anime.meanScore;
  const season = anime.season && anime.seasonYear
    ? `${formatEnum(anime.season)} ${anime.seasonYear}`
    : anime.seasonYear
    ? String(anime.seasonYear)
    : null;
  const railSeason = anime.season && anime.seasonYear
    ? formatCompactSeason(anime.season, anime.seasonYear)
    : season;
  const metadataItems = [
    anime.format
      ? {
          key: "format",
          icon: mediaType === "MANGA" ? BookOpenIcon : TvIcon,
          tone: "sky" as const,
          label: anime.format,
        }
      : null,
    score
      ? {
          key: "score",
          icon: StarIcon,
          tone: "amber" as const,
          label: `Avg ${formatScore10(score / 10)}`,
        }
      : null,
    season
      ? {
          key: "season",
          icon: CalendarDaysIcon,
          tone: "violet" as const,
          label: railSeason,
        }
      : null,
    anime.popularity
      ? {
          key: "popularity",
          icon: FireIcon,
          tone: "rose" as const,
          label: formatNumber(anime.popularity),
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    tone: "sky" | "amber" | "violet" | "rose";
    label: string;
  }>;
  const isGridCard = variant === "grid";
  const visibleMetadataItems = metadataItems.slice(0, isGridCard ? 2 : 3);
  const iconButtonClass = isGridCard
    ? "right-1.5 top-1.5 h-7 w-7 rounded-lg"
    : densityStyles.iconButtonClass;
  const iconClass = isGridCard ? "h-3.5 w-3.5" : densityStyles.iconClass;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelectAnime(anime.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectAnime(anime.id);
        }
      }}
      className={`browse-discover-card group relative overflow-hidden border border-white/10 bg-white/5 text-left transition hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-white/55 ${
        isGridCard
          ? "w-full rounded-2xl shadow-lg"
          : `${densityStyles.railCardClass} rounded-3xl shadow-xl`
      }`}
    >
      <div className="browse-card-poster aspect-2/3 w-full overflow-hidden bg-white/5">
        {anime.coverImage?.large ? (
          <img
            src={anime.coverImage.large}
            alt={title}
            className="h-full w-full object-cover object-top transition duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="h-full w-full bg-white/5" />
        )}
        {mediaType === "ANIME" && (
          <Tooltip
            content={trackedEntry ? "Edit list entry" : "Add to list"}
            className={`absolute ${iconButtonClass}`}
            placement="bottom"
            align="end"
            positioned
          >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (trackedEntry) {
                onEditEntry(trackedEntry);
                return;
              }

              if (!isTracked) {
                onQuickAddAnime(toQuickAddAnime(anime));
              }
            }}
            className="inline-flex h-full w-full items-center justify-center rounded-[inherit] border border-(--app-accent)/35 bg-black/55 text-white/90 shadow-lg backdrop-blur transition hover:bg-(--app-accent-soft) hover:text-white disabled:cursor-default disabled:hover:bg-black/55"
            aria-label={trackedEntry ? "Edit list entry" : "Add to list"}
          >
            {trackedEntry || isTracked ? (
              <BookmarkIcon className={iconClass} />
            ) : (
              <PlusIcon className={iconClass} />
            )}
          </button>
          </Tooltip>
        )}
      </div>
      <div className={`browse-card-body ${isGridCard ? "p-2.5" : densityStyles.bodyClass}`}>
        <h3
          className={
            isGridCard
              ? "line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-white"
              : densityStyles.titleClass
          }
        >
          {title}
        </h3>
        <div className="mt-2 h-px w-full bg-white/10 transition group-hover:bg-white/18" />
        <div className={isGridCard ? "mt-2 flex max-w-full flex-wrap gap-1" : densityStyles.metaClass}>
          {visibleMetadataItems.map((item) => (
            <SmallInfoPill key={`${anime.id}-${item.key}`} icon={item.icon} tone={item.tone}>
              {item.label}
            </SmallInfoPill>
          ))}
        </div>
      </div>
    </div>
  );
}

function DiscoverShelvesSkeleton({
  density,
  showTrendingCarousel,
}: {
  density: DiscoverDensity;
  showTrendingCarousel: boolean;
}) {
  const cardCount = density === "compact" ? 7 : density === "balanced" ? 6 : 5;
  const gridClass =
    density === "compact"
      ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7"
      : density === "balanced"
        ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
        : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5";

  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading discovery shelves">
      {showTrendingCarousel && <TrendingCarouselSkeleton />}

      {Array.from({ length: 3 }).map((_, shelfIndex) => (
        <section
          key={shelfIndex}
          className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/3 p-4 sm:p-5"
        >
          <div className="carousel-skeleton-shimmer pointer-events-none absolute inset-0" />

          <div className="relative mb-5 flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="h-10 w-10 shrink-0 rounded-2xl border border-white/8 bg-white/8" />
              <div className="min-w-0 space-y-2">
                <div className="h-4 w-36 max-w-[45vw] rounded-full bg-white/12" />
                <div className="h-3 w-56 max-w-[58vw] rounded-full bg-white/7" />
              </div>
            </div>
            <div className="hidden h-8 w-20 shrink-0 rounded-full border border-white/8 bg-white/7 sm:block" />
          </div>

          <div className={`relative grid gap-3 sm:gap-4 ${gridClass}`}>
            {Array.from({ length: cardCount }).map((__, cardIndex) => (
              <div
                key={cardIndex}
                className="min-w-0 overflow-hidden rounded-2xl border border-white/8 bg-black/18"
              >
                <div className="aspect-2/3 bg-white/8" />
                <div className="space-y-2.5 border-t border-white/6 p-3">
                  <div className="h-3.5 w-4/5 rounded-full bg-white/11" />
                  <div className="flex gap-2">
                    <div className="h-3 w-2/5 rounded-full bg-white/7" />
                    <div className="h-3 w-1/4 rounded-full bg-white/5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function DiscoverGridSkeleton({ density }: { density: DiscoverDensity }) {
  const skeletonCount = density === "compact" ? 18 : density === "balanced" ? 15 : 12;

  return (
    <div className={DISCOVER_LIST_GRID_CLASS} aria-busy="true">
      {Array.from({ length: skeletonCount }).map((_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-2xl border border-white/10 bg-white/5"
        >
          <div className="aspect-2/3 bg-white/8" />
          <div className="space-y-2 p-2.5">
            <div className="h-4 w-28 rounded bg-white/10" />
            <div className="h-4 w-20 rounded bg-white/8" />
          </div>
        </div>
      ))}
    </div>
  );
}

const TUTORIAL_STEPS = [
  {
    eyebrow: "Welcome to Seenary",
    title: "Your anime and manga, all in one place.",
    body: "Discover something new, organize what you want to watch or read, and keep your progress up to date.",
    icon: SparklesIcon,
  },
  {
    eyebrow: "Find your way around",
    title: "One library, three useful views.",
    body: "Personal shows your activity and highlights. Discover helps you browse. My List keeps every tracked title organized.",
    icon: HomeIcon,
  },
  {
    eyebrow: "Find something",
    title: "Search directly or follow your curiosity.",
    body: "Use the search bar when you know what you want, or explore curated shelves in Discover. Switch between Anime and Manga at any time.",
    icon: MagnifyingGlassIcon,
  },
  {
    eyebrow: "Build your list",
    title: "Save a title in a single click.",
    body: "Quick add places anime in Planned and manga in Plan to Read. Open any title when you want to choose a different status.",
    icon: BookmarkIcon,
  },
  {
    eyebrow: "Track what matters",
    title: "Keep progress and favorites current.",
    body: "Update episodes or chapters, change status, add a score, and mark favorites from the list editor.",
    icon: ChartBarIcon,
  },
  {
    eyebrow: "You’re ready",
    title: "Make Seenary yours.",
    body: "Start exploring now. You can adjust appearance, layouts, account connections, and other preferences later in Settings.",
    icon: CheckCircleIcon,
  },
] as const;

function Tutorial({
  step,
  onStepChange,
  onSkip,
  onFinish,
}: {
  step: number;
  onStepChange: (step: number) => void;
  onSkip: () => void | Promise<void>;
  onFinish: (destination: LibraryDestination) => void;
}) {
  const activeStep = TUTORIAL_STEPS[step] ?? TUTORIAL_STEPS[0];
  const Icon = activeStep.icon;
  const isLastStep = step === TUTORIAL_STEPS.length - 1;

  return (
    <div className="flex h-full min-h-0 overflow-y-auto px-5 py-6 sm:px-8 lg:px-12">
      <div className="m-auto w-full max-w-5xl">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2" aria-label={`Tutorial step ${step + 1} of ${TUTORIAL_STEPS.length}`}>
            {TUTORIAL_STEPS.map((tutorialStep, index) => (
              <button
                key={tutorialStep.eyebrow}
                type="button"
                onClick={() => onStepChange(index)}
                aria-label={`Go to step ${index + 1}: ${tutorialStep.eyebrow}`}
                aria-current={index === step ? "step" : undefined}
                className={`h-1.5 rounded-full transition-all ${
                  index === step
                    ? "w-10 bg-(--app-accent)"
                    : index < step
                      ? "w-5 bg-white/35 hover:bg-white/55"
                      : "w-5 bg-white/12 hover:bg-white/25"
                }`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => void onSkip()}
            className="rounded-xl px-3 py-2 text-sm font-semibold text-white/45 transition hover:bg-white/6 hover:text-white"
          >
            Skip tutorial
          </button>
        </div>

        <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#111111]/85 shadow-2xl backdrop-blur-xl">
          <div className="grid min-h-[31rem] lg:grid-cols-[0.88fr_1.12fr]">
            <div className="flex flex-col justify-between p-7 sm:p-10 lg:p-12">
              <div>
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-(--app-accent)/20 bg-(--app-accent-soft)">
                  <Icon className="h-6 w-6 text-(--app-accent)" />
                </div>

                <p className="mt-8 text-xs font-semibold uppercase tracking-[0.24em] text-(--app-accent)">
                  {activeStep.eyebrow}
                </p>
                <h1 className="mt-3 max-w-lg text-3xl font-bold tracking-tight text-white sm:text-4xl">
                  {activeStep.title}
                </h1>
                <p className="mt-5 max-w-lg text-base leading-7 text-white/55">
                  {activeStep.body}
                </p>
              </div>

              <div className="mt-10">
                {isLastStep ? (
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => onFinish("discover")}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-(--app-accent) px-5 py-3 text-sm font-bold text-black transition hover:brightness-110"
                    >
                      Explore Discover
                      <ArrowRightIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onFinish("list")}
                      className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                    >
                      Open My List
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    {step > 0 && (
                      <button
                        type="button"
                        onClick={() => onStepChange(step - 1)}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                      >
                        <ArrowLeftIcon className="h-4 w-4" />
                        Back
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onStepChange(step + 1)}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-(--app-accent) px-5 py-3 text-sm font-bold text-black transition hover:brightness-110"
                    >
                      {step === 0 ? "Start tutorial" : "Next"}
                      <ArrowRightIcon className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="relative min-h-80 overflow-hidden border-t border-white/8 bg-white/[0.025] p-5 sm:p-8 lg:min-h-full lg:border-l lg:border-t-0">
              <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-(--app-accent)/10 blur-3xl" />
              <TutorialPreview step={step} />
            </div>
          </div>
        </section>

        <p className="mt-4 text-center text-xs text-white/30">
          Step {step + 1} of {TUTORIAL_STEPS.length}
        </p>
      </div>
    </div>
  );
}

function TutorialPreview({ step }: { step: number }) {
  if (step === 0) {
    return (
      <div className="relative flex h-full min-h-72 items-center justify-center">
        <div className="relative grid h-56 w-56 place-items-center rounded-[3rem] border border-white/10 bg-white/5 shadow-2xl">
          <div className="absolute inset-5 rounded-[2.3rem] border border-(--app-accent)/15 bg-(--app-accent-soft)" />
          <SparklesIcon className="relative h-20 w-20 text-(--app-accent)" />
        </div>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="flex h-full min-h-72 items-center">
        <div className="w-full">
          <p className="text-center text-[0.65rem] font-semibold uppercase tracking-[0.24em] text-white/30">
            The Library Lens
          </p>

          <div className="relative mt-5 flex justify-center">
            <div className="pointer-events-none absolute inset-x-14 -inset-y-8 rounded-full bg-(--app-accent)/8 blur-3xl" />
            <div className="pointer-events-none relative">
              <LibraryLens
                mediaType="ANIME"
                destination="personal"
                onMediaChange={() => undefined}
                onDestinationChange={() => undefined}
              />
            </div>
          </div>

          <div className="mt-9 overflow-hidden rounded-3xl border border-white/10 bg-black/20 shadow-xl">
            <TutorialLensRow
              icon={HomeIcon}
              title="Personal"
              body="Your overview, activity, stats, and recommendations."
              active
            />
            <TutorialLensRow
              icon={MagnifyingGlassIcon}
              title="Discover"
              body="Trending titles, seasonal picks, and curated shelves."
            />
            <TutorialLensRow
              icon={BookmarkIcon}
              title="My List"
              body="Every title you track, organized by status."
            />
          </div>

          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-white/35">
            <PlayCircleIcon className="h-4 w-4 text-(--app-accent)" />
            Use the Anime menu to switch the entire Lens to Manga.
          </div>
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="flex h-full min-h-72 flex-col justify-center">
        <div className="flex w-full items-center gap-2 rounded-2xl border border-white/10 bg-white/6 px-3 py-2 shadow-lg">
          <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-white/45" />
          <span className="min-w-0 flex-1 truncate text-sm text-white/35">
            Search titles, characters, studios, or music...
          </span>
          <kbd className="rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] font-medium tracking-wide text-white/38">
            Enter
          </kbd>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.22em] text-white/30">Discover</p>
            <p className="mt-1 text-sm font-semibold text-white">Trending now</p>
          </div>
          <span className="text-xs text-white/40">See all</span>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-3">
          <TutorialMediaCard title="Frieren" meta="TV · 28 eps" tone="violet" />
          <TutorialMediaCard title="Dandadan" meta="TV · 12 eps" tone="blue" />
          <TutorialMediaCard title="Vinland Saga" meta="TV · 24 eps" tone="amber" />
          <TutorialMediaCard title="Monster" meta="TV · 74 eps" tone="rose" />
        </div>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="flex h-full min-h-72 items-center">
        <div className="w-full">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <p className="text-[0.65rem] uppercase tracking-[0.22em] text-white/30">Discover</p>
              <p className="mt-1 text-base font-semibold text-white">Popular this season</p>
            </div>
            <span className="text-xs text-white/40">See all</span>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <TutorialDiscoverCard title="Frieren" meta="TV · 28 eps" highlighted />
            <TutorialDiscoverCard title="Dandadan" meta="TV · 12 eps" />
            <TutorialDiscoverCard title="Vinland Saga" meta="TV · 24 eps" />
          </div>

          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-[#141414]/95 px-4 py-3 shadow-2xl backdrop-blur-md">
            <div className="relative grid h-9 w-9 shrink-0 place-items-center">
              <span className="absolute inset-0 rounded-full border-2 border-emerald-300/25" />
              <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-300 text-black">
                <CheckIcon className="h-3.5 w-3.5 stroke-[2.4]" />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white">List updated</p>
              <p className="mt-0.5 text-[0.68rem] text-white/55">Frieren was added to your list as Planned.</p>
            </div>
            <XMarkIcon className="h-3.5 w-3.5 text-white/40" />
          </div>
        </div>
      </div>
    );
  }

  if (step === 4) {
    return (
      <div className="flex h-full min-h-72 items-center">
        <div className="w-full rounded-3xl border border-white/10 bg-[#111111]/95 p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[0.65rem] uppercase tracking-[0.25em] text-white/35">List Entry</p>
              <h2 className="mt-1.5 text-xl font-semibold text-white">Edit list entry</h2>
              <p className="mt-1 text-xs text-white/55">A title from your list</p>
            </div>
            <XMarkIcon className="h-5 w-5 text-white/55" />
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <div>
              <p className="text-xs font-medium text-white">Favorite</p>
              <p className="mt-0.5 text-[0.65rem] text-white/40">Pin this title to the top.</p>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-white/65">
              <HeartIcon className="h-3.5 w-3.5" />
              Favorite
            </div>
          </div>

          <div className="mt-4">
            <p className="mb-2 text-xs text-white/65">Status</p>
            <div className="grid grid-cols-5 gap-1.5">
              {["Planned", "Watching", "Completed", "Paused", "Dropped"].map((status, index) => (
                <div
                  key={status}
                  className={`rounded-xl border px-1.5 py-2 text-center text-[0.62rem] ${
                    index === 1
                      ? "border-(--app-accent) bg-(--app-accent) font-semibold text-black shadow-lg shadow-(--app-accent)/15"
                      : "border-white/10 bg-white/5 text-white/55"
                  }`}
                >
                  {status}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-white/65">Progress</span>
              <span className="text-white/35">8 / 12</span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/75"
              >
                <MinusIcon className="h-3.5 w-3.5" />
              </div>
              <div className="flex h-10 flex-1 items-center rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white">
                8
              </div>
              <div
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/75"
              >
                <PlusIcon className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-2/3 rounded-full bg-(--app-accent) shadow-[0_0_14px_var(--app-accent)]" />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex justify-between text-xs">
                <span className="text-white/65">Score</span>
                <span className="text-white/35">8.5 / 10</span>
              </div>
              <div className="relative h-2 rounded-full bg-white/10">
                <div className="h-full w-[85%] rounded-full bg-(--app-accent)" />
                <div className="absolute left-[85%] top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#111111] bg-(--app-accent)" />
              </div>
            </div>
            <div className="flex h-10 w-16 items-center justify-center rounded-xl border border-white/10 bg-black/25 text-sm font-semibold text-white">
              8.5
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-72 items-center justify-center">
      <div className="w-full max-w-sm rounded-3xl border border-(--app-accent)/20 bg-(--app-accent-soft) p-7 text-center shadow-2xl">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-(--app-accent) text-black">
          <CheckCircleIcon className="h-9 w-9" />
        </div>
        <p className="mt-6 text-lg font-bold text-white">Everything is ready</p>
        <p className="mt-2 text-sm leading-6 text-white/50">
          Your library will grow with you as you watch, read, and discover.
        </p>
      </div>
    </div>
  );
}

function TutorialLensRow({
  icon: Icon,
  title,
  body,
  active = false,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: string;
  body: string;
  active?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 border-b border-white/8 px-4 py-3.5 last:border-b-0">
      <div
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${
          active
            ? "border-(--app-accent)/25 bg-(--app-accent-soft) text-(--app-accent)"
            : "border-white/8 bg-white/4 text-white/40"
        }`}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="mt-0.5 truncate text-xs text-white/40">{body}</p>
      </div>
      {active && (
        <span className="ml-auto shrink-0 rounded-full border border-(--app-accent)/20 bg-(--app-accent-soft) px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-wider text-(--app-accent)">
          Selected
        </span>
      )}
    </div>
  );
}

function TutorialMediaCard({
  title,
  meta,
  tone,
}: {
  title: string;
  meta: string;
  tone: "violet" | "blue" | "amber" | "rose";
}) {
  const posterTone = {
    violet: "from-violet-500/30 to-violet-950/25",
    blue: "from-sky-500/25 to-slate-950/30",
    amber: "from-amber-400/25 to-orange-950/25",
    rose: "from-rose-500/25 to-fuchsia-950/25",
  }[tone];

  return (
    <div className="browse-search-card">
      <div className={`browse-search-poster relative aspect-2/3 overflow-hidden rounded-2xl bg-gradient-to-br ${posterTone}`}>
        <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/80 via-transparent to-transparent p-2">
          <div>
            <p className="line-clamp-2 text-[0.65rem] font-semibold text-white">{title}</p>
            <p className="mt-0.5 text-[0.55rem] text-white/60">{meta}</p>
          </div>
        </div>
        <div className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-lg border border-(--app-accent)/35 bg-black/55 text-white/90 backdrop-blur-sm">
          <PlusIcon className="h-3 w-3" />
        </div>
      </div>
    </div>
  );
}

function TutorialDiscoverCard({
  title,
  meta,
  highlighted = false,
}: {
  title: string;
  meta: string;
  highlighted?: boolean;
}) {
  return (
    <div className={`browse-discover-card relative overflow-hidden rounded-3xl border bg-white/5 shadow-xl ${highlighted ? "border-(--app-accent)/40" : "border-white/10"}`}>
      <div className={`browse-card-poster relative aspect-2/3 w-full overflow-hidden ${highlighted ? "bg-gradient-to-br from-(--app-accent)/30 to-black/25" : "bg-gradient-to-br from-white/12 to-black/20"}`}>
        <div className={`absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-xl border border-(--app-accent)/35 ${highlighted ? "bg-(--app-accent-soft)" : "bg-black/55"} text-white/90 shadow-lg backdrop-blur`}>
          {highlighted ? (
            <BookmarkIcon className="h-4 w-4" />
          ) : (
            <PlusIcon className="h-4 w-4" />
          )}
        </div>
      </div>
      <div className="browse-card-body p-3">
        <h3 className="line-clamp-2 min-h-9 text-xs font-semibold leading-4 text-white">{title}</h3>
        <div className="mt-2 h-px w-full bg-white/10" />
        <span className="mt-2 inline-flex rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[0.58rem] text-white/55">
          {meta}
        </span>
      </div>
    </div>
  );
}

function TrendingCarousel({
  items,
  activeIndex,
  onSelectIndex,
  onSelectAnime,
  titleLanguage,
  autoRotate,
  animateEntryChanges,
  cycleKey,
  isPaused,
  isLoading,
  onPause,
  onResume,
}: {
  items: TrendingAnime[];
  activeIndex: number;
  onSelectIndex: (index: number) => void;
  onSelectAnime: (animeId: number) => void;
  titleLanguage: TitleLanguage;
  autoRotate: boolean;
  animateEntryChanges: boolean;
  cycleKey: number;
  isPaused: boolean;
  isLoading: boolean;
  onPause: () => void;
  onResume: () => void;
}) {
  const targetItem = items[activeIndex];
  const [displayedItem, setDisplayedItem] = useState<TrendingAnime | undefined>(targetItem);
  const [entryTransitionPhase, setEntryTransitionPhase] = useState<"idle" | "out" | "in">(
    "idle"
  );
  const targetItemRef = useRef(targetItem);
  const displayedItemRef = useRef(displayedItem);

  useEffect(() => {
    targetItemRef.current = targetItem;
  }, [targetItem]);

  useEffect(() => {
    displayedItemRef.current = displayedItem;
  }, [displayedItem]);

  useEffect(() => {
    const nextTargetItem = targetItemRef.current;
    const currentDisplayedItem = displayedItemRef.current;
    if (!nextTargetItem) return;

    if (!animateEntryChanges) {
      const syncTimer = window.setTimeout(() => {
        setDisplayedItem(nextTargetItem);
        setEntryTransitionPhase("idle");
      }, 0);
      return () => window.clearTimeout(syncTimer);
    }

    if (!currentDisplayedItem || currentDisplayedItem.id === nextTargetItem.id) {
      const syncTimer = window.setTimeout(() => {
        setDisplayedItem(nextTargetItem);
        setEntryTransitionPhase("idle");
      }, 0);
      return () => window.clearTimeout(syncTimer);
    }

    const exitTimer = window.setTimeout(() => setEntryTransitionPhase("out"), 0);
    let settleTimer: number | undefined;
    const swapTimer = window.setTimeout(() => {
      setDisplayedItem(nextTargetItem);
      setEntryTransitionPhase("in");
      settleTimer = window.setTimeout(() => setEntryTransitionPhase("idle"), 420);
    }, 180);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(swapTimer);
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
    };
  }, [targetItem?.id, animateEntryChanges]);

  const activeItem = displayedItem ?? targetItem;

  if (isLoading && !activeItem) return <TrendingCarouselSkeleton />;
  if (!activeItem) return null;

  const title = getTrendingTitle(activeItem, titleLanguage);
  const score = activeItem.averageScore || activeItem.meanScore;
  const nextEpisode = activeItem.nextAiringEpisode?.episode;

  return (
    <section
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-2xl"
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      onFocusCapture={onPause}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onResume();
        }
      }}
    >
      <button
        type="button"
        onClick={() => onSelectAnime(activeItem.id)}
        className={`group block h-80 w-full text-left transition-[filter,opacity,transform] duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-white/55 ${
          entryTransitionPhase === "out"
            ? "scale-[0.995] opacity-0 blur-md"
            : entryTransitionPhase === "in"
              ? "carousel-entry-focus-in"
              : "scale-100 opacity-100 blur-none"
        }`}
      >
        <HeroBackdrop
          bannerImage={activeItem.bannerImage ?? null}
          coverImage={activeItem.coverImage?.large ?? null}
          title={title}
          className="absolute inset-0"
        />

        <div className="absolute inset-0 bg-linear-to-r from-[#0f0f0f] via-[#0f0f0f]/70 to-[#0f0f0f]/20" />
        <div className="absolute inset-0 bg-linear-to-t from-[#0f0f0f] via-transparent to-transparent" />

        <div className="relative flex h-full max-w-3xl flex-col justify-end p-8 pb-14">
          <span className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-black/35 px-3 py-1 text-xs uppercase tracking-[0.18em] text-white/70 backdrop-blur">
            <FireIcon className="h-4 w-4" />
            Trending now
          </span>

          <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            {title}
          </h1>

          <div className="mt-4 flex flex-wrap gap-2">
            {activeItem.isAdult && <MetaPill>18+</MetaPill>}
            {activeItem.format && <MetaPill>{activeItem.format}</MetaPill>}
            {activeItem.season && activeItem.seasonYear && (
              <MetaPill>
                {formatEnum(activeItem.season)} {activeItem.seasonYear}
              </MetaPill>
            )}
            {score ? <MetaPill>Avg {formatScore10(score / 10)}</MetaPill> : null}
            {nextEpisode ? <MetaPill>Episode {nextEpisode} next</MetaPill> : null}
          </div>
        </div>
      </button>

      <div className="absolute inset-x-0 bottom-4 z-20 flex justify-center gap-1">
        {items.map((item, index) => (
          <Tooltip key={item.id} content={getTrendingTitle(item, titleLanguage)}>
          <button
            type="button"
            onClick={() => onSelectIndex(index)}
            className="group relative h-7 w-10 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white/55"
            aria-label={`Show ${getTrendingTitle(item, titleLanguage)}`}
            aria-current={index === activeIndex ? "true" : undefined}
          >
            <span
              className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full border transition-[width,height,background-color,border-color,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                index === activeIndex
                  ? "h-2.5 w-10 border-white/15 bg-white/12"
                  : "h-2 w-9 border-white/10 bg-white/22 group-hover:bg-white/38"
              }`}
            >
              {index === activeIndex && (
                <span
                  key={`${cycleKey}-${activeIndex}`}
                  className="block h-full w-full rounded-full bg-(--app-accent)"
                  style={{
                    animationName: autoRotate ? "carousel-pill-fill" : "none",
                    animationDuration: `${TRENDING_CYCLE_MS}ms`,
                    animationTimingFunction: "linear",
                    animationFillMode: "forwards",
                    animationPlayState: isPaused ? "paused" : "running",
                  }}
                />
              )}
            </span>
          </button>
          </Tooltip>
        ))}
      </div>
    </section>
  );
}

function TrendingCarouselSkeleton() {
  return (
    <section
      className="relative h-80 overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-2xl"
      aria-busy="true"
      aria-label="Loading trending anime"
    >
      <div className="absolute inset-0 bg-linear-to-br from-white/8 via-white/3 to-black/30" />
      <div className="carousel-skeleton-shimmer absolute inset-0" />
      <div className="absolute inset-0 bg-linear-to-r from-[#0f0f0f]/90 via-[#0f0f0f]/65 to-[#0f0f0f]/25" />

      <div className="relative flex h-full max-w-3xl flex-col justify-end p-8 pb-14">
        <div className="mb-4 h-7 w-40 rounded-full bg-white/10" />
        <div className="h-10 w-[min(28rem,75%)] rounded-xl bg-white/14" />
        <div className="mt-4 flex flex-wrap gap-2">
          <div className="h-7 w-14 rounded-full bg-white/10" />
          <div className="h-7 w-24 rounded-full bg-white/10" />
          <div className="h-7 w-20 rounded-full bg-white/10" />
          <div className="h-7 w-32 rounded-full bg-white/10" />
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-5 flex items-center justify-center gap-3">
        <span className="carousel-loading-ring h-5 w-5 rounded-full border-2 border-white/15 border-t-(--app-accent)" />
        <div className="flex gap-2" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <span key={index} className="h-2 w-9 rounded-full bg-white/15" />
          ))}
        </div>
      </div>
    </section>
  );
}

function SpotlightPanel({
  entry,
  onSelectAnime,
  titleLanguage,
  compact = false,
}: {
  entry: TrackedAnimeEntry | null;
  onSelectAnime: (animeId: number) => void;
  titleLanguage: TitleLanguage;
  compact?: boolean;
}) {
  if (!entry) {
    return (
      <section className="relative min-h-72 overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 shadow-xl">
        <div className="absolute inset-0 bg-linear-to-br from-white/8 via-transparent to-black/30" />
        <div className="relative flex h-full flex-col justify-end">
          <p className="text-sm uppercase tracking-[0.3em] text-white/35">
            Home
          </p>
          <h1 className="mt-3 max-w-xl text-3xl font-bold tracking-tight">
            Start with a search, then make this space yours.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-white/60">
            Saved titles will turn this into a personal dashboard with progress,
            planned picks, and recent activity.
          </p>
        </div>
      </section>
    );
  }

  const title = getEntryTitle(entry, titleLanguage);
  const progress = getProgressLabel(entry);
  const focusLabel =
    entry.status === "watching"
      ? "Now Watching"
      : entry.status === "planned"
        ? "Up Next"
        : "From Your List";

  return (
    <button
      type="button"
      onClick={() => onSelectAnime(entry.anime_id)}
      className="group relative min-h-72 overflow-hidden rounded-3xl border border-white/10 bg-white/5 text-left shadow-xl focus:outline-none focus:ring-2 focus:ring-white/55"
    >
      <HeroBackdrop
        bannerImage={entry.banner_image ?? null}
        coverImage={entry.cover_image_large ?? null}
        title={title}
        className="absolute inset-0"
        drift
      />
      <div className="absolute inset-0 bg-linear-to-r from-[#0f0f0f] via-[#0f0f0f]/75 to-[#0f0f0f]/20" />
      <div className="absolute inset-0 bg-linear-to-t from-[#0f0f0f] via-transparent to-transparent" />

      <div className={`relative flex h-full min-h-72 flex-col justify-end ${compact ? "p-5" : "p-6 md:p-8"}`}>
        <span className={`${compact ? "mb-2 text-[0.65rem]" : "mb-4 text-xs"} inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-1 uppercase tracking-[0.18em] text-white/65 backdrop-blur`}>
          <FireIcon className="h-4 w-4" />
          {focusLabel}
        </span>
        <h1 className={`max-w-2xl font-bold tracking-tight text-white ${compact ? "text-2xl" : "text-3xl"}`}>
          {title}
        </h1>
        <div className={`${compact ? "mt-2" : "mt-4"} flex flex-wrap gap-2`}>
          <MetaPill>{formatStatus(entry.status)}</MetaPill>
          {progress && <MetaPill>{progress}</MetaPill>}
          {entry.average_score !== null && entry.average_score !== undefined && (
            <MetaPill>{entry.average_score}% avg</MetaPill>
          )}
        </div>
      </div>
    </button>
  );
}

function BrokenHeartIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      data-slot="icon"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733C11.285 4.876 9.623 3.75 7.687 3.75 5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m12.75 4.5-2.25 5.25 3 2.25-3 5.25"
      />
    </svg>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  compact = false,
  strip = false,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  value: number;
  compact?: boolean;
  strip?: boolean;
}) {
  if (strip) {
    return (
      <div className="flex min-w-0 items-center justify-center gap-3 px-3 py-2">
        <div className="inline-flex shrink-0 rounded-xl border border-(--app-accent)/20 bg-(--app-accent-soft) p-2 text-white/80">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-semibold leading-none text-white">{value}</p>
          <p className="mt-1 truncate text-xs text-white/45">{label}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center rounded-2xl border border-white/10 bg-white/5 shadow-lg ${compact ? "gap-2 p-2.5" : "gap-3 p-5"}`}>
      <div className={`inline-flex shrink-0 rounded-xl border border-(--app-accent)/20 bg-(--app-accent-soft) text-white/80 ${compact ? "p-1.5" : "p-2"}`}>
        <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} />
      </div>
      <div className="min-w-0">
        <p className={`${compact ? "text-xl" : "text-[1.65rem]"} font-semibold leading-none text-white`}>{value}</p>
        <p className={`${compact ? "text-[0.65rem]" : "text-sm"} ${compact ? "mt-1" : "mt-1.5"} truncate text-white/45`}>{label}</p>
      </div>
    </div>
  );
}

function HomeShelf({
  title,
  icon: Icon,
  entries,
  emptyText,
  onSelectAnime,
  variant = "medium",
  density = "balanced",
  titleLanguage,
  mode = "library",
  carousel = false,
  verticalScroll = false,
  autoScroll = false,
  fitGridHeight = false,
}: {
  title: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  entries: TrackedAnimeEntry[] | RecommendationCandidate[];
  emptyText: string;
  onSelectAnime: (animeId: number) => void;
  variant?: "medium" | "compact" | "gridCompact" | "list";
  density?: HomeDensity;
  titleLanguage: TitleLanguage;
  mode?: "library" | "recommendations";
  carousel?: boolean;
  verticalScroll?: boolean;
  autoScroll?: boolean;
  fitGridHeight?: boolean;
}) {
  const densityStyles = HOME_DENSITY_STYLES[density];
  const shouldUseCarousel =
    carousel && variant === "medium" && mode === "library" && entries.length > 0;
  return (
    <MediaShelf<TrackedAnimeEntry | RecommendationCandidate> title={title} icon={Icon} items={entries} emptyText={emptyText} gridClassName={variant === "gridCompact" ? densityStyles.compactGridClass : variant === "compact" || variant === "list" ? "grid grid-cols-1 gap-3" : densityStyles.gridClass} carousel={shouldUseCarousel} verticalScroll={verticalScroll} autoScroll={autoScroll} gapClassName={densityStyles.railGapClass} gapPixels={densityStyles.railGapPixels} visibleCards={densityStyles.railVisibleCards} getKey={(entry, index) => mode === "recommendations" ? `recommendation-${index}` : (entry as TrackedAnimeEntry).anime_id} renderItem={(entry) => mode === "recommendations" ? <RecommendationLibraryCard entry={entry as RecommendationCandidate} onSelectAnime={onSelectAnime} titleLanguage={titleLanguage} /> : <HomeAnimeCard entry={entry as TrackedAnimeEntry} onSelectAnime={onSelectAnime} variant={variant} density={density} titleLanguage={titleLanguage} fitGridHeight={fitGridHeight} />} fillHeight={fitGridHeight} />
  );
}

function HomeAnimeCard({
  entry,
  onSelectAnime,
  variant = "medium",
  density = "balanced",
  titleLanguage,
  fitGridHeight = false,
}: {
  entry: TrackedAnimeEntry;
  onSelectAnime: (animeId: number) => void;
  variant?: "medium" | "compact" | "gridCompact" | "list";
  density?: HomeDensity;
  titleLanguage: TitleLanguage;
  fitGridHeight?: boolean;
}) {
  const title = getEntryTitle(entry, titleLanguage);
  const progress = getProgressLabel(entry);
  const score = getDisplayScore(entry);
  const subMeta = buildEntryMeta(entry);
  const densityStyles = HOME_DENSITY_STYLES[density];
  const mediumTitleHeightClass = density === "compact" ? "min-h-8" : "min-h-10";
  const mediumPosterClass = fitGridHeight
    ? "h-full w-full"
    : densityStyles.mediumPosterClass;

  if (variant === "compact" || variant === "gridCompact" || variant === "list") {
    return (
      <button
        type="button"
        onClick={() => onSelectAnime(entry.anime_id)}
        className={`group flex w-full items-center gap-4 rounded-3xl border border-white/10 bg-white/5 text-left shadow-xl transition hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-white/55 ${
          variant === "gridCompact" ? densityStyles.compactCardClass : "p-3"
        }`}
      >
        <PosterImage
          entry={entry}
          title={title}
          className={variant === "gridCompact" ? densityStyles.compactPosterClass : "h-24 w-16"}
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-white">{title}</h3>
          <p className="mt-1 truncate text-xs text-white/45">
            {variant === "list" && subMeta.length
              ? subMeta.join(" - ")
              : `${formatStatus(entry.status)}${progress ? ` - ${progress}` : ""}`}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {score && <SmallInfoPill icon={StarIcon}>{score}</SmallInfoPill>}
            {entry.source && (
              <SmallInfoPill icon={BookmarkIcon}>{formatEnum(entry.source)}</SmallInfoPill>
            )}
            {entry.popularity && (
              <SmallInfoPill icon={HeartIcon}>{formatNumber(entry.popularity)}</SmallInfoPill>
            )}
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelectAnime(entry.anime_id)}
      className={`browse-home-card group w-full text-left focus:outline-none focus:ring-2 focus:ring-white/55 ${
        fitGridHeight ? "grid-height-home-card flex h-full min-h-0 flex-col" : "block"
      }`}
    >
      <div className={`browse-home-card-poster overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-xl ${fitGridHeight ? "min-h-0 flex-1" : ""}`}>
        <PosterImage entry={entry} title={title} className={mediumPosterClass} />
      </div>
      <div className="browse-home-card-body mt-3">
        <div className={`flex ${mediumTitleHeightClass} items-end`}>
          <h3 className={densityStyles.mediumTitleClass}>
            {title}
          </h3>
        </div>
        <p className="mt-1 truncate text-sm text-white/45">
          {progress || subMeta.join(" - ") || formatStatus(entry.status)}
        </p>
        <div className={densityStyles.mediumMetaClass}>
          {entry.format && <SmallInfoPill icon={TvIcon}>{entry.format}</SmallInfoPill>}
          {score && <SmallInfoPill icon={StarIcon}>{score}</SmallInfoPill>}
          {entry.duration && (
            <SmallInfoPill icon={ClockIcon}>{entry.duration} min</SmallInfoPill>
          )}
          {entry.source && (
            <SmallInfoPill icon={BookmarkIcon}>{formatEnum(entry.source)}</SmallInfoPill>
          )}
        </div>
      </div>
    </button>
  );
}

function RecommendationLibraryCard({
  entry,
  onSelectAnime,
  titleLanguage,
}: {
  entry: RecommendationCandidate;
  onSelectAnime: (animeId: number) => void;
  titleLanguage: TitleLanguage;
}) {
  const title = getPreferredTitle(entry.title, titleLanguage);
  const meta = [
    entry.format,
    entry.season && entry.seasonYear
      ? `${formatEnum(entry.season)} ${entry.seasonYear}`
      : entry.seasonYear
      ? `${entry.seasonYear}`
      : null,
    entry.episodes ? `${entry.episodes} eps` : null,
  ].filter(Boolean) as string[];

  return (
    <button
      type="button"
      onClick={() => onSelectAnime(entry.animeId)}
      className="group flex items-center gap-4 rounded-3xl border border-white/10 bg-white/5 p-3 text-left shadow-xl transition hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-white/55"
    >
      <div className="h-24 w-16 shrink-0 overflow-hidden rounded-2xl bg-white/5">
        {entry.coverImage?.large ? (
          <img
            src={entry.coverImage.large}
            alt={title}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="h-full w-full bg-white/5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-white">{title}</h3>
        <p className="mt-1 truncate text-xs text-white/45">
          {entry.sourceTitles[0]
            ? `Because you liked ${entry.sourceTitles[0]}`
            : meta.join(" - ") || "Recommendation"}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {meta.length > 0 && (
            <SmallInfoPill icon={TvIcon}>{meta.join(" - ")}</SmallInfoPill>
          )}
          {typeof entry.averageScore === "number" && entry.averageScore > 0 && (
            <SmallInfoPill icon={StarIcon}>
              Avg {formatScore10(entry.averageScore / 10)}
            </SmallInfoPill>
          )}
          <SmallInfoPill icon={ArrowTrendingUpIcon}>
            {entry.sourceCount} match{entry.sourceCount === 1 ? "" : "es"}
          </SmallInfoPill>
        </div>
      </div>
    </button>
  );
}

function SinceYouLikedSection({
  entries,
  onSelectMedia,
  titleLanguage,
  mediaType,
  maxItems = 4,
}: {
  entries: RecommendationCandidate[];
  onSelectMedia: (mediaId: number) => void;
  titleLanguage: TitleLanguage;
  mediaType: MediaType;
  maxItems?: number;
}) {
  const isManga = mediaType === "MANGA";

  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-2xl border border-(--app-accent)/20 bg-(--app-accent-soft) p-2.5 text-white/80">
          <ArrowTrendingUpIcon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">Since You Liked...</h2>
          <p className="text-sm text-white/40">
            Personal next-{isManga ? "read" : "watch"} suggestions built from your favorites.
          </p>
        </div>
      </div>

      {entries.length ? (
        <div className="space-y-3">
          {entries.slice(0, maxItems).map((entry) => (
            <SinceYouLikedPairCard
              key={`since-you-liked-${entry.animeId}`}
              entry={entry}
              onSelectMedia={onSelectMedia}
              titleLanguage={titleLanguage}
              mediaType={mediaType}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/3 px-5 py-8 text-sm text-white/45">
          Favorite a few {isManga ? "Manga" : "shows"} you liked to get more personal
          next-{isManga ? "read" : "watch"} suggestions.
        </div>
      )}
    </section>
  );
}

function SinceYouLikedPairCard({
  entry,
  onSelectMedia,
  titleLanguage,
  mediaType,
}: {
  entry: RecommendationCandidate;
  onSelectMedia: (mediaId: number) => void;
  titleLanguage: TitleLanguage;
  mediaType: MediaType;
}) {
  const MediaIcon = mediaType === "MANGA" ? BookOpenIcon : TvIcon;
  const recommendedTitle = getPreferredTitle(entry.title, titleLanguage);
  const sourceTitle = entry.source
    ? getPreferredTitle(entry.source.title, titleLanguage)
    : "Favorite pick";
  const recommendedMeta = [
    entry.format,
    entry.episodes ? `${entry.episodes} eps` : null,
    typeof entry.averageScore === "number" && entry.averageScore > 0
      ? `Avg ${formatScore10(entry.averageScore / 10)}`
      : null,
  ].filter(Boolean) as string[];

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-3 shadow-xl">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,30fr)_2.5rem_minmax(0,70fr)] lg:items-stretch">
        <button
          type="button"
          onClick={() => entry.source && onSelectMedia(entry.source.animeId)}
          disabled={!entry.source}
          className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/3 p-3 text-left transition hover:bg-white/8 disabled:cursor-default disabled:hover:bg-white/3"
        >
          <div className="h-28 w-20 shrink-0 overflow-hidden rounded-xl bg-white/5">
            {entry.source?.coverImage ? (
              <img
                src={entry.source.coverImage}
                alt={sourceTitle}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full bg-white/5" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-white/35">
              You liked
            </p>
            <h3 className="mt-1.5 line-clamp-2 text-sm font-semibold text-white">
              {sourceTitle}
            </h3>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {entry.source?.format && (
                <SmallInfoPill icon={MediaIcon}>{entry.source.format}</SmallInfoPill>
              )}
              {typeof entry.source?.score === "number" && entry.source.score > 0 && (
                <SmallInfoPill icon={StarIcon}>Mine {entry.source.score}</SmallInfoPill>
              )}
            </div>
          </div>
        </button>

        <div className="flex items-center justify-center text-white/30">
          <ArrowRightIcon className="h-5 w-5" />
        </div>

        <button
          type="button"
          onClick={() => onSelectMedia(entry.animeId)}
          className="flex min-w-0 items-center gap-3.5 rounded-2xl border border-white/10 bg-white/3 p-3 text-left transition hover:bg-white/8"
        >
          <div className="h-28 w-20 shrink-0 overflow-hidden rounded-xl bg-white/5">
            {entry.coverImage?.large ? (
              <img
                src={entry.coverImage.large}
                alt={recommendedTitle}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full bg-white/5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-[0.2em] text-white/35">
              Try next
            </p>
            <div className="mt-1.5 flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
              <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-white">
                {recommendedTitle}
              </h3>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                {recommendedMeta.map((item) => (
                  <SmallInfoPill
                    key={`${entry.animeId}-${item}`}
                    icon={item.startsWith("Avg ") ? StarIcon : MediaIcon}
                  >
                    {item}
                  </SmallInfoPill>
                ))}
              </div>
            </div>
            <p className="mt-2.5 line-clamp-2 text-xs leading-5 text-white/50">
              {getRecommendationSummary(entry.description)}
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}

function EmptyHomeState() {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-xl">
      <SparklesIcon className="mx-auto h-8 w-8 text-white/55" />
      <h2 className="mt-4 text-2xl font-bold tracking-tight text-white">
        Your home page is ready for its first title.
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-white/55">
        Search from the top bar, open a detail page, and add something to your
        list. Continue Watching, Planned Picks, and recent activity will fill in
        from there.
      </p>
    </section>
  );
}

function PosterImage({
  entry,
  title,
  className,
}: {
  entry: TrackedAnimeEntry;
  title: string;
  className: string;
}) {
  return (
    <div className={`shrink-0 overflow-hidden rounded-2xl bg-white/5 ${className}`}>
      {entry.cover_image_large ? (
        <img
          src={entry.cover_image_large}
          alt={title}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="h-full w-full bg-white/5" />
      )}
    </div>
  );
}

function HeroBackdrop({
  bannerImage,
  coverImage,
  title,
  className,
  drift = false,
}: {
  bannerImage?: string | null;
  coverImage?: string | null;
  title: string;
  className?: string;
  drift?: boolean;
}) {
  const [useBanner, setUseBanner] = useState(Boolean(bannerImage));

  useEffect(() => {
    setUseBanner(Boolean(bannerImage));
  }, [bannerImage]);

  const handleBannerLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    const hasWeakWidth = image.naturalWidth > 0 && image.naturalWidth < 1100;
    const hasWeakHeight = image.naturalHeight > 0 && image.naturalHeight < 320;
    const hasWeakArea =
      image.naturalWidth > 0 &&
      image.naturalHeight > 0 &&
      image.naturalWidth * image.naturalHeight < 500000;

    if ((hasWeakWidth && hasWeakHeight) || hasWeakArea) {
      setUseBanner(false);
    }
  };

  if (useBanner && bannerImage) {
    return (
      <img
        src={bannerImage}
        alt={title}
        onLoad={handleBannerLoad}
        onError={() => setUseBanner(false)}
        className={`${className ?? ""} h-full w-full object-cover object-center opacity-65 transition-opacity duration-500 group-hover:opacity-75 ${
          drift ? "spotlight-backdrop-drift" : "transition-transform group-hover:scale-[1.01]"
        }`}
      />
    );
  }

  if (coverImage) {
    return (
      <div className={`${className ?? ""} overflow-hidden bg-white/5`}>
        <img
          src={coverImage}
          alt={title}
          className={`h-full w-full object-cover object-center opacity-32 blur-[1.5px] transition-opacity duration-500 group-hover:opacity-42 ${
            drift ? "spotlight-backdrop-drift" : "scale-[1.06] transition-transform group-hover:scale-[1.08]"
          }`}
        />
      </div>
    );
  }

  return <div className={`${className ?? ""} bg-white/5`} />;
}

function MetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/75 backdrop-blur">
      {children}
    </span>
  );
}

function SmallInfoPill({
  icon: Icon,
  children,
  tone,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  children: ReactNode;
  tone?: "neutral" | "sky" | "amber" | "violet" | "rose" | "emerald";
}) {
  const toneClass = getSmallInfoPillTone(tone ?? getSmallInfoPillIconTone(Icon));

  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-white/8 py-1 pl-1 pr-2.5 text-[11px] text-white/65">
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-black/15 ${toneClass}`}
      >
        <Icon className="h-3 w-3" />
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

function getSmallInfoPillIconTone(
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
): "neutral" | "sky" | "amber" | "violet" | "rose" | "emerald" {
  if (Icon === TvIcon || Icon === BookOpenIcon) return "sky";
  if (Icon === StarIcon) return "amber";
  if (Icon === ClockIcon || Icon === CalendarDaysIcon) return "violet";
  if (Icon === HeartIcon || Icon === FireIcon) return "rose";
  if (Icon === BookmarkIcon || Icon === ArrowTrendingUpIcon) return "emerald";
  return "neutral";
}

function getSmallInfoPillTone(tone: "neutral" | "sky" | "amber" | "violet" | "rose" | "emerald") {
  switch (tone) {
    case "sky":
      return "border-sky-300/25 text-sky-100/80 bg-sky-300/10";
    case "amber":
      return "border-amber-300/25 text-amber-100/80 bg-amber-300/10";
    case "violet":
      return "border-violet-300/25 text-violet-100/80 bg-violet-300/10";
    case "rose":
      return "border-rose-300/25 text-rose-100/80 bg-rose-300/10";
    case "emerald":
      return "border-emerald-300/25 text-emerald-100/80 bg-emerald-300/10";
    default:
      return "border-white/12 text-white/45";
  }
}

function buildPersonalizedRecommendations(
  entries: TrackedAnimeEntry[],
  titleLanguage: TitleLanguage,
  options: { favoriteSourcesOnly?: boolean; mediaType?: MediaType } = {}
) {
  const libraryIds = new Set(entries.map((entry) => entry.anime_id));
  const sourceEntries = options.favoriteSourcesOnly
    ? entries.filter((entry) => Boolean(entry.is_favorite))
    : entries;
  const genreWeights = buildGenreWeights(sourceEntries);
  const candidates = new Map<number, RecommendationCandidate>();

  for (const entry of sourceEntries) {
    if (entry.status === "dropped") continue;

    const sourceStrength = getTasteStrength(entry, genreWeights);
    if (sourceStrength <= 0) continue;

    for (const recommendation of entry.recommendations ?? []) {
      const media = recommendation.mediaRecommendation;
      if (!media?.id || libraryIds.has(media.id)) continue;
      if (options.mediaType && media.type !== options.mediaType) continue;

      const existing = candidates.get(media.id);
      const recommendationStrength =
        sourceStrength +
        (typeof recommendation.rating === "number" ? recommendation.rating / 25 : 0) +
        (typeof media.averageScore === "number" ? media.averageScore / 40 : 0);
      const sourceTitle = getRecommendationSourceTitle(entry, titleLanguage);

      if (existing) {
        existing.strength += recommendationStrength;
        existing.sourceCount += 1;
        existing.averageScore = Math.max(
          existing.averageScore ?? 0,
          media.averageScore ?? 0
        );
        if (sourceTitle && !existing.sourceTitles.includes(sourceTitle)) {
          existing.sourceTitles.push(sourceTitle);
        }
        if (recommendationStrength > existing.sourceStrength) {
          existing.sourceStrength = recommendationStrength;
          existing.source = buildRecommendationSource(entry);
          existing.description = media.description ?? existing.description ?? null;
        }
        continue;
      }

      candidates.set(media.id, {
        animeId: media.id,
        title: media.title,
        coverImage: media.coverImage,
        description: media.description ?? null,
        format: media.format ?? null,
        episodes: media.episodes ?? null,
        season: media.season ?? null,
        seasonYear: media.seasonYear ?? null,
        averageScore: media.averageScore ?? null,
        strength: recommendationStrength,
        sourceCount: 1,
        sourceTitles: sourceTitle ? [sourceTitle] : [],
        source: buildRecommendationSource(entry),
        sourceStrength: recommendationStrength,
      });
    }
  }

  const sortedCandidates = [...candidates.values()].sort((a, b) => {
    if (b.strength !== a.strength) {
      return b.strength - a.strength;
    }

    return (b.averageScore ?? 0) - (a.averageScore ?? 0);
  });

  return options.favoriteSourcesOnly
    ? selectFavoriteRecommendationMix(sortedCandidates, 6, 4)
    : sortedCandidates.slice(0, 6);
}

function selectFavoriteRecommendationMix(
  candidates: RecommendationCandidate[],
  limit: number,
  visibleLimit: number
) {
  const visible: RecommendationCandidate[] = [];
  const selectedIds = new Set<number>();
  const selectedSourceKeys = new Set<string>();

  function addCandidate(candidate: RecommendationCandidate) {
    if (selectedIds.has(candidate.animeId) || visible.length >= visibleLimit) {
      return false;
    }

    const sourceKey = getRecommendationSourceKey(candidate);
    if (sourceKey && selectedSourceKeys.has(sourceKey)) {
      return false;
    }

    visible.push(candidate);
    selectedIds.add(candidate.animeId);
    if (sourceKey) {
      selectedSourceKeys.add(sourceKey);
    }
    return true;
  }

  const scoredSourceKeys = [
    ...new Set(
      candidates
        .filter(hasScoredRecommendationSource)
        .map(getRecommendationSourceKey)
        .filter(Boolean) as string[]
    ),
  ];

  for (const sourceKey of scoredSourceKeys) {
    const candidate = candidates.find(
      (item) => hasScoredRecommendationSource(item) && getRecommendationSourceKey(item) === sourceKey
    );

    if (candidate) {
      addCandidate(candidate);
    }
  }

  for (const candidate of candidates) {
    addCandidate(candidate);
  }

  return visible.slice(0, limit);
}

function hasScoredRecommendationSource(candidate: RecommendationCandidate) {
  return typeof candidate.source?.score === "number" && candidate.source.score > 0;
}

function getRecommendationSourceKey(candidate: RecommendationCandidate) {
  return candidate.source?.animeId
    ? String(candidate.source.animeId)
    : candidate.sourceTitles[0] ?? null;
}

function buildGenreWeights(entries: TrackedAnimeEntry[]) {
  const weights = new Map<string, number>();

  for (const entry of entries) {
    if (entry.status === "dropped" || !entry.genres?.length) continue;

    const baseWeight =
      typeof entry.score === "number" && entry.score > 0
        ? entry.score / 10
        : typeof entry.average_score === "number" && entry.average_score > 0
        ? entry.average_score / 100
        : entry.status === "completed" || entry.status === "watching"
        ? 0.45
        : 0.2;

    for (const genre of entry.genres) {
      weights.set(genre, (weights.get(genre) ?? 0) + baseWeight);
    }
  }

  return weights;
}

function getTasteStrength(
  entry: TrackedAnimeEntry,
  genreWeights: Map<string, number>
) {
  const personalScore =
    typeof entry.score === "number" && entry.score > 0
      ? entry.score / 10
      : typeof entry.average_score === "number" && entry.average_score > 0
      ? entry.average_score / 100
      : 0;

  const genreBonus =
    entry.genres?.reduce((sum, genre) => sum + (genreWeights.get(genre) ?? 0), 0) ?? 0;

  return personalScore * 2 + genreBonus * 0.35;
}

function getRecommendationSourceTitle(
  entry: TrackedAnimeEntry,
  titleLanguage: TitleLanguage
) {
  if (hasNegativePersonalSignal(entry)) {
    return null;
  }

  return getEntryTitle(entry, titleLanguage);
}

function buildRecommendationSource(entry: TrackedAnimeEntry): RecommendationSource | null {
  if (
    !entry.title_preferred &&
    !entry.title_english &&
    !entry.title_romaji &&
    !entry.title_native
  ) {
    return null;
  }

  return {
    animeId: entry.anime_id,
    title: {
      userPreferred: entry.title_preferred,
      english: entry.title_english,
      romaji: entry.title_romaji,
      native: entry.title_native,
    },
    coverImage: entry.cover_image_large ?? null,
    format: entry.format ?? null,
    score: entry.score ?? null,
  };
}

function getRecommendationSummary(description?: string | null) {
  const cleaned = stripHtml(description);

  if (!cleaned) {
    return "A strong match based on what you rated highly in your library.";
  }

  return cleaned;
}

function stripHtml(value?: string | null) {
  if (!value) {
    return "";
  }

  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasNegativePersonalSignal(entry: TrackedAnimeEntry) {
  return typeof entry.score === "number" && entry.score > 0 && entry.score <= 4;
}

function getEntryTitle(entry: TrackedAnimeEntry, titleLanguage: TitleLanguage) {
  return getPreferredTitle(
    {
      userPreferred: entry.title_preferred,
      english: entry.title_english,
      romaji: entry.title_romaji,
      native: entry.title_native,
    },
    titleLanguage
  );
}

function getTrendingTitle(anime: TrendingAnime, titleLanguage: TitleLanguage) {
  return getPreferredTitle(anime.title, titleLanguage);
}

function getProgressLabel(entry: TrackedAnimeEntry) {
  if (
    entry.status !== "watching" &&
    entry.status !== "paused" &&
    entry.status !== "completed"
  ) {
    return null;
  }

  if (entry.episodes) {
    return `${entry.progress} / ${entry.episodes} eps`;
  }

  return `${entry.progress} eps`;
}

function formatStatus(status: TrackedAnimeEntry["status"]) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function buildEntryMeta(entry: TrackedAnimeEntry) {
  return [
    entry.format,
    entry.season && entry.season_year
      ? `${formatEnum(entry.season)} ${entry.season_year}`
      : entry.season_year
      ? `${entry.season_year}`
      : null,
    entry.duration ? `${entry.duration} min` : null,
    entry.source ? formatEnum(entry.source) : null,
  ].filter(Boolean) as string[];
}

function formatWatchedTime(totalMinutes: number) {
  const minutes = normalizeWatchedMinutes(totalMinutes);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours < 24) {
    return `${formatNumber(hours)}h ${remainingMinutes}min`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (days < 365) {
    return `${formatNumber(days)} ${days === 1 ? "day" : "days"} ${remainingHours}h`;
  }

  const years = Math.floor(days / 365);
  const remainingDays = days % 365;
  return `${formatNumber(years)} ${years === 1 ? "year" : "years"} ${remainingDays} ${remainingDays === 1 ? "day" : "days"}`;
}

function formatExactWatchedTime(totalMinutes: number) {
  const minutes = normalizeWatchedMinutes(totalMinutes);
  const totalHours = Math.floor(minutes / 60);
  const totalDays = Math.floor(totalHours / 24);
  const years = Math.floor(totalDays / 365);
  const days = totalDays % 365;
  const hours = totalHours % 24;
  const remainingMinutes = minutes % 60;
  const dayText = `${formatExactNumber(years ? days : totalDays)} ${
    (years ? days : totalDays) === 1 ? "day" : "days"
  }`;
  const timeText = `${hours} ${hours === 1 ? "hour" : "hours"} ${remainingMinutes} ${
    remainingMinutes === 1 ? "minute" : "minutes"
  }`;

  if (!years) {
    return `${dayText} ${timeText}`;
  }

  return `${formatExactNumber(years)} ${years === 1 ? "year" : "years"} ${dayText} ${timeText}`;
}

function formatTotalWatchedTime(totalMinutes: number) {
  const minutes = normalizeWatchedMinutes(totalMinutes);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${formatExactNumber(hours)} ${hours === 1 ? "hour" : "hours"} ${remainingMinutes} ${
    remainingMinutes === 1 ? "minute" : "minutes"
  }`;
}

function formatExactCount(value: number, singular: string, plural = `${singular}s`) {
  return `${formatExactNumber(value)} ${value === 1 ? singular : plural}`;
}

function normalizeWatchedMinutes(totalMinutes: number) {
  return Number.isFinite(totalMinutes) && totalMinutes > 0 ? Math.round(totalMinutes) : 0;
}

function formatCompactSeason(season: string, year: number) {
  return `${formatEnum(season)} '${String(year).slice(-2)}`;
}

function getDisplayScore(entry: TrackedAnimeEntry) {
  if (typeof entry.score === "number" && entry.score > 0) {
    return `Mine ${entry.score}`;
  }

  if (typeof entry.average_score === "number" && entry.average_score > 0) {
    return `Avg ${formatScore10(entry.average_score / 10)}`;
  }

  if (typeof entry.mean_score === "number" && entry.mean_score > 0) {
    return `Avg ${formatScore10(entry.mean_score / 10)}`;
  }

  return null;
}

function getMangaEntryTitle(entry: TrackedMangaEntry, titleLanguage: TitleLanguage) {
  return getPreferredTitle(
    {
      english: entry.title_english,
      romaji: entry.title_romaji,
      native: entry.title_native,
      userPreferred: entry.title_preferred,
    },
    titleLanguage
  );
}

function getMangaDisplayScore(entry: TrackedMangaEntry) {
  if (typeof entry.score === "number" && entry.score > 0) return `Mine ${entry.score}`;
  if (typeof entry.average_score === "number" && entry.average_score > 0) {
    return `Avg ${formatScore10(entry.average_score / 10)}`;
  }
  if (typeof entry.mean_score === "number" && entry.mean_score > 0) {
    return `Avg ${formatScore10(entry.mean_score / 10)}`;
  }
  return null;
}

function formatMangaProgress(entry: TrackedMangaEntry) {
  const volumes = Math.max(0, Number(entry.volume_progress ?? 0));
  const chapters = Math.max(0, Number(entry.progress ?? 0));
  return `${formatNumber(volumes)} vols · ${formatNumber(chapters)} ch`;
}

function formatMangaHomeStatus(status: TrackedMangaEntry["status"]) {
  if (status === "watching") return "Reading";
  if (status === "planned") return "Plan to Read";
  return formatStatus(status);
}

function readPersonalLayoutOrder() {
  const savedOrder = getMigratedLocalStorageItem(
    HOME_PERSONAL_LAYOUT_STORAGE_KEY,
    HOME_PERSONAL_LAYOUT_LEGACY_STORAGE_KEY
  );

  if (!savedOrder) {
    return [...DEFAULT_PERSONAL_LAYOUT_ORDER];
  }

  try {
    return normalizePersonalLayoutOrder(JSON.parse(savedOrder));
  } catch {
    return [...DEFAULT_PERSONAL_LAYOUT_ORDER];
  }
}

function persistPersonalLayoutOrder(order: PersonalLayoutSectionId[]) {
  window.localStorage.setItem(HOME_PERSONAL_LAYOUT_STORAGE_KEY, JSON.stringify(order));
  window.localStorage.removeItem(HOME_PERSONAL_LAYOUT_LEGACY_STORAGE_KEY);
}

function readMangaPersonalLayoutOrder() {
  const savedOrder = window.localStorage.getItem(HOME_MANGA_PERSONAL_LAYOUT_STORAGE_KEY);
  if (!savedOrder) return [...DEFAULT_PERSONAL_LAYOUT_ORDER];

  try {
    return normalizePersonalLayoutOrder(JSON.parse(savedOrder));
  } catch {
    return [...DEFAULT_PERSONAL_LAYOUT_ORDER];
  }
}

function persistMangaPersonalLayoutOrder(order: PersonalLayoutSectionId[]) {
  window.localStorage.setItem(
    HOME_MANGA_PERSONAL_LAYOUT_STORAGE_KEY,
    JSON.stringify(order)
  );
}

function getPersonalGridStorageKey(userId: number) {
  return `seenary.personal-grid-layout.v${PERSONAL_GRID_STORAGE_VERSION}:${userId}`;
}

function getMangaPersonalGridStorageKey(userId: number) {
  return `seenary.manga-personal-grid-layout.v${PERSONAL_GRID_STORAGE_VERSION}:${userId}`;
}

function cloneDefaultPersonalGridLayout() {
  return DEFAULT_PERSONAL_GRID_LAYOUT.map((item) => ({ ...item }));
}

function createPersonalGridFromLegacyOrder(order: PersonalLayoutSectionId[]) {
  const defaultById = new Map(
    DEFAULT_PERSONAL_GRID_LAYOUT.map((item) => [item.id, item] as const)
  );
  const widgetOrder = order.flatMap<PersonalGridWidgetId>((sectionId) =>
    sectionId === "overview" ? ["spotlight", "account"] : [sectionId]
  );

  return normalizePersonalGridLayout(
    widgetOrder.map((id) => ({
      ...(defaultById.get(id) ?? { id, columns: 12, rows: 6 }),
    }))
  );
}

function readPersonalGridLayout(userId: number) {
  try {
    const saved = window.localStorage.getItem(getPersonalGridStorageKey(userId));
    if (!saved) {
      return createPersonalGridFromLegacyOrder(readPersonalLayoutOrder());
    }

    const parsed = JSON.parse(saved) as {
      version?: number;
      items?: unknown;
    };
    if (parsed.version !== PERSONAL_GRID_STORAGE_VERSION) {
      return createPersonalGridFromLegacyOrder(readPersonalLayoutOrder());
    }

    return normalizePersonalGridLayout(parsed.items);
  } catch {
    return createPersonalGridFromLegacyOrder(readPersonalLayoutOrder());
  }
}

function persistPersonalGridLayout(userId: number, layout: PersonalGridItem[]) {
  try {
    window.localStorage.setItem(
      getPersonalGridStorageKey(userId),
      JSON.stringify({
        version: PERSONAL_GRID_STORAGE_VERSION,
        items: normalizePersonalGridLayout(layout),
      })
    );
  } catch {
    // The in-memory layout remains usable when storage is unavailable.
  }
}

function readMangaPersonalGridLayout(userId: number) {
  try {
    const saved = window.localStorage.getItem(getMangaPersonalGridStorageKey(userId));
    if (!saved) {
      return createPersonalGridFromLegacyOrder(readMangaPersonalLayoutOrder());
    }

    const parsed = JSON.parse(saved) as {
      version?: number;
      items?: unknown;
    };
    if (parsed.version !== PERSONAL_GRID_STORAGE_VERSION) {
      return createPersonalGridFromLegacyOrder(readMangaPersonalLayoutOrder());
    }

    return normalizePersonalGridLayout(parsed.items);
  } catch {
    return createPersonalGridFromLegacyOrder(readMangaPersonalLayoutOrder());
  }
}

function persistMangaPersonalGridLayout(userId: number, layout: PersonalGridItem[]) {
  try {
    window.localStorage.setItem(
      getMangaPersonalGridStorageKey(userId),
      JSON.stringify({
        version: PERSONAL_GRID_STORAGE_VERSION,
        items: normalizePersonalGridLayout(layout),
      })
    );
  } catch {
    // The in-memory layout remains usable when storage is unavailable.
  }
}

function normalizePersonalGridLayout(value: unknown): PersonalGridItem[] {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<PersonalGridWidgetId>();
  const items: PersonalGridItem[] = [];

  for (const candidate of source) {
    if (!candidate || typeof candidate !== "object") continue;
    const raw = candidate as {
      id?: unknown;
      span?: unknown;
      columns?: unknown;
      rows?: unknown;
      orientation?: unknown;
    };
    if (
      typeof raw.id !== "string" ||
      !Object.prototype.hasOwnProperty.call(PERSONAL_GRID_WIDGET_LABELS, raw.id)
    ) {
      continue;
    }

    const id = raw.id as PersonalGridWidgetId;
    if (seen.has(id)) continue;
    seen.add(id);

    const defaultItem =
      DEFAULT_PERSONAL_GRID_LAYOUT.find((item) => item.id === id) ??
      ({ id, columns: 12, rows: 6 } satisfies PersonalGridItem);
    const constraints = PERSONAL_GRID_CONSTRAINTS[id];
    const orientation = PERSONAL_GRID_SHELF_IDS.has(id)
      ? raw.orientation === "vertical"
        ? "vertical"
        : "horizontal"
      : undefined;
    const requestedColumns = Number(raw.columns ?? raw.span ?? defaultItem.columns);
    const requestedRows = Number(raw.rows ?? defaultItem.rows);
    const minimumColumns =
      id === "stats" && orientation !== "vertical"
        ? Math.max(10, constraints.minColumns)
        : PERSONAL_GRID_SHELF_IDS.has(id) && orientation !== "vertical"
        ? Math.max(6, constraints.minColumns)
        : constraints.minColumns;
    const minimumRows =
      PERSONAL_GRID_SHELF_IDS.has(id) && id !== "stats" && orientation === "vertical"
        ? Math.max(7, constraints.minRows)
        : constraints.minRows;
    const maximumRows =
      PERSONAL_GRID_SHELF_IDS.has(id) && orientation !== "vertical"
        ? (PERSONAL_GRID_HORIZONTAL_ROWS[id] ?? constraints.maxRows)
        : constraints.maxRows;
    const columns = Math.max(
      minimumColumns,
      Math.min(
        constraints.maxColumns,
        Number.isFinite(requestedColumns)
          ? Math.round(requestedColumns)
          : defaultItem.columns
      )
    );
    const rows = Math.max(
      minimumRows,
      Math.min(
        maximumRows,
        Number.isFinite(requestedRows) ? Math.round(requestedRows) : defaultItem.rows
      )
    );

    items.push({ id, columns, rows, ...(orientation ? { orientation } : {}) });
  }

  for (const defaultItem of DEFAULT_PERSONAL_GRID_LAYOUT) {
    if (!seen.has(defaultItem.id)) {
      items.push({ ...defaultItem });
    }
  }

  return items;
}

function persistDiscoverLayoutOrder(order: string[]) {
  window.localStorage.setItem(HOME_DISCOVER_LAYOUT_STORAGE_KEY, JSON.stringify(order));
  window.localStorage.removeItem(HOME_DISCOVER_LAYOUT_LEGACY_STORAGE_KEY);
}

function movePersonalGridWidget(
  layout: PersonalGridItem[],
  activeWidgetId: PersonalGridWidgetId,
  targetWidgetId: PersonalGridWidgetId
) {
  const activeIndex = layout.findIndex((item) => item.id === activeWidgetId);
  const targetIndex = layout.findIndex((item) => item.id === targetWidgetId);
  if (activeIndex < 0 || targetIndex < 0 || activeIndex === targetIndex) return layout;

  const next = [...layout];
  const [activeItem] = next.splice(activeIndex, 1);
  next.splice(targetIndex, 0, activeItem);
  return next;
}

function normalizePersonalLayoutOrder(value: unknown): PersonalLayoutSectionId[] {
  const allowedSections = new Set<PersonalLayoutSectionId>(DEFAULT_PERSONAL_LAYOUT_ORDER);
  const savedSections = Array.isArray(value)
    ? value.filter((section): section is PersonalLayoutSectionId =>
        allowedSections.has(section as PersonalLayoutSectionId)
      )
    : [];
  if (!savedSections.includes("activity")) {
    const statsIndex = savedSections.indexOf("stats");
    if (statsIndex >= 0) savedSections.splice(statsIndex + 1, 0, "activity");
  }
  const missingSections = DEFAULT_PERSONAL_LAYOUT_ORDER.filter(
    (section) => !savedSections.includes(section)
  );

  return [...savedSections, ...missingSections];
}

function readDiscoverLayoutOrder() {
  const savedOrder = getMigratedLocalStorageItem(
    HOME_DISCOVER_LAYOUT_STORAGE_KEY,
    HOME_DISCOVER_LAYOUT_LEGACY_STORAGE_KEY
  );

  if (!savedOrder) {
    return [...DEFAULT_DISCOVER_LAYOUT_ORDER];
  }

  try {
    const parsed = JSON.parse(savedOrder);
    return Array.isArray(parsed) ? parsed.filter((section) => typeof section === "string") : [];
  } catch {
    return [...DEFAULT_DISCOVER_LAYOUT_ORDER];
  }
}

function getDefaultDiscoverLayoutOrder(shelves: DiscoverShelf[]) {
  const defaultSectionIds = new Set<string>(DEFAULT_DISCOVER_LAYOUT_ORDER);
  const dynamicShelfIds = shelves
    .map((shelf) => shelf.id)
    .filter((shelfId) => !defaultSectionIds.has(shelfId));

  return [...DEFAULT_DISCOVER_LAYOUT_ORDER, ...dynamicShelfIds];
}

function normalizeDiscoverLayoutOrder(order: string[], shelves: DiscoverShelf[]) {
  const availableSectionIds = new Set(getDefaultDiscoverLayoutOrder(shelves));
  const savedSections = order.filter((sectionId) => availableSectionIds.has(sectionId));
  const missingSections = getDefaultDiscoverLayoutOrder(shelves).filter(
    (sectionId) => !savedSections.includes(sectionId)
  );

  return [...savedSections, ...missingSections];
}

function moveLayoutSection(order: string[], activeSectionId: string, targetSectionId: string) {
  const activeIndex = order.indexOf(activeSectionId);
  const targetIndex = order.indexOf(targetSectionId);

  if (activeIndex === -1 || targetIndex === -1 || activeIndex === targetIndex) {
    return order;
  }

  const nextOrder = [...order];
  const [activeSection] = nextOrder.splice(activeIndex, 1);
  nextOrder.splice(targetIndex, 0, activeSection);

  return nextOrder;
}

function readSavedDiscoverState(): SavedDiscoverState | null {
  try {
    const raw = getMigratedLocalStorageItem(
      HOME_DISCOVER_STATE_STORAGE_KEY,
      HOME_DISCOVER_STATE_LEGACY_STORAGE_KEY
    );
    if (!raw) return null;

    const parsed = JSON.parse(raw) as SavedDiscoverState;

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if (
      parsed.version !== HOME_DISCOVER_STATE_VERSION ||
      !Number.isFinite(parsed.savedAt) ||
      Date.now() - parsed.savedAt > HOME_DISCOVER_CACHE_TTL_MS
    ) {
      return null;
    }

    const discoverShelfPages = Object.fromEntries(
      Object.entries(parsed.discoverShelfPages ?? {}).flatMap(([stateKey, candidate]) => {
        if (
          !candidate ||
          typeof candidate !== "object" ||
          candidate.isLoading ||
          !candidate.shelf ||
          typeof candidate.shelf.id !== "string" ||
          !Array.isArray(candidate.shelf.items) ||
          !Array.isArray(candidate.shelf.pills) ||
          !Array.isArray(candidate.items)
        ) {
          return [];
        }

        return [[
          stateKey,
          {
            ...candidate,
            page: candidate.pageInfo?.currentPage ?? candidate.page ?? 1,
            isLoading: false,
            isLoadingMore: false,
            scrollTop: Number.isFinite(candidate.scrollTop) ? candidate.scrollTop : 0,
            loadMoreError: null,
          },
        ]];
      })
    ) as Record<string, DiscoverShelfPageState>;
    const activeDiscoverShelfId =
      typeof parsed.activeDiscoverShelfId === "string" &&
      Object.keys(discoverShelfPages).some((stateKey) =>
        stateKey.endsWith(`:${parsed.activeDiscoverShelfId}`)
      )
        ? parsed.activeDiscoverShelfId
        : null;

    return {
      version: HOME_DISCOVER_STATE_VERSION,
      savedAt: parsed.savedAt,
      activeDiscoverShelfId,
      discoverShelfPages,
      overviewScrollTop:
        typeof parsed.overviewScrollTop === "number" ? parsed.overviewScrollTop : 0,
      overviewRailScrolls:
        parsed.overviewRailScrolls && typeof parsed.overviewRailScrolls === "object"
          ? parsed.overviewRailScrolls
          : {},
    };
  } catch {
    return null;
  }
}

function mergeAnimeItems(currentItems: TrendingAnime[], nextItems: TrendingAnime[]) {
  const seenIds = new Set(currentItems.map((item) => item.id));
  const merged = [...currentItems];

  for (const item of nextItems) {
    if (seenIds.has(item.id)) continue;

    seenIds.add(item.id);
    merged.push(item);
  }

  return merged;
}

function toQuickAddAnime(anime: TrendingAnime): QuickAddAnime {
  return {
    id: anime.id,
    title: {
      romaji: anime.title?.romaji ?? undefined,
      english: anime.title?.english ?? undefined,
      native: anime.title?.native ?? undefined,
      userPreferred: anime.title?.userPreferred ?? undefined,
    },
    coverImage: {
      large: anime.coverImage?.large ?? "",
    },
    episodes: anime.episodes ?? null,
    format: anime.format ?? null,
    averageScore: anime.averageScore ?? null,
    season: anime.season ?? null,
    seasonYear: anime.seasonYear ?? null,
  };
}
