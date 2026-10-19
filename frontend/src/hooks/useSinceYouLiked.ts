import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaType } from '../types/domain';
import { recommendationPairKey } from '../types/sinceYouLiked';
import type { RecommendationFeedback, RecommendationPair, RecommendationPairState } from '../types/sinceYouLiked';

// The section is keyed by account and medium so responses and optimistic state
// cannot cross accounts or leak from Anime into Manga.
export function useSinceYouLiked(mediaType: MediaType, pairs: RecommendationPair[], librarySignature = '') {
  const [state, setState] = useState<Record<string, RecommendationPairState>>({});
  const [hidden, setHidden] = useState<number[]>([]);
  const [votes, setVotes] = useState<Record<string, RecommendationFeedback>>({});
  const [hiddenOverrides, setHiddenOverrides] = useState<Record<number, boolean>>({});
  const [added, setAdded] = useState<number[]>([]);
  const [retained, setRetained] = useState<number[]>([]);
  const [resolved, setResolved] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const alive = useRef(true);
  const signature = JSON.stringify(pairs);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const requested = JSON.parse(signature) as RecommendationPair[];
      const combined: Record<string, RecommendationPairState> = {};
      let hiddenIds: number[] = [];
      let retainedIds: number[] = [];
      let resolvedIds: number[] = [];
      for (let i = 0; i < Math.max(1, requested.length); i += 80) {
        const result = await window.api.getSinceYouLikedState({ mediaType, pairs: requested.slice(i, i + 80) });
        if (cancelled) return;
        if (!result.ok) throw new Error(result.message || 'Unable to load recommendation feedback.');
        for (const pair of result.pairs ?? []) combined[recommendationPairKey(pair)] = pair;
        hiddenIds = result.hiddenMediaIds ?? [];
        retainedIds = result.retainedMediaIds ?? [];
        resolvedIds = result.resolvedMediaIds ?? [];
      }
      if (!cancelled) { setState(combined); setHidden(hiddenIds); setRetained(retainedIds); setResolved(resolvedIds); setLoaded(true); setError(null); }
    }
    void load().catch(() => { if (!cancelled) setError('Could not load your recommendation choices. Try again.'); });
    const timer = window.setInterval(() => { void load().catch(() => { /* Keep the last successful state during a transient outage. */ }); }, 60000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [mediaType, signature, retry, librarySignature]);
  const track = useCallback(async (visible: RecommendationPair[]) => {
    if (!visible.length) return;
    try {
      const result = await window.api.getSinceYouLikedState({ mediaType, pairs: visible, track: true });
      if (alive.current && result.ok) { setRetained(result.retainedMediaIds ?? []); setResolved(result.resolvedMediaIds ?? []); }
    } catch { /* Tracking can retry on the next refresh. */ }
  }, [mediaType]);

  async function perform(key: string, task: () => Promise<void>) {
    if (pendingRef.current.has(key)) return;
    pendingRef.current.add(key); setPending(new Set(pendingRef.current)); setError(null);
    try { await task(); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : 'Unable to save. Try again.'); }
    finally { pendingRef.current.delete(key); if (alive.current) setPending(new Set(pendingRef.current)); }
  }

  function feedback(pair: RecommendationPair, value: RecommendationFeedback) {
    const key = recommendationPairKey(pair);
    void perform(key, async () => {
      const previous = Object.hasOwn(votes, key) ? votes[key] : state[key]?.sinceYouLikedFeedback ?? null;
      setVotes(current => ({ ...current, [key]: value }));
      try {
        const result = await window.api.setSinceYouLikedFeedback({ mediaType, ...pair, feedback: value });
        if (!result.ok) throw new Error(result.message || 'Unable to save your reaction. Try again.');
        // Refresh global weights separately; a failed refresh must not undo a saved vote.
        if (alive.current) setRetry(current => current + 1);
      } catch (failure) {
        if (alive.current) setVotes(current => ({ ...current, [key]: previous }));
        throw failure;
      }
    });
  }

  function hide(mediaId: number, value: boolean) {
    void perform(`hide:${mediaId}`, async () => {
      const previous = hiddenOverrides[mediaId] ?? hidden.includes(mediaId);
      setHiddenOverrides(current => ({ ...current, [mediaId]: value }));
      try {
        const result = await window.api.setSinceYouLikedHidden({ mediaType, mediaId, hidden: value });
        if (!result.ok) throw new Error(result.message || 'Unable to save Not Interested. Try again.');
      } catch (failure) {
        if (alive.current) setHiddenOverrides(current => ({ ...current, [mediaId]: previous }));
        throw failure;
      }
    });
  }

  function add(mediaId: number) {
    void perform(`add:${mediaId}`, async () => {
      // Only set status on a genuinely new entry; preserve progress if another
      // view/device already added it while this recommendation was visible.
      const existing = mediaType === 'MANGA' ? await window.api.getMyMangaListEntry(mediaId) : await window.api.getMyListEntry(mediaId);
      if (!alive.current) return;
      if (!existing.ok) throw new Error(existing.message || 'Unable to check your library. Try again.');
      if (!existing.entry) {
        const result = mediaType === 'MANGA'
          ? await window.api.saveMyMangaListEntry(mediaId, { status: 'planned' })
          : await window.api.saveMyListEntry(mediaId, { status: 'planned' });
        if (!result.ok) throw new Error(result.message || 'Unable to add to your library. Try again.');
      }
      if (alive.current) setAdded(current => [...current, mediaId]);
    });
  }

  return { state, loaded, error, pending, feedback, hide, add, track, retainedIds: new Set(retained), addedIds: new Set(added), retry: () => setRetry(current => current + 1),
    vote: (pair: RecommendationPair) => { const key = recommendationPairKey(pair); return Object.hasOwn(votes, key) ? votes[key] : state[key]?.sinceYouLikedFeedback ?? null; },
    hiddenIds: new Set([...hidden.filter(id => hiddenOverrides[id] !== false),
      ...Object.entries(hiddenOverrides).filter(([, value]) => value).map(([id]) => Number(id)), ...resolved,
      ...Object.entries(votes).filter(([, value]) => value !== null).map(([key]) => Number(key.split(':')[1]))]),
  };
}
