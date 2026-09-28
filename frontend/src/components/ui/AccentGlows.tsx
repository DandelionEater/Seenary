import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BackgroundGlowsContext } from './backgroundGlowsContext';

function sessionSeed() {
  const fallback = Math.random().toString(36).slice(2);
  try {
    const key = 'seenary:glow-session';
    const stored = sessionStorage.getItem(key);
    if (stored) return stored;
    sessionStorage.setItem(key, fallback);
  } catch { /* Keep the module seed when browser storage is unavailable. */ }
  return fallback;
}
const currentSessionSeed = sessionSeed();
const overscan = 750;

function glow(seed: string, band: number, spacing: number, slower: boolean) {
  let state = 2166136261;
  for (const character of seed + ':' + band) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return {
    left: (band % 2 ? 70 + random() * 25 : 5 + random() * 30) + '%',
    top: band * spacing + 200 + random() * 150 + 'px',
    width: 'min(' + (34 + random() * 10) + 'rem, 100vw)',
    opacity: 0.75 + random() * 0.25,
    animationDuration: (slower ? 95 : 64) + random() * (slower ? 65 : 55) + 's',
    animationDelay: -random() * 70 + 's',
  };
}

export function AccentGlows({ seed, session = false, personal = false }: { seed: string; session?: boolean; personal?: boolean }) {
  const enabled = useContext(BackgroundGlowsContext);
  return enabled ? <ActiveAccentGlows seed={seed} session={session} personal={personal} /> : null;
}

function ActiveAccentGlows({ seed, session, personal }: { seed: string; session: boolean; personal: boolean }) {
  const spacing = personal ? 520 : 650;
  const layer = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ first: 0, last: 2 });
  useEffect(() => {
    const content = layer.current?.parentElement;
    const scroller = content?.closest<HTMLElement>('[data-global-scroll-root]');
    if (!content || !scroller) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const visibleTop = scroller.getBoundingClientRect().top - content.getBoundingClientRect().top;
      const lastBand = Math.max(0, Math.ceil(content.offsetHeight / spacing) - 1);
      const first = Math.min(lastBand, Math.max(0, Math.floor((visibleTop - overscan) / spacing)));
      const last = Math.min(lastBand, Math.max(first, Math.ceil((visibleTop + scroller.clientHeight + overscan) / spacing)));
      setRange(current => current.first === first && current.last === last ? current : { first, last });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(content);
    observer.observe(scroller);
    scroller.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => { observer.disconnect(); scroller.removeEventListener('scroll', schedule); cancelAnimationFrame(frame); };
  }, [spacing]);
  const glows = useMemo(() => Array.from({ length: range.last - range.first + 1 }, (_, index) => {
    const band = range.first + index;
    return { band, style: glow(session ? currentSessionSeed + ':' + seed : seed, band, spacing, personal) };
  }), [range, seed, session, spacing, personal]);
  return <div ref={layer} aria-hidden="true" className="accent-glow-layer pointer-events-none absolute inset-y-0 -z-10 m-0! overflow-hidden">
    {glows.map(({ band, style }) => <div key={band} className="media-details-glow" style={style} />)}
  </div>;
}
