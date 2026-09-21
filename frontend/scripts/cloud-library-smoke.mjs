import assert from 'node:assert/strict';
import { LibraryClient, defaults, emptyState, parseBackup } from '../src/cloud/libraryClient.ts';
import { resolveLibraryHydration } from '../src/utils/libraryHydration.ts';
import { inspectSeenaryBackup, selectBackupSections } from '../src/utils/portablePreferences.ts';

const retainedHydration = resolveLibraryHydration(
  { status: 'rejected', reason: new Error('Temporary API restart') },
  { status: 'fulfilled', value: { ok: true, entries: [{ manga_id: 2 }] } },
);
assert.equal(retainedHydration.animeEntries, undefined, 'a failed refresh preserves the visible anime list');
assert.deepEqual(retainedHydration.mangaEntries, [{ manga_id: 2 }], 'a successful list refresh still applies');
assert.equal(retainedHydration.failed, true);

const emptyHydration = resolveLibraryHydration(
  { status: 'fulfilled', value: { ok: true } },
  { status: 'fulfilled', value: { ok: true, entries: [] } },
);
assert.deepEqual(emptyHydration.animeEntries, [], 'a confirmed empty cloud list may clear visible entries');
assert.equal(emptyHydration.failed, false);

const saved = new Map();
let failWrite = false;
const storage = { read: async key => structuredClone(saved.get(key)), write: async (key, value) => {
  if (failWrite) throw new Error('Disk full');
  saved.set(key, structuredClone(value));
} };
let server = { ...defaults, mediaId: 'title', type: 'ANIME', revision: 1, deleted: false, notes: 'preserve' };
const media = { _id: 'title', type: 'ANIME', anilistId: 1, metadata: {} };
const receipts = new Map();
let lostResponse = false, accountChanged = false;
const requests = [];
async function rpc(method, args, userId) {
  assert.equal(userId, 'alice');
  if (accountChanged) return { ok: false, code: 'ACCOUNT_CHANGED' };
  if (method === 'getLibrarySnapshot') return { ok: true, entries: [structuredClone(server)], changeCursor: 'cursor' };
  if (method === 'getLibraryChanges') return { ok: true, changes: [{ entry: structuredClone(server) }], nextCursor: 'cursor', hasMore: false };
  if (method === 'getLibraryMedia') return { ok: true, media: [media] };
  if (method === 'getLibraryEntry') return { ok: true, entry: structuredClone(server) };
  if (method === 'ensureLibraryMedia') return { ok: true, media };
  if (method !== 'mutateLibraryEntry') throw new Error(method);
  const request = args[0]; requests.push(structuredClone(request));
  if (receipts.has(request.operationId)) return receipts.get(request.operationId);
  if (request.expectedRevision !== server.revision) return { ok: false, code: 'REVISION_CONFLICT', current: structuredClone(server) };
  if (server.deleted && request.action === 'upsert' && !request.restore) return { ok: false, code: 'ENTRY_DELETED', current: structuredClone(server) };
  server = { ...server, ...request.patch, deleted: request.action === 'delete', revision: server.revision + 1 };
  const reply = { ok: true, entry: structuredClone(server) }; receipts.set(request.operationId, reply);
  if (lostResponse) { lostResponse = false; throw new Error('Connection lost after commit'); }
  return reply;
}
let client = new LibraryClient('alice', storage, rpc);
await client.refresh();
failWrite = true;
await assert.rejects(client.queue('title', { isFavorite: true }), /Disk full/);
assert.equal((await client.read()).pending.length, 0);
failWrite = false;
await client.queue('title', { isFavorite: true });
lostResponse = true;
await assert.rejects(client.flush(), /Connection lost/);
const operation = (await client.read()).pending[0].request.operationId;
client = new LibraryClient('alice', storage, rpc);
await client.flush();
assert.equal(requests.at(-1).operationId, operation);
assert.equal(server.revision, 2);
assert.equal(server.notes, 'preserve');
assert.equal((await client.read()).pending.length, 0);

await client.queue('title', { progress: 4 });
server = { ...server, isFavorite: false, revision: 3 };
await client.refresh();
assert.equal((await client.read()).pending.length, 1, 'refresh preserves pending overlay');
await client.flush();
assert.equal((await client.read()).pending[0].error, 'REVISION_CONFLICT');
await client.resolve((await client.read()).pending[0].request.operationId, 'device');
await client.flush();
assert.equal(server.progress, 4);
assert.equal(server.isFavorite, false, 'rebase applies only intended fields');

