import { useEffect, useState } from 'react';
import { ArrowPathIcon, CheckCircleIcon, EnvelopeIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { SecurityDialog, SecurityField, SecuritySettingRow } from './AccountSecurityUI';

export function RecoveryEmail({ hasPassword, onEmailStatusChange }: { hasPassword: boolean | null; onEmailStatusChange?: (added: boolean | null) => void }) {
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [verified, setVerified] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [pendingCode, setPendingCode] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    onEmailStatusChange?.(loading ? null : Boolean(verified));
  }, [loading, verified, onEmailStatusChange]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [step, setStep] = useState<'email' | 'code' | 'done'>('email');
  const [code, setCode] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [clock, setClock] = useState(Date.now);
  const remaining = Math.max(0, Math.ceil((resendAt - clock) / 1000));
  useEffect(() => {
    if (!open || step !== 'code') return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open, step]);
  useEffect(() => {
    let active = true;
    window.api.getRecoveryEmail().then(reply => {
      if (!active) return;
      setConfigured(reply.configured === true); setVerified(reply.email ?? null); setPending(reply.pendingEmail ?? null);
      setPendingCode(reply.pendingCode === true); setResendAt(reply.resendAt ? Date.parse(reply.resendAt) : 0);
      if (!reply.ok) { setError(true); setMessage('Could not load your recovery email. Reopen settings to try again.'); }
    }).catch(() => { if (active) { setError(true); setMessage('Could not load your recovery email. Reopen settings to try again.'); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  function close() { if (busy) return; setOpen(false); setEmail(''); setCurrentPassword(''); setCode(''); setMessage(''); setError(false); }
  function start() { setEmail(pending ?? verified ?? ''); setCode(''); setMessage(''); setError(false); setStep(pending && pendingCode ? 'code' : 'email'); setOpen(true); }
  async function save(resend = false) {
    if (busy) return; setBusy(true); setMessage(''); setError(false);
    try {
      if (step === 'code' && !resend) {
        const reply = await window.api.verifyRecoveryEmailCode(code);
        setMessage(reply.message); setError(!reply.ok);
        if (reply.ok) { setVerified(pending); setPending(null); setPendingCode(false); setCode(''); setStep('done'); }
      } else {
        const reply = resend ? await window.api.resendRecoveryEmailCode() : await window.api.setRecoveryEmail(email, currentPassword);
        setMessage(reply.message); setError(!reply.ok);
        if (reply.ok) { setMessage(resend ? 'A new code has been sent.' : ''); setPending(resend ? pending : email.trim().toLowerCase()); setPendingCode(true); setCurrentPassword(''); setCode(''); setResendAt(Date.now() + 60000); setClock(Date.now()); setStep('code'); }
      }
    } catch { setError(true); setMessage('Could not complete verification. Check your connection and try again.'); }
    finally { setBusy(false); }
  }
  const description = hasPassword === false ? 'Set a Seenary password first to add a recovery email.' : hasPassword === null ? 'Checking your sign-in methods…' : loading ? 'Checking your recovery email…' : error && !open ? message : pending ? <span className="break-all">Verification pending for <span className="text-white/70">{pending}</span>.</span> : verified ? <span className="inline-flex items-center gap-1.5 break-all text-white/60"><CheckCircleIcon className="h-3.5 w-3.5 shrink-0 text-emerald-300/80" />{verified}</span> : 'Recover access if you forget your password.';
  const title = step === 'done' ? 'Email verified' : step === 'code' ? 'Verify your email' : verified ? 'Change recovery email' : 'Add recovery email';
  return <>
    <SecuritySettingRow icon={EnvelopeIcon} title="Recovery email" description={description}>
      {hasPassword !== true ? <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/35">{hasPassword === null ? 'Checking' : 'Password required'}</span> : configured ? <button type="button" disabled={busy || loading} onClick={start} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/85 transition hover:border-white/25 hover:bg-white/8 disabled:opacity-40"><EnvelopeIcon className="h-4 w-4" />{pending ? 'Verify email' : verified ? 'Change email' : 'Add email'}</button> : <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/35">{loading ? 'Checking' : 'Unavailable'}</span>}
    </SecuritySettingRow>
    {open && <SecurityDialog showCancel={step !== 'done'} title={title} description={step === 'done' ? 'Your recovery email is ready to help you regain access to Seenary.' : step === 'code' ? `Enter the six-digit code we sent to ${pending}.` : 'Add an email you can access. We’ll send a code to confirm it belongs to you.'} icon={step === 'done' ? CheckCircleIcon : EnvelopeIcon} busy={busy} onClose={close} onSubmit={() => { if (step === 'done') close(); else void save(); }} action={step === 'done' ? <button type="button" onClick={close} className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black">Done</button> : <button type="submit" disabled={busy || (step === 'code' ? code.length !== 6 : !email || !currentPassword)} className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-40">{busy ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : step === 'code' ? <CheckCircleIcon className="h-4 w-4" /> : <PaperAirplaneIcon className="h-4 w-4" />}{busy ? 'Please wait…' : step === 'code' ? 'Verify email' : 'Send code'}</button>}>
      {step !== 'done' && <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35"><span className={step === 'email' ? 'text-[var(--app-accent)]' : 'text-white/50'}>1 · Email address</span><span className="h-px flex-1 bg-white/10" /><span className={step === 'code' ? 'text-[var(--app-accent)]' : ''}>2 · Verification</span></div>}
      {step === 'email' ? <>
        <SecurityField key="email" autoFocus label="Recovery email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={busy} />
        <SecurityField label="Current password" type="password" autoComplete="current-password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} disabled={busy} />
        {verified && <p className="text-xs leading-5 text-white/40">Your current recovery email stays active until the new address is verified.</p>}
      </> : step === 'code' ? <>
        <SecurityField key="code" autoFocus label="Verification code" type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" required pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy} />
        <p className="text-xs leading-5 text-white/45">Your code expires in 10 minutes. Check your spam folder if you don’t see the email.</p>
        <div className="flex flex-wrap justify-between gap-3 text-xs font-semibold"><button type="button" disabled={busy || remaining > 0} onClick={() => void save(true)} className="text-[var(--app-accent)] transition hover:opacity-80 disabled:text-white/30">{remaining > 0 ? `Resend code in ${remaining}s` : 'Resend code'}</button><button type="button" disabled={busy} onClick={() => { setEmail(pending ?? ''); setStep('email'); setCode(''); setMessage(''); setError(false); }} className="text-white/55 hover:text-white">Change email</button></div>
      </> : <p role="status" className="flex items-center gap-3 rounded-2xl border border-emerald-300/15 bg-emerald-300/5 px-4 py-4 text-sm text-emerald-200"><CheckCircleIcon className="h-5 w-5 shrink-0" /><span className="break-all">{verified}</span></p>}
      {message && step !== 'done' && <p role={error ? 'alert' : 'status'} className={`rounded-2xl border px-4 py-3 text-sm ${error ? 'border-rose-300/15 bg-rose-300/5 text-rose-200' : 'border-white/10 bg-white/[0.03] text-white/60'}`}>{message}</p>}
    </SecurityDialog>}
  </>;
}
