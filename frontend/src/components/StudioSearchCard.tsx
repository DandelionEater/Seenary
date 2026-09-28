import type { StudioSearchResult } from "../types/domain";
import { getPreferredTitle, type TitleLanguage } from "../utils/titlePreference";

type StudioSearchCardProps = {
  result: StudioSearchResult;
  onSelectMedia: (id: number, type: StudioSearchResult["media"]["type"]) => void;
  titleLanguage: TitleLanguage;
};

export function StudioSearchCard({
  result,
  onSelectMedia,
  titleLanguage,
}: StudioSearchCardProps) {
  const mediaTitle = getPreferredTitle(result.media.title, titleLanguage);
  const creditLabel = result.isMainStudio ? "Main studio for" : "Worked on";

  return (
    <div
      className="browse-search-card group relative cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/60"
      role="button"
      aria-label={`Open Anime ${mediaTitle}, matched by studio ${result.studio.name}`}
      onClick={() => onSelectMedia(result.media.id, result.media.type)}
    >
      <div className="browse-search-poster relative aspect-2/3 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
        <img
          src={result.media.coverImage.large}
          alt={mediaTitle}
          className="h-full w-full object-cover transition-all duration-300 group-hover:scale-[1.02] group-hover:brightness-50 group-hover:blur-[2px]"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-gradient-to-b from-black/80 via-black/35 to-transparent"
        />
        <div className="absolute left-2 top-2 z-20 rounded-lg border border-emerald-300/20 bg-emerald-400/15 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-100 backdrop-blur-sm">
          Studio
        </div>
        <div className="absolute right-2 top-2 z-20 rounded-lg border border-amber-300/20 bg-amber-400/15 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-amber-100 backdrop-blur-sm">
          Anime
        </div>

        <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black via-black/80 to-transparent px-3 pb-3 pt-16">
          <p className="line-clamp-2 text-sm font-semibold text-white">{result.studio.name}</p>
          <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-white/45">
            {creditLabel}
          </p>
          <p className="mt-0.5 line-clamp-2 text-xs text-white/80">{mediaTitle}</p>
        </div>
      </div>

      <div className="browse-search-gallery-info hidden pt-3">
        <p className="line-clamp-2 text-sm font-semibold text-white">{result.studio.name}</p>
        <p className="mt-1 line-clamp-2 text-xs text-white/45">
          {creditLabel} {mediaTitle}
        </p>
      </div>
    </div>
  );
}
