import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type InputHTMLAttributes, type ReactNode, type SVGProps } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { ModalShell } from './ui/ModalShell';

export function SecuritySettingRow({ icon: Icon, title, description, children }: {
  icon: ComponentType<SVGProps<SVGSVGElement>>; title: string; description: ReactNode; children: ReactNode;
}) {
  return <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
    <div className="flex min-w-0 items-start gap-4">
      <div className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] p-2.5 text-white/60"><Icon className="h-5 w-5" /></div>
      <div className="min-w-0"><h4 className="text-sm font-semibold text-white">{title}</h4><div className="mt-1 text-sm leading-6 text-white/45">{description}</div></div>
    </div>
    <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">{children}</div>
  </div>;
}

export function SecurityDialog({ title, description, icon: Icon, busy, onClose, onSubmit, children, action, showCancel = true }: {
  title: string; description: string; icon: ComponentType<SVGProps<SVGSVGElement>>; busy: boolean;
  onClose: () => void; onSubmit: () => void; children: ReactNode; action: ReactNode; showCancel?: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  const origin = useRef<HTMLSpanElement>(null);
  const [portal] = useState(() => document.createElement('div'));
  useLayoutEffect(() => {
    // Settings sections create containing blocks for fixed-position children.
    // Mount above them, retaining the active account's theme colors.
    const styles = getComputedStyle(origin.current!);
    for (const name of ['--app-accent', '--app-accent-soft']) portal.style.setProperty(name, styles.getPropertyValue(name));
    document.body.appendChild(portal);
    return () => portal.remove();
  }, [portal]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    form.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => previous?.focus();
  }, []);
  return <><span ref={origin} hidden />{createPortal(<ModalShell ariaLabel={title} onClose={() => { if (!busy) onClose(); }} panelClassName="max-w-lg max-h-full overflow-y-auto" closeOnBackdrop={!busy} zClassName="z-[70]">
    <form ref={form} onSubmit={event => { event.preventDefault(); if (!busy) onSubmit(); }} onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(form.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? []);
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <div className="border-b border-white/10 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="rounded-2xl border border-[var(--app-accent)]/20 bg-[var(--app-accent-soft)] p-3 text-[var(--app-accent)]"><Icon className="h-6 w-6" /></div>
          <button type="button" disabled={busy} onClick={onClose} aria-label={`Close ${title}`} className="rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-white/50 transition hover:bg-white/8 hover:text-white disabled:opacity-40"><XMarkIcon className="h-5 w-5" /></button>
        </div>
        <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">Sign-in methods</p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-white">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-white/50">{description}</p>
      </div>
      <div className="max-h-[45vh] space-y-5 overflow-y-auto p-6">{children}</div>
      <div className="flex justify-end gap-3 border-t border-white/10 bg-white/[0.02] px-6 py-4">
        {showCancel && <button type="button" disabled={busy} onClick={onClose} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/70 transition hover:bg-white/8 hover:text-white disabled:opacity-40">Cancel</button>}
        {action}
      </div>
    </form>
  </ModalShell>, portal)}</>;
}

export function SecurityField({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="block"><span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">{label}</span><input {...props} className={`mt-2 w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 ${props.autoComplete === 'one-time-code' ? 'text-center font-mono text-2xl tracking-[0.4em]' : 'text-sm'} text-white outline-none transition placeholder:text-white/20 focus:border-[var(--app-accent)]/50 focus:ring-2 focus:ring-[var(--app-accent)]/10 disabled:opacity-50`} /></label>;
}
