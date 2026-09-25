import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import {
  BookmarkIcon,
  Bars3BottomLeftIcon,
  CheckIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  PauseCircleIcon,
  Squares2X2Icon,
  ViewColumnsIcon,
  StarIcon,
  XCircleIcon,
  EyeIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { ListEntryModal } from "./ListEntryModal";
import { MyListCard } from "./MyListCard";
import { getPreferredTitle, type TitleLanguage } from "../utils/titlePreference";
import { getMigratedLocalStorageItem } from "../utils/localStorageMigration";
import type { MediaType, TrackedMangaEntry } from "../types/domain";
import { LibraryLens, type LibraryDestination } from "./LibraryLens";
import { LayoutEditorToolbar, ReorderableSection } from "./ui/LayoutEditor";
import { getListStatusLabel } from "../utils/mediaFormatting";
import { Tooltip } from "./ui/Tooltip";

type MyListEntry = {
  anime_id: number;
  status: "planned" | "watching" | "completed" | "paused" | "dropped";
  is_favorite?: number | boolean;
  progress: number;
  score: number | null;
  notes: string | null;
  updated_at?: string | null;
  local_updated_at?: string | null;
  provider_updated_at?: string | null;
  title_romaji?: string | null;
  title_english?: string | null;
  title_native?: string | null;
  title_preferred?: string | null;
  cover_image_large?: string | null;
  hidden_by_adult_filter?: boolean;
  episodes?: number | null;
  format?: string | null;
  anime_status?: string | null;
  next_airing_episode?: number | null;
  next_airing_at?: number | null;
  average_score?: number | null;
  season?: string | null;
  season_year?: number | null;
  start_date?: string | { year?: number | null } | null;
  media_type?: MediaType;
  manga_id?: number;
  chapters?: number | null;
  volumes?: number | null;
  volume_progress?: number;
  is_rereading?: number | boolean;
  genres?: string[];
  tags?: Array<{
    name?: string | null;
    isMediaSpoiler?: boolean;
    isGeneralSpoiler?: boolean;
  }>;
  details?: {
    startDate?: { year?: number | null } | null;
    tags?: Array<{
      name?: string | null;
      isMediaSpoiler?: boolean;
      isGeneralSpoiler?: boolean;
    }> | null;
  } | null;
};

type MyListPageProps = {
  userId: number;
  entries: MyListEntry[];
  mangaEntries: TrackedMangaEntry[];
  onSelectMedia: (id: number, mediaType: MediaType) => void;
  onRefreshList: () => void | Promise<void>;
  onListChanged?: () => void | Promise<void>;
  onNotify?: (
    kind: "success" | "error" | "warning",
    title: string,
    message: string
  ) => void;
  titleLanguage: TitleLanguage;
  density: MyListDensity;
  activeMediaType: MediaType;
  onMediaTypeChange: (mediaType: MediaType) => void;
  onLibraryDestinationChange: (destination: LibraryDestination) => void;
  onLibraryLensVisibilityChange: (isVisible: boolean) => void;
  initialScrollTop: number;
  onScrollContainerChange: (element: HTMLDivElement | null) => void;
  onScrollPositionChange: (scrollTop: number) => void;
};

type SortMode = "alphabetical" | "personalScore";
type ListStatus = MyListEntry["status"];
type MyListDensity = "comfortable" | "balanced" | "compact";
type MyListView = "list" | "grid" | "board";
type RatingFilter = "all" | "rated" | "unrated" | "excellent" | "good" | "mixed" | "low";
type ActivityFilter = "all" | "today" | "7d" | "30d" | "year";
type OpenFilter = "rating" | "format" | "genres" | "tags" | "release" | "activity" | "length" | null;

const DEFAULT_STATUS_ORDER: ListStatus[] = [
  "watching",
  "planned",
  "completed",
  "paused",
  "dropped",
];

const STATUS_META: Record<
  ListStatus,
  {
    label: string;
    icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    description: string;
  }
> = {
  watching: {
    label: "Watching",
    icon: EyeIcon,
    description: "What you're actively going through right now.",
  },
  planned: {
    label: "Planned",
    icon: BookmarkIcon,
    description: "Titles waiting for their turn.",
  },
  completed: {
    label: "Completed",
    icon: CheckCircleIcon,
    description: "Finished and safely archived.",
  },
  paused: {
    label: "Paused",
    icon: PauseCircleIcon,
    description: "Stuff you stepped away from for now.",
  },
  dropped: {
    label: "Dropped",
    icon: XCircleIcon,
    description: "Titles you decided not to continue.",
  },
};

function getStatusMeta(status: ListStatus, mediaType: MediaType) {
  const meta = STATUS_META[status];
  if (mediaType !== "MANGA") return { ...meta, label: getListStatusLabel(status, mediaType) };

  if (status === "watching") {
    return {
      ...meta,
      label: "Reading",
      description: "Manga you are actively reading right now.",
    };
  }
  if (status === "planned") {
    return {
      ...meta,
      label: "Plan to Read",
      description: "Manga waiting on your reading list.",
    };
  }
  return { ...meta, label: getListStatusLabel(status, mediaType) };
}

const DEFAULT_OPEN_SECTIONS: Record<MyListEntry["status"], boolean> = {
  watching: true,
  planned: true,
  completed: false,
  paused: false,
  dropped: false,
};

const MY_LIST_OPEN_SECTIONS_KEY = "seenary.my-list.open-sections";
const MY_LIST_OPEN_SECTIONS_LEGACY_KEY = "media-tracker.my-list.open-sections";
const MY_LIST_SORT_MODE_KEY = "seenary.my-list.sort-mode";
const MY_LIST_SORT_MODE_LEGACY_KEY = "media-tracker.my-list.sort-mode";
const MY_LIST_SECTION_ORDER_KEY = "seenary.my-list.section-order";
const MY_LIST_SECTION_ORDER_LEGACY_KEY = "media-tracker.my-list.section-order";
const MY_LIST_VIEW_KEY = "seenary.my-list.view";

function getMediaPreferenceKey(key: string, mediaType: MediaType) {
  return mediaType === "MANGA" ? `${key}.manga` : key;
}

function readStoredView(mediaType: MediaType = "ANIME"): MyListView {
  if (typeof window === "undefined") return "list";
  const value = window.localStorage.getItem(getMediaPreferenceKey(MY_LIST_VIEW_KEY, mediaType));
  return value === "grid" || value === "board" || value === "list" ? value : "list";
}

function readStoredOpenSections(mediaType: MediaType = "ANIME") {
  if (typeof window === "undefined") {
    return DEFAULT_OPEN_SECTIONS;
  }

  try {
    const rawValue = getMigratedLocalStorageItem(
      getMediaPreferenceKey(MY_LIST_OPEN_SECTIONS_KEY, mediaType),
      getMediaPreferenceKey(MY_LIST_OPEN_SECTIONS_LEGACY_KEY, mediaType)
    );

    if (!rawValue) {
      return DEFAULT_OPEN_SECTIONS;
    }

    const parsed = JSON.parse(rawValue);

    return {
      watching:
        typeof parsed?.watching === "boolean"
          ? parsed.watching
          : DEFAULT_OPEN_SECTIONS.watching,
      planned:
        typeof parsed?.planned === "boolean"
          ? parsed.planned
          : DEFAULT_OPEN_SECTIONS.planned,
      completed:
        typeof parsed?.completed === "boolean"
          ? parsed.completed
          : DEFAULT_OPEN_SECTIONS.completed,
      paused:
        typeof parsed?.paused === "boolean"
          ? parsed.paused
          : DEFAULT_OPEN_SECTIONS.paused,
      dropped:
        typeof parsed?.dropped === "boolean"
          ? parsed.dropped
          : DEFAULT_OPEN_SECTIONS.dropped,
    };
  } catch {
    return DEFAULT_OPEN_SECTIONS;
  }
}

function readStoredSortMode(mediaType: MediaType = "ANIME"): SortMode {
  if (typeof window === "undefined") {
    return "alphabetical";
  }

  try {
    const storedSortMode = getMigratedLocalStorageItem(
      getMediaPreferenceKey(MY_LIST_SORT_MODE_KEY, mediaType),
      getMediaPreferenceKey(MY_LIST_SORT_MODE_LEGACY_KEY, mediaType)
    );

    return storedSortMode === "personalScore" || storedSortMode === "alphabetical"
      ? storedSortMode
      : "alphabetical";
  } catch {
    return "alphabetical";
  }
}

function readStoredSectionOrder(mediaType: MediaType = "ANIME") {
  if (typeof window === "undefined") {
    return [...DEFAULT_STATUS_ORDER];
  }

  try {
    const rawValue = getMigratedLocalStorageItem(
      getMediaPreferenceKey(MY_LIST_SECTION_ORDER_KEY, mediaType),
      getMediaPreferenceKey(MY_LIST_SECTION_ORDER_LEGACY_KEY, mediaType)
    );

    if (!rawValue) {
      return [...DEFAULT_STATUS_ORDER];
    }

    return normalizeSectionOrder(JSON.parse(rawValue));
  } catch {
    return [...DEFAULT_STATUS_ORDER];
  }
}

function persistSectionOrder(order: ListStatus[], mediaType: MediaType = "ANIME") {
  try {
    window.localStorage.setItem(
      getMediaPreferenceKey(MY_LIST_SECTION_ORDER_KEY, mediaType),
      JSON.stringify(order)
    );
    window.localStorage.removeItem(
      getMediaPreferenceKey(MY_LIST_SECTION_ORDER_LEGACY_KEY, mediaType)
    );
  } catch {
    // Ignore local persistence failures and keep the UI usable.
  }
}

function normalizeSectionOrder(value: unknown): ListStatus[] {
  const allowedStatuses = new Set<ListStatus>(DEFAULT_STATUS_ORDER);
  const savedStatuses = Array.isArray(value)
    ? value.filter((status): status is ListStatus =>
        allowedStatuses.has(status as ListStatus)
      )
    : [];
  const missingStatuses = DEFAULT_STATUS_ORDER.filter(
    (status) => !savedStatuses.includes(status)
  );

  return [...savedStatuses, ...missingStatuses];
}

function isListStatus(value: string): value is ListStatus {
  return DEFAULT_STATUS_ORDER.includes(value as ListStatus);
}

function moveSectionOrder(
  order: ListStatus[],
  activeStatus: ListStatus,
  targetStatus: ListStatus
) {
  const currentOrder = normalizeSectionOrder(order);
  const activeIndex = currentOrder.indexOf(activeStatus);
  const targetIndex = currentOrder.indexOf(targetStatus);

  if (activeIndex === -1 || targetIndex === -1 || activeIndex === targetIndex) {
    return currentOrder;
  }

  const nextOrder = [...currentOrder];
  const [activeSection] = nextOrder.splice(activeIndex, 1);
  nextOrder.splice(targetIndex, 0, activeSection);

  return nextOrder;
}

function getCollapsedSections(): Record<ListStatus, boolean> {
  return {
    watching: false,
    planned: false,
    completed: false,
    paused: false,
    dropped: false,
  };
}

export function MyListPage({
  userId,
  entries: animeEntries,
  mangaEntries,
  onSelectMedia,
  onRefreshList,
  onListChanged,
  onNotify,
  titleLanguage,
  density,
  activeMediaType,
  onMediaTypeChange,
  onLibraryDestinationChange,
  onLibraryLensVisibilityChange,
  initialScrollTop,
  onScrollContainerChange,
  onScrollPositionChange,
}: MyListPageProps) {
  const entries: MyListEntry[] =
    activeMediaType === "MANGA" ? mangaEntries : animeEntries;
  const [editingEntry, setEditingEntry] = useState<MyListEntry | null>(null);
  const [listSearch, setListSearch] = useState("");
  const [openSections, setOpenSections] = useState(() =>
    readStoredOpenSections(activeMediaType)
  );
  const [sortMode, setSortMode] = useState<SortMode>(() =>
    readStoredSortMode(activeMediaType)
  );
  const [sectionOrder, setSectionOrder] = useState<ListStatus[]>(() =>
    readStoredSectionOrder(activeMediaType)
  );
  const sectionOrderRef = useRef(sectionOrder);
  const [isEditingSectionOrder, setIsEditingSectionOrder] = useState(false);
  const [draggedSectionStatus, setDraggedSectionStatus] = useState<ListStatus | null>(null);
  const [view, setView] = useState<MyListView>(() => readStoredView(activeMediaType));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");
  const [formatFilter, setFormatFilter] = useState("all");
  const [genreFilters, setGenreFilters] = useState<string[]>([]);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [releaseFromYear, setReleaseFromYear] = useState("");
  const [releaseToYear, setReleaseToYear] = useState("");
  const [releaseSeason, setReleaseSeason] = useState("all");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [minimumLength, setMinimumLength] = useState("");
  const [maximumLength, setMaximumLength] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [openFilter, setOpenFilter] = useState<OpenFilter>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const openSectionsBeforeEdit = useRef<Record<ListStatus, boolean> | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const initialScrollTopOnMount = useRef(initialScrollTop);
  const isRestoringScroll = useRef(false);
  const restoringScrollTarget = useRef(0);

  const rememberScrollContainer = useCallback(
    (element: HTMLDivElement | null) => {
      scrollContainerRef.current = element;
      onScrollContainerChange(element);
    },
    [onScrollContainerChange]
  );
  const handleOpenMedia = useCallback(
    (mediaId: number) => onSelectMedia(mediaId, activeMediaType),
    [activeMediaType, onSelectMedia]
  );

  function handleMediaTypeChange(mediaType: MediaType) {
    if (mediaType === activeMediaType) return;

    const nextOrder = readStoredSectionOrder(mediaType);
    sectionOrderRef.current = nextOrder;
    setSectionOrder(nextOrder);
    setOpenSections(readStoredOpenSections(mediaType));
    setSortMode(readStoredSortMode(mediaType));
    setView(readStoredView(mediaType));
    setIsEditingSectionOrder(false);
    setEditingEntry(null);
    onMediaTypeChange(mediaType);
    setListSearch("");
    setRatingFilter("all");
    setFormatFilter("all");
    setGenreFilters([]);
    setTagFilters([]);
    setReleaseFromYear("");
    setReleaseToYear("");
    setReleaseSeason("all");
    setActivityFilter("all");
    setMinimumLength("");
    setMaximumLength("");
    setFavoriteOnly(false);
    setOpenFilter(null);
  }

  useEffect(() => {
    onRefreshList();
  }, [onRefreshList]);

  useLayoutEffect(() => {
    let frame = 0;
    let timeout = 0;
    let cancelled = false;
    let attempts = 0;
    const targetScrollTop = initialScrollTopOnMount.current;

    restoringScrollTarget.current = targetScrollTop;
    isRestoringScroll.current = targetScrollTop > 0;

    function restoreScroll() {
      if (cancelled) return;

      const container = scrollContainerRef.current;
      if (!container) {
        isRestoringScroll.current = false;
        return;
      }

      container.scrollTop = targetScrollTop;
      const isAtTarget = Math.abs(container.scrollTop - targetScrollTop) < 2;

      if (isAtTarget || targetScrollTop <= 0 || attempts >= 40) {
        isRestoringScroll.current = false;
        onScrollPositionChange(container.scrollTop);
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
  }, [onScrollPositionChange]);

  useEffect(() => {
    if (!window.desktopConfig) return;
    const desktopConfig = window.desktopConfig;

    let cancelled = false;

    async function loadDesktopSectionOrder() {
      try {
        const result = await desktopConfig.getLayoutOrders(userId);
        if (cancelled || !result.ok) return;

        const savedOrder =
          activeMediaType === "MANGA"
            ? result.mangaMyListSectionOrder
            : result.myListSectionOrder;

        if (savedOrder) {
          const order = normalizeSectionOrder(savedOrder);
          sectionOrderRef.current = order;
          persistSectionOrder(order, activeMediaType);
          setSectionOrder(order);
        } else {
          desktopConfig.setLayoutOrders(
            userId,
            activeMediaType === "MANGA"
              ? { mangaMyListSectionOrder: sectionOrderRef.current }
              : { myListSectionOrder: sectionOrderRef.current }
          );
        }
      } catch (error) {
        console.warn("Failed to load desktop My List configuration:", error);
      }
    }

    void loadDesktopSectionOrder();
    return () => {
      cancelled = true;
    };
  }, [activeMediaType, userId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (isEditingSectionOrder) {
      return;
    }

    try {
      window.localStorage.setItem(
        getMediaPreferenceKey(MY_LIST_OPEN_SECTIONS_KEY, activeMediaType),
        JSON.stringify(openSections)
      );
    } catch {
      // Ignore local persistence failures and keep the UI usable.
    }
  }, [activeMediaType, isEditingSectionOrder, openSections]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        getMediaPreferenceKey(MY_LIST_SORT_MODE_KEY, activeMediaType),
        sortMode
      );
    } catch {
      // Ignore local persistence failures and keep the UI usable.
    }
  }, [activeMediaType, sortMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(getMediaPreferenceKey(MY_LIST_VIEW_KEY, activeMediaType), view);
    } catch {
      // Ignore local persistence failures and keep the UI usable.
    }
  }, [activeMediaType, view]);

  function saveSectionOrder(order: ListStatus[]) {
    sectionOrderRef.current = order;
    persistSectionOrder(order, activeMediaType);
    setSectionOrder(order);
    const result = window.desktopConfig?.setLayoutOrders(
      userId,
      activeMediaType === "MANGA"
        ? { mangaMyListSectionOrder: order }
        : { myListSectionOrder: order }
    );
    if (result && !result.ok) {
      console.warn(result.message || "Failed to save My List layout.");
    }
  }

  function handleToggleSectionOrderEdit() {
    if (isEditingSectionOrder) {
      persistSectionOrder(sectionOrderRef.current, activeMediaType);
      setIsEditingSectionOrder(false);

      if (openSectionsBeforeEdit.current) {
        setOpenSections(openSectionsBeforeEdit.current);
        openSectionsBeforeEdit.current = null;
      }

      setDraggedSectionStatus(null);
      return;
    }

    openSectionsBeforeEdit.current = openSections;
    setIsEditingSectionOrder(true);
    setDraggedSectionStatus(null);
    setOpenSections(getCollapsedSections());
  }

  function handleResetSectionOrder() {
    const defaultOrder = [...DEFAULT_STATUS_ORDER];
    saveSectionOrder(defaultOrder);
    setDraggedSectionStatus(null);
  }

  function handleSectionDragStart(status: string, event: DragEvent<HTMLDivElement>) {
    if (!isListStatus(status)) {
      return;
    }

    setDraggedSectionStatus(status);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", status);
  }

  function handleSectionDragOver(status: string, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();

    const activeStatus = draggedSectionStatus;
    if (!activeStatus || activeStatus === status || !isListStatus(status)) {
      return;
    }

    saveSectionOrder(moveSectionOrder(sectionOrderRef.current, activeStatus, status));
  }

  function handleSectionDragEnd() {
    setDraggedSectionStatus(null);
  }

  const normalizedSearch = listSearch.trim().toLowerCase();

  const availableFormats = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.format).filter(Boolean) as string[])).sort(),
    [entries]
  );
  const availableGenres = useMemo(
    () => collectFilterValues(entries.flatMap((entry) => entry.genres ?? [])),
    [entries]
  );
  const availableTags = useMemo(
    () => collectFilterValues(entries.flatMap(getFilterableTagNames)),
    [entries]
  );
  const availableReleaseRange = useMemo(() => {
    const years = entries
      .map(getReleaseYear)
      .filter((year): year is number => year !== null)
      .sort((left, right) => left - right);
    return years.length > 0
      ? { earliest: years[0], latest: years[years.length - 1] }
      : { earliest: null, latest: null };
  }, [entries]);
  const availableLengthRange = useMemo(() => {
    const lengths = entries
      .map((entry) => activeMediaType === "MANGA" ? entry.chapters : entry.episodes)
      .filter((length): length is number => Number.isFinite(length) && Number(length) > 0)
      .map(Number)
      .sort((left, right) => left - right);
    return lengths.length > 0
      ? { minimum: lengths[0], maximum: lengths[lengths.length - 1] }
      : { minimum: null, maximum: null };
  }, [activeMediaType, entries]);

  const activeFilterCount =
    Number(ratingFilter !== "all") +
    Number(formatFilter !== "all") +
    genreFilters.length +
    tagFilters.length +
    Number(Boolean(releaseFromYear || releaseToYear || releaseSeason !== "all")) +
    Number(activityFilter !== "all") +
    Number(Boolean(minimumLength || maximumLength)) +
    Number(favoriteOnly);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (formatFilter !== "all" && entry.format !== formatFilter) return false;
      if (ratingFilter === "rated" && entry.score === null) return false;
      if (ratingFilter === "unrated" && entry.score !== null) return false;
      if (ratingFilter === "excellent" && (entry.score === null || entry.score < 9)) return false;
      if (ratingFilter === "good" && (entry.score === null || entry.score < 7 || entry.score >= 9)) return false;
      if (ratingFilter === "mixed" && (entry.score === null || entry.score < 5 || entry.score >= 7)) return false;
      if (ratingFilter === "low" && (entry.score === null || entry.score >= 5)) return false;

      const releaseYear = getReleaseYear(entry);
      const yearBounds = getNumericBounds(releaseFromYear, releaseToYear);
      if (yearBounds.minimum !== null && (releaseYear === null || releaseYear < yearBounds.minimum)) return false;
      if (yearBounds.maximum !== null && (releaseYear === null || releaseYear > yearBounds.maximum)) return false;
      if (releaseSeason !== "all" && entry.season !== releaseSeason) return false;

      if (activityFilter !== "all") {
        const activityTime = getLatestActivityTimestamp(entry);
        if (activityTime === null || !matchesActivityWindow(activityTime, activityFilter, nowMs)) return false;
      }

      const length = activeMediaType === "MANGA" ? entry.chapters : entry.episodes;
      const lengthBounds = getNumericBounds(minimumLength, maximumLength);
      if (lengthBounds.minimum !== null && (length === null || length === undefined || length < lengthBounds.minimum)) return false;
      if (lengthBounds.maximum !== null && (length === null || length === undefined || length > lengthBounds.maximum)) return false;
      if (favoriteOnly && !entry.is_favorite) return false;

      const entryGenres = new Set(entry.genres ?? []);
      if (!genreFilters.every((genre) => entryGenres.has(genre))) return false;

      const entryTags = new Set(getFilterableTagNames(entry));
      if (!tagFilters.every((tag) => entryTags.has(tag))) return false;
      if (!normalizedSearch) return true;

      if (entry.hidden_by_adult_filter) {
        return "hidden by 18+ filter".includes(normalizedSearch);
      }

      const preferredTitle = getPreferredTitle(
        {
          userPreferred: entry.title_preferred,
          english: entry.title_english,
          romaji: entry.title_romaji,
          native: entry.title_native,
        },
        titleLanguage
      );

      return [
        preferredTitle,
        entry.title_english,
        entry.title_romaji,
        entry.title_native,
        entry.title_preferred,
        entry.notes,
        ...(entry.genres ?? []),
        ...getFilterableTagNames(entry),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });
  }, [activityFilter, activeMediaType, entries, favoriteOnly, formatFilter, genreFilters, maximumLength, minimumLength, normalizedSearch, nowMs, ratingFilter, releaseFromYear, releaseSeason, releaseToYear, tagFilters, titleLanguage]);

  const groupedEntries = useMemo(() => {
    return sectionOrder.map((status) => {
      const items = filteredEntries
        .filter((entry) => entry.status === status)
        .sort((a, b) => compareEntries(a, b, titleLanguage, sortMode));

      return {
        status,
        label: getStatusMeta(status, activeMediaType).label,
        icon: getStatusMeta(status, activeMediaType).icon,
        description: getStatusMeta(status, activeMediaType).description,
        items,
      };
    });
  }, [activeMediaType, filteredEntries, sectionOrder, sortMode, titleLanguage]);

  const visibleSections = groupedEntries.filter(({ items }) => items.length > 0);
  const displayedSections = view === "board" && !isEditingSectionOrder
    ? visibleSections.filter(({ status }) => openSections[status])
    : visibleSections;

  return (
    <>
      <div
        data-global-scroll-root
        ref={rememberScrollContainer}
        onScroll={(event) => {
          const scrollTop = event.currentTarget.scrollTop;

          if (isRestoringScroll.current && scrollTop < restoringScrollTarget.current) {
            return;
          }

          onScrollPositionChange(scrollTop);
        }}
        className="scroll-container h-full overflow-y-auto px-6 py-24"
      >
        <div className="mx-auto max-w-6xl space-y-10">
          <section className="flex flex-col gap-5 border-b border-white/10 pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-white/35">
                Personal list
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">
                My List
              </h1>
            </div>

            <LibraryLens
              mediaType={activeMediaType}
              destination="list"
              onMediaChange={handleMediaTypeChange}
              onDestinationChange={onLibraryDestinationChange}
              onVisibilityChange={onLibraryLensVisibilityChange}
            />
          </section>

          <div className="mb-4 space-y-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
              <div className="no-drag flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/10 bg-white/6 px-3 py-3 shadow-lg">
                <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-white/45" />
                <input
                  type="text"
                  value={listSearch}
                  placeholder={`Search ${entries.length} ${activeMediaType === "MANGA" ? "manga" : "anime"} in your list...`}
                  onChange={(event) => setListSearch(event.target.value)}
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/35"
                />
                {listSearch.trim() && (
                  <Tooltip content="Clear list search">
                  <button
                    type="button"
                    onClick={() => setListSearch("")}
                    aria-label="Clear list search"
                    className="rounded-full p-1 text-white/45 transition hover:bg-white/10 hover:text-white"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                  </Tooltip>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap gap-2 self-start lg:ml-3">
                <button
                  type="button"
                  onClick={() => setFiltersOpen((current) => {
                    const next = !current;
                    if (!next) setOpenFilter(null);
                    return next;
                  })}
                  className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm transition ${
                    filtersOpen || activeFilterCount
                      ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)] text-white"
                      : "border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  <FunnelIcon className="h-4 w-4" />
                  Filters
                  {activeFilterCount > 0 && (
                    <span className="rounded-full bg-black/25 px-1.5 py-0.5 text-[10px]">{activeFilterCount}</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setSortMode("alphabetical")}
                  className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm transition ${
                    sortMode === "alphabetical"
                      ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)] text-white"
                      : "border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  A-Z
                </button>
                <button
                  type="button"
                  onClick={() => setSortMode("personalScore")}
                  className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm transition ${
                    sortMode === "personalScore"
                      ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)] text-white"
                      : "border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  <StarIcon className="h-4 w-4" />
                  My rating
                </button>
              </div>
            </div>

            <div className="grid items-center gap-3 lg:grid-cols-[2fr_1fr]">
              <div className="order-2 inline-flex w-fit items-center rounded-2xl border border-white/10 bg-black/20 p-1 lg:justify-self-end">
                {([
                  ["list", Bars3BottomLeftIcon, "List"],
                  ["grid", Squares2X2Icon, "Grid"],
                  ["board", ViewColumnsIcon, "Board"],
                ] as const).map(([value, ViewIcon, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setView(value)}
                    className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${
                      view === value ? "bg-[var(--app-accent)] text-black" : "text-white/50 hover:bg-white/7 hover:text-white"
                    }`}
                  >
                    <ViewIcon className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </div>

              <div className="order-1 flex flex-wrap gap-2">
                {sectionOrder.map((status) => {
                  const count = groupedEntries.find((group) => group.status === status)?.items.length ?? 0;
                  const meta = getStatusMeta(status, activeMediaType);
                  const PillIcon = meta.icon;
                  const selected = view === "board"
                    ? openSections[status]
                    : normalizedSearch
                    ? count > 0
                    : openSections[status];

                  return (
                    <button
                      key={status}
                      type="button"
                      disabled={isEditingSectionOrder}
                      onClick={() =>
                        setOpenSections((current) => ({
                          ...current,
                          [status]: !current[status],
                        }))
                      }
                      className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm transition ${
                        selected
                          ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)] text-white"
                          : "border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/8 hover:text-white"
                      } disabled:cursor-default disabled:opacity-65`}
                    >
                      <PillIcon className="h-4 w-4" />
                      {meta.label}
                      <span className="rounded-full bg-black/20 px-2 py-0.5 text-[11px] text-white/80">
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {filtersOpen && (
              <div className="filter-panel-enter relative z-40">
                <div className="grid gap-4 rounded-3xl border border-white/10 bg-[#171717] p-4 shadow-xl md:grid-cols-2 xl:grid-cols-4">
                  <FilterSelect
                    label="Rating"
                    value={ratingFilter}
                    onChange={(value) => setRatingFilter(value as RatingFilter)}
                    open={openFilter === "rating"}
                    onOpenChange={(open) => setOpenFilter(open ? "rating" : null)}
                    options={[
                      ["all", "Any rating"],
                      ["rated", "Rated titles"],
                      ["unrated", "Not rated"],
                      ["excellent", "9–10"],
                      ["good", "7–8.9"],
                      ["mixed", "5–6.9"],
                      ["low", "Below 5"],
                    ]}
                  />
                  <FilterSelect
                    label="Format"
                    value={formatFilter}
                    onChange={setFormatFilter}
                    open={openFilter === "format"}
                    onOpenChange={(open) => setOpenFilter(open ? "format" : null)}
                    options={[
                      ["all", `Any ${activeMediaType === "MANGA" ? "Manga" : "Anime"} format`],
                      ...availableFormats.map((format) => [format, formatMediaFormat(format, activeMediaType)] as [string, string]),
                    ]}
                  />
                  <MultiSelectFilter
                    label="Genres"
                    singularLabel="genre"
                    options={availableGenres}
                    selected={genreFilters}
                    onChange={setGenreFilters}
                    open={openFilter === "genres"}
                    onOpenChange={(open) => setOpenFilter(open ? "genres" : null)}
                  />
                  <MultiSelectFilter
                    label="Tags"
                    singularLabel="tag"
                    options={availableTags}
                    selected={tagFilters}
                    onChange={setTagFilters}
                    open={openFilter === "tags"}
                    onOpenChange={(open) => setOpenFilter(open ? "tags" : null)}
                  />
                  <ReleasePeriodFilter
                    mediaType={activeMediaType}
                    earliestYear={availableReleaseRange.earliest}
                    latestYear={availableReleaseRange.latest}
                    fromYear={releaseFromYear}
                    toYear={releaseToYear}
                    season={releaseSeason}
                    onFromYearChange={setReleaseFromYear}
                    onToYearChange={setReleaseToYear}
                    onSeasonChange={setReleaseSeason}
                    open={openFilter === "release"}
                    onOpenChange={(open) => setOpenFilter(open ? "release" : null)}
                  />
                  <FilterSelect
                    label="Last activity"
                    value={activityFilter}
                    onChange={(value) => setActivityFilter(value as ActivityFilter)}
                    open={openFilter === "activity"}
                    onOpenChange={(open) => setOpenFilter(open ? "activity" : null)}
                    options={[
                      ["all", "Any time"],
                      ["today", "Today"],
                      ["7d", "Past 7 days"],
                      ["30d", "Past 30 days"],
                      ["year", "Past year"],
                    ]}
                  />
                  <NumericRangeFilter
                    label="Length"
                    unit={activeMediaType === "MANGA" ? "chapters" : "episodes"}
                    availableMinimum={availableLengthRange.minimum}
                    availableMaximum={availableLengthRange.maximum}
                    minimum={minimumLength}
                    maximum={maximumLength}
                    onMinimumChange={setMinimumLength}
                    onMaximumChange={setMaximumLength}
                    open={openFilter === "length"}
                    onOpenChange={(open) => setOpenFilter(open ? "length" : null)}
                  />
                  <div>
                    <span className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-white/35">
                      Personal
                    </span>
                    <button
                      type="button"
                      aria-pressed={favoriteOnly}
                      onClick={() => setFavoriteOnly((current) => !current)}
                      className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 text-left text-sm outline-none transition ${
                        favoriteOnly
                          ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)] text-white shadow-[0_0_0_3px_var(--app-accent-soft)]"
                          : "border-white/10 bg-[#1b1b1b] text-white/75 hover:border-white/20 hover:bg-white/[0.055]"
                      }`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <StarIcon className="h-4 w-4" /> Favourite only
                      </span>
                      <span className={`relative h-5 w-9 rounded-full transition ${favoriteOnly ? "bg-[var(--app-accent)]" : "bg-white/12"}`}>
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${favoriteOnly ? "left-[18px]" : "left-0.5"}`} />
                      </span>
                    </button>
                  </div>
                  {activeFilterCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setRatingFilter("all");
                        setFormatFilter("all");
                        setGenreFilters([]);
                        setTagFilters([]);
                        setReleaseFromYear("");
                        setReleaseToYear("");
                        setReleaseSeason("all");
                        setActivityFilter("all");
                        setMinimumLength("");
                        setMaximumLength("");
                        setFavoriteOnly(false);
                      }}
                      className="inline-flex w-fit items-center gap-2 text-sm text-white/45 transition hover:text-white md:col-span-2 xl:col-span-4"
                    >
                      <XMarkIcon className="h-4 w-4" /> Clear all filters
                    </button>
                  )}
                </div>
              </div>
            )}

          </div>

          <MyListLayoutToolbar
            isEditing={isEditingSectionOrder}
            onToggleEdit={handleToggleSectionOrderEdit}
            onReset={handleResetSectionOrder}
          />

          {normalizedSearch && (
            <div className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/55">
              Found <span className="font-semibold text-white">{filteredEntries.length}</span> matching entr
              {filteredEntries.length === 1 ? "y" : "ies"} for{" "}
              <span className="rounded-full bg-white/8 px-2 py-1 text-white">
                {listSearch.trim()}
              </span>
            </div>
          )}

          <div className={view === "board" ? `grid items-start gap-4 ${getBoardGridClass(displayedSections.length)}` : "space-y-5"}>
            {displayedSections.length ? (
              displayedSections.map(({ status, label, icon: Icon, description, items }) => {
                const isOpen = view === "board"
                  ? true
                  : isEditingSectionOrder
                  ? false
                  : normalizedSearch
                  ? true
                  : openSections[status];

                return (
                  <MyListSectionEditBlock
                    key={status}
                    status={status}
                    label={label}
                    isEditing={isEditingSectionOrder}
                    isDragging={draggedSectionStatus === status}
                    onDragStart={handleSectionDragStart}
                    onDragOver={handleSectionDragOver}
                    onDragEnd={handleSectionDragEnd}
                  >
                    <section className="min-w-0 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] shadow-xl">
                      <button
                        type="button"
                        disabled={isEditingSectionOrder || view === "board"}
                        onClick={() =>
                          setOpenSections((current) => ({
                            ...current,
                            [status]: !current[status],
                          }))
                        }
                        className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left transition hover:bg-white/[0.03] focus:outline-none focus:ring-2 focus:ring-[var(--app-accent)]/55 disabled:cursor-default disabled:hover:bg-transparent"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <div className={`rounded-2xl border p-2.5 transition ${
                            isOpen
                              ? "border-[var(--app-accent)]/25 bg-[var(--app-accent-soft)] text-white/80"
                              : "border-white/10 bg-white/5 text-white/75"
                          }`}>
                            <Icon className="h-5 w-5" />
                          </div>

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-3">
                              <h2 className="text-lg font-semibold text-white">{label}</h2>
                              <span className="rounded-full bg-white/8 px-2.5 py-1 text-xs text-white/45">
                                {items.length}
                              </span>
                            </div>

                            {view !== "board" && <p className="mt-1 text-sm text-white/40">{description}</p>}
                          </div>
                        </div>

                        {view !== "board" && <span
                          className={`rounded-2xl border border-white/10 bg-white/5 p-2 text-white/55 transition-transform duration-300 ${
                            isOpen ? "rotate-180 border-[var(--app-accent)]/25 bg-[var(--app-accent-soft)] text-white/80" : ""
                          }`}
                        >
                          <ChevronDownIcon className="h-5 w-5" />
                        </span>}
                      </button>

                      <div
                        className="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
                        style={{
                          gridTemplateRows: isOpen ? "1fr" : "0fr",
                          opacity: isOpen ? 1 : 0.7,
                        }}
                      >
                        <div className="overflow-hidden">
                          <div
                            className={`border-t border-white/10 px-5 pb-5 pt-4 transition duration-300 ${
                              isOpen ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
                            }`}
                          >
                            <div className={`grid gap-4 ${
                              view === "grid"
                                ? "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5"
                                : "grid-cols-1"
                            }`}>
                              {items.map((entry) => (
                                <MyListCard
                                  key={`${entry.anime_id}-${entry.status}`}
                                  entry={entry}
                                  statusLabel={label}
                                  onOpen={handleOpenMedia}
                                  onEdit={setEditingEntry}
                                  titleLanguage={titleLanguage}
                                  searchQuery={listSearch}
                                  density={density}
                                  variant={view}
                                  nowMs={nowMs}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </section>
                  </MyListSectionEditBlock>
                );
              })
            ) : (
              <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] px-5 py-8 text-sm text-white/45">
                {!entries.length
                  ? `Your ${activeMediaType === "MANGA" ? "Manga" : "Anime"} list is still empty. Open ${activeMediaType === "MANGA" ? "a manga" : "an anime"} page and add it when you are ready.`
                  : view === "board" && visibleSections.length
                  ? "Choose one or more statuses above to add them to the board."
                  : "No entries matched your search and filters."}
              </div>
            )}
          </div>
        </div>
      </div>

      {editingEntry && (
        <ListEntryModal
          animeId={editingEntry.anime_id}
          mediaType={activeMediaType}
          isOpen={true}
          entry={editingEntry}
          title={getPreferredTitle(
            {
              userPreferred: editingEntry.title_preferred,
              english: editingEntry.title_english,
              romaji: editingEntry.title_romaji,
              native: editingEntry.title_native,
            },
            titleLanguage
          )}
          totalEpisodes={editingEntry.episodes ?? null}
          totalVolumes={editingEntry.volumes ?? null}
          onClose={() => setEditingEntry(null)}
          onSaved={async () => {
            setEditingEntry(null);
            await onListChanged?.();
            const title = getPreferredTitle(
              {
                userPreferred: editingEntry.title_preferred,
                english: editingEntry.title_english,
                romaji: editingEntry.title_romaji,
                native: editingEntry.title_native,
              },
              titleLanguage
            );
            onNotify?.("success", "List entry updated", `${title} was updated.`);
          }}
          onRemoved={async () => {
            setEditingEntry(null);
            await onListChanged?.();
            const title = getPreferredTitle(
              {
                userPreferred: editingEntry.title_preferred,
                english: editingEntry.title_english,
                romaji: editingEntry.title_romaji,
                native: editingEntry.title_native,
              },
              titleLanguage
            );
            onNotify?.("success", "List entry removed", `${title} was removed from your list.`);
          }}
        />
      )}
    </>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  open,
  onOpenChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedLabel = options.find(([optionValue]) => optionValue === value)?.[1] ?? options[0]?.[1] ?? "Select";
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter(([, optionLabel]) => optionLabel.toLocaleLowerCase().includes(normalizedQuery))
    : options;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) onOpenChange(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={containerRef} className="relative">
      <span className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-white/35">
        {label}
      </span>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex w-full items-center justify-between gap-3 rounded-2xl border bg-[#1b1b1b] px-3 py-2.5 text-left text-sm outline-none transition ${
          open
            ? "border-[var(--app-accent)] text-white shadow-[0_0_0_3px_var(--app-accent-soft)]"
            : "border-white/10 text-white/75 hover:border-white/20 hover:bg-white/[0.055]"
        }`}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDownIcon className={`h-4 w-4 shrink-0 text-white/40 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-full overflow-hidden rounded-2xl border border-white/12 bg-[#181818] text-sm text-white/75 shadow-[0_24px_60px_rgba(0,0,0,0.7)]">
          <div className="border-b border-white/8 p-2.5">
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 transition focus-within:border-[var(--app-accent)]/70 focus-within:bg-black/35">
              <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-white/35" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                onClick={(event) => event.currentTarget.select()}
                placeholder={`Find ${label.toLowerCase()}...`}
                className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-white outline-none placeholder:text-white/30"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="rounded-lg p-1 text-white/35 transition hover:bg-white/10 hover:text-white"
                  aria-label={`Clear ${label.toLowerCase()} search`}
                >
                  <XMarkIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <div role="listbox" aria-label={label} className="scroll-container max-h-56 space-y-1 overflow-y-auto p-2">
            {filteredOptions.map(([optionValue, optionLabel]) => {
              const isSelected = optionValue === value;
              return (
                <button
                  key={optionValue}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(optionValue);
                    onOpenChange(false);
                    setQuery("");
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${
                    isSelected ? "bg-[var(--app-accent-soft)] text-white" : "hover:bg-white/[0.06]"
                  }`}
                >
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border transition ${
                    isSelected
                      ? "border-[var(--app-accent)] bg-[var(--app-accent)] text-black"
                      : "border-white/15 bg-white/[0.025]"
                  }`}>
                    {isSelected && <CheckIcon className="h-3.5 w-3.5 stroke-[2.5]" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{optionLabel}</span>
                </button>
              );
            })}
            {filteredOptions.length === 0 && (
              <p className="px-2 py-5 text-center text-xs text-white/35">
                No options match “{query.trim()}”.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReleasePeriodFilter({
  mediaType,
  earliestYear,
  latestYear,
  fromYear,
  toYear,
  season,
  onFromYearChange,
  onToYearChange,
  onSeasonChange,
  open,
  onOpenChange,
}: {
  mediaType: MediaType;
  earliestYear: number | null;
  latestYear: number | null;
  fromYear: string;
  toYear: string;
  season: string;
  onFromYearChange: (value: string) => void;
  onToYearChange: (value: string) => void;
  onSeasonChange: (value: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bounds = getNumericBounds(fromYear, toYear);
  const lowerYear = bounds.minimum ?? earliestYear;
  const upperYear = bounds.maximum ?? latestYear;
  const summaryParts: string[] = [];
  if (bounds.minimum !== null && bounds.maximum !== null) summaryParts.push(`${bounds.minimum}–${bounds.maximum}`);
  else if (bounds.minimum !== null) summaryParts.push(`From ${bounds.minimum}`);
  else if (bounds.maximum !== null) summaryParts.push(`Until ${bounds.maximum}`);
  if (mediaType === "ANIME" && season !== "all") summaryParts.push(formatSeason(season));
  const summary = summaryParts.join(" · ") || "Any release period";

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) onOpenChange(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onOpenChange]);

  function clear() {
    onFromYearChange("");
    onToYearChange("");
    onSeasonChange("all");
  }

  return (
    <div ref={containerRef} className="relative">
      <span className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-white/35">Release period</span>
      <FilterTrigger summary={summary} open={open} onClick={() => onOpenChange(!open)} />
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-full overflow-hidden rounded-2xl border border-white/12 bg-[#181818] text-sm text-white/75 shadow-[0_24px_60px_rgba(0,0,0,0.7)]">
          {earliestYear !== null && latestYear !== null && lowerYear !== null && upperYear !== null ? (
            <DualRangeSlider
              availableMinimum={earliestYear}
              availableMaximum={latestYear}
              lowerValue={lowerYear}
              upperValue={upperYear}
              lowerLabel="From"
              upperLabel="To"
              singleValueMessage={`Every title with a known release date is from ${earliestYear}.`}
              onLowerValueChange={(year) => onFromYearChange(year === earliestYear ? "" : String(year))}
              onUpperValueChange={(year) => onToYearChange(year === latestYear ? "" : String(year))}
            />
          ) : (
            <p className="px-3 py-4 text-xs text-white/35">No known release dates are cached for this list yet.</p>
          )}
          {mediaType === "ANIME" && (
            <div className="border-t border-white/8 px-3 py-3">
              <span className="mb-2 block text-[11px] uppercase tracking-[0.16em] text-white/35">Season (optional)</span>
              <div className="flex flex-wrap gap-1.5">
                {[["all", "Any"], ["WINTER", "Winter"], ["SPRING", "Spring"], ["SUMMER", "Summer"], ["FALL", "Fall"]].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onSeasonChange(value)}
                    className={`rounded-xl border px-2.5 py-1.5 text-xs transition ${season === value ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)] text-white" : "border-white/10 text-white/50 hover:border-white/20 hover:text-white"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {(fromYear || toYear || season !== "all") && <FilterClearButton label="Clear release period" onClick={clear} />}
        </div>
      )}
    </div>
  );
}

