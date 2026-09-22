const crypto = require('node:crypto');
const { createProviderBudget } = require('./providerBudget');
const { DEFAULT_FIELDS, entryKey } = require('./library');

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
    const score = personal.score == null ? null : Number(personal.score) * 10;
    result.push({ providerId, malId: provider === 'anilist' && Number.isSafeInteger(media.idMal) && media.idMal > 0 ? media.idMal : null,
      type, publicMedia: media, remoteUpdatedAt: remoteTime(provider === 'anilist' ? personal.updatedAt : personal.updated_at), fields: {
        status, progress: Number.isSafeInteger(progress) && progress >= 0 ? progress : 0,
        volumeProgress: type === 'MANGA' && Number.isSafeInteger(volumeProgress) && volumeProgress >= 0 ? volumeProgress : 0,
        score: Number.isFinite(score) && score >= 0 && score <= 100 ? score : null,
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

function createProviderInbound({ client, repo, media, cipher, adapters, metadata = {}, now = () => Date.now(), spacing, intervalMs = 6 * 3600000 }) {
  const budget = createProviderBudget({ collection: repo.providerBudgets, now, spacing });
  async function reserve(provider) { const slot = await budget.reserve(provider); if (!slot.ok) throw Object.assign(new Error('Budget busy'), { code: 'PROVIDER_BUDGET', retryAfter: slot.retryAfter }); }
  async function seed(limit = 100) {
    const links = await repo.providerAccounts.find({ needsReauthorization: { $ne: true } }).limit(limit).toArray();
    for (const link of links) await repo.providerRefreshStates.findOneAndUpdate({ _id: link._id }, { $setOnInsert: { _id: link._id, userId: link.userId,
      provider: link.provider, linkRevision: link.revision, revision: 0, nextAttemptAt: new Date(0) } }, { upsert: true, returnDocument: 'after' });
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
  async function apply(userId, provider, item, mediaId, observedAt) {
    const session = client.startSession();
    try { return await session.withTransaction(async () => {
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
    return repo.providerRefreshStates.updateOne({ _id: claim.state._id, leaseOwner: claim.owner }, { ...update,
      $unset: { ...(update.$unset || {}), progress: '', leaseOwner: '', leaseUntil: '' }, $inc: { revision: 1 } });
  }
  const service = {
    seed,
    async claimBatch(limit = 10) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid refresh limit.');
      await seed(Math.min(limit * 10, 500)); const due = await repo.providerRefreshStates.find({ nextAttemptAt: { $lte: new Date(now()) },
        $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: new Date(now()) } }] }).sort({ nextAttemptAt: 1 }).limit(limit * 10).toArray();
      const claims = [];
      for (const state of due) {
        if (claims.length >= limit) break; const owner = crypto.randomUUID();
        const held = await repo.providerRefreshStates.findOneAndUpdate({ _id: state._id, revision: state.revision,
          $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: new Date(now()) } }] },
        { $set: { leaseOwner: owner, leaseUntil: new Date(now() + 5 * 60000),
          progress: { stage: 'starting', current: 0, total: null, updatedAt: new Date(now()) } } }, { returnDocument: 'after' });
        if (held) claims.push({ owner, state: held });
      }
      return claims;
    },
    async refresh(claim) {
      const observedAt = now(); const state = await repo.providerRefreshStates.findOne({ _id: claim.state._id, leaseOwner: claim.owner });
      if (!state) return { status: 'claim-lost' };
      let link = await repo.providerAccounts.findOne({ _id: state._id, userId: state.userId, provider: state.provider });
      const settings = await repo.accountSettings.findOne({ _id: state.userId });
      const manual = Boolean(state.manualRequestedAt);
      if (!link || (!manual && settings?.autoSyncEnabled !== true) || link.needsReauthorization) {
        await finish(claim, { $set: { nextAttemptAt: new Date(observedAt + intervalMs), lastOutcome: !link ? 'unlinked' : link.needsReauthorization ? 'reauthorization-required' : 'disabled' },
          ...(manual ? { $unset: { manualRequestedAt: '' } } : {}) });
        return { status: 'skipped' };
      }
      try {
        await repo.providerRefreshStates.updateOne({ _id: state._id, leaseOwner: claim.owner },
          { $set: { progress: { stage: 'fetching', current: 0, total: null, updatedAt: new Date(now()) } } });
        const access = await token(link); link = await repo.providerAccounts.findOne({ _id: link._id });
        const all = [];
        for (const type of ['ANIME', 'MANGA']) { await reserve(link.provider); all.push(...normalize(link.provider, type, await adapters.pull(link.provider, access, type, link.providerUserId))); }
        if (link.provider === 'anilist' && metadata.anilist) {
          await repo.providerRefreshStates.updateOne({ _id: state._id, leaseOwner: claim.owner },
            { $set: { progress: { stage: 'hydrating', current: 0, total: all.length, updatedAt: new Date(now()) } } });
          for (let index = 0; index < all.length; index++) {
            await metadata.anilist(all[index].publicMedia, all[index].type, observedAt);
            if ((index + 1) % 10 === 0 || index + 1 === all.length) await repo.providerRefreshStates.updateOne({ _id: state._id, leaseOwner: claim.owner },
              { $set: { progress: { stage: 'hydrating', current: index + 1, total: all.length, updatedAt: new Date(now()) } } });
          }
        }
        if (link.provider === 'mal') {
          let mapped = 0;
          await repo.providerRefreshStates.updateOne({ _id: state._id, leaseOwner: claim.owner },
            { $set: { progress: { stage: 'mapping', current: 0, total: all.length, updatedAt: new Date(now()) } } });
          for (const type of ['ANIME', 'MANGA']) {
            const items = all.filter(item => item.type === type); const ids = items.map(item => item.providerId);
            for (let offset = 0; offset < ids.length; offset += 50) {
              await reserve('anilist'); const rows = await adapters.mapMal(type, ids.slice(offset, offset + 50));
              const byMal = new Map((rows || []).filter(row => row.type === type && Number.isSafeInteger(row.idMal)).map(row => [row.idMal, row]));
              for (const item of items.slice(offset, offset + 50)) {
                item.mapping = byMal.get(item.providerId) || null;
                if (item.mapping && metadata.anilist) await metadata.anilist(item.mapping, type, observedAt);
                if (metadata.mal) await metadata.mal(item.publicMedia, type, observedAt);
              }
              mapped += Math.min(50, ids.length - offset);
              await repo.providerRefreshStates.updateOne({ _id: state._id, leaseOwner: claim.owner },
                { $set: { progress: { stage: 'mapping', current: mapped, total: all.length, updatedAt: new Date(now()) } } });
            }
          }
        }
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
        await repo.providerRefreshStates.updateOne({ _id: state._id, leaseOwner: claim.owner },
          { $set: { progress: { stage: 'reconciling', current: 0, total: pending.length, updatedAt: new Date(now()) } } });
        for (let index = 0; index < pending.length; index++) {
          const item = pending[index];
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
          const outcome = await apply(state.userId, link.provider, item, document._id, observedAt);
          if (outcome === 'applied') counts.applied++; else counts.skipped++;
          if ((index + 1) % 10 === 0 || index + 1 === pending.length) {
            await repo.providerRefreshStates.updateOne({ _id: state._id, leaseOwner: claim.owner },
              { $set: { progress: { stage: 'reconciling', current: index + 1, total: pending.length, updatedAt: new Date(now()) } } });
          }
        }
        await finish(claim, { $set: { linkRevision: link.revision, nextAttemptAt: new Date(now() + intervalMs), lastSuccessAt: new Date(now()),
          lastOutcome: 'success', lastCounts: counts, attempts: 0 }, $unset: { progress: '', ...(manual ? { manualRequestedAt: '' } : {}) } });
        return { status: 'succeeded', counts };
      } catch (error) {
        const attempts = (state.attempts || 0) + 1; const retry = error.retryAfter ? error.retryAfter * 1000 : Math.min(30000 * 2 ** (attempts - 1), 6 * 3600000);
        await finish(claim, { $set: { attempts, nextAttemptAt: new Date(now() + retry), lastOutcome: error.terminal ? 'reauthorization-required' : 'retry',
          lastErrorCode: /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code || '') ? error.code : 'PROVIDER_UNAVAILABLE' }, $unset: { progress: '' } });
        return { status: error.terminal ? 'failed' : 'retry' };
      }
    },
    async runOnce(limit = 10) { const claims = await service.claimBatch(limit); const results = []; for (const claim of claims) results.push(await service.refresh(claim)); return { claimed: claims.length, results }; },
  };
  return service;
}

function createInboundAdapters({ anilist, mal, providerAdapters }) {
  return { refresh: token => providerAdapters.mal.refresh(token), mapMal: (type, ids) => anilist.getMediaByMalIds(ids, type),
    pull: (provider, token, type, userId) => provider === 'anilist'
      ? type === 'ANIME' ? anilist.getViewerAnimeCollection(token, Number(userId)) : anilist.getViewerMangaCollection(token, Number(userId))
      : type === 'ANIME' ? mal.getViewerAnimeList(token, { maxEntries: 5000 }) : mal.getViewerMangaList(token, { maxEntries: 5000 }) };
}
module.exports = { createProviderInbound, createInboundAdapters, normalize };
