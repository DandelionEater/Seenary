import type { ReleaseReminderGroups } from '../utils/releaseReminderSettings';
import { useCallback, useEffect, useRef, useState } from 'react';
import { atlasEndpoint } from '../cloud/config';
import { loadCalendarPages } from '../utils/progressiveCalendar';
import { collectReleaseReminders, eligibleReminderEntries, reminderTitle, type ReleaseNotice, type ReminderEntry } from '../utils/releaseReminders';
import type { ReleaseCalendarResult } from '../types/domain';
import type { TitleLanguage } from '../utils/titlePreference';

export function useReleaseReminders({ accountId, enabled, groups, entries, language, hideAdult, onOpen, onHistory }: {
  accountId: number | null; enabled: boolean; groups: ReleaseReminderGroups; entries: ReminderEntry[]; language: TitleLanguage; hideAdult: boolean;
  onOpen: (id: number, type: 'ANIME' | 'MANGA') => void; onHistory: (notice: ReleaseNotice) => void;
}) {
  const [notice, setNotice] = useState<ReleaseNotice | null>(null);
  const [releases, setReleases] = useState<ReleaseCalendarResult['items']>([]);
  const current = useRef({ entries, language, onOpen, onHistory });
  current.current = { entries, language, onOpen, onHistory };
  const queue = useRef<ReleaseNotice[]>([]);
  const showing = useRef(false);
  const seen = useRef<Record<string, number>>({});
  const storageKey = accountId === null ? '' : `seenary-release-reminders:${atlasEndpoint}:${accountId}`;
  const dismiss = useCallback(() => { setNotice(null); showing.current = false; }, []);
  const deliver = useCallback(async (next: ReleaseNotice) => {
    showing.current = true;
    if (window.desktopReleaseNotifications) {
      try { const reply = await window.desktopReleaseNotifications.show(next); if (reply.ok) { window.setTimeout(() => { showing.current = false; }, 11000); return; } } catch { /* Browser fallback. */ }
    }
    setNotice(next);
  }, []);
  useEffect(() => {
    queue.current = []; showing.current = false; setNotice(null); setReleases([]);
    void window.desktopReleaseNotifications?.clear().catch(() => { /* Main process may need a restart after a development update. */ });
    try { const stored = JSON.parse(localStorage.getItem(storageKey) || '{}'); seen.current = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}; } catch { seen.current = {}; }
    return () => { queue.current = []; showing.current = false; void window.desktopReleaseNotifications?.clear(); };
  }, [storageKey, enabled]);
  const eligibleTypes = [...new Set(eligibleReminderEntries(entries).map(entry => entry.media_type === 'MANGA' ? 'MANGA' : 'ANIME'))].sort().join(',');
  useEffect(() => {
    if (!enabled || accountId === null || !eligibleTypes) return;
    let cancelled = false;
    let running = false;
    async function refresh() {
      if (running || cancelled) return;
      running = true;
      const fetched: ReleaseCalendarResult['items'] = [];
      try {
        // Stable UTC window shares backend cache across users; no per-title lookups.
        const start = Math.floor(Date.now() / 86400000) * 86400;
        for (const type of eligibleTypes.split(',') as Array<'ANIME' | 'MANGA'>) {
          await loadCalendarPages(page => window.api.getReleaseCalendar(start, start + 2 * 86400, hideAdult, type, page), result => {
            const other = fetched.filter(item => type === 'ANIME' ? !item.airingAt : !item.date);
            fetched.splice(0, fetched.length, ...other, ...result.items);
            if (!cancelled) setReleases([...fetched]);
          }, () => cancelled);
        }
      } catch { /* Previously known schedules remain usable. */ }
      finally { running = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30 * 60000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [accountId, eligibleTypes, enabled, hideAdult]);
  useEffect(() => {
    if (!enabled || accountId === null) return;
    function check() {
      const now = Date.now();
      for (const next of collectReleaseReminders(current.current.entries, releases, current.current.language, now, [60, 0], groups)) {
        if (seen.current[next.key]) continue;
        seen.current[next.key] = now; queue.current.push(next); current.current.onHistory(next);
      }
      seen.current = Object.fromEntries(Object.entries(seen.current).filter(([, time]) => now - time < 14 * 86400000).slice(-500));
      try { localStorage.setItem(storageKey, JSON.stringify(seen.current)); } catch { /* In-memory deduplication remains. */ }
      if (!showing.current && queue.current.length) void deliver(queue.current.shift()!);
    }
    check();
    if (window.desktopReleaseNotifications?.onTick) return window.desktopReleaseNotifications.onTick(check);
    const timer = window.setInterval(check, 30000);
    return () => window.clearInterval(timer);
  }, [accountId, enabled, storageKey, releases, deliver, groups]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(dismiss, 10000); return () => window.clearTimeout(timer); }, [notice, dismiss]);
  useEffect(() => window.desktopReleaseNotifications?.onOpen(payload => current.current.onOpen(payload.id, payload.type)), []);
  const test = useCallback((kind: 'episode' | 'premiere' | 'finale' = 'episode') => {
    if (!enabled || !__APP_VERSION__.endsWith('-dev')) return;
    const candidates = eligibleReminderEntries(current.current.entries).filter(entry => kind === 'episode' || entry.media_type !== 'MANGA');
    const entry = candidates[Math.floor(Math.random() * candidates.length)];
    const samples = [
      { english: 'Frieren: Beyond Journey’s End', romaji: 'Sousou no Frieren', native: '葬送のフリーレン' },
      { english: 'The 100 Girlfriends Who Really, Really, Really, Really, REALLY Love You', romaji: 'Kimi no Koto ga Dai Dai Dai Dai Daisuki na 100-nin no Kanojo', native: '君のことが大大大大大好きな100人の彼女' },
      { english: '86 EIGHTY-SIX', romaji: '86', native: '８６―エイティシックス―' },
    ];
    const sample = samples[Math.floor(Math.random() * samples.length)];
    const manga = entry?.media_type === 'MANGA';
    const next: ReleaseNotice = { key: `preview:${Date.now()}`, id: entry ? manga ? entry.manga_id : entry.anime_id : 0, type: manga ? 'MANGA' : 'ANIME',
      title: entry ? reminderTitle(entry, current.current.language) : sample[current.current.language === 'userPreferred' ? 'english' : current.current.language],
      message: kind === 'premiere' ? 'Starts airing in 15 minutes.' : kind === 'finale' ? 'Just finished airing.' : manga ? 'Publication date begins tomorrow. Exact chapter release times are unavailable.' : 'Episode 3 airs in 15 minutes.', cover: entry?.cover_image_large, preview: true };
    void deliver(next);
  }, [deliver, enabled]);
  return { notice, dismiss, test, open: () => { if (notice?.id) onOpen(notice.id, notice.type); dismiss(); } };
}