const oldRevision = server.revision;
server = { ...server, revision: server.revision + 1, notes: 'another device' };
await client.refresh();
await client.queue('title', { notes: 'old editor' }, 'upsert', false, oldRevision);
await client.flush();
assert.equal((await client.read()).pending[0].error, 'REVISION_CONFLICT', 'editor retains revision at open time');
await client.resolve((await client.read()).pending[0].request.operationId, 'cloud');
assert.equal((await client.read()).entries.title.notes, 'another device');

await client.queue('title', { progress: 10 });
server = { ...server, revision: server.revision + 1, deleted: true };
await client.flush();
const conflict = (await client.read()).pending[0].request.operationId;
server = { ...server, revision: server.revision + 1 };
await assert.rejects(client.resolve(conflict, 'device'), /changed again/);
await client.resolve(conflict, 'device');
assert.equal((await client.read()).pending[0].request.restore, true);
await client.flush();
assert.equal(server.deleted, false);

await client.queue('title', { isFavorite: true });
accountChanged = true;
await assert.rejects(client.flush(), /ACCOUNT_CHANGED/);
assert.equal((await client.read()).pending.length, 1);
assert.deepEqual(await new LibraryClient('bob', storage, rpc).read(), emptyState());
accountChanged = false;
await client.flush();

const backup = { format: 'seenary.local-backup', version: 4, data: { entries: { 1: { anime_id: 1, is_favorite: 1, progress: 7 } }, mangaEntries: { '-2': { manga_id: -2, is_favorite: 0 } }, manga: { '-2': { external_ids: { mal: '22' } } }, deletedEntries: { 3: { anime_id: 3 } }, settings: { theme: 'keep' } } };
const candidates = parseBackup(backup, 'alice');
assert.equal(candidates.find(row => row.provider === 'mal').providerId, 22);
assert.equal(candidates[0].patch.isFavorite, true);
assert.equal(candidates[0].patch.notes, undefined, 'missing fields never erase cloud values');
assert.equal(candidates.find(row => row.providerId === 3).deleted, true);
await client.stageImport(backup);
await client.acceptCandidate('ANIME:1', 'device');
client = new LibraryClient('alice', storage, rpc);
assert.equal((await client.read()).candidates[0].done, true);
assert.equal((await client.read()).pending.length, 1);
await client.acceptCandidate('ANIME:1', 'device');
assert.equal((await client.read()).pending.length, 1, 'resume cannot enqueue duplicate upload');
assert.deepEqual((await client.read()).source, backup);
const restoreState = await client.read();
restoreState.candidates.push({ key: 'alternative', type: 'ANIME', provider: 'anilist', providerId: 1, patch: { notes: 'unreviewed device note' }, title: 'Device title' });
const restoredBackup = parseBackup({ format: 'seenary.cloud-backup', version: 1, userId: 'alice', state: restoreState }, 'alice');
assert(restoredBackup.some(item => item.patch.notes === 'unreviewed device note'), 'backup restore retains a device alternative to an existing cloud entry');
assert.throws(() => parseBackup({ ...backup, data: { entries: { 1: { anime_id: 1, is_favorite: 'false' } } } }, 'alice'), /Invalid flag/);
assert.throws(() => parseBackup({ format: 'seenary.cloud-backup', version: 1, userId: 'bob', state: {} }, 'alice'), /another account/);
const cloudBackup = { format: 'seenary.cloud-backup', version: 1, userId: 'alice', state: restoreState, data: { portablePreferences: { version: 1 } } };
const cloudInspection = inspectSeenaryBackup(cloudBackup);
assert.equal(cloudInspection.valid, true, 'the normal cloud export is accepted by the restore picker');
assert.equal(cloudInspection.animeEntries > 0, true);
assert.equal('data' in selectBackupSections(cloudBackup, { restoreLibrary: true, restorePreferences: false }), false);
assert.equal('state' in selectBackupSections(cloudBackup, { restoreLibrary: false, restorePreferences: true }), false);

const before = await client.read();
let page = 0;
const broken = new LibraryClient('alice', storage, async method => {
  if (method === 'getLibraryChanges') return { ok: false, code: 'FULL_SNAPSHOT_REQUIRED' };
  if (++page === 1) return { ok: true, entries: [], nextCursor: 'next', changeCursor: 'new' };
  throw new Error('Interrupted pagination');
});
await assert.rejects(broken.refresh(), /Interrupted pagination/);
assert.deepEqual(await client.read(), before, 'partial snapshot never replaces durable cache');
console.log('PASS: durable writes, lost acknowledgement/restart, conflict rebase, stale editor, tombstone restore, account isolation, resumable imports, MAL identity, backup validation and interrupted snapshots.');
