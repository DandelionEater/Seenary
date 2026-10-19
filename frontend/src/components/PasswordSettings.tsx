import { useState } from 'react';
import { ArrowPathIcon, CheckCircleIcon, KeyIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import { SecurityDialog, SecurityField, SecuritySettingRow } from './AccountSecurityUI';

export function PasswordSettings({ hasPassword, onPasswordSet }: { hasPassword: boolean | null; onPasswordSet: () => void }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const title = hasPassword === null ? 'Checking?' : hasPassword ? 'Reset password' : 'Set password';
  function close() { if (busy) return; setOpen(false); setCurrent(''); setPassword(''); setConfirmation(''); setMessage(''); }
  async function save() {
    if (busy) return;
    setSuccess(false);
    if (password.length < 8 || password.length > 128) { setMessage('Use between 8 and 128 characters.'); return; }
    if (password !== confirmation) { setMessage('Your new passwords do not match.'); return; }
    setBusy(true); setMessage('');
    try {
      const result = hasPassword ? await window.api.changePassword(current, password) : await window.api.setLocalPassword(password);
      setMessage(result.message);
      if (result.ok) {
        setSuccess(true); setCurrent(''); setPassword(''); setConfirmation(''); setOpen(false); onPasswordSet();
        const session = await window.api.getSession();
        if (!session.authenticated) window.location.reload();
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update your password. Try again.'); }
    finally { setBusy(false); }
  }
  return <>
    <SecuritySettingRow icon={KeyIcon} title="Seenary password" description={success && !open ? <span role="status" className="inline-flex items-center gap-1.5 text-emerald-300"><CheckCircleIcon className="h-4 w-4" />Password updated.</span> : hasPassword ? 'Manage the password you use to sign in to Seenary.' : 'Add a password to sign in with your Seenary username.'}>
      <button type="button" disabled={busy || hasPassword === null} onClick={() => { setMessage(''); setSuccess(false); setOpen(true); }} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/85 transition hover:border-white/25 hover:bg-white/8 disabled:opacity-40"><KeyIcon className="h-4 w-4" />{title}</button>
    </SecuritySettingRow>
    {open && <SecurityDialog title={title} icon={LockClosedIcon} busy={busy} onClose={close} onSubmit={() => void save()} description={hasPassword ? 'Confirm your current password, then choose a new one.' : 'Use your Seenary username and password to sign in, alongside your connected accounts.'} action={<button type="submit" disabled={busy || !password || !confirmation || (hasPassword === true && !current)} className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-40">{busy ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <CheckCircleIcon className="h-4 w-4" />}{busy ? 'Saving…' : 'Save password'}</button>}>
      {hasPassword && <SecurityField label="Current password" type="password" autoComplete="current-password" required value={current} onChange={e => setCurrent(e.target.value)} disabled={busy} />}
      <SecurityField label="New password" type="password" autoComplete="new-password" placeholder="At least 8 characters" minLength={8} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
      <SecurityField label="Confirm new password" type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} />
      <p className="flex items-start gap-2 text-xs leading-5 text-white/40"><LockClosedIcon className="mt-0.5 h-4 w-4 shrink-0" />Updating a cloud password signs you out on all devices.</p>
      {message && <p role="alert" className="rounded-2xl border border-rose-300/15 bg-rose-300/5 px-4 py-3 text-sm text-rose-200">{message}</p>}
    </SecurityDialog>}
  </>;
}
