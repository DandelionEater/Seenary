import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDownIcon, XMarkIcon } from '@heroicons/react/24/outline';
const cache = new Map<string, { names: string[]; savedAt: number }>();
const requests = new Map<string, Promise<string[]>>();
function loadGenres(safe: boolean, kind: "genres" | "tags") {
  const key = kind + ":" + safe;
  const saved = cache.get(key);
  if (saved && Date.now() - saved.savedAt < 86400000) return Promise.resolve(saved.names);
  if (!requests.has(key)) {
    requests.set(key, Promise.resolve().then(() => (kind === 'tags' ? window.api.getDiscoverTags(safe) : window.api.getDiscoverGenres(safe))).then(names => {
      if (!Array.isArray(names) || !names.length) throw new Error('Genre list unavailable.');
      const values = [...new Set(names.filter(name => typeof name === 'string' && name.trim()))].sort((a, b) => a.localeCompare(b));
      cache.set(key, { names: values, savedAt: Date.now() }); return values;
    }).finally(() => requests.delete(key)));
  }
  return requests.get(key)!;
}
export function DiscoverGenres({ initialGenres, hideAdultContent, disabled, onSelect, kind = "genres", selected, onChange, mode = "all", onModeChange }: {
  initialGenres: string[]; hideAdultContent: boolean; disabled: boolean; onSelect?: (genre: string) => void; kind?: "genres" | "tags"; selected?: string[]; onChange?: (values: string[]) => void; mode?: "all" | "any"; onModeChange?: (value: "all" | "any") => void;
}) {
  const [names, setNames] = useState(initialGenres);
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const controlled = selected !== undefined;
  useEffect(() => {
    let active = true;
    setLoading(true); setFailed(false);
    void loadGenres(hideAdultContent, kind).then(values => { if (active) setNames(values); })
      .catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [hideAdultContent, retry, kind]);
  const allNames = names.filter(name => kind !== 'genres' || !hideAdultContent || name !== 'Hentai');
  const visibleNames = allNames.filter(name => name.toLowerCase().includes(search.trim().toLowerCase()));
  const label = kind === 'tags' ? 'Tags' : 'Genres';
  const signature = visibleNames.join('|');
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    const measure = () => {
      const first = node.firstElementChild as HTMLElement | null;
      const last = node.lastElementChild as HTMLElement | null;
      setOverflow(Boolean(first && last && last.offsetTop > first.offsetTop + 1));
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, [signature, controlled]);
  return <div className="mt-3 border-t border-white/10 pt-3">
    <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-3"><p className="w-[49px] shrink-0 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30">{label}</p>
        <div className="relative w-36 sm:w-40">
          <input type="search" aria-label={'Search ' + kind} value={search} onChange={event => setSearch(event.target.value)} placeholder={'Search ' + kind + '...'} className="h-7 w-full rounded-lg border border-white/10 bg-black/20 pl-2.5 pr-7 text-xs text-white placeholder:text-white/35 outline-none focus:border-(--app-accent)/50 [&::-webkit-search-cancel-button]:appearance-none" />
          {search && <button type="button" aria-label={'Clear ' + kind + ' search'} onClick={() => { setSearch(''); list.current?.parentElement?.querySelector('input')?.focus(); }} className="absolute inset-y-0 right-1.5 flex items-center px-0.5 text-(--app-accent) hover:brightness-125 focus:outline-none">
            <XMarkIcon aria-hidden="true" className="h-3.5 w-3.5" />
          </button>}
        </div>
        {loading && <span role="status" className="text-xs text-white/35">Loading {kind}...</span>}
      </div>
      {selected && <div className="flex items-center gap-2">
        <span aria-hidden="true" className="h-3.5 w-px bg-white/15" />
        <span className="text-xs text-white/35">{selected.length ? selected.length + ' selected' : 'All'}</span>
      </div>}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
      {onModeChange && <div className="flex flex-wrap gap-1.5" aria-label={label + ' match rule'}>
        {([{value:'all',label:'Must include all'},{value:'any',label:'Must include at least one'}] as const).map(option => <button key={option.value} type="button" tabIndex={-1} disabled={disabled} aria-pressed={mode === option.value} onClick={() => onModeChange(option.value)}
          className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors focus:outline-none disabled:opacity-35 ${mode === option.value ? 'border-(--app-accent)/35 bg-(--app-accent-soft) text-white/85' : 'border-white/10 bg-white/5 text-white/45 hover:bg-white/10'}`}>{option.label}</button>)}
      </div>}
      {(overflow || expanded) && <>
      {onModeChange && <span aria-hidden="true" className="h-3.5 w-px bg-white/15" />}
      <button type="button" tabIndex={-1} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}
        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white focus:outline-none">
        {expanded ? 'Show less' : 'Show all (' + allNames.length + ')'}<ChevronDownIcon className={'h-3.5 w-3.5 transition-transform ' + (expanded ? 'rotate-180' : '')} />
      </button></>}
      </div>
    </div>
    <div ref={list} role="group" aria-label={kind === "tags" ? "Tag shortcuts" : "Genre shortcuts"} className="relative mt-2.5 flex flex-wrap gap-2 overflow-hidden" style={{ maxHeight: expanded ? undefined : 34 }}>
      {selected && <button type="button" tabIndex={-1} disabled={disabled} aria-pressed={!selected.length} onClick={() => onChange?.([])} className={`h-[34px] shrink-0 rounded-full border px-3.5 text-xs font-medium focus:outline-none disabled:opacity-35 ${!selected.length ? 'border-(--app-accent)/35 bg-(--app-accent-soft) text-white' : 'border-white/10 bg-white/5 text-white/60'}`}>All</button>}
      {visibleNames.map(name => <button key={name} type="button" tabIndex={-1} disabled={disabled} aria-pressed={selected?.includes(name)} onClick={() => selected ? onChange?.(selected.includes(name) ? selected.filter(value => value !== name) : [...selected, name]) : onSelect?.(name)}
        className={`h-[34px] shrink-0 whitespace-nowrap rounded-full border px-3.5 text-xs font-medium transition-colors hover:border-(--app-accent)/35 hover:bg-(--app-accent-soft) hover:text-white focus:outline-none disabled:cursor-default disabled:opacity-35 ${selected?.includes(name) ? "border-(--app-accent)/35 bg-(--app-accent-soft) text-white" : "border-white/10 bg-white/[0.04] text-white/62"}`}>{name}</button>)}
    </div>
    {!loading && !visibleNames.length && <p role="status" className="mt-2 text-xs text-white/40">No matching {kind}.</p>}
    {failed && <p role="status" className="mt-2 text-xs text-white/40">Could not load all {kind}. <button type="button" tabIndex={-1} onClick={() => setRetry(value => value + 1)} className="underline focus:outline-none">Retry</button></p>}
  </div>;
}
