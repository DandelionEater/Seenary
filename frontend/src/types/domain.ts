export type ListStatus = "planned" | "watching" | "completed" | "paused" | "dropped";
export type MediaType = "ANIME" | "MANGA";
export type SearchMatchType = MediaType | "CHARACTER" | "STUDIO" | "SONG" | "ARTIST";
export type ThemeAccent = "violet" | "rose" | "amber" | "emerald" | "custom";
export type TitleLanguage = "userPreferred" | "english" | "romaji" | "native";
export type CardDensity = "comfortable" | "balanced" | "compact";

export type AppSettings = {
  themeAccent: ThemeAccent;
  customAccentColor: string;
  titleLanguage: TitleLanguage;
  showTrendingCarousel: boolean;
  autoRotateTrending: boolean;
  autoScrollHomeShelves: boolean;
  hideAdultContent: boolean;
  overlayOpacity: number;
  overlayBackground: "solid" | "glass" | "transparent";
  navbarStyle: "integrated" | "floating" | "minimal";
  browseCardStyle: "default" | "immersive" | "gallery";
  backgroundDim: number;
  animationLevel: "full" | "reduced" | "off";
  compactMode: boolean;
  discoverDensity: CardDensity;
  homeDensity: CardDensity;
  myListDensity: CardDensity;
  startView: "home" | "list" | "search";
  shareAnonymousUsageStatistics: boolean;
  analyticsConsentDecided: boolean;
};

export type AnimeTitle = {
  romaji?: string | null;
  english?: string | null;
  native?: string | null;
  userPreferred?: string | null;
};

type AnimeImage = {
  extraLarge?: string | null;
  large?: string | null;
  medium?: string | null;
};

type AnimeTag = {
  id?: number | null;
  name?: string | null;
  description?: string | null;
  rank?: number | null;
  isMediaSpoiler?: boolean;
  isGeneralSpoiler?: boolean;
};

type PersonName = {
  full?: string | null;
  native?: string | null;
  userPreferred?: string | null;
  alternative?: string[] | null;
};

export type Person = {
  id?: number | null;
  name?: PersonName | null;
  image?: AnimeImage | null;
  language?: string | null;
};

export type PersonEdge = {
  node?: Person | null;
  role?: string | null;
  character_id?: number | null;
  staff_id?: number | null;
  name_full?: string | null;
  name_native?: string | null;
  image_large?: string | null;
  voiceActors?: Person[] | null;
  voice_actors?: string | Person[] | null;
};

type PersonDate = {
  year?: number | null;
  month?: number | null;
  day?: number | null;
};

export type PersonDetails = Person & {
  warning?: string | null;
  description?: string | null;
  dateOfBirth?: PersonDate | null;
  dateOfDeath?: PersonDate | null;
  age?: number | string | null;
  gender?: string | null;
  bloodType?: string | null;
  homeTown?: string | null;
  primaryOccupations?: string[] | null;
  yearsActive?: Array<number | null> | null;
  siteUrl?: string | null;
  favourites?: number | null;
  languageV2?: string | null;
};

type MediaSourceReference = {
  provider?: string | null;
  animeId?: number | string | null;
};

export type AnimeMedia = {
  warning?: string;
  id: number;
  idMal?: number | null;
  type?: MediaType | string | null;
  isAdult?: boolean;
  title: AnimeTitle;
  coverImage: { extraLarge?: string | null; large: string; medium?: string | null };
  bannerImage?: string | null;
  episodes?: number | null;
  chapters?: number | null;
  volumes?: number | null;
  format?: string | null;
  status?: string | null;
  season?: string | null;
  seasonYear?: number | null;
  averageScore?: number | null;
  meanScore?: number | null;
  popularity?: number | null;
  favourites?: number | null;
  duration?: number | null;
  source?: string | MediaSourceReference | null;
  countryOfOrigin?: string | null;
  startDate?: PersonDate | null;
  endDate?: PersonDate | null;
  franchiseStartDate?: PersonDate | null;
  nextAiringEpisode?: { episode?: number | null; airingAt?: number | null } | null;
  description?: string | null;
  genres?: string[] | null;
  synonyms?: string[] | null;
  studios?: {
    nodes?: Array<{
      id?: number;
      name: string;
      isAnimationStudio?: boolean;
    }> | null;
  } | null;
  tags?: AnimeTag[] | null;
  staff?: { edges?: PersonEdge[] | null } | null;
  characters?: { edges?: PersonEdge[] | null } | null;
  relations?: { edges?: RelatedAnimeEdge[] | null } | null;
  recommendations?: { nodes?: RecommendationNode[] | null } | null;
  externalLinks?: ExternalLink[] | null;
  streamingEpisodes?: StreamingEpisode[] | null;
  trailer?: { id?: string | null; site?: string | null } | null;
  siteUrl?: string | null;
};

