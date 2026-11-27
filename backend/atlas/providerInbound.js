const crypto = require('node:crypto');
const { createProviderBudget } = require('./providerBudget');
const { DEFAULT_FIELDS, entryKey } = require('./library');
const LEASE_MS = 5 * 60000;
const MAX_PULL_ATTEMPTS = 6;

const STATUS = { CURRENT: 'watching', REPEATING: 'watching', PLANNING: 'planned', COMPLETED: 'completed', PAUSED: 'paused', DROPPED: 'dropped',
  watching: 'watching', reading: 'watching', completed: 'completed', on_hold: 'paused', dropped: 'dropped', plan_to_watch: 'planned', plan_to_read: 'planned' };
const date = value => {
  if (value && typeof value === 'object') value = value.year && value.month && value.day
    ? `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}` : null;
  return typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && new Date(value).toISOString().slice(0, 10) === value ? value : null;
};
const remoteTime = value => {
  const number = Number(value); if (Number.isFinite(number) && number > 0) return number < 100000000000 ? number * 1000 : number;
  const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : 0;
};

function normalize(provider, type, payload) {
  const rows = provider === 'anilist' ? (payload?.lists || []).flatMap(list => list.entries || []) : payload?.data || [];
  const seen = new Set(); const result = [];
  for (const row of rows) {
    const media = provider === 'anilist' ? row.media : row.node; const personal = provider === 'anilist' ? row : row.list_status;
    const providerId = Number(media?.id); const status = STATUS[personal?.status];
    if (!Number.isSafeInteger(providerId) || providerId <= 0 || !status || seen.has(providerId)) continue;
    seen.add(providerId);
    const progress = provider === 'anilist' ? personal.progress : type === 'ANIME' ? personal.num_episodes_watched : personal.num_chapters_read;
    const volumeProgress = provider === 'anilist' ? personal.progressVolumes : personal.num_volumes_read;
    const repeatCount = provider === 'anilist' ? personal.repeat : type === 'ANIME' ? personal.num_times_rewatched : personal.num_times_reread;
    const score = personal.score == null ? null : Number(personal.score);
    result.push({ providerId, malId: provider === 'anilist' && Number.isSafeInteger(media.idMal) && media.idMal > 0 ? media.idMal : null,
      type, publicMedia: media, remoteUpdatedAt: remoteTime(provider === 'anilist' ? personal.updatedAt : personal.updated_at), fields: {
        status, progress: Number.isSafeInteger(progress) && progress >= 0 ? progress : 0,
        volumeProgress: type === 'MANGA' && Number.isSafeInteger(volumeProgress) && volumeProgress >= 0 ? volumeProgress : 0,
        score: Number.isFinite(score) && score >= 0 && score <= 10 ? score : null,
        notes: typeof personal.notes === 'string' ? personal.notes : typeof personal.comments === 'string' ? personal.comments : null,
        startedAt: date(provider === 'anilist' ? personal.startedAt : personal.start_date),
        completedAt: date(provider === 'anilist' ? personal.completedAt : personal.finish_date),
        repeatCount: Number.isSafeInteger(repeatCount) && repeatCount >= 0 ? repeatCount : 0,
        isRepeating: provider === 'anilist' ? personal.status === 'REPEATING'
          : Boolean(type === 'ANIME' ? personal.is_rewatching : personal.is_rereading),
      } });
  }
  return result;
}

