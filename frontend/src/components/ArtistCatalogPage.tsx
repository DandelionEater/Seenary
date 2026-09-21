import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  MusicalNoteIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
} from "@heroicons/react/24/outline";
import type { ArtistCatalogResult } from "../types/domain";
import type { TitleLanguage } from "../utils/titlePreference";
import { SongSearchCard } from "./SongSearchCard";

type ArtistCatalogPageProps = {
  artist: { id: number; slug: string; name: string };
  hideAdultContent: boolean;
  titleLanguage: TitleLanguage;
  previewVolume: number;
  onPreviewVolumeChange: (volume: number) => void;
  onBack: () => void;
  onSelectMedia: (id: number, type: "ANIME" | "MANGA") => void;
};

export function ArtistCatalogPage({
  artist,
  hideAdultContent,
  titleLanguage,
  previewVolume,
  onPreviewVolumeChange,
  onBack,
  onSelectMedia,
}: ArtistCatalogPageProps) {
  const [catalog, setCatalog] = useState<ArtistCatalogResult | null>(null);
  const [items, setItems] = useState<ArtistCatalogResult["items"]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const loadPage = useCallback(
    async (page: number, append: boolean) => {
      const requestId = ++requestIdRef.current;
      setError(null);
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const result = await window.api.getArtistMedia(
          artist.slug,
          page,
          hideAdultContent
        );
        if (requestIdRef.current !== requestId) return;
        setCatalog(result);
        setItems((current) => {
          const merged = append ? [...current, ...result.items] : result.items;
          return Array.from(
            new Map(
              merged.map((item) => [
                `${item.song.id}:${item.theme.id}:${item.media.id}`,
                item,
              ])
            ).values()
          );
        });
      } catch (loadError) {
        if (requestIdRef.current !== requestId) return;
        setError(
          loadError instanceof Error && loadError.message
            ? loadError.message
            : `Could not load ${artist.name}'s themes.`
        );
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [artist.name, artist.slug, hideAdultContent]
  );

  useEffect(() => {
    setCatalog(null);
    setItems([]);
    void loadPage(1, false);
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadPage]);

  const hasNextPage = Boolean(catalog?.pageInfo.hasNextPage);
  const nextPage = (catalog?.pageInfo.currentPage || 1) + 1;

  useEffect(() => {
    if (!hasNextPage || loading || loadingMore || error) return;
    const target = loadMoreRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadPage(nextPage, true);
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [error, hasNextPage, loadPage, loading, loadingMore, nextPage]);

  const displayName = catalog?.artist.name || artist.name;

  return (
    <div
      data-global-scroll-root
      className="scroll-container h-full overflow-y-auto px-6 pb-10 pt-24 text-white"
    >
      <div className="mx-auto w-full max-w-6xl">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/65 transition hover:bg-white/10 hover:text-white"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back
        </button>

        <header className="mt-6 rounded-3xl border border-white/10 bg-white/[0.035] p-6 shadow-xl">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-fuchsia-300/20 bg-fuchsia-400/10 text-fuchsia-100">
              <MusicalNoteIcon className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
                Theme artist
              </p>
              <h1 className="mt-1 text-2xl font-semibold">{displayName}</h1>
              <p className="mt-2 text-sm text-white/45">
                Opening and ending performances from AnimeThemes.
              </p>
            </div>
          </div>
        </header>

        {catalog?.warning && (
          <p role="status" className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            {catalog.warning}
          </p>
        )}

        {loading ? (
          <div className="flex min-h-72 items-center justify-center text-white/55">
            <ArrowPathIcon className="mr-3 h-5 w-5 animate-spin" />
            Loading artist themes...
          </div>
        ) : error && !items.length ? (
          <section className="mt-8 rounded-3xl border border-rose-300/15 bg-rose-400/[0.06] p-6 text-center">
            <ExclamationTriangleIcon className="mx-auto h-7 w-7 text-rose-200/70" />
            <h2 className="mt-3 font-semibold">Could not load this artist</h2>
            <p className="mt-2 text-sm text-white/50">{error}</p>
            <button
              type="button"
              onClick={() => void loadPage(1, false)}
              className="mt-5 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70"
            >
              Retry
            </button>
          </section>
        ) : (
          <section className="mt-10">
            <div className="mb-5 flex items-center justify-between gap-3 border-b border-white/10 pb-4">
              <h2 className="text-lg font-semibold">Theme performances</h2>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <label className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-white/55">
                  {previewVolume === 0 ? (
                    <SpeakerXMarkIcon className="h-4 w-4 shrink-0" />
                  ) : (
                    <SpeakerWaveIcon className="h-4 w-4 shrink-0" />
                  )}
                  <span className="sr-only">Theme preview volume</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={Math.round(previewVolume * 100)}
                    onChange={(event) =>
                      onPreviewVolumeChange(
                        Math.min(1, Math.max(0, Number(event.target.value) / 100))
                      )
                    }
                    className="h-1 w-20 cursor-pointer accent-fuchsia-300"
                    aria-label="Theme preview volume"
                  />
                  <span className="w-8 text-right text-[10px] font-semibold tabular-nums">
                    {Math.round(previewVolume * 100)}%
                  </span>
                </label>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/50">
                  {items.length} loaded
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {items.map((item) => (
                <SongSearchCard
                  key={`${item.song.id}:${item.theme.id}:${item.media.id}`}
                  result={item}
                  matchKind="artist"
                  onSelectMedia={onSelectMedia}
                  titleLanguage={titleLanguage}
                  previewVolume={previewVolume}
                />
              ))}
            </div>

            {error && <p className="mt-5 text-center text-sm text-rose-200/65">{error}</p>}
            {hasNextPage && (
              <div ref={loadMoreRef} className="mt-8 flex justify-center py-4">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void loadPage(nextPage, true)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-3 text-sm font-medium text-white/70 disabled:cursor-wait disabled:opacity-55"
                >
                  {loadingMore && <ArrowPathIcon className="h-4 w-4 animate-spin" />}
                  {loadingMore ? "Loading..." : `Load more from ${displayName}`}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
