import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  ArrowsPointingOutIcon,
  BookOpenIcon,
  BookmarkIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ClockIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  EyeSlashIcon,
  HeartIcon,
  LinkIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PencilSquareIcon,
  PlayCircleIcon,
  PlusIcon,
  StarIcon,
  TagIcon,
  TvIcon,
  UserGroupIcon,
  UsersIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { HeartIcon as HeartIconSolid } from "@heroicons/react/24/solid";
import { ListEntryModal } from "./ListEntryModal";
import { ModalShell } from "./ui/ModalShell";
import { Tooltip } from "./ui/Tooltip";
import { ThemeMusicSection } from "./ThemeMusicSection";
import { getPreferredTitle, type TitleLanguage } from "../utils/titlePreference";
import { formatLocalDate } from "../utils/dateFormat";
import { formatEnum, formatNumber, getListStatusLabel } from "../utils/mediaFormatting";
import { recordRecentMedia } from "../utils/recentMediaHistory";
import type {
  AnimeMedia,
  AnimeThemeMusicItem,
  EditableListEntry,
  ExternalLink,
  MediaType,
  Person,
  PersonDetails,
  PersonEdge,
  RecommendationMedia,
  StreamingEpisode,
} from "../types/domain";

type AnimeDetailsProps = {
  userId: number;
  mediaId: number;
  mediaType: MediaType;
  onBack: () => void;
  onSelectMedia?: (mediaId: number, mediaType: MediaType) => void;
  onOpenStudio?: (studio: { id: number; name: string }) => void;
  onListChanged?: () => void | Promise<void>;
  onNotify?: (kind: "success" | "error" | "warning", title: string, message: string) => void;
  titleLanguage: TitleLanguage;
  hideAdultContent: boolean;
};

type ListEntry = EditableListEntry & {
  manga_id?: number;
  volume_progress?: number;
  is_rereading?: number | boolean;
};

