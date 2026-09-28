export type WatchTitle = {
  id: number;
  type?: string | null;
  isAdult?: boolean;
  title?: { romaji?: string | null; english?: string | null; native?: string | null; userPreferred?: string | null } | null;
  coverImage?: { large?: string | null } | null;
  format?: string | null;
  status?: string | null;
  warning?: string;
  startDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  relations?: { edges?: Array<{ relationType?: string | null; node?: WatchTitle | null }> | null } | null;
};
const STORY_LINKS = new Set(['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'SUMMARY', 'ALTERNATIVE', 'SPIN_OFF', 'COMPILATION']);
export const WATCH_FORMATS = [
  { value: 'TV', label: 'TV' },
  { value: 'MOVIE', label: 'Movie' },
  { value: 'TV_SHORT', label: 'TV short' },
  { value: 'SPECIAL', label: 'Special' },
  { value: 'OVA', label: 'OVA' },
  { value: 'ONA', label: 'ONA' },
  { value: 'MUSIC', label: 'Music' },
  { value: 'UNKNOWN', label: 'Other / unknown' },
];
export function filterWatchTitles(titles: WatchTitle[], formats: string[]) {
  return titles.filter(title => formats.includes(
    WATCH_FORMATS.some(format => format.value === title.format) ? title.format! : 'UNKNOWN',
  ));
}

export async function collectWatchTitles(seed: WatchTitle, fetchTitle: (id: number) => Promise<WatchTitle>,
  { signal, hideAdultContent = false, onProgress }: {
    signal?: AbortSignal; hideAdultContent?: boolean; onProgress?: (count: number, titles: WatchTitle[]) => void;
  } = {}) {
  const titles = new Map<number, WatchTitle>();
  const queue = [seed];
  const queued = new Set([seed.id]);
  const visited = new Set<number>();
  let incomplete = false;
  async function visit(node: WatchTitle) {
    signal?.throwIfAborted();
    if (visited.has(node.id) || (hideAdultContent && node.isAdult)) return;
    visited.add(node.id);
    let details = node;
    try {
      if (node.id !== seed.id) details = await fetchTitle(node.id);
      signal?.throwIfAborted();
      if (details.id !== node.id || (details.type && details.type !== 'ANIME')) {
        incomplete = true;
        return;
      }
      if (hideAdultContent && details.isAdult) return;
      if (details.warning || !details.relations) incomplete = true;
    } catch {
      signal?.throwIfAborted();
      incomplete = true;
      // Do not display or follow unverified responses from failed requests.
      return;
    }
    titles.set(node.id, details);
    for (const edge of details.relations?.edges || []) {
      const related = edge.node;
      if (!STORY_LINKS.has(edge.relationType || '') || related?.type !== 'ANIME' || !Number.isInteger(related.id) || related.id <= 0) continue;
      if (!queued.has(related.id)) {
        queued.add(related.id);
        queue.push(related);
      }
    }
    onProgress?.(titles.size, [...titles.values()]);
  }
  while (queue.length) {
    signal?.throwIfAborted();
    // Atlas cache hits can load together; provider misses remain paced by the server.
    await Promise.all(queue.splice(0, 4).map(visit));
  }
  return { titles: [...titles.values()], incomplete };
}

export function sortWatchTitles(titles: WatchTitle[], now = new Date()) {
  const dated: WatchTitle[] = [], unknown: WatchTitle[] = [], upcoming: WatchTitle[] = [];
  const today = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  for (const title of new Map(titles.map(title => [title.id, title])).values()) {
    const date = title.startDate;
    if (title.status === 'NOT_YET_RELEASED' || (date?.year && dateKey(title) > today)) upcoming.push(title);
    else if (!date?.year) unknown.push(title);
    else dated.push(title);
  }
  const compare = (a: WatchTitle, b: WatchTitle) => dateKey(a) - dateKey(b) || a.id - b.id;
  dated.sort(compare); upcoming.sort(compare); unknown.sort((a, b) => a.id - b.id);
  return { dated, unknown, upcoming };
}
function dateKey(title: WatchTitle) {
  return (title.startDate?.year || 9999) * 10000 + (title.startDate?.month || 1) * 100 + (title.startDate?.day || 1);
}
