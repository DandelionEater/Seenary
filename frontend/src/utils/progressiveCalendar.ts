import type { ReleaseCalendarResult } from '../types/domain';

export async function loadCalendarPages(
  fetchPage: (page: number) => Promise<ReleaseCalendarResult>,
  publish: (result: ReleaseCalendarResult) => void,
  isCancelled: () => boolean,
) {
  const items = new Map<string, ReleaseCalendarResult['items'][number]>();
  const warnings = new Set<string>();
  for (let page = 1; page <= 5 && !isCancelled(); page++) {
    const result = await fetchPage(page);
    if (isCancelled()) return;
    for (const item of result.items) {
      const key = `${item.media.id}:${item.airingAt ?? JSON.stringify(item.date)}:${item.episode ?? ''}`;
      items.set(key, item);
    }
    if (result.warning) warnings.add(result.warning);
    publish({ ...result, items: [...items.values()], warning: [...warnings].join(' ') || undefined });
    if (!result.hasNextPage) break;
  }
}