type MetaItem = {
  label: string;
  value: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

type ExpandedArtwork = {
  src: string;
  alt: string;
  label: string;
};

type RelatedMedia = {
  id?: number | string | null;
  type?: "ANIME" | "MANGA" | string | null;
  title?: {
    userPreferred?: string | null;
    english?: string | null;
    romaji?: string | null;
    native?: string | null;
  } | null;
  coverImage?: { large?: string | null } | null;
  format?: string | null;
  episodes?: number | null;
  chapters?: number | null;
  volumes?: number | null;
  averageScore?: number | null;
};

type RelatedAnimeEdge = {
  relationType?: string | null;
  node?: RelatedMedia | null;
};

type PeopleModalItem = {
  id?: number | null;
  kind: "character" | "staff";
  title: string;
  name: string;
  nativeName?: string | null;
  image?: string | null;
  role?: string | null;
  voiceActor?: {
    name: string;
    nativeName?: string | null;
    image?: string | null;
    language?: string | null;
  } | null;
};

export default function MediaDetails({
  userId,
  mediaId,
  mediaType,
  onBack,
  onSelectMedia,
  onOpenStudio,
  onListChanged,
  onNotify,
  titleLanguage,
  hideAdultContent,
}: AnimeDetailsProps) {
  const [anime, setAnime] = useState<AnimeMedia | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [franchiseTimingStatus, setFranchiseTimingStatus] = useState<
    "idle" | "calculating" | "ready" | "error"
  >("idle");
  const [listEntry, setListEntry] = useState<ListEntry | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [listMessage, setListMessage] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<PeopleModalItem | null>(null);
  const [expandedArtwork, setExpandedArtwork] = useState<ExpandedArtwork | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [themeMusic, setThemeMusic] = useState<AnimeThemeMusicItem[]>([]);
  const [themeMusicLoading, setThemeMusicLoading] = useState(false);

  function notifyListChange(title: string, message: string) {
    onNotify?.("success", title, message);
  }

  const loadListEntry = useCallback(async (currentAnimeId: number) => {
    try {
      const result =
        mediaType === "MANGA"
          ? await window.api.getMyMangaListEntry(currentAnimeId)
          : await window.api.getMyListEntry(currentAnimeId);

      if (result.ok) {
        setListEntry(result.entry);
      }
    } catch (err) {
      console.error("Failed to load list entry:", err);
    }
  }, [mediaType]);

  useEffect(() => {
    let mounted = true;

    async function loadAnime() {
      try {
        setLoading(true);
        setError(null);

        const data = await window.api.getMediaDetails(mediaType, mediaId);

        if (mounted) {
          setAnime(data);
          recordRecentMedia(userId, mediaType, data);
          await loadListEntry(mediaId);
        }
      } catch (err) {
        console.error(err);
        if (mounted) {
          setError(
            err instanceof Error && err.message
              ? err.message
              : `Failed to load ${mediaType === "MANGA" ? "manga" : "anime"} details.`
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadAnime();

    return () => {
      mounted = false;
    };
  }, [loadListEntry, mediaId, mediaType, retryKey, userId]);

  useEffect(() => {
    let cancelled = false;

    if (loading || mediaType !== "ANIME" || !anime || anime.id !== mediaId) {
      setFranchiseTimingStatus("idle");
      return () => {
        cancelled = true;
      };
    }

    if (anime.franchiseStartDate?.year) {
      setFranchiseTimingStatus("ready");
      return () => {
        cancelled = true;
      };
    }

    setFranchiseTimingStatus("calculating");
    void window.api
      .getAnimeFranchiseStartDate(mediaId)
      .then((result) => {
        if (cancelled || !result.franchiseStartDate?.year) return;
        setAnime((current) =>
          current?.id === mediaId
            ? { ...current, franchiseStartDate: result.franchiseStartDate }
            : current
        );
        setFranchiseTimingStatus("ready");
      })
      .catch((franchiseError) => {
        console.warn("Failed to calculate franchise age:", franchiseError);
        if (!cancelled) setFranchiseTimingStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [anime, loading, mediaId, mediaType]);

  useEffect(() => {
    let cancelled = false;
    if (!anime || mediaType !== "ANIME") {
      setThemeMusic([]);
      setThemeMusicLoading(false);
      return;
    }

    const titles = [
      anime.title?.userPreferred,
      anime.title?.english,
      anime.title?.romaji,
      anime.title?.native,
      ...(anime.synonyms ?? []),
    ].filter((value): value is string => Boolean(value?.trim()));

    setThemeMusic([]);
    setThemeMusicLoading(true);
    void window.api
      .getAnimeThemeMusic(mediaId, titles)
      .then((items) => {
        if (!cancelled) setThemeMusic(items);
      })
      .catch((themeError) => {
        console.warn("Failed to load AnimeThemes details:", themeError);
        if (!cancelled) setThemeMusic([]);
      })
      .finally(() => {
        if (!cancelled) setThemeMusicLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [anime, mediaId, mediaType]);

  async function handleAddToList() {
    if (listBusy) return;

    try {
      setListBusy(true);
      setListMessage(null);

      const payload = {
        status: "planned",
        isFavorite: Boolean(listEntry?.is_favorite),
        progress: 0,
        score: null,
        notes: null,
        volumeProgress: 0,
      };
      const result =
        mediaType === "MANGA"
          ? await window.api.saveMyMangaListEntry(mediaId, payload)
          : await window.api.saveMyListEntry(mediaId, payload);

      if (!result.ok) {
        setListMessage(result.message);
        return;
      }

      setListEntry(
        result.entry ?? { status: "planned", progress: 0, score: null, notes: null }
      );
      await onListChanged?.();
      notifyListChange(
        "List updated",
        `${title || `This ${mediaType === "MANGA" ? "manga" : "anime"}`} was added to your list as ${mediaType === "MANGA" ? "Plan to Read" : "Planned"}.`
      );
    } catch (err) {
      console.error(err);
      setListMessage(`Failed to add ${mediaType === "MANGA" ? "manga" : "anime"} to your list.`);
    } finally {
      setListBusy(false);
    }
  }

  function handleOpenEditor() {
    if (!listEntry) return;
    setIsEditorOpen(true);
  }

  async function handleQuickProgress() {
    if (listBusy) return;

    try {
      setListBusy(true);
      setListMessage(null);

      const totalEpisodes =
        typeof (mediaType === "MANGA" ? anime?.chapters : anime?.episodes) === "number" &&
        Number(mediaType === "MANGA" ? anime?.chapters : anime?.episodes) > 0
          ? Number(mediaType === "MANGA" ? anime?.chapters : anime?.episodes)
          : null;

      const currentProgress = Number(listEntry?.progress ?? 0);
      let nextProgress = currentProgress + 1;

      if (totalEpisodes) {
        nextProgress = Math.min(nextProgress, totalEpisodes);
      }

      let nextStatus = listEntry?.status ?? "watching";

      if (!listEntry) {
        nextStatus = "watching";
      }

      if (listEntry?.status === "planned" && nextProgress > 0) {
        nextStatus = "watching";
      }

      if (totalEpisodes && nextProgress >= totalEpisodes) {
        nextStatus = "completed";
        nextProgress = totalEpisodes;
      }

      const payload = {
        status: nextStatus,
        isFavorite: Boolean(listEntry?.is_favorite),
        progress: nextProgress,
        score: listEntry?.score ?? null,
        notes: listEntry?.notes ?? null,
        volumeProgress: listEntry?.volume_progress ?? 0,
      };
      const result =
        mediaType === "MANGA"
          ? await window.api.saveMyMangaListEntry(mediaId, payload)
          : await window.api.saveMyListEntry(mediaId, payload);

      if (!result.ok) {
        setListMessage(result.message);
        return;
      }

      setListEntry(result.entry ?? null);
      await onListChanged?.();

      if (!listEntry) {
        notifyListChange(
          "Progress updated",
          `${title || `This ${mediaType === "MANGA" ? "manga" : "anime"}`} was added to your list with ${nextProgress} ${mediaType === "MANGA" ? "chapter read" : "episode watched"}.`
        );
      } else if (nextStatus === "completed") {
        notifyListChange(
          "Progress updated",
          `${title || `This ${mediaType === "MANGA" ? "manga" : "anime"}`} was marked completed at ${nextProgress} ${mediaType === "MANGA" ? "chapter" : "episode"}${
            nextProgress === 1 ? "" : "s"
          } watched.`
        );
      } else {
        notifyListChange(
          "Progress updated",
          `${title || `This ${mediaType === "MANGA" ? "manga" : "anime"}`} is now at ${nextProgress} ${mediaType === "MANGA" ? "chapter" : "episode"}${
            nextProgress === 1 ? "" : "s"
          } watched.`
        );
      }
    } catch (err) {
      console.error(err);
      setListMessage("Failed to update progress.");
    } finally {
      setListBusy(false);
    }
  }

  async function handleToggleFavorite() {
    if (listBusy) return;

    try {
      setListBusy(true);
      setListMessage(null);

      const nextFavorite = !listEntry?.is_favorite;
      const fallbackStatus = listEntry?.status ?? "planned";
      const fallbackProgress = Number(listEntry?.progress ?? 0);

      const payload = {
        status: fallbackStatus,
        isFavorite: nextFavorite,
        progress: fallbackProgress,
        score: listEntry?.score ?? null,
        notes: listEntry?.notes ?? null,
        volumeProgress: listEntry?.volume_progress ?? 0,
      };
      const result =
        mediaType === "MANGA"
          ? await window.api.saveMyMangaListEntry(mediaId, payload)
          : await window.api.saveMyListEntry(mediaId, payload);

      if (!result.ok) {
        setListMessage(result.message);
        return;
      }

      setListEntry(result.entry ?? null);
      await onListChanged?.();
      notifyListChange(
        nextFavorite ? "Favorite added" : "Favorite removed",
        nextFavorite
          ? `${title || `This ${mediaType === "MANGA" ? "manga" : "anime"}`} was ${
              listEntry ? "added to favorites" : "added to your list and marked as favorite"
            }.`
          : `${title || `This ${mediaType === "MANGA" ? "manga" : "anime"}`} was removed from favorites.`
      );
    } catch (err) {
      console.error(err);
      setListMessage("Failed to update favorite.");
    } finally {
      setListBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-white/80">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-white">
        <section className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/4 p-6 text-center shadow-xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-300/20 bg-amber-300/10 text-amber-100">
            <ExclamationTriangleIcon className="h-7 w-7" />
          </div>
          <h2 className="mt-5 text-lg font-semibold">
            There was a problem loading details.
          </h2>
          <p className="mt-2 text-sm leading-6 text-white/55">{error}</p>

          <div className="mt-6 flex flex-col-reverse items-stretch justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/4 px-4 py-2.5 text-sm font-medium text-white/75 transition hover:bg-white/8 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/55"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              onClick={() => setRetryKey((current) => current + 1)}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-white/55"
            >
              <ArrowPathIcon className="h-4 w-4" />
              Retry
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (!anime) {
    return (
      <div className="p-6 text-white">
        <button
          onClick={onBack}
          className="mb-4 rounded-xl bg-white/10 px-4 py-2 transition hover:bg-white/20"
        >
          Back
        </button>
        <p>No {mediaType === "MANGA" ? "manga" : "anime"} found.</p>
      </div>
    );
  }

  if (hideAdultContent && anime.isAdult) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-white">
        <section className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#151515] p-7 text-center shadow-2xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/55">
            <EyeSlashIcon className="h-7 w-7" />
          </div>
          <h2 className="mt-5 text-xl font-semibold">Hidden by 18+ filter</h2>
          <p className="mt-2 text-sm leading-6 text-white/50">
            This {mediaType === "MANGA" ? "manga" : "anime"} is hidden while adult content filtering is enabled. You can change this
            preference in Settings.
          </p>
          <button
            type="button"
            onClick={onBack}
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/6 px-4 py-2.5 text-sm font-medium text-white/75 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/55"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back
          </button>
        </section>
      </div>
    );
  }

  const title = getPreferredTitle(anime.title, titleLanguage);
  const isManga = mediaType === "MANGA";

  const studios = anime.studios?.nodes?.filter((studio) => studio?.name) ?? [];

  const safeTags = (anime.tags ?? [])
    .filter((tag) => !tag.isMediaSpoiler && !tag.isGeneralSpoiler)
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
    .slice(0, 12);

  const characterEdges = anime.characters?.edges?.slice(0, 12) ?? [];
  const staffEdges = anime.staff?.edges?.slice(0, 12) ?? [];
  const relationEdges: RelatedAnimeEdge[] = anime.relations?.edges ?? [];
  const recommendations = anime.recommendations?.nodes ?? [];
  const externalLinks = (anime.externalLinks ?? []).filter((link) => !link.isDisabled);
  const streamingEpisodes = anime.streamingEpisodes ?? [];
  const trailerUrl = getTrailerUrl(anime.trailer);
  const coverImageUrl = anime.coverImage?.extraLarge ?? anime.coverImage?.large ?? null;
  const sourceLabel = typeof anime.source === "string" ? anime.source : null;
  const primaryLinks = [
    anime.siteUrl ? { label: "AniList", url: anime.siteUrl, accent: "bg-sky-400/15 text-sky-100" } : null,
    !isManga && trailerUrl ? { label: "Trailer", url: trailerUrl, accent: "bg-red-400/15 text-red-100" } : null,
  ].filter(Boolean) as Array<{ label: string; url: string; accent: string }>;

  const isFavorite = Boolean(listEntry?.is_favorite);
  const isUpcoming = anime.status === "NOT_YET_RELEASED";
  const hasDistinctEndDate = Boolean(
    anime.endDate && !areMediaDatesEqual(anime.startDate, anime.endDate)
  );

  return (
    <>
      <div className="relative h-full overflow-hidden rounded-3xl bg-[#0f0f0f] text-white">
        <div data-global-scroll-root className="scroll-container h-full overflow-y-auto">
          {anime.warning && <p role="status" className="mx-5 mt-4 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">{anime.warning}</p>}
          <div className="relative h-56 w-full overflow-hidden rounded-t-3xl">
            {anime.bannerImage ? (
              <button
                type="button"
                onClick={() =>
                  setExpandedArtwork({
                    src: anime.bannerImage!,
                    alt: `${title} banner`,
                    label: "Banner artwork",
                  })
                }
                className="group absolute inset-0 h-full w-full cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white/55"
                aria-label={`Enlarge ${title} banner`}
              >
                <img
                  src={anime.bannerImage}
                  alt={`${title} banner`}
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]"
                />
                <span className="absolute right-5 top-5 z-10 inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/45 px-3 py-2 text-xs font-medium text-white/75 opacity-0 backdrop-blur-md transition group-hover:opacity-100 group-focus:opacity-100">
                  <ArrowsPointingOutIcon className="h-4 w-4" />
                  Enlarge
                </span>
              </button>
            ) : (
              <div className="h-full w-full bg-white/5" />
            )}

            <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-[#0f0f0f] via-[#0f0f0f]/60 to-[#0f0f0f]/10" />
            <div className="pointer-events-none absolute inset-0 bg-linear-to-r from-[#0f0f0f]/80 via-transparent to-[#0f0f0f]/40" />
          </div>

          <div className="relative px-6 pb-28 pl-8">
            <section className="-mt-20 grid grid-cols-1 gap-6 lg:grid-cols-[10rem_1fr]">
              <div>
                {coverImageUrl && (
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedArtwork({
                        src: coverImageUrl,
                        alt: `${title} cover`,
                        label: "Cover artwork",
                      })
                    }
                    className="group relative block h-64 w-40 cursor-zoom-in overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/10 transition hover:-translate-y-1 hover:ring-white/25 focus:outline-none focus:ring-2 focus:ring-white/55"
                    aria-label={`Enlarge ${title} cover`}
                  >
                    <img
                      src={coverImageUrl}
                      alt={`${title} cover`}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    />
                    <span className="absolute inset-x-3 bottom-3 inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-black/60 px-3 py-2 text-xs font-medium text-white/85 opacity-0 backdrop-blur-md transition group-hover:opacity-100 group-focus:opacity-100">
                      <ArrowsPointingOutIcon className="h-4 w-4" />
                      Enlarge
                    </span>
                  </button>
                )}
              </div>

              <div className="relative min-w-0 self-end overflow-hidden rounded-[2rem] border border-white/10 bg-[#111111] p-6 shadow-2xl">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--app-accent-soft),transparent_42%)] opacity-70" />
                <div className="relative">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-white/55">
                    {anime.status && (
                      <HeroBadge
                        value={getMediaStatusLabel(anime.status, mediaType)}
                        tone={getAiringBadgeTone(anime.status)}
                      />
                    )}
                    {anime.format && (
                      <HeroBadge value={formatMediaFormat(anime.format)} tone="format" />
                    )}
                    {!isManga && anime.season && anime.seasonYear && (
                      <HeroBadge
                        value={`${formatEnum(anime.season)} ${anime.seasonYear}`}
                        tone="season"
                      />
                    )}
                    {!isManga && Number(anime.episodes) > 0 && (
                      <HeroBadge value={`${anime.episodes} episodes`} tone="episodes" />
                    )}
                    {isManga && Number(anime.chapters) > 0 && (
                      <HeroBadge value={`${anime.chapters} chapters`} tone="episodes" />
                    )}
                    {isManga && Number(anime.volumes) > 0 && (
                      <HeroBadge value={`${anime.volumes} volumes`} tone="season" />
                    )}
                  </div>

                  <h1 className="mt-4 max-w-4xl text-3xl font-bold leading-tight tracking-tight text-white">
                    {title}
                  </h1>

                  <AlternateTitles
                    animeTitle={anime.title}
                    displayedTitle={title}
                    synonyms={anime.synonyms ?? []}
                  />

                  {isManga ? (
                    <MangaOverview
                      chapters={anime.chapters ?? null}
                      volumes={anime.volumes ?? null}
                      mangaStatus={anime.status ?? null}
                      startDate={anime.startDate ?? null}
                      relations={relationEdges}
                      entry={listEntry}
                    />
                  ) : (
                    <WatchOverview
                      episodes={anime.episodes ?? null}
                      duration={anime.duration ?? null}
                      animeStatus={anime.status ?? null}
                      franchiseStartDate={anime.franchiseStartDate ?? null}
                      franchiseTimingStatus={franchiseTimingStatus}
                      nextAiringEpisode={anime.nextAiringEpisode ?? null}
                      entry={listEntry}
                      relations={relationEdges}
                    />
                  )}

                  <div className="mt-5 grid grid-cols-1 gap-3 border-t border-white/8 pt-5 sm:grid-cols-2 xl:grid-cols-4">
                    {sourceLabel && (
                      <HeroDetail
                        label={isManga ? "Source" : "Based on"}
                        value={formatEnum(sourceLabel)}
                      />
                    )}
                    {anime.countryOfOrigin && (
                      <HeroDetail label="Origin" value={anime.countryOfOrigin} />
                    )}
                    {anime.startDate && (
                      <HeroDetail
                        label={
                          isUpcoming
                            ? isManga ? "Publication date" : "Premiere date"
                            : anime.status === "RELEASING"
                              ? isManga ? "Began publishing" : "Began airing"
                              : isManga ? "First published" : "First aired"
                        }
                        value={formatFuzzyDate(anime.startDate)}
                      />
                    )}
                    {anime.endDate &&
                      anime.status !== "RELEASING" &&
                      (!isUpcoming || hasDistinctEndDate) && (
                      <HeroDetail
                        label={isUpcoming ? "Expected end" : isManga ? "Finished publishing" : "Finished airing"}
                        value={formatFuzzyDate(anime.endDate)}
                      />
                    )}
                    {!isManga && studios.length > 0 && (
                      <StudioHeroDetail
                        studios={studios}
                        onOpenStudio={onOpenStudio}
                      />
                    )}
                  </div>

                  {primaryLinks.length > 0 && (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {primaryLinks.map((link) => (
                      <a
                        key={link.label}
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className={`inline-flex items-center gap-2 rounded-2xl border border-white/10 px-3 py-2 text-sm transition hover:bg-white/10 ${link.accent}`}
                      >
                        <LinkIcon className="h-4 w-4" />
                        {link.label}
                      </a>
                    ))}
                  </div>
                  )}

                  {listMessage && (
                  <div className="mt-5 w-fit rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                    {listMessage}
                  </div>
                  )}
                </div>
              </div>
            </section>

            <section className="mt-6 grid grid-cols-1 gap-8 xl:grid-cols-[1fr_18rem]">
              <div className="min-w-0 space-y-8">
                <PersonalListPanel
                  entry={listEntry}
                  totalEpisodes={isManga ? anime.chapters ?? null : anime.episodes ?? null}
                  totalVolumes={isManga ? anime.volumes ?? null : null}
                  mediaType={mediaType}
                  onAdd={handleAddToList}
                  onEdit={handleOpenEditor}
                  busy={listBusy}
                />

                {(anime.description || (anime.genres?.length ?? 0) > 0 || safeTags.length > 0) && (
                  <StoryAndTaxonomy
                    description={anime.description ?? null}
                    genres={anime.genres ?? []}
                    tags={safeTags}
                  />
                )}

                {characterEdges.length > 0 && (
                  <PeopleShelf
                    title="Characters"
                    icon={UsersIcon}
                    kind="character"
                    edges={characterEdges}
                    onSelect={setSelectedPerson}
                  />
                )}

                {staffEdges.length > 0 && (
                  <PeopleShelf
                    title={isManga ? "Creators & staff" : "Staff"}
                    icon={UserGroupIcon}
                    kind="staff"
                    edges={staffEdges}
                    onSelect={setSelectedPerson}
                  />
                )}

                {!isManga && (
                  <ThemeMusicSection
                    items={themeMusic}
                    loading={themeMusicLoading}
                  />
                )}

                {relationEdges.length > 0 && (
                  <RelatedAnimeShelf
                    edges={relationEdges}
                    onSelectMedia={onSelectMedia}
                  />
                )}

                {recommendations.length > 0 && (
                  <MediaShelf
                    title="Recommendations"
                    icon={StarIcon}
                    onSelectMedia={onSelectMedia}
                    items={recommendations
                      .filter(
                        (item): item is typeof item & { mediaRecommendation: RecommendationMedia } =>
                          Boolean(item.mediaRecommendation)
                      )
                      .map((item) => ({
                        label: item.rating ? `${item.rating} votes` : "Recommended",
                        media: item.mediaRecommendation,
                      }))}
                  />
                )}

                {(streamingEpisodes.length > 0 || externalLinks.length > 0) && (
                  <LinksSection
                    streamingEpisodes={streamingEpisodes}
                    externalLinks={externalLinks}
                    mediaType={mediaType}
                    progress={listEntry?.progress ?? null}
                  />
                )}

              </div>

              <div className="space-y-5">
                {!isManga && <TrailerPanel trailer={anime.trailer} trailerUrl={trailerUrl} />}

                <SideFacts
                  score={anime.averageScore ?? null}
                  meanScore={anime.meanScore ?? null}
                  popularity={anime.popularity ?? null}
                  favourites={anime.favourites ?? null}
                  duration={anime.duration ?? null}
                  source={sourceLabel}
                  countryOfOrigin={anime.countryOfOrigin ?? null}
                  startDate={anime.startDate ?? null}
                  endDate={anime.endDate ?? null}
                  season={anime.season}
                  seasonYear={anime.seasonYear}
                  format={anime.format}
                  animeStatus={anime.status}
                  mediaType={mediaType}
                  chapters={anime.chapters ?? null}
                  volumes={anime.volumes ?? null}
                />
              </div>
            </section>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-50 flex justify-center">
          <div className="pointer-events-auto flex items-center overflow-hidden rounded-full border border-white/10 bg-[#1a1a1a]/90 shadow-2xl backdrop-blur-md">
            <ActionButton label="Back" onClick={onBack}>
              <ArrowLeftIcon className="h-5 w-5" />
            </ActionButton>

            <ActionDivider />

            <ActionButton
              label={listEntry ? "Edit list entry" : "Add to list"}
              onClick={listEntry ? handleOpenEditor : handleAddToList}
              disabled={listBusy}
            >
              {listEntry ? (
                <PencilSquareIcon className="h-5 w-5" />
              ) : (
                <PlusIcon className="h-5 w-5" />
              )}
            </ActionButton>

            <ActionDivider />

            <ActionButton
              label={
                isManga
                  ? listEntry
                    ? "Add 1 chapter read"
                    : "Start reading (+1)"
                  : listEntry
                    ? "Add 1 episode watched"
                    : "Start watching (+1)"
              }
              onClick={handleQuickProgress}
              disabled={listBusy}
            >
              <span className="text-base font-semibold tracking-wide">+1</span>
            </ActionButton>

            <ActionDivider />

            <ActionButton
              label={isFavorite ? "Remove favorite" : "Add to favorites"}
              onClick={handleToggleFavorite}
              disabled={listBusy}
              active={isFavorite}
            >
              {isFavorite ? (
                <HeartIconSolid className="h-5 w-5" />
              ) : (
                <HeartIcon className="h-5 w-5" />
              )}
            </ActionButton>
          </div>
        </div>
      </div>

      <ListEntryModal
        animeId={mediaId}
        mediaType={mediaType}
        isOpen={isEditorOpen}
        entry={listEntry}
        title={title}
        totalEpisodes={isManga ? anime?.chapters ?? null : anime?.episodes ?? null}
        totalVolumes={anime?.volumes ?? null}
        onClose={() => setIsEditorOpen(false)}
        onSaved={(updatedEntry) => {
          setListEntry(updatedEntry);
          onListChanged?.();
          setListMessage(null);
          notifyListChange(
            "List entry updated",
            `${title || `This ${mediaType === "MANGA" ? "manga" : "anime"}`} was updated.`
          );
        }}
        onRemoved={() => {
          setListEntry(null);
          onListChanged?.();
          setListMessage(null);
          notifyListChange(
            "Removed from list",
            `${title || `This ${mediaType === "MANGA" ? "manga" : "anime"}`} was removed from your list.`
          );
        }}
      />

      {selectedPerson && (
        <PeopleDetailModal
          item={selectedPerson}
          onClose={() => setSelectedPerson(null)}
        />
      )}

      {expandedArtwork && (
        <ArtworkLightbox
          artwork={expandedArtwork}
          onClose={() => setExpandedArtwork(null)}
        />
      )}
    </>
  );
}

type HeroBadgeTone =
  | "default"
  | "upcoming"
  | "airing"
  | "finished"
  | "format"
  | "season"
  | "episodes";

const HERO_BADGE_STYLES: Record<HeroBadgeTone, { badge: string; dot: string }> = {
  default: {
    badge: "border-white/10 bg-white/[0.05] text-white/60",
    dot: "bg-white/35",
  },
  upcoming: {
    badge: "border-rose-400/25 bg-rose-500/10 text-rose-200",
    dot: "bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,0.8)]",
  },
  airing: {
    badge: "border-emerald-400/25 bg-emerald-500/10 text-emerald-200",
    dot: "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]",
  },
  finished: {
    badge: "border-blue-400/25 bg-blue-500/10 text-blue-200",
    dot: "bg-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.8)]",
  },
  format: {
    badge: "border-violet-400/20 bg-violet-500/10 text-violet-200/90",
    dot: "bg-violet-400/80",
  },
  season: {
    badge: "border-amber-400/20 bg-amber-500/10 text-amber-100/85",
    dot: "bg-amber-400/80",
  },
  episodes: {
    badge: "border-slate-300/20 bg-slate-300/10 text-slate-100/85",
    dot: "bg-slate-200/80 shadow-[0_0_10px_rgba(226,232,240,0.35)]",
  },
};

function HeroBadge({ value, tone = "default" }: { value: string; tone?: HeroBadgeTone }) {
  const styles = HERO_BADGE_STYLES[tone];

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 ${styles.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
      {value}
    </span>
  );
}

function AlternateTitles({
  animeTitle,
  displayedTitle,
  synonyms,
}: {
  animeTitle?: {
    romaji?: string | null;
    english?: string | null;
    native?: string | null;
  } | null;
  displayedTitle: string;
  synonyms: string[];
}) {
  const alternatives = [animeTitle?.english, animeTitle?.romaji, animeTitle?.native]
    .filter((value): value is string => Boolean(value?.trim()))
    .filter(
      (value, index, values) =>
        value.toLocaleLowerCase() !== displayedTitle.toLocaleLowerCase() &&
        values.findIndex((candidate) => candidate.toLocaleLowerCase() === value.toLocaleLowerCase()) ===
          index
    );
  const usedTitles = new Set(
    [displayedTitle, ...alternatives].map((value) => value.trim().toLocaleLowerCase())
  );
  const uniqueSynonyms = synonyms
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => {
      const normalized = value.toLocaleLowerCase();
      if (usedTitles.has(normalized)) return false;
      usedTitles.add(normalized);
      return true;
    });

  if (!alternatives.length && !uniqueSynonyms.length) return null;

  const fullText = [
    alternatives.join(" · "),
    uniqueSynonyms.length ? `Also known as: ${uniqueSynonyms.join(" · ")}` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  return (
    <Tooltip content={fullText} as="div" className="mt-2 block max-w-4xl" focusable>
      <p className="line-clamp-2 text-sm leading-6 text-white/42">
      {alternatives.join(" · ")}
      {alternatives.length > 0 && uniqueSynonyms.length > 0 && (
        <span className="mx-2 text-white/20">|</span>
      )}
      {uniqueSynonyms.length > 0 && (
        <span>
          <span className="text-white/30">Also known as:</span>{" "}
          {uniqueSynonyms.join(" · ")}
        </span>
      )}
      </p>
    </Tooltip>
  );
}

function HeroDetail({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={`min-w-0 ${wide ? "sm:col-span-2 xl:col-span-2" : ""}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/28">
        {label}
      </p>
      <Tooltip content={value} as="div" className="mt-1 block" focusable>
        <p className="line-clamp-2 text-sm leading-5 text-white/68">{value}</p>
      </Tooltip>
    </div>
  );
}

function StudioHeroDetail({
  studios,
  onOpenStudio,
}: {
  studios: Array<{ id?: number; name: string }>;
  onOpenStudio?: (studio: { id: number; name: string }) => void;
}) {
  const studioNames = studios.map((studio) => studio.name).join(", ");

  return (
    <div className="min-w-0 sm:col-span-2 xl:col-span-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/28">
        Made by
      </p>
      <Tooltip content={`${studioNames} - Open studio catalog`} as="div" className="mt-1 block">
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          {studios.map((studio, index) =>
            studio.id && onOpenStudio ? (
              <button
                key={studio.id}
                type="button"
                onClick={() => onOpenStudio({ id: studio.id!, name: studio.name })}
                className="text-left text-sm leading-5 text-white/68 decoration-white/30 underline-offset-4 transition hover:text-white hover:underline focus:outline-none focus:text-white focus:underline"
                aria-label={`View all Anime from ${studio.name}`}
              >
                {studio.name}
                {index < studios.length - 1 ? "," : ""}
              </button>
            ) : (
              <span key={`${studio.name}-${index}`} className="text-sm leading-5 text-white/68">
                {studio.name}
                {index < studios.length - 1 ? "," : ""}
              </span>
            )
          )}
        </div>
      </Tooltip>
    </div>
  );
}

type WatchInsight = {
  label: string;
  value: string;
  context: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  accent?: boolean;
};

function WatchOverview({
  episodes,
  duration,
  animeStatus,
  franchiseStartDate,
  franchiseTimingStatus,
  nextAiringEpisode,
  entry,
  relations,
}: {
  episodes: number | null;
  duration: number | null;
  animeStatus: string | null;
  franchiseStartDate: {
    year?: number | null;
    month?: number | null;
    day?: number | null;
  } | null;
  franchiseTimingStatus: "idle" | "calculating" | "ready" | "error";
  nextAiringEpisode: { episode?: number | null; airingAt?: number | null } | null;
  entry: ListEntry | null;
  relations: RelatedAnimeEdge[];
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!nextAiringEpisode?.airingAt) return;

    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [nextAiringEpisode?.airingAt]);

  const episodeCount = positiveNumberOrNull(episodes);
  const episodeDuration = positiveNumberOrNull(duration);
  const progress = Math.max(0, Number(entry?.progress ?? 0));
  const isAiring = animeStatus === "RELEASING";
  const totalMinutes = episodeCount && episodeDuration ? episodeCount * episodeDuration : null;
  const watchedMinutes = entry && episodeDuration ? progress * episodeDuration : null;
  const episodesRemaining =
    entry && episodeCount ? Math.max(0, episodeCount - Math.min(progress, episodeCount)) : null;
  const remainingMinutes =
    episodesRemaining !== null && episodeDuration ? episodesRemaining * episodeDuration : null;
  const completion =
    entry && episodeCount ? Math.min(100, Math.round((progress / episodeCount) * 100)) : null;
  const airedEpisodes = nextAiringEpisode?.episode
    ? Math.max(0, Number(nextAiringEpisode.episode) - 1)
    : null;
  const directRelations = summarizeDirectRelations(relations);
  const seriesTiming = getSeriesTiming(franchiseStartDate, now);
  const countdown = formatAiringCountdown(nextAiringEpisode?.airingAt, now);
  const nextEpisodeDate = nextAiringEpisode?.airingAt
    ? new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(nextAiringEpisode.airingAt * 1000))
    : null;
  const nextEpisodeContext = nextAiringEpisode?.episode
    ? `Episode ${nextAiringEpisode.episode}${
        countdown ? ` ${countdown.toLocaleLowerCase()}` : " is next"
      }${nextEpisodeDate ? ` · ${nextEpisodeDate}` : ""}`
    : "More episodes are coming";

  const insights: WatchInsight[] = [
    totalMinutes
      ? {
          label: isAiring ? "Projected runtime" : "Total runtime",
          value: formatRuntime(totalMinutes),
          context: `${episodeCount} ${episodeCount === 1 ? "episode" : "episodes"}${
            isAiring ? " · still airing" : ""
          }`,
          icon: ClockIcon,
          accent: true,
        }
      : episodeDuration
        ? {
            label: "Episode length",
            value: formatRuntime(episodeDuration),
            context: isAiring ? "Total episode count unknown · still airing" : "Per episode",
            icon: ClockIcon,
            accent: true,
          }
        : null,
    watchedMinutes !== null
      ? {
          label: "Time watched",
          value: formatRuntime(watchedMinutes),
          context: `${progress} ${progress === 1 ? "episode" : "episodes"} watched`,
          icon: PlayCircleIcon,
        }
      : null,
    remainingMinutes !== null && episodesRemaining !== null
      ? {
          label: "Time remaining",
          value: formatRuntime(remainingMinutes),
          context: `${episodesRemaining} of ${episodeCount} left`,
          icon: ClockIcon,
        }
      : null,
    completion !== null
      ? {
          label: "Completion",
          value: `${completion}% complete`,
          context: `${Math.min(progress, episodeCount ?? progress)} of ${episodeCount} watched`,
          icon: CheckCircleIcon,
          accent: completion === 100,
        }
      : null,
    seriesTiming
      ? {
          label: seriesTiming.label,
          value: seriesTiming.value,
          context: seriesTiming.context,
          icon: CalendarDaysIcon,
        }
      : franchiseTimingStatus === "calculating" || franchiseTimingStatus === "idle"
        ? {
            label: "Franchise age",
            value: "Calculating…",
            context: "Tracing the anime's prequel history",
            icon: CalendarDaysIcon,
          }
        : franchiseTimingStatus === "error"
          ? {
              label: "Franchise age",
              value: "Unavailable",
              context: "The franchise history could not be calculated",
              icon: CalendarDaysIcon,
            }
          : null,
    isAiring && airedEpisodes !== null
      ? {
          label: "Airing progress",
          value: episodeCount
            ? `${Math.min(airedEpisodes, episodeCount)} of ${episodeCount} aired`
            : `${airedEpisodes} ${airedEpisodes === 1 ? "episode" : "episodes"} aired`,
          context: nextEpisodeContext,
          icon: TvIcon,
          accent: true,
        }
      : null,
    directRelations
      ? {
          label: "Direct connections",
          value: `${directRelations.total} linked ${directRelations.total === 1 ? "title" : "titles"}`,
          context: directRelations.summary,
          icon: LinkIcon,
        }
      : null,
  ].filter(Boolean) as WatchInsight[];

  if (!insights.length) return null;

  return (
    <section className="mt-6" aria-label="Series at a glance">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/30">
            Series at a glance
          </p>
          <p className="mt-1 text-xs text-white/40">The useful numbers and the fun ones.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {insights.map((insight) => (
          <WatchInsightCard key={insight.label} insight={insight} />
        ))}
      </div>
    </section>
  );
}

function MangaOverview({
  chapters,
  volumes,
  mangaStatus,
  startDate,
  relations,
  entry,
}: {
  chapters: number | null;
  volumes: number | null;
  mangaStatus: string | null;
  startDate: {
    year?: number | null;
    month?: number | null;
    day?: number | null;
  } | null;
  relations: RelatedAnimeEdge[];
  entry: ListEntry | null;
}) {
  const [now] = useState(() => Date.now());
  const chapterCount = positiveNumberOrNull(chapters);
  const volumeCount = positiveNumberOrNull(volumes);
  const chapterTotal = getPublicationTotalPresentation(
    chapterCount,
    mangaStatus,
    "chapter"
  );
  const volumeTotal = getPublicationTotalPresentation(volumeCount, mangaStatus, "volume");
  const publicationTiming = getPublicationTiming(startDate, now);
  const linkedTitles = relations.filter((edge) => Boolean(getRelatedMediaType(edge.node))).length;
  const insights: WatchInsight[] = [
    entry
      ? {
          label: "Chapters read",
          value: chapterCount ? `${entry.progress} of ${chapterCount}` : formatNumber(entry.progress),
          context: chapterCount
            ? `${Math.min(100, Math.round((entry.progress / chapterCount) * 100))}% complete`
            : "Total chapter count is unknown",
          icon: CheckCircleIcon,
          accent: Boolean(chapterCount && entry.progress >= chapterCount),
        }
      : null,
    entry
      ? {
          label: "Volumes read",
          value: volumeCount
            ? `${entry.volume_progress ?? 0} of ${volumeCount}`
            : formatNumber(entry.volume_progress ?? 0),
          context: volumeCount ? "Tracked volume progress" : "Total volume count is unknown",
          icon: BookmarkIcon,
        }
      : null,
    {
      label: "Chapters",
      value: chapterTotal.value,
      context: chapterTotal.context,
      icon: DocumentTextIcon,
      accent: true,
    },
    {
      label: "Volumes",
      value: volumeTotal.value,
      context: volumeTotal.context,
      icon: BookmarkIcon,
    },
    mangaStatus
      ? {
          label: "Publishing status",
          value: getMediaStatusLabel(mangaStatus, "MANGA"),
          context:
            mangaStatus === "RELEASING"
              ? "New chapters may still be released"
              : "Current AniList publication state",
          icon: CheckCircleIcon,
          accent: mangaStatus === "RELEASING",
        }
      : null,
    publicationTiming
      ? {
          label: publicationTiming.label,
          value: publicationTiming.value,
          context: publicationTiming.context,
          icon: CalendarDaysIcon,
        }
      : null,
    linkedTitles
      ? {
          label: "Direct connections",
          value: `${linkedTitles} linked ${linkedTitles === 1 ? "title" : "titles"}`,
          context: "Anime adaptations and related publications",
          icon: LinkIcon,
        }
      : null,
  ].filter(Boolean) as WatchInsight[];

  return (
    <section className="mt-6" aria-label="Publication at a glance">
      <div className="mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/30">
          Publication at a glance
        </p>
        <p className="mt-1 text-xs text-white/40">
          Known publication totals and current release state.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {insights.map((insight) => (
          <WatchInsightCard key={insight.label} insight={insight} />
        ))}
      </div>
    </section>
  );
}

function WatchInsightCard({ insight }: { insight: WatchInsight }) {
  const Icon = insight.icon;

  return (
    <div
      className={`group relative min-w-0 overflow-hidden rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:border-white/18 ${
        insight.accent
          ? "border-(--app-accent)/22 bg-(--app-accent-soft)"
          : "border-white/8 bg-black/18"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/32">
          {insight.label}
        </p>
        <Icon className="h-4 w-4 shrink-0 text-white/28 transition group-hover:text-white/48" />
      </div>
      <p className="mt-3 truncate text-lg font-semibold tracking-tight text-white/88">
        {insight.value}
      </p>
      <Tooltip content={insight.context} as="div" className="mt-1 block" focusable>
        <p className="line-clamp-2 text-xs leading-5 text-white/38">{insight.context}</p>
      </Tooltip>
    </div>
  );
}

function ArtworkLightbox({
  artwork,
  onClose,
}: {
  artwork: ExpandedArtwork;
  onClose: () => void;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function clampPosition(nextPosition: { x: number; y: number }, nextZoom = zoom) {
    const image = imageRef.current;
    if (!image || nextZoom <= 1) return { x: 0, y: 0 };

    const maxX = (image.offsetWidth * (nextZoom - 1)) / 2;
    const maxY = (image.offsetHeight * (nextZoom - 1)) / 2;

    return {
      x: Math.max(-maxX, Math.min(maxX, nextPosition.x)),
      y: Math.max(-maxY, Math.min(maxY, nextPosition.y)),
    };
  }

  function changeZoom(
    amount: number,
    anchor?: { clientX: number; clientY: number }
  ) {
    const nextZoom = Math.max(1, Math.min(4, Number((zoom + amount).toFixed(2))));
    const image = imageRef.current;

    if (nextZoom === zoom) return;

    setPosition((current) => {
      if (!anchor || !image) {
        return clampPosition(current, nextZoom);
      }

      const rect = image.getBoundingClientRect();
      const zoomRatio = nextZoom / zoom;
      const cursorFromImageCenter = {
        x: anchor.clientX - (rect.left + rect.width / 2),
        y: anchor.clientY - (rect.top + rect.height / 2),
      };
      const anchoredPosition = {
        x: current.x + (1 - zoomRatio) * cursorFromImageCenter.x,
        y: current.y + (1 - zoomRatio) * cursorFromImageCenter.y,
      };

      // The ordinary pan clamp contracts as zoom decreases, pulling the
      // artwork toward center and breaking the cursor anchor. Wheel events
      // originate over the image, so the anchored point remains reachable.
      return nextZoom <= 1 ? { x: 0, y: 0 } : anchoredPosition;
    });
    setZoom(nextZoom);
  }

  function resetView() {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  }

  function handlePointerDown(event: React.PointerEvent<HTMLImageElement>) {
    if (zoom <= 1) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
    setIsDragging(true);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLImageElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    setPosition(
      clampPosition({
        x: drag.originX + event.clientX - drag.startX,
        y: drag.originY + event.clientY - drag.startY,
      })
    );
  }

  function finishDragging(event: React.PointerEvent<HTMLImageElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;

    dragRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center overflow-hidden rounded-3xl bg-black/82 p-5"
      role="dialog"
      aria-modal="true"
      aria-label={artwork.label}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-5 top-5 z-20 rounded-full border border-white/15 bg-black/80 p-2.5 text-white/75 shadow-xl backdrop-blur-md transition hover:bg-white/15 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/55"
        aria-label="Close enlarged artwork"
      >
        <XMarkIcon className="h-5 w-5" />
      </button>
      <div className="relative flex max-h-full max-w-6xl flex-col items-center">
        <img
          ref={imageRef}
          src={artwork.src}
          alt={artwork.alt}
          draggable={false}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDragging}
          onPointerCancel={finishDragging}
          onWheel={(event) => {
            event.preventDefault();
            changeZoom(event.deltaY < 0 ? 0.25 : -0.25, {
              clientX: event.clientX,
              clientY: event.clientY,
            });
          }}
          className={`h-auto max-h-[70vh] w-auto max-w-[90vw] select-none rounded-2xl object-contain shadow-2xl ${
            zoom > 1 ? (isDragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"
          } ${isDragging ? "" : "transition-transform duration-200 ease-out"}`}
          style={{
            transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${zoom})`,
          }}
          onDoubleClick={(event) =>
            zoom > 1
              ? resetView()
              : changeZoom(1, { clientX: event.clientX, clientY: event.clientY })
          }
        />
      </div>
        <div className="absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-full border border-white/10 bg-[#171717]/95 px-3 py-2 text-xs text-white/55 shadow-xl backdrop-blur-md">
          <span className="px-1">{artwork.label}</span>
          <span className="h-1 w-1 rounded-full bg-white/25" />
          <div className="flex items-center gap-1">
            <Tooltip content="Zoom out">
              <button type="button" onClick={() => changeZoom(-0.25)} disabled={zoom <= 1} className="rounded-full p-1.5 text-white/65 transition hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-30" aria-label="Zoom out">
                <MagnifyingGlassMinusIcon className="h-4 w-4" />
              </button>
            </Tooltip>
            <Tooltip content="Reset zoom and position">
              <button type="button" onClick={resetView} disabled={zoom === 1 && position.x === 0 && position.y === 0} className="min-w-12 rounded-full px-2 py-1 text-center font-semibold text-white/70 transition hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-50" aria-label="Reset zoom and position">
                {Math.round(zoom * 100)}%
              </button>
            </Tooltip>
            <Tooltip content="Zoom in">
              <button type="button" onClick={() => changeZoom(0.25)} disabled={zoom >= 4} className="rounded-full p-1.5 text-white/65 transition hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-30" aria-label="Zoom in">
                <MagnifyingGlassPlusIcon className="h-4 w-4" />
              </button>
            </Tooltip>
          </div>
          <span className="h-1 w-1 rounded-full bg-white/25" />
          <span className="px-1">Scroll to zoom · Drag to pan · Double-click to reset</span>
        </div>
    </div>
  );
}

function PersonalListPanel({
  entry,
  totalEpisodes,
  totalVolumes,
  mediaType,
  onAdd,
  onEdit,
  busy,
}: {
  entry: ListEntry | null;
  totalEpisodes: number | null;
  totalVolumes: number | null;
  mediaType: MediaType;
  onAdd: () => void;
  onEdit: () => void;
  busy: boolean;
}) {
  if (!entry) {
    return (
      <aside className="rounded-3xl border border-white/10 bg-white/3 p-5">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/8 p-2.5 text-white/65">
            <BookmarkIcon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-white/35">
              Your list
            </p>
            <h2 className="mt-1 text-base font-semibold text-white">Not in list</h2>
          </div>
        </div>

        <p className="mt-4 text-sm leading-6 text-white/50">
          Add this title to track progress, notes, and your personal score.
        </p>

        <button
          onClick={onAdd}
          disabled={busy}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" />
          Add to list
        </button>
      </aside>
    );
  }

  const progressPercent =
    totalEpisodes && totalEpisodes > 0
      ? Math.min(100, Math.round((entry.progress / totalEpisodes) * 100))
      : null;

  return (
    <aside className="rounded-3xl border border-white/10 bg-white/3 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-white/35">
            Your progress
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-sm font-semibold text-white">
              {getPersonalStatusLabel(entry.status, mediaType)}
            </span>
            {mediaType === "MANGA" && (
              <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-sm text-white/70">
                {entry.volume_progress ?? 0}
                {totalVolumes ? ` / ${totalVolumes}` : ""} vols
              </span>
            )}
            <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-sm text-white/70">
              {formatProgress(entry.progress, totalEpisodes, mediaType)}
            </span>
          </div>
        </div>

        <Tooltip content="Edit list entry">
          <button
            onClick={onEdit}
            disabled={busy}
            aria-label="Edit list entry"
            className="rounded-2xl border border-white/10 bg-white/6 p-2.5 text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            <PencilSquareIcon className="h-5 w-5" />
          </button>
        </Tooltip>
      </div>

      {progressPercent !== null && (
        <div className="mt-5">
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-white/75"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-white/40">
            {progressPercent}% {mediaType === "MANGA" ? "read" : "watched"}
          </p>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <ListStat label="Score" value={entry.score ?? "-"} icon={StarIcon} />
        <ListStat
          label="Updated"
          value={formatLocalDate(entry.updated_at, { month: "short", day: "numeric" })}
          icon={ClockIcon}
        />
      </div>

      {entry.notes?.trim() && <ExpandableNotes notes={entry.notes.trim()} />}
    </aside>
  );
}

function ExpandableNotes({ notes }: { notes: string }) {
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const [expandedHeight, setExpandedHeight] = useState(72);

  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text) return;

    const measureNotes = () => {
      const nextHeight = text.scrollHeight;
      setExpandedHeight(nextHeight);
      setCanExpand(nextHeight > 73);
    };

    measureNotes();
    const observer = new ResizeObserver(measureNotes);
    observer.observe(text);

    return () => observer.disconnect();
  }, [notes]);

  return (
    <div className="mt-4 grid grid-cols-1 gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 sm:grid-cols-[minmax(7rem,1fr)_minmax(0,3fr)] sm:gap-4">
      <div className="flex items-start gap-2.5 sm:border-r sm:border-white/8 sm:pr-4">
        <DocumentTextIcon className="mt-0.5 h-4 w-4 shrink-0 text-white/40" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/55">
            Notes
          </p>
          <p className="mt-1 text-xs text-white/30">Personal note</p>
        </div>
      </div>

      <div className="min-w-0">
        <div
          className="overflow-hidden transition-[max-height] duration-500 ease-in-out"
          style={{ maxHeight: expanded ? `${expandedHeight}px` : "4.5rem" }}
        >
          <p
            ref={textRef}
            className="whitespace-pre-wrap break-words text-sm leading-6 text-white/60"
          >
            {notes}
          </p>
        </div>

        {(canExpand || expanded) && (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-(--app-accent) transition hover:brightness-125 focus:outline-none focus:ring-2 focus:ring-(--app-accent)/55"
            aria-expanded={expanded}
          >
            {expanded ? "Show less" : "Show more"}
            <ChevronDownIcon
              className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        )}
      </div>
    </div>
  );
}

function ListStat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <Icon className="h-4 w-4 text-white/40" />
      <p className="mt-3 text-xs text-white/35">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-white/80">{value}</p>
    </div>
  );
}

function ContentSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2 text-white/55">
        <Icon className="h-4 w-4" />
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em]">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function StoryAndTaxonomy({
  description,
  genres,
  tags,
}: {
  description: string | null;
  genres: string[];
  tags: Array<{
    id?: number | string | null;
    name?: string | null;
    description?: string | null;
    rank?: number | null;
  }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasTaxonomy = genres.length > 0 || tags.length > 0;
  const hasMore = Boolean(description && getPlainText(description).length > 420);

  return (
    <section
      className={`grid grid-cols-1 gap-4 ${
        description && hasTaxonomy ? "lg:grid-cols-[minmax(0,2fr)_minmax(15rem,1fr)]" : ""
      }`}
      aria-label="Story, genres, and tags"
    >
      {description && (
        <article className="relative flex flex-col overflow-hidden rounded-3xl border border-white/8 bg-white/[0.025] p-5 lg:min-h-[23rem]">
          <div className="flex items-center gap-2 text-white/55">
            <BookmarkIcon className="h-4 w-4" />
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em]">Description</h2>
          </div>

          <div
            className={`relative mt-5 ${
              hasMore && !expanded ? "min-h-0 flex-1" : ""
            }`}
          >
            <div
              className={`overflow-hidden transition-[max-height] duration-700 ease-in-out ${
                expanded ? "max-h-[100rem]" : hasMore ? "h-full" : ""
              }`}
            >
              <div
                className="whitespace-pre-line text-sm leading-7 text-white/72"
              >
                {getSafeDescriptionText(description)}
              </div>
            </div>

            {hasMore && !expanded && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-linear-to-t from-[#151515] via-[#151515]/90 to-transparent" />
            )}
          </div>

          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              aria-expanded={expanded}
              className="relative mt-4 inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-white/65 transition hover:border-white/20 hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-(--app-accent)/55"
            >
              {expanded ? "Show less" : "Read full description"}
              <ChevronDownIcon
                className={`h-4 w-4 transition-transform duration-500 ${expanded ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </article>
      )}

      {hasTaxonomy && (
        <aside className="rounded-3xl border border-white/8 bg-white/[0.025] p-5 lg:min-h-[23rem] lg:self-start">
          {genres.length > 0 && (
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-white/55">
                  <TagIcon className="h-4 w-4" />
                  <h2 className="text-sm font-semibold uppercase tracking-[0.2em]">Genres</h2>
                </div>
                <span className="text-[10px] font-medium text-white/25">{genres.length}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {genres.map((genre) => (
                  <span
                    key={genre}
                    className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-white/75"
                  >
                    {genre}
                  </span>
                ))}
              </div>
            </div>
          )}

          {tags.length > 0 && (
            <div className={genres.length > 0 ? "mt-7 border-t border-white/8 pt-6" : ""}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-white/55">
                  <TagIcon className="h-4 w-4" />
                  <h2 className="text-sm font-semibold uppercase tracking-[0.2em]">Tags</h2>
                </div>
                <span className="text-[10px] font-medium text-white/25">{tags.length}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {tags.map((tag, index) => (
                  <Tooltip
                    key={tag.id ?? `${tag.name ?? "tag"}-${index}`}
                    content={tag.description || tag.name || "Tag"}
                    focusable
                  >
                    <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-white/72">
                      {tag.name || "Tag"}
                      {tag.rank ? (
                        <span className="ml-1.5 text-white/32">{tag.rank}%</span>
                      ) : null}
                    </span>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}
        </aside>
      )}
    </section>
  );
}

function PeopleShelf({
  title,
  icon: Icon,
  kind,
  edges,
  onSelect,
}: {
  title: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  kind: PeopleModalItem["kind"];
  edges: PersonEdge[];
  onSelect: (item: PeopleModalItem) => void;
}) {
  return (
    <ContentSection title={title} icon={Icon}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {edges.map((edge, index) => {
          const person = getPersonFromEdge(edge, kind);
          const voiceActor = getVoiceActorFromEdge(edge);
          const name = getPersonName(person);
          const modalItem = buildPeopleModalItem({
            edge,
            kind,
            title,
            person,
            voiceActor,
          });

          return (
            <button
              key={`${title}-${person?.id ?? index}-${edge.role}`}
              type="button"
              onClick={() => onSelect(modalItem)}
              className="overflow-hidden rounded-3xl border border-white/10 bg-white/3 text-left transition hover:border-(--app-accent)/30 hover:bg-(--app-accent-soft) focus:outline-none focus:ring-2 focus:ring-(--app-accent)/55"
            >
              <div className="flex gap-3 p-3">
                <PersonImage src={person?.image?.large} name={name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white/85">
                    {name}
                  </p>
                  {edge.role && (
                    <p className="mt-1 truncate text-xs text-white/45">
                      {formatEnum(edge.role)}
                    </p>
                  )}
                  {voiceActor && (
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/50">
                      VA: {getPersonName(voiceActor)}
                    </p>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </ContentSection>
  );
}

function PeopleDetailModal({
  item,
  onClose,
}: {
  item: PeopleModalItem | null;
  onClose: () => void;
}) {
  const [detailRequest, setDetailRequest] = useState<{
    key: string;
    status: "ready" | "error";
    details: PersonDetails | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!item?.id) {
      return () => {
        cancelled = true;
      };
    }

    const requestKey = getPersonDetailRequestKey(item);

    const loadDetails =
      item.kind === "character"
        ? window.api.getCharacterDetails(item.id)
        : window.api.getStaffDetails(item.id);

    loadDetails
      .then(async (result) => {
        await preloadPersonImages(result, item);
        if (!cancelled) {
          setDetailRequest({ key: requestKey, status: "ready", details: result });
        }
      })
      .catch((error) => {
        console.error("Failed to load person details:", error);
        if (!cancelled) {
          setDetailRequest({ key: requestKey, status: "error", details: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [item]);

  if (!item) return null;

  const requestKey = getPersonDetailRequestKey(item);
  const isLoadingProfile =
    Boolean(item.id) && detailRequest?.key !== requestKey;
  const details = detailRequest?.key === requestKey ? detailRequest.details : null;
  const detailError =
    detailRequest?.key === requestKey && detailRequest.status === "error"
      ? "Profile details could not be loaded."
      : null;
  const displayName = getPersonName(details) || item.name;
  const nativeName = details?.name?.native ?? item.nativeName;
  const image = details?.image?.large ?? item.image;
  const descriptionSegments = parseAniListDescription(details?.description);
  const facts = buildPersonFacts(details, item.kind);

  if (isLoadingProfile) {
    return (
      <PersonDetailsLoadingModal
        kind={item.kind}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center overflow-hidden rounded-3xl bg-black/82 p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close person details"
        onClick={onClose}
      />
      <section className="relative flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#111111] text-white shadow-2xl">
        <div className="border-b border-white/10 bg-white/3 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-white/35">
                {item.kind === "character" ? "Character" : "Staff"}
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">{displayName}</h2>
              {nativeName && nativeName !== displayName && (
                <p className="mt-1 text-sm text-white/45">{nativeName}</p>
              )}
            </div>
            <Tooltip content="Close">
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-2xl border border-white/10 bg-white/5 p-2 text-white/55 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-(--app-accent)/55"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="scroll-container min-h-0 flex-1 overscroll-contain overflow-y-auto p-5">
          <div className="grid gap-5 md:grid-cols-[9rem_1fr]">
            <PersonImage src={image} name={displayName} size="large" />

            <div className="space-y-4">
              <InfoPanel label="Appears as" value={item.title} />
              {item.role && <InfoPanel label="Role" value={formatEnum(item.role)} />}

              {facts.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {facts.map((fact) => (
                    <InfoPanel key={fact.label} label={fact.label} value={fact.value} />
                  ))}
                </div>
              )}

              {detailError && <InfoPanel label="Profile" value={detailError} />}
              {details?.warning && <InfoPanel label="Saved profile" value={details.warning} />}

              {item.voiceActor && (
                <div className="rounded-3xl border border-white/10 bg-white/3 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-white/35">
                    Japanese voice
                  </p>
                  <div className="mt-3 flex items-center gap-3">
                    <PersonImage
                      src={item.voiceActor.image}
                      name={item.voiceActor.name}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white/85">
                        {item.voiceActor.name}
                      </p>
                      {item.voiceActor.nativeName &&
                        item.voiceActor.nativeName !== item.voiceActor.name && (
                          <p className="mt-1 truncate text-xs text-white/45">
                            {item.voiceActor.nativeName}
                          </p>
                        )}
                      {item.voiceActor.language && (
                        <p className="mt-1 text-xs text-white/35">
                          {formatEnum(item.voiceActor.language)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {descriptionSegments.length > 0 && (
              <PersonDescription segments={descriptionSegments} />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function PersonDetailsLoadingModal({
  kind,
  onClose,
}: {
  kind: PeopleModalItem["kind"];
  onClose: () => void;
}) {
  return (
    <ModalShell onClose={onClose} ariaLabel="Person details" zClassName="z-60" panelClassName="flex h-72 max-w-lg items-center justify-center overflow-hidden p-0 text-white" showCloseButton>
        <div className="flex flex-col items-center text-center">
          <div className="h-12 w-12 rounded-full border border-(--app-accent)/25 border-t-(--app-accent) animate-spin" />
          <p className="mt-5 text-xs uppercase tracking-[0.24em] text-white/35">
            Loading {kind === "character" ? "character" : "staff"}
          </p>
          <p className="mt-2 text-sm text-white/65">Preparing profile details...</p>
        </div>
    </ModalShell>
  );
}

function PersonDescription({
  segments,
}: {
  segments: Array<{ type: "text" | "spoiler"; text: string }>;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const [expandedHeight, setExpandedHeight] = useState(240);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const measureDescription = () => {
      const nextHeight = content.scrollHeight;
      setExpandedHeight(nextHeight);
      setCanExpand(nextHeight > 241);
    };

    measureDescription();
    const observer = new ResizeObserver(measureDescription);
    observer.observe(content);

    return () => observer.disconnect();
  }, [segments]);

  return (
    <div className="rounded-3xl border border-white/10 bg-white/3 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-white/35">
        Description
      </p>

      <div className="relative mt-3">
        <div
          className="overflow-hidden transition-[max-height] duration-500 ease-in-out"
          style={{ maxHeight: expanded ? `${expandedHeight}px` : "15rem" }}
        >
          <div ref={contentRef} className="space-y-3 text-sm leading-6 text-white/65">
            {segments.map((segment, index) =>
              segment.type === "spoiler" ? (
                <SpoilerBlock key={`${segment.type}-${index}`} text={segment.text} />
              ) : (
                <p key={`${segment.type}-${index}`} className="whitespace-pre-line">
                  {segment.text}
                </p>
              )
            )}
          </div>
        </div>

        {canExpand && !expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-[#171717] to-transparent" />
        )}
      </div>

      {(canExpand || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-(--app-accent) transition hover:brightness-125 focus:outline-none focus:ring-2 focus:ring-(--app-accent)/55"
          aria-expanded={expanded}
        >
          {expanded ? "Show less" : "Show more"}
          <ChevronDownIcon
            className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      )}
    </div>
  );
}

function SpoilerBlock({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="rounded-2xl border border-(--app-accent)/25 bg-(--app-accent-soft) p-3">
      <button
        type="button"
        onClick={() => setRevealed((current) => !current)}
        className="text-xs font-semibold uppercase tracking-[0.18em] text-white/75 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-(--app-accent)/55"
      >
        {revealed ? "Hide spoiler" : "Spoiler, click to view"}
      </button>
      {revealed && (
        <p className="mt-3 whitespace-pre-line text-sm leading-6 text-white/65">
          {text}
        </p>
      )}
    </div>
  );
}

function InfoPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/3 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-white/35">{label}</p>
      <p className="mt-2 text-sm font-medium text-white/80">{value}</p>
    </div>
  );
}

function RelatedAnimeShelf({
  edges,
  onSelectMedia,
}: {
  edges: RelatedAnimeEdge[];
  onSelectMedia?: (mediaId: number, mediaType: MediaType) => void;
}) {
  const items = [...edges]
    .sort((a, b) => getRelationPriority(a?.relationType) - getRelationPriority(b?.relationType))
    .slice(0, 10);

  return (
    <ContentSection title="Related titles" icon={LinkIcon}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((edge, index) => {
          const media = edge.node;
          const relation = getRelationDetails(edge.relationType);
          const titleText = getMediaTitle(media);
          const mediaId = Number(media?.id);
          const relatedMediaType = getRelatedMediaType(media);
          const canOpen =
            Boolean(relatedMediaType) &&
            Number.isInteger(mediaId) &&
            mediaId > 0 &&
            Boolean(onSelectMedia);

          const tooltipLabel = canOpen ? `Open ${titleText}` : titleText;

          return (
            <Tooltip key={`${media?.id ?? index}-${edge.relationType ?? "related"}`} content={tooltipLabel} as="div" className="block">
            <button
              type="button"
              onClick={() =>
                canOpen && relatedMediaType && onSelectMedia?.(mediaId, relatedMediaType)
              }
              disabled={!canOpen}
              className="group grid w-full min-w-0 grid-cols-[3.5rem_1fr] gap-3 rounded-2xl border border-white/10 bg-white/3 p-3 text-left transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-white/35 disabled:cursor-default disabled:hover:translate-y-0 disabled:hover:border-white/10 disabled:hover:bg-white/3"
              aria-label={tooltipLabel}
            >
              <div className="h-20 w-14 overflow-hidden rounded-xl bg-white/5">
                {media?.coverImage?.large ? (
                  <img
                    src={media.coverImage.large}
                    alt={titleText}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full bg-white/5" />
                )}
              </div>

              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${relation.tone}`}
                  >
                    <relation.icon className="h-3.5 w-3.5" />
                    {relation.label}
                  </span>
                  <span className="text-xs font-medium text-white/45">
                    {relation.cue}
                  </span>
                </div>

                <p className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-white/88">
                  {titleText}
                </p>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {media?.format && (
                    <span className="rounded-full bg-white/8 px-2 py-1 text-[11px] text-white/45">
                      {media.format}
                    </span>
                  )}
                  {relatedMediaType && (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/40">
                      {relatedMediaType === "MANGA" ? "Manga" : "Anime"}
                    </span>
                  )}
                  {media?.episodes && (
                    <span className="rounded-full bg-white/8 px-2 py-1 text-[11px] text-white/45">
                      {media.episodes} eps
                    </span>
                  )}
                  {media?.chapters && (
                    <span className="rounded-full bg-white/8 px-2 py-1 text-[11px] text-white/45">
                      {media.chapters} ch
                    </span>
                  )}
                  {media?.volumes && (
                    <span className="rounded-full bg-white/8 px-2 py-1 text-[11px] text-white/45">
                      {media.volumes} vols
                    </span>
                  )}
                  {media?.averageScore && (
                    <span className="rounded-full bg-white/8 px-2 py-1 text-[11px] text-white/45">
                      {media.averageScore}%
                    </span>
                  )}
                </div>
              </div>
            </button>
            </Tooltip>
          );
        })}
      </div>
    </ContentSection>
  );
}

function MediaShelf({
  title,
  icon: Icon,
  items,
  onSelectMedia,
}: {
  title: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  items: Array<{ label: string; media: RecommendationMedia }>;
  onSelectMedia?: (mediaId: number, mediaType: MediaType) => void;
}) {
  return (
    <ContentSection title={title} icon={Icon}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.slice(0, 10).map(({ label, media }, index) => {
          const titleText = getMediaTitle(media);
          const mediaId = Number(media?.id);
          const recommendationType = getRelatedMediaType(media);
          const canOpen =
            Boolean(recommendationType) &&
            Number.isInteger(mediaId) &&
            mediaId > 0 &&
            Boolean(onSelectMedia);

          const tooltipLabel = canOpen ? `Open ${titleText}` : titleText;

          return (
            <Tooltip key={`${media?.id ?? index}-${label}`} content={tooltipLabel} as="div" className="block">
            <button
              type="button"
              onClick={() =>
                canOpen && recommendationType && onSelectMedia?.(mediaId, recommendationType)
              }
              disabled={!canOpen}
              className="group flex w-full min-w-0 gap-3 rounded-2xl border border-white/10 bg-white/3 p-3 text-left transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-white/35 disabled:cursor-default disabled:hover:translate-y-0 disabled:hover:border-white/10 disabled:hover:bg-white/3"
              aria-label={tooltipLabel}
            >
              <div className="h-20 w-14 shrink-0 overflow-hidden rounded-xl bg-white/5">
                {media?.coverImage?.large ? (
                  <img
                    src={media.coverImage.large}
                    alt={titleText}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full bg-white/5" />
                )}
              </div>
              <div className="min-w-0 flex-1 py-1">
                <div className="flex min-w-0 items-start gap-2">
                  <p className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-5 text-white/85">
                    {titleText}
                  </p>
                </div>
                <p className="mt-2 truncate text-xs text-white/45">{label}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {media?.format && (
                    <span className="rounded-full bg-white/8 px-2 py-1 text-[11px] text-white/45">
                      {media.format}
                    </span>
                  )}
                  {recommendationType && (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/40">
                      {recommendationType === "MANGA" ? "Manga" : "Anime"}
                    </span>
                  )}
                  {media?.averageScore && (
                    <span className="rounded-full bg-white/8 px-2 py-1 text-[11px] text-white/45">
                      {media.averageScore}%
                    </span>
                  )}
                </div>
              </div>
            </button>
            </Tooltip>
          );
        })}
      </div>
    </ContentSection>
  );
}

const KNOWN_LINK_COLORS: Array<[RegExp, string]> = [
  [/\bcrunchyroll\b/i, "#f47521"],
  [/\bbilibili\b/i, "#00aeec"],
  [/\bamazon prime video\b|\bprime video\b/i, "#00a8e1"],
  [/\byoutube\b/i, "#ff0033"],
  [/\bnetflix\b/i, "#e50914"],
  [/\bhidive\b/i, "#00aeef"],
  [/\bhulu\b/i, "#1ce783"],
  [/\bdisney\+?\b/i, "#4b69ff"],
  [/\bmax\b|\bhbo max\b/i, "#5b39f5"],
  [/\btubi\b/i, "#ff501a"],
  [/\btwitter\b|\bx \(twitter\)\b/i, "#ffffff"],
  [/\btiktok\b/i, "#25f4ee"],
];

function getLinkBrandColor(site?: string | null, suppliedColor?: string | null) {
  const knownColor = KNOWN_LINK_COLORS.find(([pattern]) => pattern.test(site || ""))?.[1];
  return knownColor || suppliedColor;
}

function isTikTokLinkSite(site?: string | null) {
  return /\btiktok\b/i.test(site || "");
}

function isXLinkSite(site?: string | null) {
  return /\btwitter\b|\bx \(twitter\)\b/i.test(site || "");
}

function getLinkIconSurfaceStyle(
  site?: string | null,
  suppliedColor?: string | null
) {
  if (isTikTokLinkSite(site) || isXLinkSite(site)) {
    return {
      borderColor: "rgba(255, 255, 255, 0.14)",
      background: "#050505",
    };
  }

  const brandColor = getLinkBrandColor(site, suppliedColor);
  return {
    borderColor: brandColor
      ? `color-mix(in srgb, ${brandColor} 18%, transparent)`
      : undefined,
    background: brandColor
      ? `color-mix(in srgb, ${brandColor} 6%, transparent)`
      : undefined,
  };
}

function getReadableLinkColor(color?: string | null) {
  if (!color) return "rgba(255, 255, 255, 0.72)";

  const hex = color.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (!hex) return color;
  const normalized = hex.length === 3 ? [...hex].map((value) => value + value).join("") : hex;
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;

  if (luminance >= 0.14) return color;
  const lift = (channel: number) => Math.round(channel + (255 - channel) * 0.78);
  return `rgb(${lift(red)}, ${lift(green)}, ${lift(blue)})`;
}

function BrandedLinkIcon({
  link,
  site,
  className,
  fallback = "link",
}: {
  link: Pick<ExternalLink, "icon" | "color"> | null;
  site?: string | null;
  className: string;
  fallback?: "link" | "play" | "book";
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [iconFailed, setIconFailed] = useState(false);
  const brandColor = getReadableLinkColor(getLinkBrandColor(site, link?.color));
  const usesTikTokPalette = isTikTokLinkSite(site);

  useEffect(() => {
    const canvas = canvasRef.current;
    const iconUrl = link?.icon;
    if (!canvas || !iconUrl) return;

    let cancelled = false;
    const context = canvas.getContext("2d");
    const image = new Image();

    image.onload = () => {
      if (cancelled || !context) return;
      const size = canvas.width;
      const scale =
        Math.min(size / image.naturalWidth, size / image.naturalHeight) *
        (usesTikTokPalette ? 0.9 : 1);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      const x = (size - width) / 2;
      const y = (size - height) / 2;

      context.clearRect(0, 0, size, size);

      const drawTintedLayer = (color: string, offsetX = 0, offsetY = 0) => {
        const layer = document.createElement("canvas");
        layer.width = size;
        layer.height = size;
        const layerContext = layer.getContext("2d");
        if (!layerContext) return;

        layerContext.drawImage(image, x + offsetX, y + offsetY, width, height);
        layerContext.globalCompositeOperation = "source-in";
        layerContext.fillStyle = color;
        layerContext.fillRect(0, 0, size, size);
        context.drawImage(layer, 0, 0);
      };

      if (usesTikTokPalette) {
        drawTintedLayer("#25f4ee", -2, -1);
        drawTintedLayer("#fe2c55", 2, 1);
        drawTintedLayer("#ffffff");
      } else {
        drawTintedLayer(brandColor);
      }
    };
    image.onerror = () => {
      if (!cancelled) setIconFailed(true);
    };
    image.src = iconUrl;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [brandColor, link?.icon, usesTikTokPalette]);

  if (link?.icon && !iconFailed) {
    return (
      <canvas
        ref={canvasRef}
        width={64}
        height={64}
        aria-hidden="true"
        className={className}
      />
    );
  }

  const FallbackIcon =
    fallback === "play" ? PlayCircleIcon : fallback === "book" ? BookOpenIcon : LinkIcon;
  return <FallbackIcon className={className} style={{ color: brandColor }} />;
}

function getStreamingEpisodeNumber(episode: StreamingEpisode) {
  const match = episode.title?.match(/\bEpisode\s+(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function LinksSection({
  streamingEpisodes,
  externalLinks,
  mediaType,
  progress,
}: {
  streamingEpisodes: StreamingEpisode[];
  externalLinks: ExternalLink[];
  mediaType: MediaType;
  progress: number | null;
}) {
  const [showAllEpisodes, setShowAllEpisodes] = useState(false);
  const isManga = mediaType === "MANGA";
  const streamingLinks = externalLinks.filter(
    (link) => link.type?.toUpperCase() === "STREAMING"
  );
  const supportingLinks = externalLinks.filter(
    (link) => link.type?.toUpperCase() !== "STREAMING"
  );
  const providerKeys = new Set<string>();
  const providers = streamingLinks.reduce<
    Array<{ site: string; link: ExternalLink | null; episodes: StreamingEpisode[] }>
  >((items, link) => {
    const site = link.site?.trim() || "Streaming provider";
    const key = site.toLocaleLowerCase();
    if (providerKeys.has(key)) return items;
    providerKeys.add(key);
    items.push({
      site,
      link,
      episodes: streamingEpisodes.filter(
        (episode) => episode.site?.trim().toLocaleLowerCase() === key
      ),
    });
    return items;
  }, []);

  streamingEpisodes.forEach((episode) => {
    const site = episode.site?.trim() || "Streaming provider";
    const key = site.toLocaleLowerCase();
    if (providerKeys.has(key)) return;
    providerKeys.add(key);
    providers.push({
      site,
      link: null,
      episodes: streamingEpisodes.filter(
        (candidate) => candidate.site?.trim().toLocaleLowerCase() === key
      ),
    });
  });

  const nextEpisodeNumber =
    typeof progress === "number" && progress >= 0 ? progress + 1 : null;
  const nextEpisodeIndex =
    nextEpisodeNumber === null
      ? -1
      : streamingEpisodes.findIndex(
          (episode) => getStreamingEpisodeNumber(episode) === nextEpisodeNumber
        );
  const collapsedEpisodeStart =
    nextEpisodeIndex >= 0
      ? Math.min(nextEpisodeIndex, Math.max(0, streamingEpisodes.length - 4))
      : 0;
  const visibleEpisodes = showAllEpisodes
    ? streamingEpisodes
    : streamingEpisodes.slice(collapsedEpisodeStart, collapsedEpisodeStart + 4);

  return (
    <ContentSection title={isManga ? "Read & Links" : "Watch & Links"} icon={LinkIcon}>
      <div className="space-y-5">
        {providers.length > 0 && (
          <div>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-white/80">
                  {isManga ? "Where to read" : "Where to watch"}
                </h3>
                <p className="mt-1 text-xs text-white/40">
                  Availability and languages vary by region. Provider links are supplied by AniList.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {providers.map((provider) => {
                const destination =
                  provider.link?.url || provider.episodes[0]?.url || undefined;
                return (
                  <a
                    key={`provider-${provider.site}`}
                    href={destination}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex min-w-0 items-center gap-3 rounded-3xl border border-white/10 bg-white/3 p-3 transition hover:border-white/20 hover:bg-white/8"
                  >
                    <div
                      className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/8"
                      style={getLinkIconSurfaceStyle(
                        provider.site,
                        provider.link?.color
                      )}
                    >
                      <BrandedLinkIcon
                        link={provider.link}
                        site={provider.site}
                        className="h-6 w-6 opacity-80"
                        fallback={isManga ? "book" : "play"}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white/85">
                        {provider.site}
                      </p>
                      <p className="mt-1 truncate text-xs text-white/45">
                        {isManga
                          ? "Read online"
                          : formatEnum(provider.link?.type || "STREAMING")}
                        {isManga && provider.link?.language
                          ? ` · ${provider.link.language}`
                          : ""}
                        {provider.episodes.length > 0 &&
                          ` · ${provider.episodes.length} ${
                            provider.episodes.length === 1 ? "episode" : "episodes"
                          } listed`}
                      </p>
                    </div>
                    <ArrowTopRightOnSquareIcon className="h-4 w-4 shrink-0 text-white/25 transition group-hover:text-white/60" />
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {!isManga && streamingEpisodes.length > 0 && (
          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white/80">Streaming episodes</h3>
                <p className="mt-1 text-xs text-white/40">
                  {collapsedEpisodeStart > 0 && !showAllEpisodes
                    ? "Showing what comes next from your list progress."
                    : "Direct episode links shared by the listed provider."}
                </p>
              </div>
              {streamingEpisodes.length > 4 && (
                <button
                  type="button"
                  onClick={() => setShowAllEpisodes((current) => !current)}
                  className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/60 transition hover:bg-white/10 hover:text-white/85"
                  aria-expanded={showAllEpisodes}
                >
                  {showAllEpisodes ? "Show less" : `Show all ${streamingEpisodes.length}`}
                  <ChevronDownIcon
                    className={`h-3.5 w-3.5 transition ${
                      showAllEpisodes ? "rotate-180" : ""
                    }`}
                  />
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {visibleEpisodes.map((episode, index) => {
                const episodeNumber = getStreamingEpisodeNumber(episode);
                const isUpNext =
                  nextEpisodeNumber !== null && episodeNumber === nextEpisodeNumber;
                return (
                  <a
                    key={`stream-${episode.url ?? index}`}
                    href={episode.url ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className={`group flex min-w-0 gap-3 rounded-3xl border bg-white/3 p-3 transition hover:bg-white/8 ${
                      isUpNext ? "border-[var(--app-accent)]/45" : "border-white/10"
                    }`}
                  >
                    <div className="h-16 w-24 shrink-0 overflow-hidden rounded-2xl bg-white/5">
                      {episode.thumbnail ? (
                        <img
                          src={episode.thumbnail}
                          alt={episode.title ?? "Streaming episode"}
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-white/5">
                          <PlayCircleIcon className="h-6 w-6 text-white/25" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 self-center">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-white/85">
                          {episode.title || episode.site}
                        </p>
                        {isUpNext && (
                          <span className="shrink-0 rounded-full bg-[var(--app-accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--app-accent)]">
                            Up next
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-white/45">
                        {episode.site || "Streaming"}
                      </p>
                    </div>
                    <ArrowTopRightOnSquareIcon className="h-4 w-4 shrink-0 self-center text-white/20 transition group-hover:text-white/60" />
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {supportingLinks.length > 0 && (
          <div>
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-white/80">More official links</h3>
              <p className="mt-1 text-xs text-white/40">
                {isManga
                  ? "Official sites, publisher pages, and social profiles."
                  : "Official sites, video channels, and social profiles."}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {supportingLinks.map((link, index) => (
                <a
                  key={`external-${link.id ?? link.url ?? index}`}
                  href={link.url ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center gap-3 rounded-3xl border border-white/10 bg-white/3 p-3 transition hover:border-white/20 hover:bg-white/8"
                >
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/8"
                    style={getLinkIconSurfaceStyle(link.site, link.color)}
                  >
                    <BrandedLinkIcon
                      link={link}
                      site={link.site}
                      className="h-5 w-5 opacity-80"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white/85">
                      {link.site || "External link"}
                    </p>
                    <p className="mt-1 truncate text-xs text-white/45">
                      {formatEnum(link.type || "INFO")}
                      {link.language ? ` · ${link.language}` : ""}
                    </p>
                  </div>
                  <ArrowTopRightOnSquareIcon className="h-4 w-4 shrink-0 text-white/20 transition group-hover:text-white/60" />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </ContentSection>
  );
}

function PersonImage({
  src,
  name,
  size = "normal",
}: {
  src?: string | null;
  name: string;
  size?: "normal" | "large";
}) {
  const className =
    size === "large"
      ? "h-52 w-36 rounded-3xl"
      : "h-16 w-12 rounded-2xl";

  return (
    <div className={`${className} shrink-0 overflow-hidden bg-white/5`}>
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full bg-white/5" />
      )}
    </div>
  );
}

function TrailerPanel({
  trailer,
  trailerUrl,
}: {
  trailer?: { id?: string | null; site?: string | null; thumbnail?: string | null } | null;
  trailerUrl: string | null;
}) {
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  if (!trailer?.thumbnail && !trailerUrl) return null;

  const embedUrl = getTrailerEmbedUrl(trailer);

  return (
    <>
      <div className="group overflow-hidden rounded-3xl border border-white/10 bg-white/3 transition hover:border-white/18 focus-within:border-white/18">
      {trailer?.thumbnail ? (
        <div className="relative aspect-video overflow-hidden bg-white/5">
          <img
            src={trailer.thumbnail}
            alt="Trailer thumbnail"
            className="h-full w-full object-cover opacity-80 transition-[filter,transform,opacity] duration-300 group-hover:scale-[1.025] group-hover:blur-[3px] group-hover:opacity-55 group-focus-within:scale-[1.025] group-focus-within:blur-[3px] group-focus-within:opacity-55"
          />
          <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/75 via-black/5 to-transparent transition group-hover:bg-black/30 group-focus-within:bg-black/30" />
          <div className="pointer-events-none absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-xs font-medium text-white/85 backdrop-blur transition group-hover:opacity-0 group-focus-within:opacity-0">
            <PlayCircleIcon className="h-4 w-4" />
            Trailer
          </div>

          {trailerUrl && (
            <div className="absolute inset-0 flex items-center justify-center gap-3 bg-black/10 opacity-0 transition duration-300 group-hover:opacity-100 group-focus-within:opacity-100">
              {embedUrl && (
                <Tooltip content="Play trailer in Seenary">
                <button
                  type="button"
                  onClick={() => setIsPlayerOpen(true)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white/85 shadow-xl backdrop-blur-md transition hover:scale-110 hover:bg-(--app-accent) hover:text-black focus:outline-none focus:ring-2 focus:ring-white/60"
                  aria-label="Play trailer in Seenary"
                >
                  <PlayCircleIcon className="h-6 w-6" />
                </button>
                </Tooltip>
              )}
              <Tooltip content="Open trailer in browser">
              <a
                href={trailerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white/85 shadow-xl backdrop-blur-md transition hover:scale-110 hover:bg-white hover:text-black focus:outline-none focus:ring-2 focus:ring-white/60"
                aria-label="Open trailer in browser"
              >
                <ArrowTopRightOnSquareIcon className="h-5 w-5" />
              </a>
              </Tooltip>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
          <PlayCircleIcon className="h-5 w-5 text-white/55" />
          <span className="text-sm font-medium text-white/80">Trailer</span>
          </div>
          {trailerUrl && (
            <div className="flex items-center gap-2">
              {embedUrl && (
                <Tooltip content="Play trailer in Seenary">
                <button
                  type="button"
                  onClick={() => setIsPlayerOpen(true)}
                  className="rounded-full border border-white/10 bg-white/[0.05] p-2 text-white/65 transition hover:bg-(--app-accent) hover:text-black"
                  aria-label="Play trailer in Seenary"
                >
                  <PlayCircleIcon className="h-5 w-5" />
                </button>
                </Tooltip>
              )}
              <Tooltip content="Open trailer in browser">
              <a
                href={trailerUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-white/10 bg-white/[0.05] p-2 text-white/65 transition hover:bg-white hover:text-black"
                aria-label="Open trailer in browser"
              >
                <ArrowTopRightOnSquareIcon className="h-5 w-5" />
              </a>
              </Tooltip>
            </div>
          )}
        </div>
      )}

      {trailer?.site && (
        <div className="px-4 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-white/35">
            {trailer.site}
          </p>
        </div>
      )}
      </div>

      {isPlayerOpen && embedUrl && trailerUrl && (
        <TrailerPlayerModal
          embedUrl={embedUrl}
          externalUrl={trailerUrl}
          provider={trailer?.site || "Trailer"}
          onClose={() => setIsPlayerOpen(false)}
        />
      )}
    </>
  );
}

function TrailerPlayerModal({
  embedUrl,
  externalUrl,
  provider,
  onClose,
}: {
  embedUrl: string;
  externalUrl: string;
  provider: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center overflow-y-auto rounded-3xl bg-black/82 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Trailer player"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/12 bg-[#0d0d0d] shadow-2xl sm:max-h-[calc(100dvh-2.5rem)]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-white">Trailer</p>
            <p className="mt-0.5 text-xs uppercase tracking-[0.16em] text-white/35">
              {provider}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip content="Open in browser">
            <a
              href={externalUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/10 bg-white/[0.05] p-2.5 text-white/65 transition hover:bg-white hover:text-black focus:outline-none focus:ring-2 focus:ring-white/60"
              aria-label="Open trailer in browser"
            >
              <ArrowTopRightOnSquareIcon className="h-5 w-5" />
            </a>
            </Tooltip>
            <Tooltip content="Close trailer">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/[0.05] p-2.5 text-white/65 transition hover:bg-white/12 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/60"
              aria-label="Close trailer"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
            </Tooltip>
          </div>
        </div>
        <div className="aspect-video min-h-0 w-full shrink bg-black">
          <iframe
            src={embedUrl}
            title="Anime trailer"
            className="h-full w-full border-0"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      </section>
    </div>,
    document.body
  );
}

function SideFacts({
  score,
  meanScore,
  popularity,
  favourites,
  duration,
  source,
  countryOfOrigin,
  startDate,
  endDate,
  season,
  seasonYear,
  format,
  animeStatus,
  mediaType,
  chapters,
  volumes,
}: {
  score: number | null;
  meanScore: number | null;
  popularity: number | null;
  favourites: number | null;
  duration: number | null;
  source?: string | null;
  countryOfOrigin?: string | null;
  startDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  endDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  season?: string | null;
  seasonYear?: number | null;
  format?: string | null;
  animeStatus?: string | null;
  mediaType: MediaType;
  chapters: number | null;
  volumes: number | null;
}) {
  const isManga = mediaType === "MANGA";
  const isUpcoming = animeStatus === "NOT_YET_RELEASED";
  const hasDistinctEndDate = Boolean(endDate && !areMediaDatesEqual(startDate, endDate));
  const facts = [
    score ? { label: "Community", value: `${score}%`, icon: StarIcon } : null,
    meanScore ? { label: "Mean", value: `${meanScore}%`, icon: StarIcon } : null,
    popularity
      ? { label: "Popularity", value: formatNumber(popularity), icon: UsersIcon }
      : null,
    favourites
      ? { label: "Favourites", value: formatNumber(favourites), icon: HeartIcon }
      : null,
    !isManga && duration ? { label: "Duration", value: `${duration} min`, icon: ClockIcon } : null,
    isManga && chapters
      ? { label: "Chapters", value: formatNumber(chapters), icon: DocumentTextIcon }
      : null,
    isManga && volumes
      ? { label: "Volumes", value: formatNumber(volumes), icon: BookmarkIcon }
      : null,
    source ? { label: "Source", value: formatEnum(source), icon: BookmarkIcon } : null,
    countryOfOrigin
      ? { label: "Country", value: countryOfOrigin, icon: TagIcon }
      : null,
    startDate
      ? {
          label: isUpcoming
            ? isManga
              ? "Publication"
              : "Premiere"
            : isManga
              ? "Published"
              : "Start",
          value: formatFuzzyDate(startDate),
          icon: CalendarDaysIcon,
        }
      : null,
    endDate && (!isUpcoming || hasDistinctEndDate)
      ? {
          label: isUpcoming ? "Expected end" : isManga ? "Last published" : "End",
          value: formatFuzzyDate(endDate),
          icon: CalendarDaysIcon,
        }
      : null,
    !isManga && season && seasonYear
      ? {
          label: "Season",
          value: `${formatEnum(season)} ${seasonYear}`,
          icon: CalendarDaysIcon,
        }
      : null,
    format ? { label: "Format", value: formatMediaFormat(format), icon: isManga ? BookmarkIcon : TvIcon } : null,
    animeStatus
      ? {
          label: isManga ? "Publishing" : "Airing",
          value: getMediaStatusLabel(animeStatus, mediaType),
          icon: CheckCircleIcon,
        }
      : null,
  ].filter(Boolean) as MetaItem[];

  if (!facts.length) return null;

  return (
    <aside className="rounded-3xl border border-white/10 bg-white/3 p-5">
      <p className="text-xs uppercase tracking-[0.22em] text-white/35">
        Quick facts
      </p>
      <div className="mt-4 space-y-3">
        {facts.map((fact) => {
          const Icon = fact.icon;
          return (
            <div
              key={`${fact.label}-${fact.value}`}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3"
            >
              <Icon className="h-4 w-4 text-white/45" />
              <div className="min-w-0">
                <p className="text-xs text-white/35">{fact.label}</p>
                <p className="truncate text-sm font-medium text-white/75">
                  {fact.value}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  active = false,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <button
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`no-drag px-5 py-3 transition-transform duration-300 ease-out hover:scale-110 disabled:opacity-50 disabled:hover:scale-100 ${
          active
            ? "text-(--app-accent)"
            : "text-white/80 hover:text-white"
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function ActionDivider() {
  return <div className="h-6 w-px bg-white/10" />;
}

function formatProgress(
  progress: number,
  totalEpisodes: number | null,
  mediaType: MediaType = "ANIME"
) {
  const unit = mediaType === "MANGA" ? "ch" : "eps";
  if (totalEpisodes && totalEpisodes > 0) {
    return `${progress} / ${totalEpisodes} ${unit}`;
  }

  return `${progress} ${unit}`;
}

function getPersonalStatusLabel(status: ListEntry["status"], mediaType: MediaType) {
  return getListStatusLabel(status, mediaType);
}

function formatMediaFormat(value: string) {
  return value === "TV" || value === "TV_SHORT" ? value.replace("_", " ") : formatEnum(value);
}

function getPersonFromEdge(edge: PersonEdge, kind: PeopleModalItem["kind"]): Person {
  if (edge?.node) return edge.node;

  return {
    id: kind === "character" ? edge?.character_id : edge?.staff_id,
    name: {
      full: edge?.name_full,
      native: edge?.name_native,
      userPreferred: edge?.name_full,
    },
    image: {
      large: edge?.image_large,
    },
  };
}

function getVoiceActorFromEdge(edge: PersonEdge): Person | null {
  const voiceActor = edge?.voiceActors?.[0];
  if (voiceActor) return voiceActor;

  if (typeof edge?.voice_actors === "string") {
    try {
    return (JSON.parse(edge.voice_actors) as Person[])?.[0] ?? null;
    } catch {
      return null;
    }
  }

  if (Array.isArray(edge?.voice_actors)) {
    return edge.voice_actors[0] ?? null;
  }

  return null;
}

function buildPeopleModalItem({
  edge,
  kind,
  title,
  person,
  voiceActor,
}: {
  edge: PersonEdge;
  kind: PeopleModalItem["kind"];
  title: string;
  person: Person;
  voiceActor: Person | null;
}): PeopleModalItem {
  const name = getPersonName(person);
  const voiceActorName = voiceActor ? getPersonName(voiceActor) : null;

  return {
    id: Number(person?.id ?? edge?.character_id ?? edge?.staff_id) || null,
    kind,
    title,
    name,
    nativeName: person?.name?.native ?? null,
    image: person?.image?.large ?? null,
    role: edge?.role ?? null,
    voiceActor:
      kind === "character" && voiceActor && voiceActorName
        ? {
            name: voiceActorName,
            nativeName: voiceActor?.name?.native ?? null,
            image: voiceActor?.image?.large ?? null,
            language: voiceActor?.language ?? null,
          }
        : null,
  };
}

function getPersonDetailRequestKey(item: PeopleModalItem) {
  return `${item.kind}:${item.id ?? "local"}`;
}

async function preloadPersonImages(details: PersonDetails, item: PeopleModalItem) {
  const imageUrls = [
    details?.image?.large ?? item.image,
    item.voiceActor?.image,
  ].filter((url): url is string => Boolean(url));

  await Promise.all([...new Set(imageUrls)].map(preloadImage));
}

function preloadImage(src: string) {
  return new Promise<void>((resolve) => {
    const image = new Image();
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    image.onload = () => {
      if (typeof image.decode === "function") {
        image.decode().catch(() => undefined).finally(finish);
      } else {
        finish();
      }
    };
    image.onerror = finish;
    image.src = src;

    if (image.complete) finish();
  });
}

function buildPersonFacts(details: PersonDetails | null, kind: PeopleModalItem["kind"]) {
  if (!details) return [];

  const facts: Array<{ label: string; value: string }> = [];
  const birthday = formatPersonDate(details.dateOfBirth);
  const deathDate = formatPersonDate(details.dateOfDeath);

  if (birthday !== "-") facts.push({ label: "Birthday", value: birthday });
  if (kind === "staff" && deathDate !== "-") facts.push({ label: "Died", value: deathDate });
  if (details.age) {
    facts.push({
      label: kind === "character" ? "Initial age" : "Age",
      value: String(details.age),
    });
  }
  if (details.gender) facts.push({ label: "Gender", value: details.gender });
  if (kind === "character" && Array.isArray(details.name?.alternative)) {
    const aliases = details.name.alternative
      .map((alias: unknown) => String(alias || "").trim())
      .filter(Boolean)
      .slice(0, 3);

    if (aliases.length > 0) {
      facts.push({ label: "Also known as", value: aliases.join(", ") });
    }
  }
  if (details.languageV2) facts.push({ label: "Language", value: details.languageV2 });
  if (Array.isArray(details.primaryOccupations) && details.primaryOccupations.length > 0) {
    facts.push({
      label: "Work",
      value: details.primaryOccupations.slice(0, 3).join(", "),
    });
  }
  if (Array.isArray(details.yearsActive) && details.yearsActive.length > 0) {
    const activeYears = details.yearsActive.filter(
      (year): year is number => typeof year === "number" && year > 0
    );

    if (activeYears.length === 1) {
      facts.push({ label: "Active since", value: String(activeYears[0]) });
    } else if (activeYears.length > 1) {
      facts.push({ label: "Years active", value: activeYears.join(" - ") });
    }
  }
  if (details.homeTown) facts.push({ label: "Hometown", value: details.homeTown });
  if (details.bloodType) facts.push({ label: "Blood type", value: details.bloodType });
  return facts;
}

function parseAniListDescription(value?: string | null) {
  if (!value) return [];

  const normalized = normalizeAniListDescriptionText(value);
  const segments: Array<{ type: "text" | "spoiler"; text: string }> = [];
  const spoilerPattern = /~!(.*?)!~/gs;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = spoilerPattern.exec(normalized))) {
    const textBefore = normalized.slice(lastIndex, match.index).trim();
    const spoilerText = cleanDescriptionText(match[1]);

    if (textBefore) {
      segments.push({ type: "text", text: cleanDescriptionText(textBefore) });
    }

    if (spoilerText) {
      segments.push({ type: "spoiler", text: spoilerText });
    }

    lastIndex = match.index + match[0].length;
  }

  const textAfter = normalized.slice(lastIndex).trim();
  if (textAfter) {
    segments.push({ type: "text", text: cleanDescriptionText(textAfter) });
  }

  return segments.filter((segment) => segment.text);
}

function normalizeAniListDescriptionText(value: string) {
  return String(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "");
}

function cleanDescriptionText(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/_{2,}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatPersonDate(date?: {
  year?: number | null;
  month?: number | null;
  day?: number | null;
} | null) {
  if (!date?.year && !date?.month && !date?.day) return "-";

  const month =
    date.month && date.month >= 1 && date.month <= 12
      ? new Intl.DateTimeFormat(undefined, { month: "short" }).format(
          new Date(2000, date.month - 1, 1)
        )
      : null;

  if (month && date.day && date.year) return `${month} ${date.day}, ${date.year}`;
  if (month && date.day) return `${month} ${date.day}`;
  if (month && date.year) return `${month} ${date.year}`;
  if (month) return month;
  if (date.year) return String(date.year);
  if (date.day) return String(date.day);

  return "-";
}

function getRelationPriority(relationType?: string | null) {
  const priorities: Record<string, number> = {
    PREQUEL: 10,
    PARENT: 15,
    SOURCE: 20,
    ADAPTATION: 25,
    SEQUEL: 30,
    SIDE_STORY: 40,
    SPIN_OFF: 45,
    CHARACTER: 50,
    SUMMARY: 60,
    COMPILATION: 65,
    CONTAINS: 70,
    ALTERNATIVE: 80,
    OTHER: 90,
  };

  return priorities[relationType ?? ""] ?? 100;
}

function getRelatedMediaType(
  media: RelatedMedia | RecommendationMedia | null | undefined
): MediaType | null {
  if (media?.type === "ANIME" || media?.type === "MANGA") {
    return media.type;
  }

  const format = String(media?.format ?? "").toUpperCase();
  if (new Set(["TV", "TV_SHORT", "MOVIE", "OVA", "ONA", "SPECIAL", "MUSIC"]).has(format)) {
    return "ANIME";
  }
  if (new Set(["MANGA", "NOVEL", "ONE_SHOT"]).has(format)) {
    return "MANGA";
  }

  return null;
}

function getRelationDetails(relationType?: string | null): {
  label: string;
  cue: string;
  tone: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
} {
  switch (relationType) {
    case "PREQUEL":
      return {
        label: "Prequel",
        cue: "Comes before this title",
        tone: "border-sky-300/20 bg-sky-300/10 text-sky-100",
        icon: CalendarDaysIcon,
      };
    case "SEQUEL":
      return {
        label: "Sequel",
        cue: "Comes after this title",
        tone: "border-emerald-300/20 bg-emerald-300/10 text-emerald-100",
        icon: ArrowRightIcon,
      };
    case "ADAPTATION":
      return {
        label: "Adaptation",
        cue: "Same story in another format",
        tone: "border-violet-300/20 bg-violet-300/10 text-violet-100",
        icon: BookmarkIcon,
      };
    case "SOURCE":
      return {
        label: "Source",
        cue: "Original version",
        tone: "border-violet-300/20 bg-violet-300/10 text-violet-100",
        icon: BookmarkIcon,
      };
    case "SIDE_STORY":
      return {
        label: "Side story",
        cue: "Parallel or extra story",
        tone: "border-amber-300/20 bg-amber-300/10 text-amber-100",
        icon: LinkIcon,
      };
    case "SPIN_OFF":
      return {
        label: "Spin-off",
        cue: "Related branch",
        tone: "border-amber-300/20 bg-amber-300/10 text-amber-100",
        icon: LinkIcon,
      };
    case "SUMMARY":
      return {
        label: "Summary",
        cue: "Recap version",
        tone: "border-teal-300/20 bg-teal-300/10 text-teal-100",
        icon: CheckCircleIcon,
      };
    case "COMPILATION":
      return {
        label: "Compilation",
        cue: "Collected version",
        tone: "border-teal-300/20 bg-teal-300/10 text-teal-100",
        icon: CheckCircleIcon,
      };
    case "PARENT":
      return {
        label: "Parent story",
        cue: "Main entry",
        tone: "border-sky-300/20 bg-sky-300/10 text-sky-100",
        icon: LinkIcon,
      };
    case "CHARACTER":
      return {
        label: "Character",
        cue: "Shares characters",
        tone: "border-pink-300/20 bg-pink-300/10 text-pink-100",
        icon: UsersIcon,
      };
    case "ALTERNATIVE":
      return {
        label: "Alternative",
        cue: "Alternate version",
        tone: "border-orange-300/20 bg-orange-300/10 text-orange-100",
        icon: ArrowPathIcon,
      };
    case "CONTAINS":
      return {
        label: "Contains",
        cue: "Includes this story",
        tone: "border-teal-300/20 bg-teal-300/10 text-teal-100",
        icon: LinkIcon,
      };
    default:
      return {
        label: relationType ? formatEnum(relationType) : "Related",
        cue: "Connected title",
        tone: "border-white/10 bg-white/8 text-white/70",
        icon: LinkIcon,
      };
  }
}

function positiveNumberOrNull(value: number | null | undefined) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function getPlainText(html: string) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSafeDescriptionText(html: string) {
  if (typeof window === "undefined") return getPlainText(html);

  const parsed = new window.DOMParser().parseFromString(html, "text/html");
  for (const breakElement of parsed.querySelectorAll("br")) {
    breakElement.replaceWith("\n");
  }
  for (const blockElement of parsed.querySelectorAll("p, div")) {
    blockElement.append("\n");
  }

  return (parsed.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

function formatRuntime(totalMinutes: number) {
  const roundedMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  if (!hours) return `${minutes} min`;
  if (!minutes) return `${hours} hr`;

  return `${hours} hr ${minutes} min`;
}

function getSeriesTiming(
  date: { year?: number | null; month?: number | null; day?: number | null } | null,
  now: number
) {
  if (!date?.year) return null;

  const start = new Date(date.year, Math.max(0, (date.month ?? 1) - 1), date.day ?? 1);
  const difference = now - start.getTime();
  const future = difference < 0;
  const absoluteDays = Math.floor(Math.abs(difference) / 86_400_000);
  const span = formatCalendarSpan(absoluteDays);

  return future
    ? {
        label: "Premiere",
        value: span === "today" ? "Starts today" : `Starts in ${span}`,
        context: formatFuzzyDate(date),
      }
    : {
        label: "Series age",
        value: span === "today" ? "First aired today" : `First aired ${span} ago`,
        context: formatFuzzyDate(date),
      };
}

function getPublicationTiming(
  date: { year?: number | null; month?: number | null; day?: number | null } | null,
  now: number
) {
  const timing = getSeriesTiming(date, now);
  if (!timing) return null;

  if (timing.label === "Premiere") {
    return {
      label: "Publication",
      value: timing.value.replace("Starts", "Publishes"),
      context: timing.context,
    };
  }

  return {
    label: "Publication age",
    value: timing.value.replace("First aired", "First published"),
    context: timing.context,
  };
}

function getPublicationTotalPresentation(
  total: number | null,
  status: string | null,
  unit: "chapter" | "volume"
) {
  if (total) {
    return {
      value: formatNumber(total),
      context: `${total} ${total === 1 ? unit : `${unit}s`} published`,
    };
  }

  switch (status) {
    case "RELEASING":
      return {
        value: "Ongoing",
        context: `Final ${unit} total not announced`,
      };
    case "NOT_YET_RELEASED":
      return {
        value: "TBA",
        context: `${unit === "chapter" ? "Chapter" : "Volume"} total will be confirmed later`,
      };
    case "FINISHED":
      return {
        value: "Not listed",
        context: `AniList has no confirmed ${unit} total`,
      };
    case "HIATUS":
      return {
        value: "Unconfirmed",
        context: `No final ${unit} total while publication is on hiatus`,
      };
    case "CANCELLED":
      return {
        value: "Not listed",
        context: `No confirmed final ${unit} total`,
      };
    default:
      return {
        value: "Not listed",
        context: `AniList has no confirmed ${unit} total`,
      };
  }
}

function formatCalendarSpan(days: number) {
  if (days < 1) return "today";
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"}`;
  if (days < 60) {
    const weeks = Math.max(2, Math.round(days / 7));
    return `${weeks} weeks`;
  }
  if (days < 730) {
    const months = Math.max(2, Math.round(days / 30.44));
    return `${months} months`;
  }

  const years = Math.floor(days / 365.25);
  return `${years} years`;
}

function formatAiringCountdown(airingAt: number | null | undefined, now: number) {
  const timestamp = Number(airingAt) * 1000;
  if (!Number.isFinite(timestamp) || timestamp <= now) return null;

  const totalMinutes = Math.max(1, Math.ceil((timestamp - now) / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `In ${days}d ${hours}h`;
  if (hours > 0) return `In ${hours}h ${minutes}m`;
  return `In ${minutes}m`;
}

function summarizeDirectRelations(relations: RelatedAnimeEdge[]) {
  const animeFormats = new Set(["TV", "TV_SHORT", "MOVIE", "OVA", "ONA", "SPECIAL", "MUSIC"]);
  const relationCounts = new Map<string, number>();

  for (const edge of relations) {
    const format = String(edge.node?.format ?? "").toUpperCase();
    if (!animeFormats.has(format)) continue;

    const relation = String(edge.relationType ?? "RELATED").toUpperCase();
    relationCounts.set(relation, (relationCounts.get(relation) ?? 0) + 1);
  }

  const total = [...relationCounts.values()].reduce((sum, count) => sum + count, 0);
  if (!total) return null;

  const relationOrder = ["PREQUEL", "SEQUEL", "SIDE_STORY", "SPIN_OFF"];
  const entries = [...relationCounts.entries()].sort(([left], [right]) => {
    const leftIndex = relationOrder.indexOf(left);
    const rightIndex = relationOrder.indexOf(right);
    return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
  });
  const parts = entries.map(([relation, count]) => {
    const singular = getDirectRelationLabel(relation);
    const plural = getDirectRelationPlural(singular);
    return formatCount(count, singular, plural);
  });

  return { total, summary: parts.join(" · ") };
}

function getDirectRelationLabel(relation: string) {
  switch (relation) {
    case "PREQUEL":
      return "prequel";
    case "SEQUEL":
      return "sequel";
    case "SIDE_STORY":
      return "side story";
    case "SPIN_OFF":
      return "spin-off";
    case "SUMMARY":
      return "summary";
    case "COMPILATION":
      return "compilation";
    case "ALTERNATIVE":
      return "alternative";
    case "PARENT":
      return "parent title";
    case "CHARACTER":
      return "character connection";
    default:
      return "related title";
  }
}

function getDirectRelationPlural(label: string) {
  switch (label) {
    case "side story":
      return "side stories";
    case "summary":
      return "summaries";
    default:
      return `${label}s`;
  }
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  if (!count) return null;
  return `${count} ${count === 1 ? singular : plural}`;
}

function getMediaStatusLabel(status: string, mediaType: MediaType) {
  const isManga = mediaType === "MANGA";

  switch (status) {
    case "RELEASING":
      return isManga ? "Publishing" : "Still airing";
    case "FINISHED":
      return isManga ? "Finished publishing" : "Finished airing";
    case "NOT_YET_RELEASED":
      return isManga ? "Not yet published" : "Upcoming";
    case "CANCELLED":
      return "Cancelled";
    case "HIATUS":
      return "On hiatus";
    default:
      return formatEnum(status);
  }
}

function getAiringBadgeTone(status: string): HeroBadgeTone {
  if (status === "RELEASING") return "airing";
  if (status === "FINISHED") return "finished";
  return "upcoming";
}

function formatFuzzyDate(date: {
  year?: number | null;
  month?: number | null;
  day?: number | null;
}) {
  if (!date?.year) return "-";

  const parts = [date.year];

  if (date.month) {
    parts.push(date.month);
  }

  if (date.day) {
    parts.push(date.day);
  }

  return parts.join("-");
}

function areMediaDatesEqual(
  left?: { year?: number | null; month?: number | null; day?: number | null } | null,
  right?: { year?: number | null; month?: number | null; day?: number | null } | null
) {
  if (!left || !right) return false;

  return left.year === right.year && left.month === right.month && left.day === right.day;
}

function getPersonName(person: Person | null | undefined) {
  return (
    person?.name?.userPreferred ||
    person?.name?.full ||
    person?.name?.native ||
    "Unknown"
  );
}

function getMediaTitle(
  media: AnimeMedia | RecommendationMedia | RelatedMedia | null | undefined
) {
  return (
    media?.title?.userPreferred ||
    media?.title?.english ||
    media?.title?.romaji ||
    media?.title?.native ||
    "Unknown title"
  );
}

function getTrailerUrl(trailer?: {
  id?: string | null;
  site?: string | null;
} | null) {
  if (!trailer?.id || !trailer.site) return null;

  const site = trailer.site.toLowerCase();

  if (site === "youtube") {
    return `https://www.youtube.com/watch?v=${trailer.id}`;
  }

  if (site === "dailymotion") {
    return `https://www.dailymotion.com/video/${trailer.id}`;
  }

  return null;
}

function getTrailerEmbedUrl(trailer?: {
  id?: string | null;
  site?: string | null;
} | null) {
  if (!trailer?.id || !trailer.site) return null;

  const id = encodeURIComponent(trailer.id);
  const site = trailer.site.toLowerCase();

  if (site === "youtube") {
    return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
  }

  if (site === "dailymotion") {
    return `https://www.dailymotion.com/embed/video/${id}?autoplay=1`;
  }

  return null;
}