export type SearchAnime = AnimeMedia & {
  coverImage: { extraLarge?: string | null; large: string };
};

export type SearchMedia = Omit<SearchAnime, "type"> & {
  type: MediaType;
};

export type CharacterSearchResult = {
  character: {
    id: number;
    name?: {
      full?: string | null;
      native?: string | null;
      userPreferred?: string | null;
    } | null;
    image?: {
      large?: string | null;
    } | null;
  };
  media: SearchMedia;
};

export type StudioSearchResult = {
  studio: {
    id: number;
    name: string;
  };
  media: SearchMedia;
  isMainStudio: boolean;
};

export type SongSearchResult = {
  song: {
    id: number;
    title: {
      romaji?: string | null;
      native?: string | null;
    };
    artists: Array<{
      id: number;
      name: string;
    }>;
  };
  theme: {
    id: number;
    type: "OP" | "ED";
    sequence: number | null;
  };
  media: SearchMedia;
  previewUrl?: string | null;
};

export type ArtistSearchResult = SongSearchResult & {
  artist: {
    id: number;
    slug: string;
    name: string;
    nativeName?: string | null;
  };
  creditedAs?: string | null;
};

export type AnimeThemeMusicItem = Omit<SongSearchResult, "media"> & { cache?: { stale?: boolean } };

export type ArtistCatalogResult = {
  warning?: string;
  artist: ArtistSearchResult["artist"];
  items: ArtistSearchResult[];
  pageInfo: {
    currentPage: number;
    hasNextPage: boolean;
  };
};

export type StudioCatalogResult = {
  warning?: string;
  studio: {
    id: number;
    name: string;
    isAnimationStudio: boolean;
  };
  items: StudioSearchResult[];
  pageInfo: {
    currentPage: number;
    hasNextPage: boolean;
  };
};

export type MediaSearchResults = {
  anime: SearchMedia[];
  manga: SearchMedia[];
  characters?: CharacterSearchResult[];
  studios?: StudioSearchResult[];
  songs?: SongSearchResult[];
  artists?: ArtistSearchResult[];
  warnings?: Array<{
    provider: "anilist" | "animethemes";
    message: string;
  }>;
};

export type DiscoverShelfResult = {
  id?: string;
  title?: string;
  description?: string;
  pills?: string[];
  items?: AnimeMedia[];
  pageInfo?: {
    currentPage: number;
    lastPage: number;
    hasNextPage: boolean;
    total?: number | null;
    perPage?: number | null;
  } | null;
  warning?: string | null;
};

export type DiscoverMediaResult = {
  anime: {
    trending: AnimeMedia[];
    shelves: DiscoverShelfResult[];
  };
  manga: {
    trending: AnimeMedia[];
    shelves: DiscoverShelfResult[];
  };
};

export type ReleaseCalendarResult = {
  mediaType: MediaType;
  start: number;
  end: number;
  precision: "time" | "date";
  items: Array<{
    airingAt?: number;
    episode?: number;
    date?: { year?: number | null; month?: number | null; day?: number | null };
    media: AnimeMedia;
  }>;
  warning?: string | null;
};

export type RelatedAnimeEdge = {
  relationType?: string | null;
  node?: AnimeMedia | null;
};

type RecommendationNode = {
  rating?: number | null;
  mediaRecommendation?: RecommendationMedia | null;
};

