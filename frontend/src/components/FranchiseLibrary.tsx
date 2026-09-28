import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { PlayIcon, PlusIcon } from '@heroicons/react/24/outline';
import type { EditableListEntry, ListStatus, MediaType } from '../types/domain';
import { getListStatusLabel } from '../utils/mediaFormatting';
import { FranchiseStatusSelect } from './FranchiseStatusSelect';
import { Tooltip } from './ui/Tooltip';
import { franchiseStatusPayload } from '../utils/franchiseLibrary';

type LibraryState = { entries: Record<string, EditableListEntry>; ready: Partial<Record<MediaType, boolean>>;
  failed: Partial<Record<MediaType, boolean>>; busy: Set<string>; errors: Record<string, string>;
  change: (type: MediaType, id: number, status: ListStatus) => Promise<void>; retry: () => void };
const LibraryContext = createContext<LibraryState | null>(null);
const keyFor = (type: MediaType, id: number) => `${type}:${id}`;

export function FranchiseLibraryProvider({ children, onChanged }: {
  children: ReactNode; onChanged?: (id: number, type: MediaType) => void | Promise<void>;
}) {
  const [entries, setEntries] = useState<Record<string, EditableListEntry>>({});
  const [ready, setReady] = useState<LibraryState['ready']>({});
  const [failed, setFailed] = useState<LibraryState['failed']>({});
  const [busy, setBusy] = useState(new Set<string>());
  const locks = useRef(new Set<string>());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    setReady({}); setFailed({});
    for (const type of ['ANIME', 'MANGA'] as const) {
      const request = type === 'ANIME' ? window.api.getMyList() : window.api.getMyMangaList();
      void request.then(result => {
        if (!result.ok) throw new Error(result.message || 'Library unavailable');
        if (!current) return;
        const loaded: Record<string, EditableListEntry> = {};
        for (const entry of result.entries) {
          const identity = entry as { anime_id?: number; manga_id?: number };
          const id = type === 'ANIME' ? identity.anime_id : identity.manga_id;
          if (id == null || !Number.isSafeInteger(id)) continue;
          loaded[keyFor(type, id)] = entry;
        }
        setEntries(previous => ({ ...Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith(`${type}:`))), ...loaded }));
        setReady(previous => ({ ...previous, [type]: true }));
      }).catch(() => { if (current) setFailed(previous => ({ ...previous, [type]: true })); });
    }
    return () => { current = false; };
  }, [attempt]);
  async function change(type: MediaType, id: number, status: ListStatus) {
    const key = keyFor(type, id);
    if (!ready[type] || locks.current.has(key)) return;
    locks.current.add(key); setBusy(new Set(locks.current));
    setErrors(previous => ({ ...previous, [key]: '' }));
    try {
      // Read the current revision and preserve personal fields across both Atlas and legacy saves.
      const latest = type === 'ANIME' ? await window.api.getMyListEntry(id) : await window.api.getMyMangaListEntry(id);
      if (!latest.ok) throw new Error(latest.message || 'Unable to check library status.');
      const payload = franchiseStatusPayload(type, status, latest.entry);
      const saved = type === 'ANIME' ? await window.api.saveMyListEntry(id, payload) : await window.api.saveMyMangaListEntry(id, payload);
      if (!saved.ok) throw new Error(saved.message || 'Unable to save status.');
      if (mounted.current) setEntries(previous => ({ ...previous, [key]: saved.entry ?? { ...latest.entry, status, progress: latest.entry?.progress ?? 0, score: latest.entry?.score ?? null, notes: latest.entry?.notes ?? null } }));
      // A notification failure must not turn a successful save into a failed edit.
      try { await onChanged?.(id, type); } catch { /* The row already shows the saved result. */ }
    } catch (error) {
      if (mounted.current) setErrors(previous => ({ ...previous, [key]: error instanceof Error ? error.message : 'Unable to save status.' }));
    } finally {
      locks.current.delete(key);
      if (mounted.current) setBusy(new Set(locks.current));
    }
  }
  return <LibraryContext.Provider value={{ entries, ready, failed, busy, errors, change, retry: () => setAttempt(value => value + 1) }}>{children}</LibraryContext.Provider>;
}

const tones: Record<ListStatus, string> = {
  planned: 'border-violet-400/20 text-violet-200', watching: 'border-sky-400/25 text-sky-200',
  completed: 'border-emerald-400/20 text-emerald-200', paused: 'border-amber-400/20 text-amber-200', dropped: 'border-rose-400/20 text-rose-200',
};
export function FranchiseLibraryControls({ id, type, title }: { id: number; type: MediaType; title: string }) {
  const library = useContext(LibraryContext);
  if (!library) return null;
  const key = keyFor(type, id), entry = library.entries[key], busy = library.busy.has(key);
  return <div className="space-y-1.5">
    <div className="flex flex-wrap items-center gap-2">
      {!library.ready[type] ? <span className="text-[11px] text-white/35">{library.failed[type] ? <button type="button" onClick={library.retry} className="underline underline-offset-2">Library unavailable · Retry</button> : 'Checking library…'}</span>
        : entry ? <FranchiseStatusSelect value={entry.status} type={type} title={title} disabled={busy} tone={tones[entry.status]} onChange={status => void library.change(type, id, status)} /> : <>
          <span className="text-[11px] text-white/40">Not in library</span>
          <Tooltip content={type === 'ANIME' ? 'Add to Planned' : 'Plan to Read'}><button type="button" disabled={busy} onClick={() => void library.change(type, id, 'planned')} aria-label={`Add ${title} to ${getListStatusLabel('planned', type)}`} className="rounded-full border border-white/10 p-1.5 text-white/60 hover:bg-white/10 disabled:opacity-40"><PlusIcon className="h-3.5 w-3.5" /></button></Tooltip>
          <Tooltip content={type === 'ANIME' ? 'Start watching' : 'Start reading'}><button type="button" disabled={busy} onClick={() => void library.change(type, id, 'watching')} aria-label={`${type === 'ANIME' ? 'Start watching' : 'Start reading'} ${title}`} className="rounded-full border border-(--app-accent)/25 bg-(--app-accent-soft) p-1.5 text-white/70 hover:bg-white/10 disabled:opacity-40"><PlayIcon className="h-3.5 w-3.5" /></button></Tooltip>
        </>}
      {busy && <span role="status" className="text-[11px] text-white/35">Saving…</span>}
    </div>
    {library.errors[key] && <p role="alert" className="text-xs text-rose-200">{library.errors[key]}</p>}
  </div>;
}
