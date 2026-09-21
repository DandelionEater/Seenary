export type Fields = {
  status: 'planned' | 'watching' | 'completed' | 'paused' | 'dropped';
  isFavorite: boolean; progress: number; volumeProgress: number; score: number | null;
  notes: string | null; startedAt: string | null; completedAt: string | null;
  repeatCount: number; isRepeating: boolean;
};
export type Entry = Fields & { mediaId: string; type: 'ANIME' | 'MANGA'; revision: number; deleted: boolean };
export type Media = { _id: string; type: 'ANIME' | 'MANGA'; anilistId?: number; malId?: number; metadata: Record<string, unknown>;
  sources?: { anilist?: { details?: { recommendations?: { nodes?: unknown[] } } } } };
export type Mutation = { operationId: string; mediaId: string; expectedRevision: number; action: 'upsert' | 'delete'; patch?: Partial<Fields>; restore?: boolean };
export type Pending = { request: Mutation; error?: string; current?: Entry | null };
export type Candidate = { key: string; type: 'ANIME' | 'MANGA'; provider: 'anilist' | 'mal'; providerId: number; patch: Partial<Fields>; deleted?: boolean; title: string; done?: boolean };
export type State = {
  entries: Record<string, Entry>; media: Record<string, Media>; pending: Pending[]; cursor?: string;
  candidates: Candidate[]; source?: unknown;
};
export type Reply = { ok?: boolean; code?: string; message?: string; authenticated?: boolean; user?: { id: string; username: string }; entry?: Entry | null; current?: Entry | null; entries?: Entry[]; changes?: { entry: Entry }[]; nextCursor?: string; changeCursor?: string; hasMore?: boolean; media?: Media | Media[] };
export type Rpc = (method: string, args: unknown[], userId: string) => Promise<Reply>;
export type Storage = { read(key: string): Promise<State | undefined>; write(key: string, state: State): Promise<void>; remove?(key: string): Promise<void> };
export const emptyState = (): State => ({ entries: {}, media: {}, pending: [], candidates: [] });
export const defaults: Fields = { status: 'planned', isFavorite: false, progress: 0, volumeProgress: 0, score: null, notes: null, startedAt: null, completedAt: null, repeatCount: 0, isRepeating: false };
export const fields = (entry: Partial<Fields>): Partial<Fields> => Object.fromEntries(Object.keys(defaults).filter(key => key in entry).map(key => [key, entry[key as keyof Fields]]));
function checked(reply: Reply) { if (!reply.ok) throw new Error(reply.code || reply.message || 'Cloud request failed.'); return reply; }

