import type { ReleaseReminderGroups, ReminderCategory } from './releaseReminderSettings';
import type { ReleaseCalendarResult, TrackedAnimeEntry, TrackedMangaEntry } from '../types/domain';
import { getPreferredTitle, type TitleLanguage } from './titlePreference';

export type ReleaseNotice = { key: string; id: number; type: 'ANIME' | 'MANGA'; title: string; message: string; cover?: string | null; preview?: boolean };
export type ReminderEntry = TrackedAnimeEntry | TrackedMangaEntry;
export function eligibleReminderEntries(entries: ReminderEntry[]) {
  return entries.filter(entry => (entry.status === 'watching' || entry.status === 'planned') && !entry.hidden_by_adult_filter);
}
export function reminderTitle(entry: ReminderEntry, language: TitleLanguage) {
  return getPreferredTitle({ userPreferred: entry.title_preferred, english: entry.title_english, romaji: entry.title_romaji, native: entry.title_native }, language);
}
export function collectReleaseReminders(entries: ReminderEntry[], releases: ReleaseCalendarResult['items'], language: TitleLanguage, now: number, timings: number[] = [60, 0], groups?: ReleaseReminderGroups) {
  const notices = new Map<string, ReleaseNotice>();
  for (const entry of eligibleReminderEntries(entries)) {
    const manga = entry.media_type === 'MANGA';
    const id = manga ? (entry as TrackedMangaEntry).manga_id : entry.anime_id;
    const upcoming = releases.filter(item => item.media.id === id && (manga ? Boolean(item.date) : Boolean(item.airingAt)));
    if (!manga && entry.next_airing_at && !upcoming.some(item => item.airingAt === entry.next_airing_at && item.episode === entry.next_airing_episode)) upcoming.push({ airingAt: entry.next_airing_at, episode: entry.next_airing_episode ?? undefined, media: { id, title: {}, coverImage: { large: '' } } });
    for (const release of upcoming) {
      const date = release.date;
      const time = manga && date?.year && date.month && date.day ? new Date(date.year, date.month - 1, date.day).getTime() : (release.airingAt ?? 0) * 1000;
      const difference = time - now;
      if (!time || !manga && release.episode && entry.progress >= release.episode) continue;
      const totalEpisodes = release.media.episodes ?? (!manga ? (entry as TrackedAnimeEntry).episodes : null);
      const isFinalEpisode = Boolean(totalEpisodes && release.episode === totalEpisodes);
      const category: ReminderCategory = manga ? 'manga' : isFinalEpisode ? 'finales' : release.episode === 1 ? 'premieres' : 'episodes';
      if (groups && !groups[category].enabled) continue;
      for (const minutes of new Set(groups ? groups[category].minutes : timings)) {
        if (![1440, 720, 360, 60, 30, 15, 0].includes(minutes)) continue;
        const elapsed = minutes * 60000 - difference;
        if (elapsed < 0 || elapsed > 120000) continue;
        const key = `${manga ? 'MANGA' : 'ANIME'}:${id}:${release.episode ?? 'publication'}:${time}:${minutes}`;
        const remaining = minutes === 1440 ? '1 day' : minutes === 60 ? '1 hour' : minutes < 60 ? `${minutes} minutes` : `${minutes / 60} hours`;
        const animeMessage = minutes === 0 && isFinalEpisode ? 'Just finished airing.'
          : release.episode === 1 ? minutes === 0 ? 'Just started airing.' : `Starts airing in ${remaining}.`
          : isFinalEpisode ? `Final episode airs in ${remaining}.`
          : `Episode ${release.episode ?? '?'} ${minutes === 0 ? 'is airing now' : `airs in ${remaining}`}.`;
        notices.set(key, { key, id, type: manga ? 'MANGA' : 'ANIME', title: reminderTitle(entry, language), cover: entry.cover_image_large,
          message: manga ? `${minutes === 0 ? 'Publication date begins today.' : `Publication date begins in ${remaining}.`} Exact chapter release times are unavailable.` : animeMessage });
      }
    }
  }
  return [...notices.values()];
}