function DualRangeSlider({
  availableMinimum,
  availableMaximum,
  lowerValue,
  upperValue,
  lowerLabel,
  upperLabel,
  singleValueMessage,
  onLowerValueChange,
  onUpperValueChange,
}: {
  availableMinimum: number;
  availableMaximum: number;
  lowerValue: number;
  upperValue: number;
  lowerLabel: string;
  upperLabel: string;
  singleValueMessage: string;
  onLowerValueChange: (value: number) => void;
  onUpperValueChange: (value: number) => void;
}) {
  const rangeSpan = availableMaximum - availableMinimum;
  const lowerPosition = rangeSpan > 0 ? ((lowerValue - availableMinimum) / rangeSpan) * 100 : 0;
  const upperPosition = rangeSpan > 0 ? ((upperValue - availableMinimum) / rangeSpan) * 100 : 100;

  if (rangeSpan === 0) {
    return (
      <div className="p-3">
        <p className="rounded-xl border border-white/8 bg-black/20 px-3 py-3 text-center text-xs text-white/50">
          {singleValueMessage}
        </p>
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">
          <span className="block text-[10px] uppercase tracking-[0.14em] text-white/30">{lowerLabel}</span>
          <span className="mt-0.5 block font-medium text-white">{lowerValue}</span>
        </div>
        <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-right">
          <span className="block text-[10px] uppercase tracking-[0.14em] text-white/30">{upperLabel}</span>
          <span className="mt-0.5 block font-medium text-white">{upperValue}</span>
        </div>
      </div>
      <div className="relative mt-4 h-6">
        <div className="absolute left-1 right-1 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/10" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--app-accent)]"
          style={{ left: `${lowerPosition}%`, right: `${100 - upperPosition}%` }}
        />
        <input
          type="range"
          min={availableMinimum}
          max={availableMaximum}
          value={lowerValue}
          onChange={(event) => onLowerValueChange(Math.min(Number(event.target.value), upperValue))}
          aria-label={lowerLabel}
          className={`dual-range-input absolute inset-0 w-full ${lowerValue === upperValue && upperValue === availableMaximum ? "z-30" : "z-20"}`}
        />
        <input
          type="range"
          min={availableMinimum}
          max={availableMaximum}
          value={upperValue}
          onChange={(event) => onUpperValueChange(Math.max(Number(event.target.value), lowerValue))}
          aria-label={upperLabel}
          className={`dual-range-input absolute inset-0 w-full ${lowerValue === upperValue && upperValue === availableMaximum ? "z-20" : "z-30"}`}
        />
      </div>
      <div className="flex justify-between px-0.5 text-[10px] text-white/30">
        <span>{availableMinimum}</span>
        <span>{availableMaximum}</span>
      </div>
    </div>
  );
}

