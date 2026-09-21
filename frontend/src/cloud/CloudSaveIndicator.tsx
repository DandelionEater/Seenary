import { useEffect, useState } from 'react';
import { browserStorage } from './browserStorage';
import { atlasEndpoint, atlasLabel } from './config';

export default function CloudSaveIndicator() {
  const [label, setLabel] = useState(`Cloud saves · ${atlasLabel}`);
  const [connection, setConnection] = useState<'loading' | 'current' | 'stale' | 'offline' | 'retrying' | 'signedOut'>(
    navigator.onLine ? 'loading' : 'offline'
  );
  useEffect(() => {
    let stopped = false;
    const endpoint = atlasEndpoint;
    const key = `seenary-atlas-renderer-session:${endpoint}`;
    const storage = browserStorage(endpoint);
    const update = async () => {
      try {
        const identity = localStorage.getItem(key);
        const user = JSON.parse(identity || 'null');
        if (!user?.id) {
          setConnection('signedOut');
          setLabel('Cloud saves · sign in');
          return;
        }
        const state = user?.id ? await storage.read(user.id) : undefined;
        if (stopped || identity !== localStorage.getItem(key)) return;
        const errors = state?.pending.filter(item => item.error).length ?? 0;
        const pending = state?.pending.length ?? 0;
        setLabel(errors ? `Cloud saves · ${errors} need review` : pending ? `Cloud saves · ${pending} pending` : `Cloud saves · ${atlasLabel}`);
      } catch { if (!stopped) setLabel('Cloud saves · storage unavailable'); }
    };
    const connectionChanged = (event: Event) => {
      const status = (event as CustomEvent<{ status?: typeof connection }>).detail?.status;
      if (status) setConnection(status);
    };
    const wentOffline = () => setConnection('offline');
    void update();
    window.addEventListener('seenary:local-library-updated', update);
    window.addEventListener('seenary:library-connection', connectionChanged);
    window.addEventListener('offline', wentOffline);
    const timer = setInterval(() => void update(), 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('seenary:local-library-updated', update);
      window.removeEventListener('seenary:library-connection', connectionChanged);
      window.removeEventListener('offline', wentOffline);
    };
  }, []);
  const connectionLabel = connection === 'offline'
    ? 'Cloud saves · offline cache'
    : connection === 'stale'
      ? 'Cloud saves · cloud unavailable'
      : connection === 'retrying'
        ? 'Cloud saves · reconnecting'
        : connection === 'loading'
          ? 'Cloud saves · loading'
          : connection === 'signedOut'
            ? 'Cloud saves · sign in'
            : label;
  return <a href="?atlasReview=1" aria-live="polite" title="Open cloud saves, pending edits, conflicts, backups, and recovery controls" style={{ position: 'fixed', bottom: 12, left: 12, zIndex: 9999, padding: '8px 16px', borderRadius: 8, background: '#30395b', color: 'white' }}>{connectionLabel}</a>;
}
