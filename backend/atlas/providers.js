const crypto = require('node:crypto');
const argon2 = require('argon2');
const { tokenHash, safeUser, normalize } = require('./accounts');
const { exportAccountData, eraseAccountData } = require('./accountData');
const fail = (message) => ({ ok: false, message });
const validProvider = (provider) => ['anilist', 'mal'].includes(provider);
const publicLink = (link) => link ? { provider: link.provider, providerUserId: link.providerUserId,
  username: link.username, linked: true, expiresAt: link.expiresAt, needsReauthorization: Boolean(link.needsReauthorization) } : null;

function tokenFields(data, cipher, previousRefresh = null) {
  if (!data || typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 20000) throw new Error('Invalid provider token response.');
  const seconds = Number(data.expires_in);
  const expiry = data.expires_in == null ? null : new Date(Date.now() + seconds * 1000);
  if (expiry && (!Number.isFinite(seconds) || seconds <= 0 || Number.isNaN(expiry.getTime()))) throw new Error('Invalid token expiry.');
  return { accessToken: cipher.encrypt(data.access_token), refreshToken: cipher.encrypt(data.refresh_token || previousRefresh),
    expiresAt: expiry, needsReauthorization: false };
}

function createProviderService({ client, repo, accounts, cipher, adapters }) {
  async function transaction(operation) {
    const session = client.startSession();
    try { return await session.withTransaction(() => operation(session)); }
    finally { await session.endSession(); }
  }
  async function touchUser(userId, session, authVersion) {
    const user = await repo.users.findOneAndUpdate({ _id: userId, status: { $ne: 'deleted' },
      ...(authVersion == null ? {} : { authVersion }) }, { $inc: { lifecycleRevision: 1 } }, { session, returnDocument: 'after' });
    if (!user) throw new Error('Account changed or is unavailable.');
    return user;
  }
  async function authenticatedWrite(token, operation) {
    const user = await accounts.getAuthenticatedUser(token);
    if (!user) return fail('You must be logged in.');
    return transaction(async (session) => {
      if (!await repo.sessions.findOne({ _id: tokenHash(token), expiresAt: { $gt: new Date() } }, { session })) throw new Error('Session expired.');
      const current = await touchUser(user._id, session, user.authVersion);
      return operation(current, session);
    });
  }
  async function cancelWork(userId, session, provider) {
    await repo.jobs.updateMany({ userId, ...(provider ? { provider } : {}), status: { $in: ['pending', 'running', 'retry', 'queued', 'blocked_mapping'] } },
      { $set: { status: 'cancelled', cancelledAt: new Date(), cancellationReason: 'account-link-revoked' } }, { session });
    if (repo.jobLocks) await repo.jobLocks.deleteMany({ userId, ...(provider ? { provider } : {}) }, { session });
    if (repo.providerRefreshStates) await repo.providerRefreshStates.deleteMany({ userId, ...(provider ? { provider } : {}) }, { session });
  }
  return {
    async exportAccount(token) {
      const user = await accounts.getAuthenticatedUser(token);
      return user ? { ok: true, export: await exportAccountData(repo, user) } : fail('You must be logged in.');
    },
    async begin(provider, mode, token, binding, username, delivery = 'popup') {
      if (!validProvider(provider) || !['login', 'link'].includes(mode) || !/^[a-f0-9]{64}$/.test(binding || '')) return fail('Invalid authorization request.');
      if (!['popup', 'poll'].includes(delivery)) return fail('Invalid authorization delivery mode.');
      const user = mode === 'link' ? await accounts.getAuthenticatedUser(token) : null;
      if (mode === 'link' && !user) return fail('You must be logged in.');
      if (username != null && (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(username.trim()))) return fail('Invalid Seenary username.');
      const state = crypto.randomBytes(32).toString('hex');
      const pollToken = delivery === 'poll' ? crypto.randomBytes(32).toString('hex') : null;
      const verifier = provider === 'mal' ? crypto.randomBytes(48).toString('base64url') : null;
      const authorizationUrl = adapters[provider].authorize(state, verifier);
      await repo.oauthFlows.insertOne({ _id: tokenHash(state), provider, mode, bindingHash: tokenHash(binding),
        userId: user?._id || null, authVersion: user?.authVersion ?? null, sessionHash: user ? tokenHash(token) : null,
        username: username?.trim() || null, verifier: cipher.encrypt(verifier), pollHash: pollToken ? tokenHash(pollToken) : null,
        expiresAt: new Date(Date.now() + 10 * 60000) });
      return { ok: true, authorizationUrl, ...(pollToken ? { pollToken } : {}) };
    },
    async complete(provider, state, code, binding) {
      if (!validProvider(provider) || !/^[a-f0-9]{64}$/.test(state || '')) return fail('Invalid or expired authorization.');
      const flowQuery = { _id: tokenHash(state), provider, expiresAt: { $gt: new Date() } };
      const candidate = await repo.oauthFlows.findOne(flowQuery);
      if (!candidate || !candidate.pollHash && (!/^[a-f0-9]{64}$/.test(binding || '') || candidate.bindingHash !== tokenHash(binding))) return fail('Invalid or expired authorization.');
      const flow = await repo.oauthFlows.findOneAndUpdate({ ...flowQuery, mode: candidate.mode },
        { $set: { mode: 'processing' } }, { returnDocument: 'before' });
      if (!flow) return fail('Invalid or expired authorization.');
      const deliver = async (result) => {
        if (flow.pollHash) {
          await repo.oauthFlows.insertOne({ _id: flow.pollHash, provider, mode: 'completion', bindingHash: flow.bindingHash,
            completion: cipher.encrypt(JSON.stringify(result)), expiresAt: new Date(Date.now() + 10 * 60000) });
        }
        await repo.oauthFlows.deleteOne({ _id: flow._id, mode: 'processing' });
        if (!flow.pollHash) return result;
        return { ok: true, delivered: true };
      };
      if (typeof code !== 'string' || !code || code.length > 4096) return deliver(fail('Authorization was denied or cancelled.'));
      try {
      // Network requests happen outside transactions; identity comes only from the provider.
      const tokens = await adapters[provider].exchange(code, cipher.decrypt(flow.verifier));
      const fields = tokenFields(tokens, cipher);
      const viewer = await adapters[provider].viewer(tokens.access_token);
      if (!Number.isSafeInteger(viewer?.id) || viewer.id <= 0 || typeof viewer.name !== 'string' || !viewer.name || viewer.name.length > 100) return deliver(fail('Provider returned invalid identity.'));
      if (flow.mode === 'login' && !flow.username) {
        const owner = await repo.providerAccounts.findOne({ provider, providerUserId: String(viewer.id) });
        if (!owner) {
          const signupToken = crypto.randomBytes(32).toString('hex');
          await repo.oauthFlows.insertOne({ _id: tokenHash(signupToken), provider, mode: 'signup', bindingHash: flow.bindingHash,
            providerUserId: String(viewer.id), providerUsername: viewer.name, accessToken: fields.accessToken,
            refreshToken: fields.refreshToken, providerExpiresAt: fields.expiresAt,
            expiresAt: new Date(Date.now() + 10 * 60000) });
          return deliver({ ok: false, needsUsername: true, signupToken, providerUsername: viewer.name,
            message: `Connected to ${provider === 'anilist' ? 'AniList' : 'MyAnimeList'}. Choose your Seenary username.` });
        }
      }
      const passwordHash = flow.mode === 'login' && flow.username
        ? await argon2.hash(crypto.randomBytes(48).toString('hex'), { type: argon2.argon2id }) : null;
      let result;
      try {
        result = await transaction(async (session) => {
          const owner = await repo.providerAccounts.findOne({ provider, providerUserId: String(viewer.id) }, { session });
          let user;
          if (flow.mode === 'link') {
            if (!await repo.sessions.findOne({ _id: flow.sessionHash, userId: flow.userId, expiresAt: { $gt: new Date() } }, { session })) return fail('Link session expired.');
            user = await touchUser(flow.userId, session, flow.authVersion);
            if (owner && owner.userId !== user._id) return fail('Provider account belongs to another Seenary account. No accounts were merged.');
          } else if (owner) {
            user = await touchUser(owner.userId, session);
          } else {
            if (!flow.username) return fail('Choose a Seenary username and restart provider login.');
            const now = new Date();
            user = { _id: crypto.randomUUID(), username: flow.username, username_normalized: normalize(flow.username),
              password_hash: passwordHash, local_credentials_confirmed: false, tutorial_dismissed: false,
              authVersion: 0, schemaVersion: 1, lifecycleRevision: 0, created_at: now, updated_at: now, last_login_at: now };
            await repo.users.insertOne(user, { session });
          }
          const current = await repo.providerAccounts.findOne({ userId: user._id, provider }, { session });
          const now = new Date();
          const link = { _id: current?._id || crypto.randomUUID(), userId: user._id, provider, providerUserId: String(viewer.id),
            username: viewer.name, originalUsername: current?.originalUsername || viewer.name, ...fields,
            createdAt: current?.createdAt || now, updatedAt: now, lastImportAt: current?.lastImportAt || null,
            revision: (current?.revision ?? -1) + 1 };
          if (current) await repo.providerAccounts.replaceOne({ _id: current._id }, link, { session });
          else await repo.providerAccounts.insertOne(link, { session });
          await repo.users.updateOne({ _id: user._id }, { $set: { last_login_at: now } }, { session });
          return { ok: true, user, account: publicLink(link) };
        });
      } catch (error) {
        if (error.code === 11000) return deliver(fail('Username or provider account is already in use.'));
        throw error;
      }
      if (!result.ok) return deliver(result);
      return deliver({ ok: true, user: safeUser(result.user), account: result.account,
        ...(flow.mode === 'login' ? { token: await accounts.issueSession(result.user) } : {}) });
      } catch {
        return deliver(fail('Provider authorization failed. Restart the authorization flow.'));
      }
    },
    async poll(provider, pollToken) {
      if (!validProvider(provider) || !/^[a-f0-9]{64}$/.test(pollToken || '')) return fail('Invalid authorization status request.');
      const id = tokenHash(pollToken);
      const completion = await repo.oauthFlows.findOneAndDelete({ _id: id, provider, mode: 'completion', expiresAt: { $gt: new Date() } });
      if (completion) return JSON.parse(cipher.decrypt(completion.completion));
      const pending = await repo.oauthFlows.findOne({ provider, pollHash: id, expiresAt: { $gt: new Date() } });
      return pending ? { ok: true, pending: true } : fail('Authorization expired or was cancelled.');
    },
    async completeSignup(provider, signupToken, username, binding) {
      if (!validProvider(provider) || !/^[a-f0-9]{64}$/.test(signupToken || '') || !/^[a-f0-9]{64}$/.test(binding || '')
          || typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(username.trim())) return fail('Invalid account setup request.');
      const flowQuery = { _id: tokenHash(signupToken), provider, mode: 'signup',
        bindingHash: tokenHash(binding), expiresAt: { $gt: new Date() } };
      const flow = await repo.oauthFlows.findOne(flowQuery);
      if (!flow) return fail('Account setup expired. Connect your provider again.');
      const passwordHash = await argon2.hash(crypto.randomBytes(48).toString('hex'), { type: argon2.argon2id });
      try {
        const result = await transaction(async (session) => {
          if (!await repo.oauthFlows.findOneAndDelete(flowQuery, { session })) return fail('Account setup expired. Connect your provider again.');
          const owner = await repo.providerAccounts.findOne({ provider, providerUserId: flow.providerUserId }, { session });
          if (owner) return fail('This provider account is already connected. Return to login and try again.');
          const now = new Date();
          const user = { _id: crypto.randomUUID(), username: username.trim(), username_normalized: normalize(username),
            password_hash: passwordHash, local_credentials_confirmed: false, tutorial_dismissed: false,
            authVersion: 0, schemaVersion: 1, lifecycleRevision: 0, created_at: now, updated_at: now, last_login_at: now };
          await repo.users.insertOne(user, { session });
          const link = { _id: crypto.randomUUID(), userId: user._id, provider, providerUserId: flow.providerUserId,
            username: flow.providerUsername, originalUsername: flow.providerUsername, accessToken: flow.accessToken,
            refreshToken: flow.refreshToken, expiresAt: flow.providerExpiresAt || null, needsReauthorization: false,
            createdAt: now, updatedAt: now, lastImportAt: null, revision: 0 };
          await repo.providerAccounts.insertOne(link, { session });
          return { ok: true, user, account: publicLink(link) };
        });
        if (!result.ok) return result;
        return { ok: true, user: safeUser(result.user), account: result.account, token: await accounts.issueSession(result.user) };
      } catch (error) {
        if (error.code === 11000) return fail('That Seenary username is already in use. Choose another one.');
        throw error;
      }
    },
    async getLink(token, provider) {
      const user = await accounts.getAuthenticatedUser(token);
      if (!user) return fail('You must be logged in.');
      if (provider !== undefined && !validProvider(provider)) return fail('Invalid provider.');
      return { ok: true, account: publicLink(await repo.providerAccounts.findOne({ userId: user._id, ...(provider ? { provider } : {}) })) };
    },
    async setLocalPassword(token, password) {
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) return fail('Password must contain 8–128 characters.');
      const hash = await argon2.hash(password, { type: argon2.argon2id });
      return authenticatedWrite(token, async (user, session) => {
        if (user.local_credentials_confirmed !== false) return fail('Use the current password to change confirmed or legacy credentials.');
        await repo.users.updateOne({ _id: user._id }, { $set: { password_hash: hash, local_credentials_confirmed: true, updated_at: new Date() }, $inc: { authVersion: 1 } }, { session });
        return { ok: true, message: 'Password set. Sign in again.' };
      });
    },
    async unlink(token, provider, password) {
      const user = await accounts.getAuthenticatedUser(token);
      if (!validProvider(provider) || !user || typeof password !== 'string' || password.length > 128 || !password
          || !await argon2.verify(user.password_hash, password)) return fail('Confirm your Seenary password before unlinking.');
      return authenticatedWrite(token, async (current, session) => {
        if (current.authVersion !== user.authVersion) return fail('Account changed; sign in again.');
        const link = await repo.providerAccounts.findOne({ userId: user._id, provider }, { session });
        if (link) await repo.providerAccounts.deleteOne({ _id: link._id }, { session });
        await repo.oauthFlows.deleteMany({ userId: user._id, provider }, { session });
        await cancelWork(user._id, session, provider);
        await repo.users.updateOne({ _id: user._id }, { $inc: { authVersion: 1 }, $set: { local_credentials_confirmed: true } }, { session });
        return { ok: true, message: 'Provider unlinked. Sign in again.' };
      });
    },
    async settings(token, patch) {
      const user = await accounts.getAuthenticatedUser(token);
      if (!user) return fail('You must be logged in.');
      if (patch === undefined) {
        const stored = await repo.accountSettings.findOne({ _id: user._id });
        return { ok: true, settings: { autoSyncEnabled: stored?.autoSyncEnabled ?? false,
          needsDeviceReconciliation: stored?.needsDeviceReconciliation ?? true,
          analyticsConsentDecided: stored?.analyticsConsentDecided === true,
          analyticsEnabled: stored?.analyticsEnabled === true } };
      }
      if (!patch || typeof patch !== 'object' || Object.keys(patch).length !== 1 || typeof patch.autoSyncEnabled !== 'boolean') return fail('Invalid account settings.');
      return authenticatedWrite(token, async (current, session) => {
        const settings = { autoSyncEnabled: patch.autoSyncEnabled, needsDeviceReconciliation: false };
        await repo.accountSettings.updateOne({ _id: current._id }, { $set: { ...settings, updatedAt: new Date() } }, { upsert: true, session });
        return { ok: true, settings };
      });
    },
    async requestInboundSync(token, provider) {
      const user = await accounts.getAuthenticatedUser(token);
      if (!user) return fail('You must be logged in.');
      if (!validProvider(provider)) return fail('Invalid provider.');
      const link = await repo.providerAccounts.findOne({ userId: user._id, provider });
      if (!link) return fail(`No linked ${provider === 'anilist' ? 'AniList' : 'MyAnimeList'} account.`);
      const requestedAt = new Date();
      const pending = await repo.providerRefreshStates.findOne({ _id: link._id });
      if (pending?.manualRequestedAt || pending?.leaseUntil && new Date(pending.leaseUntil) > requestedAt) {
        return { ok: true, requestedAt: pending.manualRequestedAt || requestedAt, alreadyQueued: true };
      }
      await repo.providerRefreshStates.updateOne({ _id: link._id }, {
        $set: { userId: user._id, provider, linkRevision: link.revision,
          nextAttemptAt: requestedAt, manualRequestedAt: requestedAt },
        $setOnInsert: { revision: 0 },
      }, { upsert: true });
      return { ok: true, requestedAt };
    },
    async inboundSyncStatus(token, provider) {
      const user = await accounts.getAuthenticatedUser(token);
      if (!user) return fail('You must be logged in.');
      if (!validProvider(provider)) return fail('Invalid provider.');
      const link = await repo.providerAccounts.findOne({ userId: user._id, provider });
      if (!link) return fail(`No linked ${provider === 'anilist' ? 'AniList' : 'MyAnimeList'} account.`);
      const state = await repo.providerRefreshStates.findOne({ _id: link._id });
      return { ok: true, sync: state ? {
        running: Boolean(state.leaseUntil && new Date(state.leaseUntil) > new Date()),
        requestedAt: state.manualRequestedAt || null,
        lastSuccessAt: state.lastSuccessAt || null,
        lastOutcome: state.lastOutcome || null,
        counts: state.lastCounts || null,
      } : null };
    },
    async syncActivity(token) {
      const user = await accounts.getAuthenticatedUser(token);
      if (!user) return fail('You must be logged in.');
      const jobs = await repo.jobs.find({ userId: user._id, kind: 'provider-library' }).sort({ createdAt: -1 }).limit(200).toArray();
      const mediaIds = [...new Set(jobs.map(job => job.mediaId))];
      const mediaRows = mediaIds.length ? await repo.media.find({ _id: { $in: mediaIds } }).toArray() : [];
      const mediaById = new Map(mediaRows.map(item => [item._id, item]));
      const rows = jobs.map(job => {
        const media = mediaById.get(job.mediaId); const providerId = media?.[job.provider === 'anilist' ? 'anilistId' : 'malId'];
        return { id: job._id, provider: job.provider, operation: job.operation, status: job.status, attempts: job.attempts || 0,
          media_type: job.mediaType, ...(job.mediaType === 'MANGA' ? { manga_id: providerId } : { anime_id: providerId }),
          animeTitle: media?.metadata?.title_preferred || media?.metadata?.title_english || media?.metadata?.title_romaji || null,
          last_error: job.lastError || null, next_attempt_at: job.nextAttemptAt || null, created_at: job.createdAt, updated_at: job.updatedAt || null };
      });
      const selected = (...statuses) => rows.filter(row => statuses.includes(row.status));
      const refreshes = await repo.providerRefreshStates.find({ userId: user._id }).toArray();
      const pulled = refreshes.filter(item => item.lastSuccessAt).map(item => ({ id: item._id, provider: item.provider,
        operation: `pull-${item.provider}`, status: item.lastOutcome || 'completed', created_at: item.lastSuccessAt,
        updated_at: item.lastSuccessAt, message: item.lastCounts ? JSON.stringify(item.lastCounts) : null }));
      return { ok: true, pending: selected('pending', 'retry', 'queued', 'running', 'blocked_mapping'), completed: selected('succeeded'),
        failed: selected('failed', 'reauthorization_required'), excluded: selected('excluded'), pulled };
    },
    async setSyncExclusion(token, jobId, excluded) {
      const user = await accounts.getAuthenticatedUser(token);
      if (!user) return fail('You must be logged in.');
      if (typeof jobId !== 'string' || !jobId) return fail('Invalid sync entry.');
      const job = await repo.jobs.findOne({ _id: jobId, userId: user._id, kind: 'provider-library' });
      if (!job) return fail('Sync entry was not found.');
      if (excluded) {
        if (!['pending', 'retry', 'queued', 'blocked_mapping', 'failed'].includes(job.status)) return fail('Only unfinished sync entries can be excluded.');
        await repo.jobs.updateOne({ _id: jobId, userId: user._id }, { $set: { status: 'excluded', updatedAt: new Date() }, $unset: { leaseOwner: '', leaseUntil: '', nextAttemptAt: '' } });
        return { ok: true, message: 'This provider update was excluded.' };
      }
      if (job.status !== 'excluded') return fail('This sync entry is not excluded.');
      await repo.jobs.updateOne({ _id: jobId, userId: user._id }, { $set: { status: job.providerMediaId ? 'pending' : 'blocked_mapping', attempts: 0, updatedAt: new Date() }, $unset: { lastError: '', nextAttemptAt: '' } });
      return { ok: true, message: 'This provider update was restored to the queue.' };
    },
    async deleteAccount(token, username, password) {
      const user = await accounts.getAuthenticatedUser(token);
      if (!user || username !== user.username || typeof password !== 'string' || !password || password.length > 128
          || !await argon2.verify(user.password_hash, password)) return fail('Confirm your username and Seenary password.');
      return authenticatedWrite(token, async (current, session) => {
        if (current.authVersion !== user.authVersion) return fail('Account changed; sign in again.');
        // Includes encrypted credentials, sessions, migration receipts, personal history, outbox payloads, and worker state.
        await eraseAccountData(repo, user._id, session);
        const anonymized = 'deleted_' + crypto.randomBytes(5).toString('hex');
        const migrationBlockHash = current.legacyKey ? crypto.createHash('sha256').update(current.legacyKey).digest('hex') : null;
        await repo.users.updateOne({ _id: user._id }, { $set: { status: 'deleted', username: anonymized,
          username_normalized: anonymized, password_hash: '', local_credentials_confirmed: null, tutorial_dismissed: false,
          last_login_at: null, updated_at: new Date(), deletedAt: new Date(), ...(migrationBlockHash ? { migrationBlockHash } : {}) },
          $unset: { sourceFingerprint: '', legacy: '', legacyKey: '' }, $inc: { authVersion: 1 } }, { session });
        return { ok: true, message: 'Account deleted.' };
      });
    },
    async refresh(token) {
      const user = await accounts.getAuthenticatedUser(token);
      if (!user) return fail('You must be logged in.');
      const lease = crypto.randomUUID();
      const link = await repo.providerAccounts.findOneAndUpdate({ userId: user._id,
        $or: [{ refreshLeaseUntil: { $exists: false } }, { refreshLeaseUntil: { $lte: new Date() } }] },
      { $set: { refreshLease: lease, refreshLeaseUntil: new Date(Date.now() + 60000) } }, { returnDocument: 'after' });
      if (!link) return fail('No linked account or a refresh is already running.');
      try {
        if (link.provider === 'anilist') return fail('AniList uses reauthorization instead of refresh tokens.');
        if (!link.refreshToken) return fail('Relink MyAnimeList to refresh its authorization.');
        const previousRefresh = cipher.decrypt(link.refreshToken);
        const data = await adapters.mal.refresh(previousRefresh);
        const fields = tokenFields(data, cipher, previousRefresh);
        return await authenticatedWrite(token, async (current, session) => {
          const result = await repo.providerAccounts.updateOne({ _id: link._id, revision: link.revision, refreshLease: lease,
            refreshLeaseUntil: { $gt: new Date() } }, { $set: { ...fields, updatedAt: new Date() }, $inc: { revision: 1 } }, { session });
          return result.modifiedCount ? { ok: true, refreshed: true } : fail('Link changed; refresh was discarded.');
        });
      } catch (error) {
        if ([400, 401].includes(error.status)) await repo.providerAccounts.updateOne({ _id: link._id, revision: link.revision, refreshLease: lease }, { $set: { needsReauthorization: true } });
        throw error;
      } finally {
        await repo.providerAccounts.updateOne({ _id: link._id, refreshLease: lease }, { $unset: { refreshLease: '', refreshLeaseUntil: '' } });
      }
    },
  };
}
module.exports = { createProviderService, publicLink, tokenFields };
