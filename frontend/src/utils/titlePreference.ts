export type TitleLanguage = "userPreferred" | "english" | "romaji" | "native";

type AnimeTitle = {
  userPreferred?: string | null;
  english?: string | null;
  romaji?: string | null;
  native?: string | null;
};

// Display-only exception for the provider's joined season suffix; saved metadata stays intact.
const DISPLAY_TITLE_CORRECTIONS: Record<string, string> = {
  "The Angel Next Door Spoils Me Rotten2": "The Angel Next Door Spoils Me Rotten Season 2",
};

function displayTitle(value: string) {
  return Object.hasOwn(DISPLAY_TITLE_CORRECTIONS, value) ? DISPLAY_TITLE_CORRECTIONS[value] : value;
}

export function getAlternateTitles(title: AnimeTitle | null | undefined, synonyms: string[], selected: string) {
  const seen = new Set([displayTitle(selected.trim()).toLocaleLowerCase()]);
  return [title?.english, title?.romaji, title?.native, ...synonyms]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(value => displayTitle(value.trim()))
    .filter(value => {
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function getPreferredTitle(
  title: AnimeTitle | null | undefined,
  titleLanguage: TitleLanguage
) {
  if (!title) return "Unknown title";

  const orderedTitles = [
    title[titleLanguage],
    title.userPreferred,
    title.english,
    title.romaji,
    title.native,
  ];

  const selected = orderedTitles.find((value) => value?.trim()) || "Unknown title";
  return displayTitle(selected);
}
