export type TitleLanguage = "userPreferred" | "english" | "romaji" | "native";

const TITLE_LANGUAGE_KEY = "seenary:titleLanguage";

export function isTitleLanguage(value: unknown): value is TitleLanguage {
  return value === "userPreferred" || value === "english" || value === "romaji" || value === "native";
}

export function saveTitleLanguage(language: unknown) {
  if (isTitleLanguage(language)) localStorage.setItem(TITLE_LANGUAGE_KEY, language);
}

export function readTitleLanguage(legacyLanguage?: unknown): TitleLanguage {
  const saved = localStorage.getItem(TITLE_LANGUAGE_KEY);
  if (isTitleLanguage(saved)) return saved;
  if (isTitleLanguage(legacyLanguage)) {
    saveTitleLanguage(legacyLanguage);
    return legacyLanguage;
  }
  return "userPreferred";
}

export type MediaTitles = {
  userPreferred?: string | null;
  english?: string | null;
  romaji?: string | null;
  native?: string | null;
};

// Display-only exception for the provider's joined season suffix; saved metadata stays intact.
const DISPLAY_TITLE_CORRECTIONS: Record<string, string> = {
  "The Angel Next Door Spoils Me Rotten2": "The Angel Next Door Spoils Me Rotten Season 2",
};

// AniList synonyms are unlabelled. Require a unique candidate with English
// cues, since Latin script alone also includes romaji and other languages.
const ENGLISH_TITLE_CUE = /\b(?:and|from|into|not|of|the|with|without|your)\b/i;

function getEnglishAlias(title: MediaTitles, synonyms: readonly string[]) {
  const normalize = (value: string) => value.replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
  const known = new Set(
    [title.romaji, title.native].filter((value): value is string => Boolean(value?.trim())).map(normalize)
  );
  const candidates = new Map<string, string>();
  for (const synonym of synonyms) {
    if (typeof synonym !== "string") continue;
    const normalized = normalize(synonym);
    if (known.has(normalized) || !/^[a-z0-9 ]+$/.test(normalized) ||
        normalized.split(" ").length < 2 || !ENGLISH_TITLE_CUE.test(normalized)) continue;
    candidates.set(normalized, synonym.trim());
  }
  return candidates.size === 1 ? candidates.values().next().value : undefined;
}

function displayTitle(value: string) {
  return Object.hasOwn(DISPLAY_TITLE_CORRECTIONS, value) ? DISPLAY_TITLE_CORRECTIONS[value] : value;
}

export function getAlternateTitles(title: MediaTitles | null | undefined, synonyms: string[], selected: string) {
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
  title: MediaTitles | null | undefined,
  titleLanguage: TitleLanguage,
  synonyms?: readonly string[] | null
) {
  if (!title) return "Unknown title";

  const orderedTitles = [
    title[titleLanguage],
    titleLanguage === "english" && !title.english?.trim() && synonyms ? getEnglishAlias(title, synonyms) : undefined,
    title.userPreferred,
    title.english,
    title.romaji,
    title.native,
  ];

  const selected = orderedTitles.find((value) => value?.trim()) || "Unknown title";
  return displayTitle(selected);
}