export type RecommendationMedia = {
  id: number;
  type?: MediaType | string | null;
  title?: AnimeTitle | null;
  coverImage?: AnimeImage | null;
  description?: string | null;
  format?: string | null;
  status?: string | null;
  episodes?: number | null;
  chapters?: number | null;
  volumes?: number | null;
  season?: string | null;
  seasonYear?: number | null;
  averageScore?: number | null;
};

export type ExternalLink = {
  id?: number | null;
  url?: string | null;
  site?: string | null;
  type?: string | null;
  language?: string | null;
  color?: string | null;
  icon?: string | null;
  notes?: string | null;
  isDisabled?: boolean;
};

export type StreamingEpisode = {
  title?: string | null;
  thumbnail?: string | null;
  url?: string | null;
  site?: string | null;
};

export type LocalListEntry = {
  anime_id: number;
  status: ListStatus;
  is_favorite?: number | boolean;
  repeat_count?: number;
  is_rewatching?: number | boolean;
  progress: number;
  score: number | null;
  notes: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  local_updated_at?: string | null;
  provider_updated_at?: string | null;
};

export type EditableListEntry = Omit<LocalListEntry, "anime_id"> & {
  anime_id?: number;
};

export type TrackedAnimeEntry = LocalListEntry & {
  media_type?: "ANIME";
  is_adult?: number | boolean | null;
  hidden_by_adult_filter?: boolean;
  title_romaji?: string | null;
  title_english?: string | null;
  title_native?: string | null;
  title_preferred?: string | null;
  cover_image_large?: string | null;
  banner_image?: string | null;
  episodes?: number | null;
  format?: string | null;
  anime_status?: string | null;
  season?: string | null;
  season_year?: number | null;
  average_score?: number | null;
  mean_score?: number | null;
  popularity?: number | null;
  favourites?: number | null;
  duration?: number | null;
  next_airing_episode?: number | null;
  next_airing_at?: number | null;
  genres?: string[];
  tags?: AnimeTag[];
  recommendations?: RecommendationNode[];
  details?: AnimeMedia | null;
};

export type LocalMangaListEntry = {
  manga_id: number;
  status: ListStatus;
  is_favorite?: number | boolean;
  repeat_count?: number;
  is_rereading?: number | boolean;
  progress: number;
  volume_progress: number;
  score: number | null;
  notes: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  local_updated_at?: string | null;
  provider_updated_at?: string | null;
};

export type TrackedMangaEntry = LocalMangaListEntry & {
  media_type: "MANGA";
  anime_id: number;
  is_rewatching?: number | boolean;
  is_adult?: number | boolean | null;
  hidden_by_adult_filter?: boolean;
  title_romaji?: string | null;
  title_english?: string | null;
  title_native?: string | null;
  title_preferred?: string | null;
  cover_image_large?: string | null;
  banner_image?: string | null;
  chapters?: number | null;
  episodes?: number | null;
  volumes?: number | null;
  format?: string | null;
  anime_status?: string | null;
  average_score?: number | null;
  mean_score?: number | null;
  popularity?: number | null;
  favourites?: number | null;
  source?: string | null;
  country_of_origin?: string | null;
  genres?: string[];
  tags?: AnimeTag[];
  recommendations?: RecommendationNode[];
  details?: AnimeMedia | null;
};

export type TrackedMediaEntry = TrackedAnimeEntry | TrackedMangaEntry;

export type StoredManga = Omit<TrackedMangaEntry, keyof LocalMangaListEntry> & {
  manga_id: number;
  external_ids?: { anilist?: string | null; mal?: string | null };
  details_cached_at?: string | null;
};

export type StoredAnime = Omit<
  TrackedAnimeEntry,
  keyof LocalListEntry | "status" | "recommendations"
> & {
  anime_id: number;
  genres?: string[];
  recommendations?: RecommendationNode[];
  source?: string | MediaSourceReference | null;
  country_of_origin?: string | null;
  start_date?: PersonDate | null;
  end_date?: PersonDate | null;
  external_ids?: { anilist?: string | null; mal?: string | null };
  details?: AnimeMedia | null;
  details_cached_at?: string | null;
};

