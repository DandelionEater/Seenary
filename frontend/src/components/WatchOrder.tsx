import { useEffect, useRef, useState } from 'react';
import { ArrowPathIcon, CheckIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { Tooltip } from './ui/Tooltip';
import { FranchiseLibraryControls } from './FranchiseLibrary';
import { collectWatchTitles, filterWatchTitles, sortWatchTitles, WATCH_FORMATS, type WatchTitle } from '../utils/watchOrder';
import { getPreferredTitle, type TitleLanguage } from '../utils/titlePreference';

const FORMAT_STORAGE_KEY = 'seenary_watch_order_formats';
function savedFormats() {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(FORMAT_STORAGE_KEY) || 'null');
    if (Array.isArray(saved) && saved.every(value => typeof value === 'string' && WATCH_FORMATS.some(format => format.value === value))) return saved as string[];
  } catch { /* Storage is optional. */ }
  return WATCH_FORMATS.map(format => format.value);
}

export function WatchOrder({ seed, titleLanguage, hideAdultContent, onSelect }: {
  seed: WatchTitle; titleLanguage: TitleLanguage; hideAdultContent: boolean; onSelect?: (id: number) => void;
}) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof collectWatchTitles>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);
  const [error, setError] = useState(false);
  const [formats, setFormats] = useState<string[]>(savedFormats);
  useEffect(() => {
    try { window.localStorage.setItem(FORMAT_STORAGE_KEY, JSON.stringify(formats)); } catch { /* Filtering still works without storage. */ }
  }, [formats]);
  const seedRef = useRef(seed);
  seedRef.current = seed;
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const task = new AbortController();
    setLoading(true); setError(false); setCount(0); setResult(null);
    collectWatchTitles(seedRef.current, id => window.api.getAnimeDetails(id), {
      signal: task.signal, hideAdultContent,
      onProgress: (count, titles) => {
        if (task.signal.aborted) return;
        setCount(count);
        setResult({ titles, incomplete: false });
      },
    }).then(collected => {
      if (!task.signal.aborted) setResult(collected);
    }).catch(() => {
      if (!task.signal.aborted) setError(true);
    }).finally(() => {
      if (!task.signal.aborted) setLoading(false);
    });
    return () => task.abort();
  }, [seed.id, hideAdultContent, attempt]);
  const filteredTitles = result ? filterWatchTitles(result.titles, formats) : [];
  const sorted = result ? sortWatchTitles(filteredTitles) : null;
  function row(title: WatchTitle, number?: number) {
    const date = title.startDate;
    const dateText = date?.year ? [date.year, date.month && String(date.month).padStart(2, '0'), date.day && String(date.day).padStart(2, '0')].filter(Boolean).join('-') : 'Release date unknown';
    const text = getPreferredTitle(title.title || {}, titleLanguage);
    return <li key={title.id}>
      <div className="flex flex-col rounded-2xl border border-white/10 bg-white/3 sm:flex-row sm:items-center">
      <button type="button" onClick={() => onSelect?.(title.id)} disabled={!onSelect}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-t-2xl p-3 text-left transition hover:bg-white/8 disabled:cursor-default focus-visible:outline-2 focus-visible:outline-(--app-accent) sm:rounded-l-2xl sm:rounded-tr-none"
        aria-label={`Open ${text}`}>
        <span className="w-8 shrink-0 text-center text-lg font-semibold text-(--app-accent)">{number ?? '—'}</span>
        {title.coverImage?.large && <img src={title.coverImage.large} alt="" className="h-16 w-11 shrink-0 rounded-lg object-cover" loading="lazy" />}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-white/85">{text}</span>
            {title.status === 'RELEASING' && <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Currently airing
            </span>}
          </span>
          <span className="mt-1 block text-xs text-white/45">{dateText}{title.format ? ` · ${title.format.replaceAll('_', ' ')}` : ''}{title.id === seed.id ? ' · Current title' : ''}</span>
        </span>
      </button>
      <div className="relative flex shrink-0 items-center justify-center p-3 sm:w-40 sm:self-stretch">
        <span aria-hidden="true" className="absolute inset-x-3 top-0 h-px bg-white/10 sm:inset-x-auto sm:inset-y-3 sm:left-0 sm:h-auto sm:w-px" />
        <FranchiseLibraryControls id={title.id} type="ANIME" title={text} />
      </div>
      </div>
    </li>;
  }
  return <section aria-label="Suggested watch order" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-amber-300/15 bg-amber-300/5 px-2.5 py-1 text-[11px] font-medium text-amber-200/80">Speculative · Release order</span>
        <Tooltip content="Ordered by first release date, not an official or story-chronological order. Alternate versions, recaps, and spin-offs may be optional. Incomplete dates are approximate; ties have no implied priority." placement="bottom">
          <button type="button" aria-label="About this suggested order" className="rounded-full p-1 text-white/35 transition hover:text-white/70 focus-visible:outline-2 focus-visible:outline-(--app-accent)"><InformationCircleIcon className="h-4 w-4" /></button>
        </Tooltip>
      </div>
      <span role="status" className="flex items-center gap-2 text-xs text-white/45">
        {loading && <ArrowPathIcon className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />}
        {loading ? `Finding titles · ${count} found` : `${filteredTitles.length} of ${count} titles`}
      </span>
    </div>
    <fieldset className="border-b border-white/8 pb-4">
      <legend className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Formats</legend>
      <div className="flex flex-wrap gap-1.5">
        {WATCH_FORMATS.map(format => <button key={format.value} type="button" aria-pressed={formats.includes(format.value)} onClick={() => setFormats(current => current.includes(format.value) ? current.filter(value => value !== format.value) : [...current, format.value])}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition focus-visible:outline-2 focus-visible:outline-(--app-accent) ${formats.includes(format.value) ? 'border-(--app-accent)/35 bg-(--app-accent-soft) text-white/85' : 'border-white/8 text-white/40 hover:border-white/20 hover:text-white/65'}`}>
          {formats.includes(format.value) && <CheckIcon className="h-3 w-3" />}{format.label}
        </button>)}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[11px]">
        <button type="button" onClick={() => setFormats(['TV', 'MOVIE'])} className="text-white/45 transition hover:text-white/80">TV + movies</button>
        <button type="button" onClick={() => setFormats(WATCH_FORMATS.map(format => format.value))} className="text-white/45 transition hover:text-white/80">All</button>
        <button type="button" onClick={() => setFormats([])} className="text-white/45 transition hover:text-white/80">None</button>
        <span className="ml-auto text-white/25">Selection remembered</span>
      </div>
    </fieldset>
    {loading && <p className="text-[11px] text-white/30">The order updates as titles arrive. You can change formats while loading.</p>}
    {error && <div role="alert" className="flex items-center gap-3 text-sm text-amber-200/80"><span>Could not load the order.</span><button type="button" onClick={() => setAttempt(current => current + 1)} className="text-xs underline underline-offset-4">Retry</button></div>}
    {result?.incomplete && <Tooltip content="Some links could not be checked. Numbering may change when more titles become available.">
      <span tabIndex={0} role="status" className="inline-flex items-center gap-1.5 text-xs text-amber-200/75">Partial order <InformationCircleIcon className="h-3.5 w-3.5" /></span>
    </Tooltip>}
    {!formats.length && <p role="status" className="text-sm text-white/50">Choose at least one format to see titles.</p>}
    {sorted && <>
      <ol className="space-y-2">{sorted.dated.map((title, index) => row(title, index + 1))}</ol>
      {formats.length > 0 && !loading && (!filteredTitles.length ? <p role="status" className="text-sm text-white/50">No titles match the selected formats.</p> : !sorted.dated.length && <p className="text-sm text-white/50">No released titles with known dates match the selected formats.</p>)}
      {sorted.unknown.length > 0 && <div><h3 className="mb-2 text-sm font-semibold text-white/65">Unknown release date · Unranked</h3><ul className="space-y-2">{sorted.unknown.map(title => row(title))}</ul></div>}
      {sorted.upcoming.length > 0 && <div><h3 className="mb-2 text-sm font-semibold text-white/65">Upcoming · Unranked</h3><ul className="space-y-2">{sorted.upcoming.map(title => row(title))}</ul></div>}
    </>}
  </section>;
}
