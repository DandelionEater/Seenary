import type { CharacterSearchResult } from "../types/domain";
import { getPreferredTitle, type TitleLanguage } from "../utils/titlePreference";

type CharacterSearchCardProps = {
  result: CharacterSearchResult;
  onSelectMedia: (id: number, type: CharacterSearchResult["media"]["type"]) => void;
  titleLanguage: TitleLanguage;
};

export function CharacterSearchCard({
  result,
  onSelectMedia,
  titleLanguage,
}: CharacterSearchCardProps) {
  const characterName =
    result.character.name?.userPreferred ||
    result.character.name?.full ||
    result.character.name?.native ||
    "Unknown character";
  const mediaTitle = getPreferredTitle(result.media.title, titleLanguage);
  const destinationLabel = result.media.type === "MANGA" ? "Manga" : "Anime";
  const portrait = result.character.image?.large;

  return (
    <div
      className="browse-search-card group relative cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/60"
      role="button"
      aria-label={`Open ${destinationLabel} ${mediaTitle}, matched by character ${characterName}`}
      onClick={() => onSelectMedia(result.media.id, result.media.type)}
    >
      <div className="browse-search-poster relative aspect-2/3 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
        {portrait ? (
          <img
            src={portrait}
            alt={characterName}
            className="h-full w-full object-cover transition-all duration-300 group-hover:scale-[1.02] group-hover:brightness-50 group-hover:blur-[2px]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-white/35">
            No character portrait
          </div>
        )}

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-gradient-to-b from-black/80 via-black/35 to-transparent"
        />
        <div className="absolute left-2 top-2 z-20 rounded-lg border border-violet-300/20 bg-violet-400/15 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-violet-100 backdrop-blur-sm">
          Character
        </div>
        <div
          className={`absolute right-2 top-2 z-20 rounded-lg border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] backdrop-blur-sm ${
            result.media.type === "MANGA"
              ? "border-cyan-300/20 bg-cyan-400/15 text-cyan-100"
              : "border-amber-300/20 bg-amber-400/15 text-amber-100"
          }`}
        >
          {destinationLabel}
        </div>

        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black via-black/80 to-transparent px-3 pb-3 pt-16">
          <p className="line-clamp-2 text-sm font-semibold text-white">{characterName}</p>
          <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-white/45">
            From
          </p>
          <p className="mt-0.5 line-clamp-2 text-xs text-white/80">{mediaTitle}</p>
        </div>
      </div>

      <div className="browse-search-gallery-info hidden pt-3">
        <p className="line-clamp-2 text-sm font-semibold text-white">{characterName}</p>
        <p className="mt-1 line-clamp-2 text-xs text-white/45">
          From {mediaTitle} / {destinationLabel}
        </p>
      </div>
    </div>
  );
}
