import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  BuildingOffice2Icon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import type {
  SearchMedia,
  StudioCatalogResult,
  TrackedMediaEntry,
} from "../types/domain";
import type { TitleLanguage } from "../utils/titlePreference";
import { ResultsGrid } from "./ResultsGrid";

type StudioCatalogPageProps = {
  studio: { id: number; name: string };
  hideAdultContent: boolean;
  trackedEntries: TrackedMediaEntry[];
  titleLanguage: TitleLanguage;
  onBack: () => void;
  onSelectMedia: (id: number) => void;
  onQuickAdd: (media: SearchMedia) => void;
  onEditEntry: (entry: TrackedMediaEntry) => void;
};

export function StudioCatalogPage({
  studio,
  hideAdultContent,
  trackedEntries,
  titleLanguage,
  onBack,
  onSelectMedia,
  onQuickAdd,
  onEditEntry,
}: StudioCatalogPageProps) {
  const [catalog, setCatalog] = useState<StudioCatalogResult | null>(null);
  const [items, setItems] = useState<StudioCatalogResult["items"]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const loadPage = useCallback(
    async (page: number, append: boolean) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setError(null);
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const result = await window.api.getStudioMedia(
          studio.id,
          page,
          hideAdultContent
        );
        if (requestIdRef.current !== requestId) return;

        setCatalog(result);
        setItems((current) => {
          const merged = append ? [...current, ...result.items] : result.items;
          return Array.from(
            new Map(merged.map((item) => [item.media.id, item])).values()
          );
        });
      } catch (loadError) {
        if (requestIdRef.current !== requestId) return;
        setError(
          loadError instanceof Error && loadError.message
            ? loadError.message
            : `Could not load ${studio.name}'s Anime.`
        );
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [hideAdultContent, studio.id, studio.name]
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
        if (entries[0]?.isIntersecting) {
          void loadPage(nextPage, true);
        }
      },
      { rootMargin: "600px 0px" }
    );

    observer.observe(target);

    return () => observer.disconnect();
  }, [error, hasNextPage, loadPage, loading, loadingMore, nextPage]);

  const displayName = catalog?.studio.name || studio.name;
  const media = items.map((item) => item.media);

  return (
    <div
      data-global-scroll-root
      className="scroll-container h-full overflow-y-auto px-6 pb-10 pt-24 text-white"
    >
      <div className="mx-auto w-full max-w-6xl">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/65 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/55"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back
        </button>

        <header className="mt-6 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] p-6 shadow-xl">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-300/20 bg-emerald-400/10 text-emerald-100">
              <BuildingOffice2Icon className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
                {catalog?.studio.isAnimationStudio === false
                  ? "Production company"
                  : "Animation studio"}
              </p>
              <h1 className="mt-1 truncate text-2xl font-semibold">{displayName}</h1>
              <p className="mt-2 text-sm text-white/45">
                Anime AniList credits to this studio, ordered by popularity.
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
            Loading studio catalog...
          </div>
        ) : error && !items.length ? (
          <section className="mt-8 rounded-3xl border border-rose-300/15 bg-rose-400/[0.06] p-6 text-center">
            <ExclamationTriangleIcon className="mx-auto h-7 w-7 text-rose-200/70" />
            <h2 className="mt-3 font-semibold">Could not load this studio</h2>
            <p className="mt-2 text-sm text-white/50">{error}</p>
            <button
              type="button"
              onClick={() => void loadPage(1, false)}
              className="mt-5 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              Retry
            </button>
          </section>
        ) : (
          <section className="mt-10">
            <div className="mb-5 flex items-center justify-between gap-3 border-b border-white/10 pb-4">
              <h2 className="text-lg font-semibold">Anime</h2>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/50">
                {media.length} loaded
              </span>
            </div>

            {media.length ? (
              <ResultsGrid
                results={media}
                onSelectMedia={onSelectMedia}
                trackedEntries={trackedEntries}
                onQuickAdd={onQuickAdd}
                onEditEntry={onEditEntry}
                titleLanguage={titleLanguage}
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.025] px-5 py-10 text-center text-sm text-white/40">
                No visible Anime were found on this page.
              </div>
            )}

            {error && items.length > 0 && (
              <p className="mt-5 text-center text-sm text-rose-200/65">{error}</p>
            )}

            {hasNextPage && (
              <div ref={loadMoreRef} className="mt-8 flex justify-center py-4">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void loadPage(nextPage, true)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-3 text-sm font-medium text-white/70 transition hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-55"
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
