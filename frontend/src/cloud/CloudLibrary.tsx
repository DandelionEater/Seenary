import { useEffect, useRef, useState } from 'react';
import { LibraryClient, defaults, emptyState, fields } from './libraryClient.ts';
import type { Entry, Fields, Reply, State } from './libraryClient.ts';
import { accountLock, browserStorage } from './browserStorage.ts';
import './cloud.css';

const endpoint = `http://${location.hostname}:3001`;
const storage = browserStorage(endpoint);
const identityKey = `seenary-cloud-user:${endpoint}`;
let lastRequest = 0;
async function rpc(method: string, args: unknown[] = [], userId?: string): Promise<Reply> {
  // Stay below staging's request budget, including large device uploads.
  const wait = Math.max(0, lastRequest + 650 - Date.now());
  lastRequest = Date.now() + wait;
  await new Promise(resolve => setTimeout(resolve, wait));
  const response = await fetch(`${endpoint}/rpc`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Seenary-Version': __APP_VERSION__ },
    body: JSON.stringify({ method, args, ...(userId ? { expectedUserId: userId } : {}) }), signal: AbortSignal.timeout(30000) });
  const reply = await response.json() as Reply;
  if (!response.ok) throw new Error(reply.code || reply.message || `Cloud unavailable (${response.status})`);
  return reply;
}
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function title(state: State, id: string) {
  const media = state.media[id];
  return String(media?.metadata.title_preferred || media?.metadata.title_english || media?.metadata.title_romaji ||
    (media?.anilistId ? `AniList #${media.anilistId}` : media?.malId ? `MAL #${media.malId}` : id));
}

