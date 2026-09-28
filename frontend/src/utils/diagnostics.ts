import { atlasDatabaseName, atlasEndpoint } from '../cloud/config';

type DiagnosticError = { at: string; operation: string; code: string; status?: number; phase?: string };
const errors: DiagnosticError[] = [];
export function clearDiagnosticErrors() { errors.length = 0; }
export function recordDiagnosticError(operation: string, code: unknown, status?: number, phase?: string | null) {
  errors.push({ at: new Date().toISOString(), operation: /^[A-Za-z][A-Za-z0-9:-]{0,79}$/.test(operation) ? operation : 'unknown',
    code: typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'REQUEST_FAILED',
    ...(Number.isInteger(status) ? { status } : {}),
    ...(['authorization', 'fetch-anime', 'fetch-manga', 'normalize-anime', 'normalize-manga', 'hydrate', 'mapping', 'reconcile', 'finish'].includes(phase || '') ? { phase: phase! } : {}) });
  if (errors.length > 40) errors.shift();
}

async function storageHealth() {
  let browserStorage = 'available';
  try { const key = `seenary-diagnostic-${Date.now()}`; localStorage.setItem(key, 'probe'); localStorage.removeItem(key); }
  catch { browserStorage = 'unavailable'; }
  const indexedDatabase = await new Promise<string>(resolve => {
    let request: IDBOpenDBRequest;
    let done = false;
    const finish = (value: string) => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => finish('timeout'), 3000);
    try {
      request = indexedDB.open(atlasDatabaseName);
      request.onupgradeneeded = () => { request.transaction?.abort(); finish('not-created'); };
      request.onsuccess = () => { request.result.close(); finish('available'); };
      request.onerror = () => finish(request.error?.name === 'UnknownError' ? 'backing-store-unavailable' : 'unavailable');
      request.onblocked = () => finish('blocked');
    } catch { finish('unavailable'); }
  });
  return { browserStorage, indexedDatabase };
}

export async function collectDiagnostics() {
  const storage = await storageHealth();
  let desktop: Record<string, unknown> | null = null;
  try {
    const result = await window.desktopDiagnostics?.getInfo();
    if (result) desktop = Object.fromEntries(['platform', 'architecture', 'appVersion', 'electronVersion', 'chromiumVersion', 'packaged', 'profileWritable']
      .filter(key => ['string', 'boolean'].includes(typeof result[key])).map(key => [key, result[key]]));
  } catch { /* Report renderer checks even if IPC fails. */ }
  return { format: 'seenary.diagnostics', version: 1, generatedAt: new Date().toISOString(), appVersion: __APP_VERSION__,
    online: navigator.onLine, atlasOrigin: new URL(atlasEndpoint).origin, storage, desktop, recentErrors: [...errors] };
}
export async function exportDiagnostics() {
  const report = await collectDiagnostics();
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url;
  link.download = `Seenary-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
