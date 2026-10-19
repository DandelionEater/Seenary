import { BellAlertIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type { ReleaseNotice } from '../utils/releaseReminders';

export function ReleaseNotification({ notice, onOpen, onDismiss }: { notice: ReleaseNotice | null; onOpen: () => void; onDismiss: () => void }) {
  if (!notice) return null;
  return <aside role="status" aria-live="polite" className="fixed bottom-5 right-5 z-[80] w-[380px] max-w-[calc(100vw-40px)] overflow-hidden rounded-3xl border border-white/15 bg-[#17151c] p-4 text-white shadow-2xl">
    <div className="mb-3 flex items-center justify-between"><span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--app-accent)]"><BellAlertIcon className="h-4 w-4" />{notice.preview ? 'Seenary · Preview' : 'Seenary · Coming soon'}</span><button type="button" onClick={onDismiss} aria-label="Dismiss release reminder" className="rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white"><XMarkIcon className="h-4 w-4" /></button></div>
    <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 text-left">
      {notice.cover && <img src={notice.cover} alt="" className="h-20 w-14 shrink-0 rounded-xl object-cover" />}
      <div className="min-w-0"><p className="line-clamp-3 break-words text-sm font-semibold leading-5">{notice.title}</p><p className="mt-2 text-xs leading-5 text-white/55">{notice.message}</p></div>
    </button>
  </aside>;
}
