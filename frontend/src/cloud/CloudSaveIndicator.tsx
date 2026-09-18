import { useEffect, useState } from 'react';
import { browserStorage } from './browserStorage';

export default function CloudSaveIndicator() {
  const [label, setLabel] = useState('Cloud saves · Atlas staging');
  useEffect(() => {
    let stopped = false;
    const endpoint = `http://${location.hostname}:3001`;
    const key = `seenary-atlas-renderer-session:${endpoint}`;
    const storage = browserStorage(endpoint);
    const update = async () => {
      try {
        const identity = localStorage.getItem(key);
        const user = JSON.parse(identity || 'null');
        const state = user?.id ? await storage.read(user.id) : undefined;
        if (stopped || identity !== localStorage.getItem(key)) return;
        const errors = state?.pending.filter(item => item.error).length ?? 0;
        const pending = state?.pending.length ?? 0;
        setLabel(errors ? `Cloud saves · ${errors} need review` : pending ? `Cloud saves · ${pending} pending` : 'Cloud saves · Atlas staging');
      } catch { if (!stopped) setLabel('Cloud saves · storage unavailable'); }
    };
    void update();
    window.addEventListener('seenary:local-library-updated', update);
    const timer = setInterval(() => void update(), 5000);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('seenary:local-library-updated', update); };
  }, []);
  return <a href="?atlasReview=1" aria-live="polite" style={{ position: 'fixed', bottom: 12, left: 12, zIndex: 9999, padding: '8px 16px', borderRadius: 8, background: '#30395b', color: 'white' }}>{label}</a>;
}