export type DeletedListEntry = {
  anime_id?: number;
  manga_id?: number;
  media_type?: MediaType;
  external_ids?: { anilist?: string | null; mal?: string | null };
  title?: string | null;
  deleted_at?: string | null;
  status?: ListStatus;
  [key: string]: unknown;
};

export type SyncActivityItem = {
  id: number;
  anime_id?: number | null;
  manga_id?: number | null;
  media_type?: MediaType;
  animeTitle?: string | null;
  operation: string;
  status: string;
  created_at: string;
  message?: string | null;
  [key: string]: unknown;
};

export type ImportPreviewItem = {
  animeId: number;
  mangaId?: number;
  mediaId?: number;
  mediaType?: "ANIME" | "MANGA";
  status: string;
  progress: number;
  score: number | null;
  notes: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  providerUpdatedAt?: number | string | null;
  repeatCount?: number;
  title: AnimeTitle;
  coverImage?: AnimeImage | null;
  episodes?: number | null;
  chapters?: number | null;
  volumes?: number | null;
  volumeProgress?: number;
  format?: string | null;
  season?: string | null;
  seasonYear?: number | null;
  averageScore?: number | null;
  sourceTitle?: string;
  guessed?: boolean;
  guessedFrom?: string | null;
  interpretedTitle?: string | null;
  source?: MediaSourceReference | null;
  media?: AnimeMedia | null;
};

export type MangaImportItem = {
  mangaId: number;
  mediaType: "MANGA";
  status: string;
  progress: number;
  volumeProgress: number;
  score: number | null;
  notes: string | null;
  startedAt?: string | PersonDate | null;
  completedAt?: string | PersonDate | null;
  providerUpdatedAt?: number | string | null;
  repeatCount?: number;
  isRereading?: boolean;
  title: AnimeTitle;
  coverImage?: AnimeImage | null;
  chapters?: number | null;
  volumes?: number | null;
  format?: string | null;
  source?: Record<string, unknown> | null;
  media?: AnimeMedia | null;
};

export type ImportPayload = {
  localEntries?: ImportPreviewItem[];
  localMangaEntries?: MangaImportItem[];
  preview?: { groups?: Array<{ status: string; items: ImportPreviewItem[] }> };
  activity?: SyncActivityItem[];
  [key: string]: unknown;
};

export type AuthImportResult = {
  user?: { id?: number } | null;
  importPending?: boolean;
  import?: ImportPayload | null;
  localEntries?: ImportPreviewItem[];
  preview?: { groups?: Array<{ status: string; items: ImportPreviewItem[] }> };
  message?: string;
  summary?: {
    sourceUsername?: string;
    totalFound?: number;
    selectedStatuses?: string[];
    selectedAnimeIds?: number[];
    imported?: number;
    created?: number;
    updated?: number;
    skipped?: number;
  };
  [key: string]: unknown;
};

export type SaveListEntryPayload = {
  status?: string;
  isFavorite?: boolean;
  repeatCount?: number;
  isRewatching?: boolean;
  isRereading?: boolean;
  progress?: number;
  volumeProgress?: number;
  score?: number | string | null;
  notes?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type SeenaryBackup = {
  format?: string;
  version?: number;
  exportedAt?: string;
  username?: string;
  data?: {
    settings?: unknown;
    anime?: Record<string, StoredAnime>;
    entries?: Record<string, LocalListEntry>;
    manga?: Record<string, StoredManga>;
    mangaEntries?: Record<string, LocalMangaListEntry>;
    dirtyEntries?: Record<string, boolean>;
    deletedEntries?: Record<string, DeletedListEntry>;
    dirtyMangaEntries?: Record<string, boolean>;
    deletedMangaEntries?: Record<string, DeletedListEntry>;
    syncHistory?: SyncActivityItem[];
    syncFailures?: Record<string, unknown>;
    autoSyncEnabled?: boolean;
    portablePreferences?: unknown;
    desktopPreferences?: unknown;
  };
};