export default function CloudLibrary() {
  const [user, setUser] = useState<{ id: string; username: string } | null>(null);
  const active = useRef<string | null>(null);
  const [state, setState] = useState<State>(emptyState);
  const [message, setMessage] = useState('Sign in to Atlas staging.');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [filter, setFilter] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  async function run(task: (client: LibraryClient) => Promise<unknown>, id = active.current) {
    if (!id) return;
    setBusy(true);
    try {
      await accountLock(endpoint, id, async () => {
        const client = new LibraryClient(id, storage, rpc);
        try { await task(client); }
        finally { const next = await client.read(); if (active.current === id) setState(next); }
      });
      if (active.current === id) setMessage('Local cache updated. Pending edits are shown below.');
    } catch (error) { if (active.current === id) setMessage(error instanceof Error ? error.message : 'Operation failed.'); }
    finally { setBusy(false); }
  }
  async function activate(next: { id: string; username: string }) {
    active.current = next.id; setUser(next); setEditing(null); setState(emptyState());
    localStorage.setItem(identityKey, JSON.stringify(next));
    await run(async client => { setState(await client.read()); await client.flush(); await client.refresh(); }, next.id);
  }
  useEffect(() => {
    let stopped = false;
    void rpc('getSession').then(reply => {
      if (!stopped && reply.authenticated && reply.user) void activate(reply.user);
    }).catch(() => { if (!stopped) setMessage('Cloud unavailable. You can open the last account’s offline cache.'); });
    const sync = () => { if (active.current) void run(async client => { await client.flush(); await client.refresh(); }); };
    window.addEventListener('online', sync);
    const interval = window.setInterval(sync, 60000);
    return () => { stopped = true; window.removeEventListener('online', sync); clearInterval(interval); };
    // Account identity is captured by each operation; reconnect never moves a queue between accounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingIds = new Set(state.pending.map(item => item.request.mediaId));
  const displayed = { ...state.entries };
  for (const pending of state.pending) {
    const id = pending.request.mediaId;
    displayed[id] = { ...(displayed[id] ?? { ...defaults, mediaId: id, type: state.media[id]?.type ?? 'ANIME', revision: 0 }),
      ...pending.request.patch, deleted: pending.request.action === 'delete' };
  }
  return <main className="cloud-library">
    <header><span>Seenary · Atlas staging</span><h1>Your cloud library</h1><p>Favorites and personal entries, with a durable queue for offline changes.</p></header>
    <p role="status">{message}</p>
    {!user ? <form onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true);
      void rpc('login', [data.get('username'), data.get('password')]).then(async reply => {
        if (!reply.ok || !reply.user) throw new Error(reply.message || reply.code || 'Login failed.');
        await activate(reply.user);
      }).catch(error => setMessage(String(error))).finally(() => setBusy(false));
    }}><label>Username<input name="username" autoComplete="username" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label><button disabled={busy}>Sign in</button>
      <button type="button" disabled={busy} onClick={() => {
        try {
          const saved = JSON.parse(localStorage.getItem(identityKey) || 'null');
          if (!saved?.id || !saved?.username) throw new Error('No cached account on this browser.');
          active.current = saved.id; setUser(saved); void run(async client => { setState(await client.read()); });
        } catch (error) { setMessage(String(error)); }
      }}>Open offline cache</button></form> : <>
      <div className="cloud-actions"><strong>{user.username}</strong>
        <button disabled={busy} onClick={() => void run(async client => { await client.flush(); await client.refresh(); })}>Sync with cloud</button>
        <button disabled={busy} onClick={() => void run(async client => download({ format: 'seenary.cloud-backup', version: 1, userId: user.id, exportedAt: new Date().toISOString(), state: await client.read() }, 'seenary-cloud-backup.json'))}>Export backup</button>
        <button disabled={busy} onClick={() => {
          setBusy(true); void rpc('logout', [], user.id).then(reply => {
            if (!reply.ok) throw new Error('Sign out failed.');
            active.current = null; setUser(null); setState(emptyState()); setEditing(null); localStorage.removeItem(identityKey);
            localStorage.removeItem(`seenary-atlas-renderer-session:${endpoint}`);
          }).catch(error => setMessage(String(error))).finally(() => setBusy(false));
        }}>Sign out</button>
      </div>
      <p>{Object.values(state.entries).filter(entry => !entry.deleted).length} confirmed entries · {state.pending.length} pending cloud edits · {state.pending.filter(item => item.error).length} need review. Provider delivery is separate from cloud saving.</p>
      <details><summary>Import a device library or restore a backup</summary>
        <p>Export a local backup from Seenary on your device, then select it here. Check that it belongs to {user.username}. Every differing entry needs a choice; device preferences stay in the original backup.</p>
        <input aria-label="Select Seenary backup" type="file" accept=".json,application/json" disabled={busy} onChange={event => {
          const file = event.target.files?.[0]; if (!file) return;
          void run(async client => { if (file.size > 100 * 1024 * 1024) throw new Error('Backup exceeds 100 MB.'); await client.refresh(); await client.stageImport(JSON.parse(await file.text())); });
          event.target.value = '';
        }} />
        {state.source != null && <button onClick={() => download(state.source, 'seenary-original-import.json')}>Download preserved source</button>}
        <p>{state.candidates.filter(item => item.done).length} of {state.candidates.length} reviewed. Upload decisions survive a restart.</p>
        {state.candidates.filter(item => !item.done).slice(0, 20).map(item => {
          const media = Object.values(state.media).find(media => media.type === item.type && media[item.provider === 'anilist' ? 'anilistId' : 'malId'] === item.providerId);
          const current = media && state.entries[media._id];
          return <article key={item.key}><strong>{item.title} ({item.type})</strong>
            <div className="cloud-comparison"><pre>Device: {item.deleted ? 'Deleted' : JSON.stringify(item.patch, null, 2)}</pre><pre>Cloud: {current ? JSON.stringify({ ...fields(current), deleted: current.deleted }, null, 2) : 'No entry in reviewed snapshot'}</pre></div>
            <button disabled={busy} onClick={() => void run(client => client.acceptCandidate(item.key, 'device'))}>{current?.deleted && !item.deleted ? 'Restore using device values' : item.deleted ? 'Apply device deletion' : 'Use device values'}</button>
            <button disabled={busy} onClick={() => void run(client => client.acceptCandidate(item.key, 'cloud'))}>Keep cloud / skip</button>
          </article>;
        })}
      </details>
      {state.pending.length > 0 && <section aria-label="Pending edits"><h2>Pending edits</h2>{state.pending.map(item => <article key={item.request.operationId}>
        <strong>{title(state, item.request.mediaId)}</strong><p>{item.error || 'Saved on this device; waiting for cloud acknowledgement.'}</p>
        {item.error && <><div className="cloud-comparison"><pre>Your edit: {JSON.stringify(item.request.patch ?? { deleted: true }, null, 2)}</pre><pre>Cloud: {JSON.stringify(item.current ?? state.entries[item.request.mediaId] ?? null, null, 2)}</pre></div>
          <button disabled={busy} onClick={() => void run(client => client.resolve(item.request.operationId, 'device'))}>Apply my edit{item.current?.deleted ? ' and restore entry' : ''}</button>
          <button disabled={busy} onClick={() => void run(client => client.resolve(item.request.operationId, 'cloud'))}>Keep cloud version</button></>}
      </article>)}</section>}
      <div className="cloud-actions"><input aria-label="Filter library" placeholder="Filter titles" value={filter} onChange={event => setFilter(event.target.value)} />
        <label><input type="checkbox" checked={favoritesOnly} onChange={event => setFavoritesOnly(event.target.checked)} /> Favorites</label>
        <label><input type="checkbox" checked={showDeleted} onChange={event => setShowDeleted(event.target.checked)} /> Show deleted</label>
      </div>
      <form onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        void run(async client => {
          const reply = await rpc('ensureLibraryMedia', [data.get('type'), data.get('provider'), Number(data.get('id'))], user.id);
          if (!reply.ok || !reply.media || Array.isArray(reply.media)) throw new Error(reply.code || 'Invalid media identity.');
          const cache = await client.read(); cache.media[reply.media._id] = reply.media; await storage.write(user.id, cache);
          const current = cache.entries[reply.media._id];
          if (current?.deleted) throw new Error('This title was deleted. Enable Show deleted and restore it explicitly.');
          if (current) throw new Error('This title is already in your library.');
          await client.queue(reply.media._id, defaults);
        });
      }}><select name="type" aria-label="Media type"><option>ANIME</option><option>MANGA</option></select><select name="provider" aria-label="ID provider"><option value="anilist">AniList</option><option value="mal">MAL</option></select><input name="id" aria-label="Provider ID" type="number" min="1" step="1" required placeholder="Provider ID" /><button disabled={busy}>Add title</button></form>
      <ul className="cloud-entries">{Object.values(displayed).filter(entry => (showDeleted || !entry.deleted) && (!favoritesOnly || (entry.isFavorite && entry.status !== 'dropped' && !entry.deleted)) && title(state, entry.mediaId).toLowerCase().includes(filter.toLowerCase())).map(entry => <li key={entry.mediaId}>
        <div><strong>{title(state, entry.mediaId)}</strong><p>{entry.type} · {entry.deleted ? 'Deleted' : `${entry.status} · ${entry.progress} progress`} {pendingIds.has(entry.mediaId) ? '· Pending' : ''}</p></div>
        <button aria-label={`${entry.isFavorite ? 'Unfavorite' : 'Favorite'} ${title(state, entry.mediaId)}`} disabled={busy || entry.deleted || pendingIds.has(entry.mediaId)} onClick={() => void run(client => client.queue(entry.mediaId, { isFavorite: !entry.isFavorite }))}>{entry.isFavorite ? '★' : '☆'}</button>
        <button disabled={busy || pendingIds.has(entry.mediaId)} onClick={() => setEditing(entry)}>{entry.deleted ? 'Restore' : 'Edit'}</button>
      </li>)}</ul>
      {editing && <EntryEditor key={`${editing.mediaId}:${editing.revision}`} entry={editing} busy={busy} onClose={() => setEditing(null)} onSave={(patch, action) => {
        void run(async client => { await client.queue(editing.mediaId, patch, action, editing.deleted, editing.revision); setEditing(null); });
      }} />}
    </>}
  </main>;
}

