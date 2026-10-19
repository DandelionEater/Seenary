import { useEffect, useState } from 'react';

export function PasswordRecovery({ link, onBack }: { link?: { kind: string; token: string }; onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (link) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, [link]);
  const verify = link?.kind === 'verify';
  const reset = link?.kind === 'reset';
  const inputClass = 'mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white';
  return <div className="flex h-full min-h-screen items-center justify-center bg-[#0f0f0f] px-6 text-white">
    <form className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-6" onSubmit={async e => {
      e.preventDefault(); if (busy) return;
      if (reset && password !== confirmation) { setMessage('The passwords do not match.'); return; }
      setBusy(true); setMessage('');
      try {
        const reply = verify ? await window.api.verifyRecoveryEmail(link.token) : reset ? await window.api.resetPassword(link.token, password) : await window.api.requestPasswordReset(email);
        setMessage(reply.message);
        if (reply.ok && link) { setDone(true); setPassword(''); setConfirmation(''); }
      } catch { setMessage('Could not complete this request. Check your connection and try again.'); }
      finally { setBusy(false); }
    }}>
      <h1 className="text-2xl font-bold">{verify ? 'Verify recovery email' : 'Reset password'}</h1>
      {!link && <p className="mt-3 text-sm text-white/60">Enter the recovery email you previously verified in Seenary. Accounts without a verified email can sign in through an already linked AniList or MyAnimeList account.</p>}
      {!done && (!link ? <label className="mt-4 block text-sm">Recovery email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={busy} className={inputClass} /></label> : reset ? <>
        <label className="mt-4 block text-sm">New password<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} className={inputClass} /></label>
        <label className="mt-4 block text-sm">Confirm new password<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} className={inputClass} /></label>
      </> : <p className="mt-3 text-sm text-white/60">Confirm this email as your Seenary recovery address.</p>)}
      {message && <p role="status" className="mt-4 text-sm text-white/75">{message}</p>}
      {!done && <button disabled={busy} className="mt-5 w-full rounded-2xl bg-white px-4 py-3 font-semibold text-black disabled:opacity-50">{busy ? 'Please wait…' : verify ? 'Verify email' : reset ? 'Save new password' : 'Send reset link'}</button>}
      <button type="button" disabled={busy} onClick={onBack} className="mt-4 w-full text-sm text-white/60">Back to Seenary</button>
    </form>
  </div>;
}
