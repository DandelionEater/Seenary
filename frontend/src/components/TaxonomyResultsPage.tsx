import { useEffect, useState } from "react";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import type { MediaType, SearchMedia, TrackedMediaEntry } from "../types/domain";
import { createBrowseShelfId } from "../utils/discoverBrowseFilters";
import type { TitleLanguage } from "../utils/titlePreference";
import { ResultsGrid } from "./ResultsGrid";
import { AsyncStatePanel } from "./ui/AsyncStatePanel";

type Props = {
  kind: "genre" | "tag";
  name: string;
  mediaType: MediaType;
  hideAdultContent: boolean;
  trackedEntries: TrackedMediaEntry[];
  titleLanguage: TitleLanguage;
  onBack: () => void;
  onSelectMedia: (id: number) => void;
  onQuickAdd: (media: SearchMedia) => void;
  onEditEntry: (entry: TrackedMediaEntry) => void;
};

export default function TaxonomyResultsPage({
  kind, name, mediaType, hideAdultContent, trackedEntries, titleLanguage,
  onBack, onSelectMedia, onQuickAdd, onEditEntry,
}: Props) {
  const [items, setItems] = useState<SearchMedia[]>([]);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const shelfId = createBrowseShelfId({
    genres: kind === "genre" ? [name] : [], genreMode: "all",
    tags: kind === "tag" ? [name] : [], tagMode: "all", years: [], season: "any",
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void window.api.getDiscoverShelfAnime(shelfId, page, hideAdultContent, mediaType).then(result => {
      if (!active) return;
      const nextItems = (result.items ?? []).map(item => ({ ...item, type: mediaType }));
      setItems(current => [...new Map(
        [...(page === 1 ? [] : current), ...nextItems].map(item => [item.id, item])
      ).values()]);
      setHasMore(Boolean(result.pageInfo?.hasNextPage));
      setWarning(result.warning ?? null);
    }).catch(loadError => {
      if (!active) return;
      setError(loadError instanceof Error && loadError.message ? loadError.message : "Try again in a moment.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [shelfId, page, retry, hideAdultContent, mediaType]);

  return (
    <div data-global-scroll-root className="scroll-container h-full overflow-y-auto px-6 pb-8 pt-24">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="space-y-3 border-b border-white/10 pb-5">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-white/75 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent)">
            <ArrowLeftIcon className="h-4 w-4" />
            Back to title
          </button>
          <h1 className="text-3xl font-bold text-white">{name}</h1>
          <p className="text-sm text-white/55">{mediaType === "MANGA" ? "Manga" : "Anime"} by {kind}</p>
        </header>
        {warning && <p role="status" className="text-sm text-amber-100/80">{warning}</p>}
        {items.length > 0 && (
          <ResultsGrid results={items} trackedEntries={trackedEntries} titleLanguage={titleLanguage}
            onSelectMedia={onSelectMedia} onQuickAdd={onQuickAdd} onEditEntry={onEditEntry} />
        )}
        {error ? (
          <AsyncStatePanel title="Could not load results" message={error} actionLabel="Retry" onAction={() => setRetry(value => value + 1)} />
        ) : loading && !items.length ? (
          <AsyncStatePanel title="Finding matching titles…" busy compact />
        ) : !items.length && !hasMore ? (
          <AsyncStatePanel title="No matching titles" />
        ) : hasMore ? (
          <button type="button" disabled={loading} onClick={() => setPage(value => value + 1)}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/75 hover:bg-white/10 disabled:opacity-50">
            {loading ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