// Injected storage/transport keep this protocol reusable by the Android client.
// The caller must hold a cross-tab account lock for each public operation.
export class LibraryClient {
  readonly userId: string;
  readonly storage: Storage;
  readonly rpc: Rpc;
  constructor(userId: string, storage: Storage, rpc: Rpc) { this.userId = userId; this.storage = storage; this.rpc = rpc; }
  async read() { return await this.storage.read(this.userId) ?? emptyState(); }
  async refresh() {
    const state = await this.read();
    if (state.cursor) {
      let cursor = state.cursor;
      for (;;) {
        const reply = await this.rpc('getLibraryChanges', [{ cursor, limit: 200 }], this.userId);
        if (reply.code === 'FULL_SNAPSHOT_REQUIRED') { state.cursor = undefined; break; }
        checked(reply);
        for (const change of reply.changes ?? []) state.entries[change.entry.mediaId] = change.entry;
        cursor = reply.nextCursor!;
        state.cursor = cursor;
        if (!reply.hasMore) break;
      }
    }
    if (!state.cursor) {
      const entries: Record<string, Entry> = {};
      let cursor: string | undefined;
      do {
        const reply = checked(await this.rpc('getLibrarySnapshot', [{ limit: 200, includeDeleted: true, ...(cursor ? { cursor } : {}) }], this.userId));
        for (const entry of reply.entries ?? []) entries[entry.mediaId] = entry;
        cursor = reply.nextCursor;
        state.cursor = reply.changeCursor;
      } while (cursor);
      state.entries = entries;
    }
    // Commit the cursor with the corresponding entries, never midway through a snapshot.
    await this.storage.write(this.userId, state);
    const missing = Object.keys(state.entries).filter(id => !state.media[id]);
    for (let i = 0; i < missing.length; i += 50) {
      const reply = checked(await this.rpc('getLibraryMedia', [missing.slice(i, i + 50)], this.userId));
      for (const media of reply.media as Media[]) state.media[media._id] = media;
      await this.storage.write(this.userId, state);
    }
    return state;
  }
  async queue(mediaId: string, patch: Partial<Fields>, action: 'upsert' | 'delete' = 'upsert', restore = false, expectedRevision?: number) {
    const state = await this.read();
    if (state.pending.some(item => item.request.mediaId === mediaId)) throw new Error('This title already has a pending edit. Sync or resolve it first.');
    const current = state.entries[mediaId];
    const request: Mutation = { operationId: crypto.randomUUID(), mediaId, expectedRevision: expectedRevision ?? current?.revision ?? 0, action,
      ...(action === 'upsert' ? { patch, ...(restore ? { restore: true } : {}) } : {}) };
    state.pending.push({ request });
    await this.storage.write(this.userId, state); // An edit is accepted only after durable storage succeeds.
    return state;
  }
  async flush() {
    const state = await this.read();
    for (const pending of [...state.pending]) {
      if (pending.error) continue;
      // Network failures leave the exact request intact, including its operation ID.
      const reply = await this.rpc('mutateLibraryEntry', [pending.request], this.userId);
      if (reply.code === 'UNAUTHENTICATED' || reply.code === 'ACCOUNT_CHANGED') throw new Error(reply.code);
      if (reply.ok && reply.entry) {
        const existing = state.entries[reply.entry.mediaId];
        if (!existing || existing.revision <= reply.entry.revision) state.entries[reply.entry.mediaId] = reply.entry;
        state.pending = state.pending.filter(item => item.request.operationId !== pending.request.operationId);
      } else {
        pending.error = reply.code || reply.message || 'Save rejected';
        pending.current = reply.current;
      }
      await this.storage.write(this.userId, state);
    }
    return state;
  }
  async resolve(operationId: string, choice: 'cloud' | 'device') {
    const state = await this.read();
    const pending = state.pending.find(item => item.request.operationId === operationId);
    if (!pending) return;
    const reply = checked(await this.rpc('getLibraryEntry', [pending.request.mediaId], this.userId));
    if (choice === 'device' && (reply.entry?.revision ?? 0) !== (pending.current?.revision ?? state.entries[pending.request.mediaId]?.revision ?? 0)) {
      pending.current = reply.entry;
      await this.storage.write(this.userId, state);
      throw new Error('The cloud entry changed again. Review its latest values before applying your edit.');
    }
    if (reply.entry) state.entries[pending.request.mediaId] = reply.entry;
    else delete state.entries[pending.request.mediaId];
    state.pending = state.pending.filter(item => item !== pending);
    if (choice === 'device') state.pending.push({ request: { ...pending.request, operationId: crypto.randomUUID(), expectedRevision: reply.entry?.revision ?? 0,
      ...(pending.request.action === 'upsert' && reply.entry?.deleted ? { restore: true } : {}) } });
    await this.storage.write(this.userId, state);
  }
  async stageImport(source: unknown) {
    const state = await this.read();
    if (state.candidates.some(candidate => !candidate.done)) throw new Error('Finish reviewing the current import before selecting another file.');
    state.candidates = parseBackup(source, this.userId);
    state.source = source; // Retain the complete original, including preferences and deletion records.
    await this.storage.write(this.userId, state);
  }
  async acceptCandidate(key: string, choice: 'device' | 'cloud') {
    const state = await this.read();
    const candidate = state.candidates.find(item => item.key === key);
    if (!candidate || candidate.done) return;
    if (choice === 'device') {
      const reply = checked(await this.rpc('ensureLibraryMedia', [candidate.type, candidate.provider, candidate.providerId], this.userId));
      const media = reply.media as Media;
      if (state.pending.some(item => item.request.mediaId === media._id)) throw new Error('Resolve the pending edit for this title first.');
      state.media[media._id] = media;
      // Import uses the reviewed snapshot revision. Concurrent changes become visible conflicts.
      const current = state.entries[media._id];
      state.pending.push({ request: { operationId: crypto.randomUUID(), mediaId: media._id, expectedRevision: current?.revision ?? 0,
        action: candidate.deleted ? 'delete' : 'upsert', ...(candidate.deleted ? {} : { patch: candidate.patch, ...(current?.deleted ? { restore: true } : {}) }) } });
    }
    candidate.done = true;
    // Candidate checkpoint and queued operation are atomic, so restart cannot lose an upload.
    await this.storage.write(this.userId, state);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid backup object.');
  return value as Record<string, unknown>;
}
export function parseBackup(source: unknown, userId: string): Candidate[] {
  const backup = record(source);
  if (backup.format === 'seenary.cloud-backup' && backup.version === 1) {
    if (backup.userId !== userId) throw new Error('This cloud backup belongs to another account.');
    const state = record(backup.state);
    const media = record(state.media);
    // Pending edits are overlaid, never blindly replayed against a different server revision.
    const entries = { ...record(state.entries) };
    for (const raw of Array.isArray(state.pending) ? state.pending : []) {
      const request = record(record(raw).request);
      const id = String(request.mediaId);
      entries[id] = { ...defaults, ...record(entries[id] ?? {}), ...record(request.patch ?? {}), mediaId: id, deleted: request.action === 'delete' };
    }
    const restored = Object.entries(entries).map(([id, raw]) => {
      const entry = record(raw), identity = record(media[id]);
      const provider = identity.anilistId ? 'anilist' : 'mal';
      return candidate(id, identity.type, provider, identity[provider === 'anilist' ? 'anilistId' : 'malId'], fields(entry as Partial<Fields>), Boolean(entry.deleted), id);
    });
    for (const raw of Array.isArray(state.candidates) ? state.candidates : []) {
      const item = record(raw);
      if (item.done) continue;
      if (!['anilist', 'mal'].includes(String(item.provider))) throw new Error('Invalid import identity.');
      const pending = candidate(`import:${item.key}`, item.type, item.provider as Candidate['provider'], item.providerId, fields(record(item.patch)), Boolean(item.deleted), String(item.title));
      restored.push(pending); // Keep an unresolved device alternative even when the cloud copy is also backed up.
    }
    return restored;
  }
  if (backup.format !== 'seenary.local-backup' || ![1, 2, 3, 4].includes(Number(backup.version))) throw new Error('Unsupported Seenary backup format.');
  const data = record(backup.data);
  const candidates: Candidate[] = [];
  for (const type of ['ANIME', 'MANGA'] as const) {
    const entries = record(data[type === 'ANIME' ? 'entries' : 'mangaEntries'] ?? {});
    const deleted = record(data[type === 'ANIME' ? 'deletedEntries' : 'deletedMangaEntries'] ?? {});
    const metadata = record(data[type === 'ANIME' ? 'anime' : 'manga'] ?? {});
    for (const [key, raw] of Object.entries({ ...entries, ...deleted })) {
      const entry = record(raw), meta = record(metadata[key] ?? {});
      const localId = entry[type === 'ANIME' ? 'anime_id' : 'manga_id'] ?? Number(key);
      const external = record(entry.external_ids ?? meta.external_ids ?? {});
      const provider = Number(localId) > 0 ? 'anilist' : 'mal';
      const id = provider === 'anilist' ? localId : Number(external.mal);
      const patch: Partial<Fields> = {};
      const mapping = { status: 'status', is_favorite: 'isFavorite', progress: 'progress', volume_progress: 'volumeProgress', score: 'score', notes: 'notes', started_at: 'startedAt', completed_at: 'completedAt', repeat_count: 'repeatCount', [type === 'ANIME' ? 'is_rewatching' : 'is_rereading']: 'isRepeating' };
      for (const [local, cloud] of Object.entries(mapping)) {
        if (entry[local] === undefined) continue;
        let value = entry[local];
        if (['isFavorite', 'isRepeating'].includes(cloud)) {
          if (![true, false, 0, 1].includes(value as boolean)) throw new Error(`Invalid flag in ${key}`);
          value = Boolean(value);
        }
        Object.assign(patch, { [cloud]: value });
      }
      candidates.push(candidate(`${type}:${key}`, type, provider, id, patch, key in deleted, String(meta.title_preferred || meta.title_english || meta.title_romaji || id)));
    }
  }
  return candidates;
}
function candidate(key: string, type: unknown, provider: 'anilist' | 'mal', id: unknown, patch: Partial<Fields>, deleted: boolean, title: string): Candidate {
  if (!['ANIME', 'MANGA'].includes(String(type)) || !Number.isSafeInteger(id) || Number(id) <= 0) throw new Error(`Unmapped or invalid media identity: ${key}. The source file is unchanged.`);
  for (const [field, value] of Object.entries(patch)) {
    if (field === 'status' && !['planned', 'watching', 'completed', 'paused', 'dropped'].includes(String(value))) throw new Error(`Invalid status: ${key}`);
    if (['progress', 'volumeProgress', 'repeatCount'].includes(field) && (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100000000)) throw new Error(`Invalid progress: ${key}`);
    if (field === 'score' && value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)) throw new Error(`Invalid score: ${key}`);
    if (['isFavorite', 'isRepeating'].includes(field) && typeof value !== 'boolean') throw new Error(`Invalid flag: ${key}`);
    if (field === 'notes' && value !== null && (typeof value !== 'string' || value.length > 10000)) throw new Error(`Invalid notes: ${key}`);
    if (['startedAt', 'completedAt'].includes(field) && value !== null && (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error(`Invalid date: ${key}`);
  }
  if (type === 'ANIME' && patch.volumeProgress) throw new Error(`Anime cannot have volume progress: ${key}`);
  return { key, type: type as Candidate['type'], provider, providerId: Number(id), patch, deleted, title };
}