function createProviderInbound({ client, repo, media, cipher, adapters, metadata = {}, now = () => Date.now(), spacing, intervalMs = 6 * 3600000,
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
  const budget = createProviderBudget({ collection: repo.providerBudgets, now, spacing });
  async function reserve(provider, checkActive) {
    let slot = await budget.reserve(provider);
    // A fast response can leave the previous request's spacing window open.
    // Wait inside the current pull before falling back to the worker's retry queue.
    const deadline = now() + 5000;
    while (!slot.ok && now() + slot.retryAfter * 1000 <= deadline) {
      await wait(slot.retryAfter * 1000);
      await checkActive?.();
      slot = await budget.reserve(provider);
    }
    if (!slot.ok) throw Object.assign(new Error('Budget busy'), { code: 'PROVIDER_BUDGET', retryAfter: slot.retryAfter });
  }
  async function seed(limit = 100) {
    const links = await repo.providerAccounts.find({ needsReauthorization: { $ne: true } }).limit(limit).toArray();
    for (const link of links) {
      const session = client.startSession();
      try { await session.withTransaction(async () => {
        // Deletion/unlink removes this document in its erasure transaction. A write
        // here forces concurrent erasure to serialize with creation of worker state.
        const current = await repo.providerAccounts.findOneAndUpdate({ _id: link._id, userId: link.userId },
          { $inc: { inboundRevision: 1 } }, { session, returnDocument: 'after' });
        if (!current) return;
        await repo.providerRefreshStates.findOneAndUpdate({ _id: current._id }, { $setOnInsert: { _id: current._id, userId: current.userId,
          provider: current.provider, linkRevision: current.revision, revision: 0, nextAttemptAt: new Date(0) } }, { upsert: true, returnDocument: 'after', session });
      }); } finally { await session.endSession(); }
    }
  }
  async function token(link) {
    if (link.provider !== 'mal' || !link.expiresAt || new Date(link.expiresAt).getTime() > now() + 60000) return cipher.decrypt(link.accessToken);
    if (!link.refreshToken) throw Object.assign(new Error('Reauthorization required'), { code: 'REAUTHORIZATION_REQUIRED', terminal: true });
    await reserve('mal');
    const lease = crypto.randomUUID();
    const held = await repo.providerAccounts.findOneAndUpdate({ _id: link._id, revision: link.revision,
      $or: [{ refreshLeaseUntil: { $exists: false } }, { refreshLeaseUntil: { $lte: new Date(now()) } }] },
    { $set: { refreshLease: lease, refreshLeaseUntil: new Date(now() + 60000) } }, { returnDocument: 'after' });
    if (!held) throw Object.assign(new Error('Refresh busy'), { code: 'TOKEN_REFRESH_BUSY', retryAfter: 2 });
    try {
      const oldRefresh = cipher.decrypt(held.refreshToken); const value = await adapters.refresh(oldRefresh);
      if (!value?.access_token) throw Object.assign(new Error('Invalid token response'), { code: 'REAUTHORIZATION_REQUIRED', terminal: true });
      const updated = await repo.providerAccounts.findOneAndUpdate({ _id: held._id, revision: held.revision, refreshLease: lease },
        { $set: { accessToken: cipher.encrypt(value.access_token), refreshToken: cipher.encrypt(value.refresh_token || oldRefresh),
          expiresAt: value.expires_in == null ? null : new Date(now() + Number(value.expires_in) * 1000), updatedAt: new Date(now()), needsReauthorization: false },
          $inc: { revision: 1 }, $unset: { refreshLease: '', refreshLeaseUntil: '' } }, { returnDocument: 'after' });
      if (!updated) throw Object.assign(new Error('Refresh race'), { code: 'TOKEN_REFRESH_BUSY', retryAfter: 2 });
      return value.access_token;
    } catch (error) {
      await repo.providerAccounts.updateOne({ _id: held._id, refreshLease: lease }, { $unset: { refreshLease: '', refreshLeaseUntil: '' },
        ...([400, 401].includes(Number(error.status)) || error.terminal ? { $set: { needsReauthorization: true } } : {}) });
      throw error;
    }
  }
  async function apply(userId, provider, item, mediaId, observedAt, claim, link) {
    const session = client.startSession();
    try { return await session.withTransaction(async () => {
      // Checking outside this transaction leaves a gap where deletion can finish
      // before an upsert recreates private library data. Both fences are writes.
      const linked = await repo.providerAccounts.findOneAndUpdate({ _id: link._id, userId, provider, revision: link.revision, needsReauthorization: { $ne: true } },
        { $inc: { inboundRevision: 1 } }, { session, returnDocument: 'after' });
      if (!linked) return 'claim-lost';
      const owned = await repo.providerRefreshStates.findOneAndUpdate({ _id: claim.state._id, leaseOwner: claim.owner, leaseUntil: { $gt: new Date(now()) } },
        { $inc: { revision: 1 } }, { session, returnDocument: 'after' });
      if (!owned) return 'claim-lost';
      const id = entryKey(userId, mediaId); const current = await repo.libraryEntries.findOne({ _id: id }, { session });
      if (current && new Date(current.updatedAt || 0).getTime() > observedAt) return 'newer-cloud';
      const previousRemote = new Date(current?.inboundSources?.[provider] || 0).getTime();
      if (item.remoteUpdatedAt && previousRemote >= item.remoteUpdatedAt) return 'already-applied';
      if (provider === 'mal' && new Date(current?.inboundSources?.anilist || 0).getTime() > (item.remoteUpdatedAt || observedAt)) return 'anilist-newer';
      const fields = { ...DEFAULT_FIELDS, ...Object.fromEntries(Object.keys(DEFAULT_FIELDS).filter(key => current && Object.hasOwn(current, key)).map(key => [key, current[key]])), ...item.fields };
      const changed = !current || current.deleted || Object.keys(DEFAULT_FIELDS).some(key => current[key] !== fields[key]);
      if (!changed) {
        await repo.libraryEntries.updateOne({ _id: id, revision: current.revision }, {
          $set: { [`inboundSources.${provider}`]: new Date(item.remoteUpdatedAt || observedAt) },
        }, { session });
        return 'unchanged';
      }
      const state = await repo.libraryState.findOneAndUpdate({ _id: userId }, { $inc: { sequence: 1 },
        $setOnInsert: { epoch: crypto.randomUUID(), retainedFrom: 0 } }, { upsert: true, returnDocument: 'after', session });
      const next = { _id: id, userId, mediaId, type: item.type, ...fields, deleted: false, revision: (current?.revision || 0) + 1,
        statusChangedAt: current?.status === fields.status ? current.statusChangedAt || current.updatedAt || new Date(observedAt) : new Date(observedAt),
        sequence: state.sequence, inboundSources: { ...(current?.inboundSources || {}), [provider]: new Date(item.remoteUpdatedAt || observedAt) },
        createdAt: current?.createdAt || new Date(observedAt), updatedAt: new Date(observedAt), localUpdatedAt: current?.localUpdatedAt || null };
      let saved;
      if (current) { const { _id, ...fieldsToSet } = next;
        saved = await repo.libraryEntries.findOneAndUpdate({ _id: id, revision: current.revision }, { $set: fieldsToSet }, { returnDocument: 'after', session }); }
      else { try { await repo.libraryEntries.insertOne(next, { session }); saved = next; } catch (error) { if (error.code !== 11000) throw error; } }
      if (!saved) return 'revision-conflict';
      await repo.libraryChanges.insertOne({ _id: crypto.randomUUID(), userId, mediaId, epoch: state.epoch, sequence: state.sequence,
        entry: next, createdAt: new Date(observedAt), source: `provider:${provider}` }, { session });
      return 'applied';
    }); } finally { await session.endSession(); }
  }
  async function finish(claim, update) {
    return repo.providerRefreshStates.updateOne({ _id: claim.state._id, leaseOwner: claim.owner, leaseUntil: { $gt: new Date(now()) } }, { ...update,
      $unset: { ...(update.$unset || {}), progress: '', leaseOwner: '', leaseUntil: '' }, $inc: { revision: 1 } });
  }
  const service = {
    seed,
    async runOnce(limit = 10) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid refresh limit.');
      await seed(Math.min(limit * 10, 500));
      const due = await repo.providerRefreshStates.find({ nextAttemptAt: { $lte: new Date(now()) },
        $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: new Date(now()) } }] }).sort({ nextAttemptAt: 1 }).limit(limit * 10).toArray();
      const results = [];
      for (const state of due) {
        if (results.length >= limit) break;
        const owner = crypto.randomUUID();
        const claimedAt = new Date(now());
        const held = await repo.providerRefreshStates.findOneAndUpdate({ _id: state._id, revision: state.revision,
          nextAttemptAt: { $lte: claimedAt },
          $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: claimedAt } }] },
        { $set: { leaseOwner: owner, leaseUntil: new Date(+claimedAt + LEASE_MS),
          progress: { stage: 'starting', current: 0, total: null, updatedAt: claimedAt } }, $inc: { revision: 1 } }, { returnDocument: 'after' });
        if (held) results.push(await service.refresh({ owner, state: held }));
      }
      return { claimed: results.length, results };
    },
    async refresh(claim) {
      const observedAt = now(); const state = await repo.providerRefreshStates.findOne({ _id: claim.state._id, leaseOwner: claim.owner, leaseUntil: { $gt: new Date(observedAt) } });
      if (!state) return { status: 'claim-lost' };
      let link = await repo.providerAccounts.findOne({ _id: state._id, userId: state.userId, provider: state.provider });
      const settings = await repo.accountSettings.findOne({ _id: state.userId });
      const manual = Boolean(state.manualRequestedAt);
      const needsReauthorization = link?.needsReauthorization || (state.lastOutcome === 'reauthorization-required' && state.linkRevision === link?.revision);
      if (!link || (!manual && settings?.autoSyncEnabled !== true) || needsReauthorization) {
        await finish(claim, { $set: { nextAttemptAt: new Date(observedAt + intervalMs), lastOutcome: !link ? 'unlinked' : needsReauthorization ? 'reauthorization-required' : 'disabled' },
          ...(manual ? { $unset: { manualRequestedAt: '' } } : {}) });
        return { status: 'skipped' };
      }
      let renewAt = observedAt + 60000;
      const checkActive = async () => {
        const checkedAt = now();
        const filter = { _id: state._id, leaseOwner: claim.owner, leaseUntil: { $gt: new Date(checkedAt) } };
        const renew = checkedAt >= renewAt;
        const [linked, owned] = await Promise.all([
          repo.providerAccounts.findOne({ _id: link._id, userId: state.userId, needsReauthorization: { $ne: true } }),
          renew ? repo.providerRefreshStates.findOneAndUpdate(filter, { $set: { leaseUntil: new Date(checkedAt + LEASE_MS) } }, { returnDocument: 'after' })
            : repo.providerRefreshStates.findOne(filter),
        ]);
        if (!linked || !owned) throw Object.assign(new Error('Pull cancelled'), { code: 'PULL_CANCELLED' });
        if (renew) renewAt = checkedAt + 60000;
      };
      let phase = 'authorization';
      const fetched = {};
      const report = (stage, current, total) => repo.providerRefreshStates.updateOne(
        { _id: state._id, leaseOwner: claim.owner, leaseUntil: { $gt: new Date(now()) } },
        { $set: { progress: { stage, current, total, fetched, updatedAt: new Date(now()) } } });
      try {
        await report('fetching', 0, 2);
        const access = await token(link); await checkActive(); link = await repo.providerAccounts.findOne({ _id: link._id });
        if (!link) return { status: 'skipped' };
        const all = [];
        for (const type of ['ANIME', 'MANGA']) {
          phase = type === 'ANIME' ? 'fetch-anime' : 'fetch-manga';
          await checkActive();
          await reserve(link.provider, checkActive);
          await checkActive();
          const payload = await adapters.pull(link.provider, access, type, link.providerUserId, checkActive);
          await checkActive();
          phase = type === 'ANIME' ? 'normalize-anime' : 'normalize-manga';
          const items = normalize(link.provider, type, payload);
          all.push(...items);
          fetched[type] = items.length;
          await report('fetching', Object.keys(fetched).length, 2);
        }
        if (link.provider === 'anilist' && metadata.anilist) {
          phase = 'hydrate';
          await report('hydrating', 0, all.length);
          for (let index = 0; index < all.length; index++) {
            await checkActive();
            await metadata.anilist(all[index].publicMedia, all[index].type, observedAt);
            if ((index + 1) % 10 === 0 || index + 1 === all.length) await report('hydrating', index + 1, all.length);
          }
        }
        if (link.provider === 'mal') {
          phase = 'mapping';
          let mapped = 0;
          await report('mapping', 0, all.length);
          for (const type of ['ANIME', 'MANGA']) {
            const items = all.filter(item => item.type === type); const ids = items.map(item => item.providerId);
            for (let offset = 0; offset < ids.length; offset += 50) {
              await checkActive();
              await reserve('anilist', checkActive); await checkActive(); const rows = await adapters.mapMal(type, ids.slice(offset, offset + 50));
              const byMal = new Map((rows || []).filter(row => row.type === type && Number.isSafeInteger(row.idMal)).map(row => [row.idMal, row]));
              for (const item of items.slice(offset, offset + 50)) {
                await checkActive();
                item.mapping = byMal.get(item.providerId) || null;
                if (item.mapping && metadata.anilist) await metadata.anilist(item.mapping, type, observedAt);
                if (metadata.mal) await metadata.mal(item.publicMedia, type, observedAt);
              }
              mapped += Math.min(50, ids.length - offset);
              await report('mapping', mapped, all.length);
            }
          }
        }
        phase = 'reconcile';
        const providerKey = link.provider === 'anilist' ? 'anilistId' : 'malId';
        const mediaRows = all.length ? await repo.media.find({ $or: all.map(item => ({ type: item.type, [providerKey]: item.providerId })) }).toArray() : [];
        const mediaByProvider = new Map(mediaRows.map(document => [`${document.type}:${document[providerKey]}`, document]));
        const mediaIds = mediaRows.map(document => document._id);
        const existingRows = mediaIds.length ? await repo.libraryEntries.find({ userId: state.userId, mediaId: { $in: mediaIds } }).toArray() : [];
        const existingByMedia = new Map(existingRows.map(entry => [entry.mediaId, entry]));
        const pending = all.filter(item => {
          if (!item.remoteUpdatedAt) return true;
          const document = mediaByProvider.get(`${item.type}:${item.providerId}`);
          const entry = document && existingByMedia.get(document._id);
          return !entry || new Date(entry.inboundSources?.[link.provider] || 0).getTime() < item.remoteUpdatedAt;
        });
        const counts = { applied: 0, skipped: all.length - pending.length, review: 0 };
        await report('reconciling', 0, pending.length);
        for (let index = 0; index < pending.length; index++) {
          const item = pending[index];
          await checkActive();
          const stillLinked = await repo.providerAccounts.findOne({ _id: link._id, userId: state.userId, provider: link.provider });
          const stillOwned = await repo.providerRefreshStates.findOne({ _id: state._id, leaseOwner: claim.owner });
          if (!stillLinked || !stillOwned || stillLinked.needsReauthorization) {
            if (stillOwned) await finish(claim, { $set: { nextAttemptAt: new Date(now() + intervalMs), lastOutcome: 'link-changed' } });
            return { status: 'skipped', counts };
          }
          let document = await media.ensure(item.type, link.provider, item.providerId);
          const mapping = link.provider === 'anilist' && item.malId ? { id: item.providerId, idMal: item.malId, type: item.type } : item.mapping;
          if (mapping?.id && mapping.idMal === (item.malId || item.providerId)) {
            try { document = await media.attachVerifiedMapping(document._id, { kind: 'anilist-idMal', type: item.type, anilistId: mapping.id, malId: mapping.idMal }); }
            catch (error) { if (['MAPPING_REVIEW_REQUIRED', 'MAPPING_CONFLICT'].includes(error.code)) counts.review++; else throw error; }
          }
          const outcome = await apply(state.userId, link.provider, item, document._id, observedAt, claim, link);
          if (outcome === 'claim-lost') {
            await finish(claim, { $set: { nextAttemptAt: new Date(now() + 30000), lastOutcome: 'link-changed' } });
            return { status: 'skipped', counts };
          }
          if (outcome === 'applied') counts.applied++; else counts.skipped++;
          if ((index + 1) % 10 === 0 || index + 1 === pending.length) {
            await report('reconciling', index + 1, pending.length);
          }
        }
        phase = 'finish';
        const completed = await finish(claim, { $set: { linkRevision: link.revision, nextAttemptAt: new Date(now() + intervalMs), lastSuccessAt: new Date(now()),
          lastOutcome: 'success', lastCounts: counts, attempts: 0 }, $unset: { progress: '', lastErrorCode: '', lastErrorStatus: '', lastErrorPhase: '', manualRequestedAt: '', retryAfterUntil: '' } });
        if (completed.matchedCount === 0) return { status: 'skipped', counts };
        return { status: 'succeeded', counts };
      } catch (error) {
        if (error.code === 'PULL_CANCELLED') return { status: 'skipped' };
        const status = Number(error.status);
        const httpStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : null;
        const reauthorize = error.terminal || (httpStatus === 401 && ['authorization', 'fetch-anime', 'fetch-manga'].includes(phase))
          || (link.provider === 'mal' && phase === 'authorization' && httpStatus === 400);
        const attempts = (state.lastOutcome === 'failed' ? 0 : state.attempts || 0) + 1;
        const exhausted = attempts >= MAX_PULL_ATTEMPTS || error.code === 'MAL_PAGINATION_LIMIT';
        const failedAt = now();
        const retryAfter = Number(error.retryAfter) * 1000;
        const retry = retryAfter > 0 && Number.isFinite(+new Date(failedAt + retryAfter))
          ? retryAfter : Math.min(30000 * 2 ** (attempts - 1), 6 * 3600000);
        await finish(claim, { $set: { attempts,
          nextAttemptAt: new Date(failedAt + (reauthorize || exhausted ? Math.max(intervalMs, retry) : retry)),
          lastOutcome: reauthorize ? 'reauthorization-required' : exhausted ? 'failed' : 'retry',
          ...(reauthorize ? { linkRevision: link.revision } : {}),
          ...(httpStatus === 429 ? { retryAfterUntil: new Date(failedAt + retry) } : {}),
          lastErrorCode: /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code || '') ? error.code : httpStatus ? `PROVIDER_HTTP_${httpStatus}` : 'PROVIDER_UNAVAILABLE',
          lastErrorStatus: httpStatus, lastErrorPhase: phase }, $unset: { progress: '', ...((reauthorize || exhausted) && manual ? { manualRequestedAt: '' } : {}) } });
        return { status: reauthorize || exhausted ? 'failed' : 'retry' };
      }
    },
  };
  return service;
}

function createInboundAdapters({ anilist, mal, providerAdapters }) {
  return { refresh: token => providerAdapters.mal.refresh(token), mapMal: (type, ids) => anilist.getMediaByMalIds(ids, type, { attempts: 1 }),
    pull: (provider, token, type, userId, checkActive) => provider === 'anilist'
      ? type === 'ANIME' ? anilist.getViewerAnimeCollection(token, Number(userId), { attempts: 1 }) : anilist.getViewerMangaCollection(token, Number(userId), { attempts: 1 })
      : type === 'ANIME' ? mal.getViewerAnimeList(token, { maxEntries: 5000, checkActive, attempts: 1 }) : mal.getViewerMangaList(token, { maxEntries: 5000, checkActive, attempts: 1 }) };
}
module.exports = { createProviderInbound, createInboundAdapters, normalize };
