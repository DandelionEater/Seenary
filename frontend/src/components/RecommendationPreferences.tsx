import { useEffect, useState } from 'react';
import { ArrowPathIcon, ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import type { RecommendationPreferenceItem } from '../types/sinceYouLiked';
import { getPreferredTitle, type TitleLanguage } from '../utils/titlePreference';

export function RecommendationPreferences({ titleLanguage, hideAdultContent, onCounts }: {
  titleLanguage: TitleLanguage; hideAdultContent: boolean; onCounts: (counts: { hidden: number; dislikes: number }) => void;
}) {
  const [kind, setKind] = useState<'hidden' | 'dislikes'>('hidden');
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [items, setItems] = useState<RecommendationPreferenceItem[]>([]);
  const [totals, setTotals] = useState({ hidden: 0, dislikes: 0 });
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void window.api.getRecommendationPreferences({ kind, page, hideAdultContent }).then(reply => {
      if (!active) return;
      if (!reply.ok) throw new Error(reply.message || 'Could not load your recommendation preferences.');
      const counts = reply.totals ?? { hidden: 0, dislikes: 0 };
      setItems(reply.items ?? []); setTotals(counts); onCounts(counts); setHasMore(reply.hasMore === true);
    }).catch(() => { if (active) setError('Could not load your recommendation preferences. Please try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [kind, page, retry, hideAdultContent, onCounts]);
  const key = (item: RecommendationPreferenceItem) => item.mediaType + ':' + (item.sourceMediaId ?? '') + ':' + item.mediaId;
  async function restore(item: RecommendationPreferenceItem) {
    if (busy) return;
    setBusy(key(item)); setError(''); setMessage('');
    try {
      const reply = kind === 'hidden'
        ? await window.api.setSinceYouLikedHidden({ mediaType: item.mediaType, mediaId: item.mediaId, hidden: false })
        : await window.api.setSinceYouLikedFeedback({ mediaType: item.mediaType, sourceMediaId: item.sourceMediaId!, recommendedMediaId: item.mediaId, feedback: null });
      if (!reply.ok) throw new Error('Could not save this change.');
      setMessage(kind === 'hidden' ? 'Restored to your recommendation choices. Titles marked Dropped stay excluded until you change their library status.' : 'Dislike removed. This suggestion can appear again.');
      setPage(0); setRetry(value => value + 1);
    } catch { setError('Could not save this change. Please try again.'); }
    finally { setBusy(null); }
  }
  function switchKind(value: 'hidden' | 'dislikes') { if (busy || kind === value) return; setLoading(true); setItems([]); setKind(value); setPage(0); setMessage(''); }
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2">
      {([{ value: 'hidden', label: 'Not Interested' }, { value: 'dislikes', label: 'Dislikes' }] as const).map(tab => (
        <button key={tab.value} type="button" tabIndex={-1} disabled={!!busy} aria-pressed={kind === tab.value} onClick={() => switchKind(tab.value)}
          className={`rounded-2xl border px-4 py-2.5 text-sm font-semibold transition focus:outline-none disabled:opacity-40 ${kind === tab.value ? 'border-[var(--app-accent)]/40 bg-[var(--app-accent-soft)] text-white' : 'border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/5'}`}>
          {tab.label} <span className="ml-2 text-xs text-white/40">{totals[tab.value]}</span>
        </button>
      ))}
    </div>
    <p className="text-sm leading-6 text-white/45">{kind === 'hidden'
      ? 'Titles hidden from your Since You Liked suggestions, including those you marked Dropped. Restoring does not change your library status.'
      : 'Dislikes belong to a favorite and its suggestion. Removing a dislike clears that reaction without changing your favorites, scores, or library.'}</p>
    {message && <p role="status" className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/65">{message}</p>}
    {error && <p role="alert" className="text-sm text-rose-200">{error} <button type="button" tabIndex={-1} disabled={!!busy} onClick={() => setRetry(value => value + 1)} className="underline focus:outline-none">Retry</button></p>}
    {loading ? <p role="status" className="py-6 text-sm text-white/45">Loading your choices...</p> : !error && !items.length ? <p className="rounded-3xl border border-dashed border-white/10 px-5 py-8 text-sm text-white/45">{kind === 'hidden' ? 'No titles marked Not Interested.' : 'No disliked suggestions.'}</p> : !error && (
      <div className="space-y-3">{items.map(item => {
        const fallback = (item.mediaType === 'MANGA' ? 'Manga' : 'Anime') + ' #' + item.mediaId;
        const title = item.media?.title ? getPreferredTitle(item.media.title, titleLanguage) : fallback;
        const source = item.source?.title ? getPreferredTitle(item.source.title, titleLanguage) : (item.mediaType === 'MANGA' ? 'Manga' : 'Anime') + ' #' + item.sourceMediaId;
        return <div key={key(item)} className="flex flex-wrap items-center gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          {item.media?.coverImage?.large && <img src={item.media.coverImage.large} alt="" className="h-20 w-14 shrink-0 rounded-xl object-cover" />}
          <div className="min-w-0 flex-1 basis-40"><p className="text-[10px] font-semibold uppercase tracking-wider text-white/35">{item.mediaType === 'MANGA' ? 'Manga' : 'Anime'}</p>
            {kind === 'dislikes' && <p className="mt-1 break-words text-xs text-white/45">Because you liked: {source}</p>}
            <p className="mt-1 break-words text-sm font-semibold text-white">{title}</p>
            {!item.media && <p className="mt-1 text-xs text-white/35">Title details are unavailable or hidden by your content filter.</p>}
          </div>
          <button type="button" tabIndex={-1} disabled={!!busy || loading} onClick={() => void restore(item)}
            className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 focus:outline-none disabled:opacity-40">
            {busy === key(item) ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <ArrowUturnLeftIcon className="h-4 w-4" />}{kind === 'hidden' ? 'Restore' : 'Remove dislike'}
          </button>
        </div>;
      })}</div>
    )}
    {!loading && !error && (page > 0 || hasMore) && <div className="flex items-center justify-between gap-3">
      <button type="button" tabIndex={-1} disabled={page === 0 || !!busy} onClick={() => setPage(value => value - 1)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/65 focus:outline-none disabled:opacity-30">Previous</button>
      <span className="text-xs text-white/40">Page {page + 1}</span>
      <button type="button" tabIndex={-1} disabled={!hasMore || !!busy} onClick={() => setPage(value => value + 1)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/65 focus:outline-none disabled:opacity-30">Next</button>
    </div>}
  </div>;
}
