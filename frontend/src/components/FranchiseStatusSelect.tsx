import { readStoredSectionOrder } from '../utils/listSectionOrder';
import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import type { ListStatus, MediaType } from '../types/domain';
import { getListStatusLabel } from '../utils/mediaFormatting';

export function FranchiseStatusSelect({ value, type, title, disabled, tone, onChange }: {
  value: ListStatus; type: MediaType; title: string; disabled: boolean; tone: string;
  onChange: (status: ListStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0 });
  const [theme, setTheme] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const visible = open && !disabled;
  const statusOrder = readStoredSectionOrder(type);
  function close() { setOpen(false); }
  useLayoutEffect(() => {
    if (!visible) return;
    const update = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const styles = getComputedStyle(trigger.current!);
      setTheme({ '--app-accent': styles.getPropertyValue('--app-accent'),
        '--app-accent-soft': styles.getPropertyValue('--app-accent-soft') } as CSSProperties);
      const height = menu.current?.offsetHeight ?? 220;
      setPosition({ width: rect.width, left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
        top: rect.bottom + height + 8 <= window.innerHeight - 8 ? rect.bottom + 8 : Math.max(8, rect.top - height - 8) });
    };
    update();
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [visible]);
  return <>
    <button ref={trigger} type="button" disabled={disabled} aria-label={`Library status for ${title}`}
      aria-haspopup="menu" aria-expanded={visible} aria-controls={visible ? menuId : undefined}
      onClick={() => setOpen(!visible)}
      className={`flex max-w-full items-center gap-4 rounded-full border bg-[#1b1b1b] px-3 py-1 text-[11px] font-medium outline-none transition hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-(--app-accent) disabled:opacity-50 ${tone} ${visible ? 'border-(--app-accent) shadow-[0_0_0_3px_var(--app-accent-soft)]' : ''}`}>
      <span className="text-(--app-accent)">{getListStatusLabel(value, type)}</span>
      <ChevronDownIcon aria-hidden="true" className={`h-3 w-3 shrink-0 text-white/50 transition ${visible ? 'rotate-180' : ''}`} />
    </button>
    {visible && createPortal(<div ref={menu} id={menuId} role="menu" aria-label={`Library status for ${title}`}
      style={{ ...position, ...theme }} className="fixed z-[1000] space-y-0.5 rounded-xl border border-white/12 bg-[#181818] p-1 text-[11px] text-white/75 shadow-[0_24px_60px_rgba(0,0,0,0.7)]"
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== trigger.current) setOpen(false); }}>
      {statusOrder.map(status => <button key={status} type="button" role="menuitemradio" aria-checked={value === status} tabIndex={value === status ? 0 : -1}
        onClick={() => { close(); if (status !== value) onChange(status); }}
        className={`block w-full rounded-lg px-2 py-1.5 text-left outline-none transition focus-visible:ring-1 focus-visible:ring-(--app-accent) ${status === value ? 'bg-(--app-accent-soft) text-(--app-accent)' : 'hover:bg-white/6'}`}>
        {getListStatusLabel(status, type)}
      </button>)}
    </div>, document.body)}
  </>;
}