function NumericRangeFilter({
  label,
  unit,
  availableMinimum,
  availableMaximum,
  minimum,
  maximum,
  onMinimumChange,
  onMaximumChange,
  open,
  onOpenChange,
}: {
  label: string;
  unit: string;
  availableMinimum: number | null;
  availableMaximum: number | null;
  minimum: string;
  maximum: string;
  onMinimumChange: (value: string) => void;
  onMaximumChange: (value: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bounds = getNumericBounds(minimum, maximum);
  const lowerValue = bounds.minimum ?? availableMinimum;
  const upperValue = bounds.maximum ?? availableMaximum;
  const summary = bounds.minimum !== null && bounds.maximum !== null
    ? `${bounds.minimum}–${bounds.maximum} ${unit}`
    : bounds.minimum !== null
      ? `${bounds.minimum}+ ${unit}`
      : bounds.maximum !== null
        ? `Up to ${bounds.maximum} ${unit}`
        : `Any number of ${unit}`;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) onOpenChange(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={containerRef} className="relative">
      <span className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-white/35">{label}</span>
      <FilterTrigger summary={summary} open={open} onClick={() => onOpenChange(!open)} />
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-full overflow-hidden rounded-2xl border border-white/12 bg-[#181818] text-sm text-white/75 shadow-[0_24px_60px_rgba(0,0,0,0.7)]">
          {availableMinimum !== null && availableMaximum !== null && lowerValue !== null && upperValue !== null ? (
            <DualRangeSlider
              availableMinimum={availableMinimum}
              availableMaximum={availableMaximum}
              lowerValue={lowerValue}
              upperValue={upperValue}
              lowerLabel={`Minimum ${unit}`}
              upperLabel={`Maximum ${unit}`}
              singleValueMessage={`Every title with a known length has ${availableMinimum} ${unit}.`}
              onLowerValueChange={(value) => onMinimumChange(value === availableMinimum ? "" : String(value))}
              onUpperValueChange={(value) => onMaximumChange(value === availableMaximum ? "" : String(value))}
            />
          ) : (
            <p className="px-3 py-4 text-xs text-white/35">No known {unit} totals are cached for this list yet.</p>
          )}
          {(minimum || maximum) && (
            <FilterClearButton
              label="Clear length"
              onClick={() => {
                onMinimumChange("");
                onMaximumChange("");
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function FilterTrigger({ summary, open, onClick }: { summary: string; open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-haspopup="dialog"
      className={`flex w-full items-center justify-between gap-3 rounded-2xl border bg-[#1b1b1b] px-3 py-2.5 text-left text-sm outline-none transition ${open ? "border-[var(--app-accent)] text-white shadow-[0_0_0_3px_var(--app-accent-soft)]" : "border-white/10 text-white/75 hover:border-white/20 hover:bg-white/[0.055]"}`}
    >
      <span className="truncate">{summary}</span>
      <ChevronDownIcon className={`h-4 w-4 shrink-0 text-white/40 transition ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

function FilterClearButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full border-t border-white/8 px-3 py-2.5 text-left text-xs text-white/45 transition hover:bg-white/[0.06] hover:text-white">
      {label}
    </button>
  );
}

function MultiSelectFilter({
  label,
  singularLabel,
  options,
  selected,
  onChange,
  open,
  onOpenChange,
}: {
  label: string;
  singularLabel: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const summary = selected.length === 0
    ? `Any ${singularLabel}`
    : selected.length === 1
      ? selected[0]
      : `${selected.length} selected`;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) => option.toLocaleLowerCase().includes(normalizedQuery))
    : options;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) onOpenChange(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onOpenChange]);

  function toggle(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value]
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <span className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-white/35">
        {label}
      </span>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex w-full items-center justify-between gap-3 rounded-2xl border bg-[#1b1b1b] px-3 py-2.5 text-left text-sm outline-none transition ${
          open
            ? "border-[var(--app-accent)] text-white shadow-[0_0_0_3px_var(--app-accent-soft)]"
            : "border-white/10 text-white/75 hover:border-white/20 hover:bg-white/[0.055]"
        }`}
      >
          <span className="truncate">{summary}</span>
          <ChevronDownIcon className={`h-4 w-4 shrink-0 text-white/40 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-full overflow-hidden rounded-2xl border border-white/12 bg-[#181818] text-sm text-white/75 shadow-[0_24px_60px_rgba(0,0,0,0.7)]">
          {options.length > 0 ? (
            <>
              <div className="border-b border-white/8 p-2.5">
                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 transition focus-within:border-[var(--app-accent)]/70 focus-within:bg-black/35">
                  <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-white/35" />
                  <input
                    autoFocus
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onFocus={(event) => event.currentTarget.select()}
                    onClick={(event) => event.currentTarget.select()}
                    placeholder={`Find a ${singularLabel}...`}
                    className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-white outline-none placeholder:text-white/30"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="rounded-lg p-1 text-white/35 transition hover:bg-white/10 hover:text-white"
                      aria-label={`Clear ${label.toLowerCase()} search`}
                    >
                      <XMarkIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <p className="px-3 pb-1 pt-2.5 text-[11px] text-white/35">
                Titles must include every selected {singularLabel}.
              </p>
              <div role="listbox" aria-label={label} aria-multiselectable="true" className="scroll-container max-h-56 space-y-1 overflow-y-auto px-2 pb-2">
                {filteredOptions.map((option) => {
                  const isSelected = selected.includes(option);
                  return (
                  <button
                    key={option}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => toggle(option)}
                    className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${
                      isSelected ? "bg-[var(--app-accent-soft)] text-white" : "hover:bg-white/[0.06]"
                    }`}
                  >
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border transition ${
                      isSelected
                        ? "border-[var(--app-accent)] bg-[var(--app-accent)] text-black"
                        : "border-white/15 bg-white/[0.025]"
                    }`}>
                      {isSelected && <CheckIcon className="h-3.5 w-3.5 stroke-[2.5]" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{option}</span>
                  </button>
                  );
                })}
                {filteredOptions.length === 0 && (
                  <p className="px-2 py-5 text-center text-xs text-white/35">
                    No {label.toLowerCase()} match “{query.trim()}”.
                  </p>
                )}
              </div>
              {selected.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onChange([]);
                    setQuery("");
                  }}
                  className="w-full border-t border-white/8 px-3 py-2.5 text-left text-xs text-white/45 transition hover:bg-white/[0.06] hover:text-white"
                >
                  Clear {label.toLowerCase()} ({selected.length})
                </button>
              )}
            </>
          ) : (
            <p className="px-3 py-4 text-xs text-white/35">
              No cached {label.toLowerCase()} are available yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function collectFilterValues(values: string[]) {
  return Array.from(
    new Set(values.map((value) => String(value).trim()).filter(Boolean))
  ).sort((left, right) => left.localeCompare(right));
}

function getNumericBounds(firstValue: string, secondValue: string) {
  const first = firstValue ? Number(firstValue) : null;
  const second = secondValue ? Number(secondValue) : null;
  if (first !== null && second !== null) {
    return { minimum: Math.min(first, second), maximum: Math.max(first, second) };
  }
  return { minimum: first, maximum: second };
}

function getReleaseYear(entry: MyListEntry) {
  if (Number.isInteger(entry.season_year)) return Number(entry.season_year);
  if (typeof entry.start_date === "object" && Number.isInteger(entry.start_date?.year)) {
    return Number(entry.start_date?.year);
  }
  if (typeof entry.start_date === "string" && entry.start_date.trim()) {
    try {
      const parsed = JSON.parse(entry.start_date) as { year?: unknown };
      if (Number.isInteger(parsed?.year)) return Number(parsed.year);
    } catch {
      const match = entry.start_date.match(/^\s*(\d{4})/);
      if (match) return Number(match[1]);
    }
  }
  const detailsYear = entry.details?.startDate?.year;
  return Number.isInteger(detailsYear) ? Number(detailsYear) : null;
}

function parseActivityTimestamp(value?: string | null) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getLatestActivityTimestamp(entry: MyListEntry) {
  const localTimestamp = parseActivityTimestamp(entry.local_updated_at);
  const providerTimestamp = parseActivityTimestamp(entry.provider_updated_at);

  if (localTimestamp === null) return providerTimestamp;
  if (providerTimestamp === null) return localTimestamp;
  return Math.max(localTimestamp, providerTimestamp);
}

function matchesActivityWindow(timestamp: number, filter: ActivityFilter, now: number) {
  if (filter === "all") return true;
  if (filter === "today") {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    return timestamp >= today.getTime() && timestamp <= now;
  }
  const windowDays = filter === "7d" ? 7 : filter === "30d" ? 30 : 365;
  return timestamp >= now - windowDays * 24 * 60 * 60 * 1000 && timestamp <= now;
}

function formatSeason(season: string) {
  return season.charAt(0).toUpperCase() + season.slice(1).toLowerCase();
}

function getFilterableTagNames(entry: MyListEntry) {
  const tags = entry.tags ?? entry.details?.tags ?? [];
  return collectFilterValues(
    tags.flatMap((tag) =>
      tag.name && !tag.isMediaSpoiler && !tag.isGeneralSpoiler ? [tag.name] : []
    )
  );
}

function formatMediaFormat(format: string, mediaType: MediaType) {
  const normalized = String(format || "").trim().toUpperCase();
  const labels = mediaType === "MANGA"
    ? {
        MANGA: "Manga",
        NOVEL: "Novel",
        ONE_SHOT: "One-shot",
      }
    : {
        TV: "TV",
        TV_SHORT: "TV Short",
        MOVIE: "Movie",
        SPECIAL: "Special",
        OVA: "OVA",
        ONA: "ONA",
        MUSIC: "Music",
      };

  return labels[normalized as keyof typeof labels] ?? normalized
    .toLowerCase()
    .replace(/(^|_)([a-z])/g, (_match, prefix: string, letter: string) =>
      `${prefix ? " " : ""}${letter.toUpperCase()}`
    );
}

function getBoardGridClass(columnCount: number) {
  if (columnCount >= 5) return "sm:grid-cols-2 xl:grid-cols-5";
  if (columnCount === 4) return "sm:grid-cols-2 xl:grid-cols-4";
  if (columnCount === 3) return "sm:grid-cols-2 xl:grid-cols-3";
  if (columnCount === 2) return "md:grid-cols-2";
  return "grid-cols-1";
}

function MyListLayoutToolbar({
  isEditing,
  onToggleEdit,
  onReset,
}: {
  isEditing: boolean;
  onToggleEdit: () => void;
  onReset: () => void;
}) {
  return <LayoutEditorToolbar className="mb-4" title={'"My List" layout'} idleDescription="Customize shelf order." editingDescription="Drag shelves into your preferred order." doneLabel="Save" isEditing={isEditing} onToggleEdit={onToggleEdit} onReset={onReset} />;
}

function MyListSectionEditBlock({
  status,
  label,
  isEditing,
  isDragging,
  onDragStart,
  onDragOver,
  onDragEnd,
  children,
}: {
  status: ListStatus;
  label: string;
  isEditing: boolean;
  isDragging: boolean;
  onDragStart: (status: string, event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (status: string, event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  children: ReactNode;
}) {
  return <ReorderableSection id={status} label={label} isEditing={isEditing} isDragging={isDragging} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>{children}</ReorderableSection>;
}

function compareEntries(
  a: MyListEntry,
  b: MyListEntry,
  titleLanguage: TitleLanguage,
  sortMode: SortMode
) {
  const aFavorite = Boolean(a.is_favorite);
  const bFavorite = Boolean(b.is_favorite);

  if (aFavorite !== bFavorite) {
    return aFavorite ? -1 : 1;
  }

  if (sortMode === "personalScore") {
    // Zero is the empty end of the 0–10 control, not a personal rating.
    // Imports created before score normalization can still contain numeric 0,
    // while newly edited unrated entries use null. Sort both representations
    // together so unrated titles consistently fall back to alphabetical order.
    const aScore = typeof a.score === "number" && a.score > 0 ? a.score : null;
    const bScore = typeof b.score === "number" && b.score > 0 ? b.score : null;

    if (aScore !== null && bScore !== null && bScore !== aScore) {
      return bScore - aScore;
    }

    if (aScore !== null && bScore === null) {
      return -1;
    }

    if (aScore === null && bScore !== null) {
      return 1;
    }
  }

  const aTitle = getPreferredTitle(
    {
      userPreferred: a.title_preferred,
      english: a.title_english,
      romaji: a.title_romaji,
      native: a.title_native,
    },
    titleLanguage
  );
  const bTitle = getPreferredTitle(
    {
      userPreferred: b.title_preferred,
      english: b.title_english,
      romaji: b.title_romaji,
      native: b.title_native,
    },
    titleLanguage
  );

  return aTitle.localeCompare(bTitle, undefined, { sensitivity: "base" });
}