function EntryEditor({ entry, busy, onClose, onSave }: { entry: Entry; busy: boolean; onClose: () => void; onSave: (patch: Partial<Fields>, action: 'upsert' | 'delete') => void }) {
  return <div className="cloud-modal"><form aria-label="Edit personal entry" onSubmit={event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const patch: Fields = { status: data.get('status') as Fields['status'], isFavorite: data.has('favorite'), progress: Number(data.get('progress')),
      volumeProgress: Number(data.get('volumes') || 0), score: data.get('score') === '' ? null : Number(data.get('score')), notes: String(data.get('notes') || '') || null,
      startedAt: String(data.get('startedAt') || '') || null, completedAt: String(data.get('completedAt') || '') || null, repeatCount: Number(data.get('repeats')), isRepeating: data.has('repeating') };
    onSave(patch, 'upsert');
  }}><h2>{entry.deleted ? 'Restore entry' : 'Edit entry'}</h2>
    <label>Status<select name="status" defaultValue={entry.status}>{['planned', 'watching', 'completed', 'paused', 'dropped'].map(value => <option key={value}>{value}</option>)}</select></label>
    <label><input type="checkbox" name="favorite" defaultChecked={entry.isFavorite} /> Favorite</label>
    <label>Progress<input name="progress" type="number" min="0" max="100000000" step="1" defaultValue={entry.progress} required /></label>
    {entry.type === 'MANGA' && <label>Volumes<input name="volumes" type="number" min="0" max="100000000" step="1" defaultValue={entry.volumeProgress} required /></label>}
    <label>Score (0–100)<input name="score" type="number" min="0" max="100" step="any" defaultValue={entry.score ?? ''} /></label>
    <label>Notes<textarea name="notes" maxLength={10000} defaultValue={entry.notes ?? ''} /></label>
    <label>Started<input name="startedAt" type="date" defaultValue={entry.startedAt ?? ''} /></label><label>Completed<input name="completedAt" type="date" defaultValue={entry.completedAt ?? ''} /></label>
    <label>Repeat count<input name="repeats" type="number" min="0" max="100000000" step="1" defaultValue={entry.repeatCount} required /></label>
    <label><input name="repeating" type="checkbox" defaultChecked={entry.isRepeating} /> Currently repeating</label>
    <button disabled={busy}>{entry.deleted ? 'Restore and save' : 'Save on this device'}</button>
    {!entry.deleted && <button type="button" disabled={busy} onClick={() => onSave({}, 'delete')}>Delete entry</button>}
    <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
  </form></div>;
}
