const { createProviderBudget } = require('./providerBudget');

const STATUS = { planned: 'PLANNING', watching: 'CURRENT', completed: 'COMPLETED', paused: 'PAUSED', dropped: 'DROPPED' };
const safeError = (code, retryable, retryAfter) => ({ code, retryable, ...(retryAfter ? { retryAfter } : {}) });

function createProviderDelivery({ repo, worker, cipher, adapters, now = () => Date.now(), spacing }) {
  const budget = createProviderBudget({ collection: repo.providerBudgets, now, spacing });
  async function reserve(provider) {
    const slot = await budget.reserve(provider);
    if (!slot.ok) throw safeError('PROVIDER_BUDGET', true, slot.retryAfter);
  }
  async function cancel(claim, code) { await worker.cancel(claim, code); return { status: 'cancelled', code }; }
  async function validate(claim) {
    const job = await repo.jobs.findOne({ _id: claim.job._id, status: 'running', leaseOwner: claim.owner });
    if (!job) return { cancel: 'CLAIM_LOST' };
    const [settings, link, entry, media] = await Promise.all([
      repo.accountSettings.findOne({ _id: job.userId }),
      repo.providerAccounts.findOne({ _id: job.providerLinkId, userId: job.userId, provider: job.provider }),
      repo.libraryEntries.findOne({ userId: job.userId, mediaId: job.mediaId }),
      repo.media.findOne({ _id: job.mediaId }),
    ]);
    if (settings?.autoSyncEnabled !== true) return { cancel: 'SYNC_DISABLED' };
    if (!link) return { cancel: 'UNLINKED' };
    if (link.revision < job.providerLinkRevision || link.needsReauthorization) return { cancel: 'REAUTHORIZATION_REQUIRED' };
    if (!entry || entry.revision !== job.libraryRevision || entry.deleted !== (job.operation === 'delete')) return { cancel: 'SUPERSEDED' };
    const providerMediaId = media?.[job.provider === 'anilist' ? 'anilistId' : 'malId'];
    if (!providerMediaId || providerMediaId !== job.providerMediaId || media.type !== job.mediaType) return { cancel: 'MAPPING_CHANGED' };
    return { job, link, entry, media, providerMediaId };
  }
  async function accessToken(claim, context) {
    let { link } = context;
    if (link.provider !== 'mal' || !link.expiresAt || new Date(link.expiresAt).getTime() > now() + 60000) return { token: cipher.decrypt(link.accessToken), link };
    if (!link.refreshToken) throw safeError('REAUTHORIZATION_REQUIRED', false);
    await reserve('mal');
    const current = await validate(claim);
    if (current.cancel) throw safeError(current.cancel, false);
    link = current.link;
    const leaseOwner = context.job._id;
    const leased = await repo.providerAccounts.findOneAndUpdate({ _id: link._id, revision: link.revision,
      $or: [{ refreshLeaseUntil: { $exists: false } }, { refreshLeaseUntil: { $lte: new Date(now()) } }] },
    { $set: { refreshLease: leaseOwner, refreshLeaseUntil: new Date(now() + 60000) } }, { returnDocument: 'after' });
    if (!leased) throw safeError('TOKEN_REFRESH_BUSY', true, 2);
    try {
      const refreshed = await adapters.mal.refresh(cipher.decrypt(leased.refreshToken));
      if (!refreshed?.access_token || refreshed.expires_in != null && (!Number.isFinite(Number(refreshed.expires_in)) || Number(refreshed.expires_in) <= 0)) {
        throw safeError('INVALID_TOKEN_RESPONSE', false);
      }
      const next = { accessToken: cipher.encrypt(refreshed.access_token),
        refreshToken: cipher.encrypt(refreshed.refresh_token || cipher.decrypt(leased.refreshToken)),
        expiresAt: refreshed.expires_in == null ? null : new Date(now() + Number(refreshed.expires_in) * 1000), updatedAt: new Date(now()),
        needsReauthorization: false };
      const updated = await repo.providerAccounts.findOneAndUpdate({ _id: leased._id, revision: leased.revision, refreshLease: leaseOwner },
        { $set: next, $inc: { revision: 1 }, $unset: { refreshLease: '', refreshLeaseUntil: '' } }, { returnDocument: 'after' });
      if (!updated) throw safeError('TOKEN_REFRESH_RACE', true, 2);
      return { token: refreshed.access_token, link: updated };
    } catch (error) {
      if ([400, 401].includes(Number(error.status)) || error.retryable === false) {
        await repo.providerAccounts.updateOne({ _id: leased._id, refreshLease: leaseOwner },
          { $set: { needsReauthorization: true, updatedAt: new Date(now()) }, $unset: { refreshLease: '', refreshLeaseUntil: '' } });
      } else await repo.providerAccounts.updateOne({ _id: leased._id, refreshLease: leaseOwner }, { $unset: { refreshLease: '', refreshLeaseUntil: '' } });
      throw error;
    }
  }
  function payload(context) {
    const entry = context.entry;
    if (context.job.provider === 'anilist') return { mediaId: context.providerMediaId, mediaType: entry.type,
      userId: Number(context.link.providerUserId), status: STATUS[entry.status], progress: entry.progress,
      progressVolumes: entry.volumeProgress, score: entry.score, notes: entry.notes ?? '',
      startedAt: entry.startedAt ?? { year: 0, month: 0, day: 0 },
      completedAt: entry.completedAt ?? { year: 0, month: 0, day: 0 }, repeat: entry.repeatCount };
    return { mediaType: entry.type, status: entry.status, progress: entry.progress, volumeProgress: entry.volumeProgress,
      score: entry.score, notes: entry.notes, started_at: entry.startedAt,
      completed_at: entry.completedAt, repeat_count: entry.repeatCount,
      is_rewatching: entry.isRepeating, is_rereading: entry.isRepeating };
  }
  async function deliver(claim) {
      let context = await validate(claim);
      if (context.cancel) return cancel(claim, context.cancel);
      try {
        const credentials = await accessToken(claim, context);
        context.link = credentials.link;
        await reserve(context.job.provider);
        // Revalidate after reserving the shared budget and immediately before the external mutation.
        context = await validate(claim);
        if (context.cancel) return cancel(claim, context.cancel);
        const token = context.link.revision === credentials.link.revision ? credentials.token : cipher.decrypt(context.link.accessToken);
        const data = payload(context);
        const result = context.job.operation === 'delete'
          ? await adapters[context.job.provider].delete(token, context.providerMediaId, data)
          : await adapters[context.job.provider].upsert(token, context.providerMediaId, data);
        const accepted = await worker.succeed(claim, { providerRevision: result?.updatedAt ?? result?.id ?? result?.deleted });
        return { status: accepted ? 'succeeded' : 'claim-lost' };
      } catch (error) {
        if (['CLAIM_LOST', 'SYNC_DISABLED', 'UNLINKED', 'SUPERSEDED', 'MAPPING_CHANGED'].includes(error.code)) {
          return cancel(claim, error.code);
        }
        const status = Number(error.status);
        if ([400, 401].includes(status) || error.code === 'REAUTHORIZATION_REQUIRED') {
          await repo.providerAccounts.updateOne({ _id: context.link._id, userId: context.job.userId, provider: context.job.provider },
            { $set: { needsReauthorization: true, updatedAt: new Date(now()) } });
          await worker.retry(claim, safeError('REAUTHORIZATION_REQUIRED', false));
          return { status: 'failed', code: 'REAUTHORIZATION_REQUIRED' };
        }
        const retryable = error.retryable !== false && (error.retryable === true || status === 408 || status === 429 || status >= 500);
        const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(String(error.code || '')) ? error.code
          : retryable ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REJECTED';
        await worker.retry(claim, safeError(code, retryable, error.retryAfter));
        return { status: retryable ? 'retry' : 'failed', code };
      }
    }
  return {
    deliver,
    async runOnce(limit = 10) {
      const claims = await worker.claimBatch(limit);
      const results = [];
      for (const claim of claims) results.push(await deliver(claim));
      return { claimed: claims.length, results };
    },
  };
}

function createDeliveryAdapters({ anilist, mal, providerAdapters }) {
  return {
    anilist: {
      upsert: (token, _id, data) => anilist.saveMediaListEntry(token, data),
      delete: (token, _id, data) => anilist.deleteMediaListEntry(token, data),
    },
    mal: {
      refresh: token => providerAdapters.mal.refresh(token),
      upsert: (token, id, data) => data.mediaType === 'MANGA' ? mal.saveMangaListStatus(token, id, data) : mal.saveAnimeListStatus(token, id, data),
      delete: (token, id, data) => data.mediaType === 'MANGA' ? mal.deleteMangaListStatus(token, id) : mal.deleteAnimeListStatus(token, id),
    },
  };
}
module.exports = { createProviderDelivery, createDeliveryAdapters };
