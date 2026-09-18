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
    async begin(provider, mode, token, binding, username) {
      if (!validProvider(provider) || !['login', 'link'].includes(mode) || !/^[a-f0-9]{64}$/.test(binding || '')) return fail('Invalid authorization request.');
      const user = mode === 'link' ? await accounts.getAuthenticatedUser(token) : null;
      if (mode === 'link' && !user) return fail('You must be logged in.');
      if (username != null && (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(username.trim()))) return fail('Invalid Seenary username.');
      const state = crypto.randomBytes(32).toString('hex');
      const verifier = provider === 'mal' ? crypto.randomBytes(48).toString('base64url') : null;
      const authorizationUrl = adapters[provider].authorize(state, verifier);
      await repo.oauthFlows.insertOne({ _id: tokenHash(state), provider, mode, bindingHash: tokenHash(binding),
        userId: user?._id || null, authVersion: user?.authVersion ?? null, sessionHash: user ? tokenHash(token) : null,
        username: username?.trim() || null, verifier: cipher.encrypt(verifier), expiresAt: new Date(Date.now() + 10 * 60000) });
      return { ok: true, authorizationUrl };
    },
    async complete(provider, state, code, binding) {
      if (!validProvider(provider) || !/^[a-f0-9]{64}$/.test(state || '') || !/^[a-f0-9]{64}$/.test(binding || '')
          || typeof code !== 'string' || !code || code.length > 4096) return fail('Invalid or expired authorization.');
      const flow = await repo.oauthFlows.findOneAndDelete({ _id: tokenHash(state), provider, bindingHash: tokenHash(binding), expiresAt: { $gt: new Date() } });
      if (!flow) return fail('Invalid or expired authorization.');
      // Network requests happen outside transactions; identity comes only from the provider.
      const tokens = await adapters[provider].exchange(code, cipher.decrypt(flow.verifier));
      const fields = tokenFields(tokens, cipher);
      const viewer = await adapters[provider].viewer(tokens.access_token);
      if (!Number.isSafeInteger(viewer?.id) || viewer.id <= 0 || typeof viewer.name !== 'string' || !viewer.name || viewer.name.length > 100) return fail('Provider returned invalid identity.');
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
          const current = await repo.providerAccounts.findOne({ userId: user._id }, { session });
          if (current && (current.provider !== provider || current.providerUserId !== String(viewer.id))) {
            return fail('Unlink the current provider before linking a different account.');
          }
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
        if (error.code === 11000) return fail('Username or provider account is already in use.');
        throw error;
      }
      if (!result.ok) return result;
      return { ok: true, user: safeUser(result.user), account: result.account,
        ...(flow.mode === 'login' ? { token: await accounts.issueSession(result.user) } : {}) };
    },
    async getLink(token) {
      const user = await accounts.getAuthenticatedUser(token);
      return user ? { ok: true, account: publicLink(await repo.providerAccounts.findOne({ userId: user._id })) } : fail('You must be logged in.');
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
    async unlink(token, password) {
      const user = await accounts.getAuthenticatedUser(token);
      if (!user || typeof password !== 'string' || password.length > 128 || !password
          || !await argon2.verify(user.password_hash, password)) return fail('Confirm your Seenary password before unlinking.');
      return authenticatedWrite(token, async (current, session) => {
        if (current.authVersion !== user.authVersion) return fail('Account changed; sign in again.');
        const link = await repo.providerAccounts.findOne({ userId: user._id }, { session });
        if (link) await repo.providerAccounts.deleteOne({ _id: link._id }, { session });
        await repo.oauthFlows.deleteMany({ userId: user._id }, { session });
        await cancelWork(user._id, session, link?.provider);
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
          needsDeviceReconciliation: stored?.needsDeviceReconciliation ?? true } };
      }
      if (!patch || typeof patch !== 'object' || Object.keys(patch).length !== 1 || typeof patch.autoSyncEnabled !== 'boolean') return fail('Invalid account settings.');
      return authenticatedWrite(token, async (current, session) => {
        const settings = { autoSyncEnabled: patch.autoSyncEnabled, needsDeviceReconciliation: false };
        await repo.accountSettings.updateOne({ _id: current._id }, { $set: { ...settings, updatedAt: new Date() } }, { upsert: true, session });
        return { ok: true, settings };
      });
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
        return { ok: true, message: 'Staging account deleted. Its migration identity is retained to prevent re-import.' };
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
