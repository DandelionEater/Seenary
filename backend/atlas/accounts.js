const crypto = require('node:crypto');
const argon2 = require('argon2');

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const normalize = (name) => String(name || '').trim().toLowerCase();
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const safeUser = (user) => user ? {
  id: user._id, username: user.username, username_normalized: user.username_normalized,
  local_credentials_confirmed: user.local_credentials_confirmed,
  tutorial_dismissed: user.tutorial_dismissed, created_at: user.created_at,
  updated_at: user.updated_at, last_login_at: user.last_login_at,
} : null;

function validPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}

function collections(db, prefix = '') {
  if (prefix && !/^batch1_test_[a-f0-9]+_$/.test(prefix)) throw new Error('Invalid test prefix.');
  return { users: db.collection(`${prefix}users`), sessions: db.collection(`${prefix}sessions`) };
}

async function setupAccounts(db, prefix = '') {
  const repo = collections(db, prefix);
  const schemas = {
    users: { bsonType: 'object', required: ['_id', 'username', 'username_normalized', 'password_hash', 'authVersion', 'schemaVersion', 'created_at', 'updated_at', 'local_credentials_confirmed', 'tutorial_dismissed'], properties: {
      _id: { bsonType: 'string' }, username: { bsonType: 'string', minLength: 3, maxLength: 20 },
      username_normalized: { bsonType: 'string' }, password_hash: { bsonType: 'string' },
      authVersion: { bsonType: 'number', minimum: 0 }, schemaVersion: { enum: [1] },
      local_credentials_confirmed: { bsonType: ['bool', 'null'] }, tutorial_dismissed: { bsonType: 'bool' },
      created_at: { bsonType: 'date' }, updated_at: { bsonType: 'date' }, last_login_at: { bsonType: ['date', 'null'] },
      legacyKey: { bsonType: 'string' }, sourceFingerprint: { bsonType: 'string' },
    } },
    sessions: { bsonType: 'object', required: ['_id', 'userId', 'authVersion', 'expiresAt', 'createdAt'], properties: {
      _id: { bsonType: 'string' }, userId: { bsonType: 'string' }, authVersion: { bsonType: 'number' },
      expiresAt: { bsonType: 'date' }, createdAt: { bsonType: 'date' },
    } },
  };
  for (const [key, schema] of Object.entries(schemas)) {
    const name = repo[key].collectionName;
    const validator = { $jsonSchema: schema };
    try {
      await db.createCollection(name, { validator, validationLevel: 'strict', validationAction: 'error' });
    } catch (error) {
      if (error.code !== 48) throw error;
      const existing = await db.listCollections({ name }).next();
      if (JSON.stringify(existing?.options?.validator) !== JSON.stringify(validator)
          || existing.options.validationLevel !== 'strict' || existing.options.validationAction !== 'error') {
        throw new Error('Existing collection schema differs; explicit schema migration required.');
      }
    }
  }
  await repo.users.createIndex({ username_normalized: 1 }, { unique: true });
  await repo.users.createIndex({ legacyKey: 1 }, { unique: true, partialFilterExpression: { legacyKey: { $type: 'string' } } });
  await repo.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await repo.sessions.createIndex({ userId: 1 });
  return repo;
}

async function createAccountService(repo) {
  const dummyHash = await argon2.hash(crypto.randomBytes(32).toString('hex'), { type: argon2.argon2id });
  async function issueSession(user) {
    if (!user || user.status === 'deleted') throw new Error('Account is unavailable.');
    const token = crypto.randomBytes(32).toString('hex');
    await repo.sessions.insertOne({ _id: tokenHash(token), userId: user._id, authVersion: user.authVersion,
      createdAt: new Date(), expiresAt: new Date(Date.now() + SESSION_MS) });
    return token;
  }
  async function session(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const record = await repo.sessions.findOne({ _id: tokenHash(token), expiresAt: { $gt: new Date() } });
    if (!record) return null;
    return repo.users.findOne({ _id: record.userId, authVersion: record.authVersion, status: { $ne: 'deleted' } });
  }
  return {
    getAuthenticatedUser: session,
    issueSession,
    async register(username, password) {
      if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(username.trim())) {
        return { ok: false, message: 'Username must contain 3–20 letters, numbers, or underscores.' };
      }
      if (!validPassword(password)) return { ok: false, message: 'Password must contain 8–128 characters.' };
      const now = new Date();
      const user = { _id: crypto.randomUUID(), username: username.trim(), username_normalized: normalize(username),
        password_hash: await argon2.hash(password, { type: argon2.argon2id }),
        local_credentials_confirmed: true, tutorial_dismissed: false, authVersion: 0, schemaVersion: 1,
        created_at: now, updated_at: now, last_login_at: now };
      try { await repo.users.insertOne(user); } catch (error) {
        if (error.code === 11000) return { ok: false, message: 'Username is already taken.' };
        throw error;
      }
      return { ok: true, user: safeUser(user), token: await issueSession(user) };
    },
    async login(username, password) {
      if (typeof username !== 'string' || username.length > 100 || !validPassword(password)) {
        return { ok: false, message: 'Invalid username or password.' };
      }
      const user = await repo.users.findOne({ username_normalized: normalize(username), status: { $ne: 'deleted' } });
      const valid = await argon2.verify(user?.password_hash || dummyHash, password);
      if (!user || !valid) return { ok: false, message: 'Invalid username or password.' };
      const updated = await repo.users.findOneAndUpdate({ _id: user._id, authVersion: user.authVersion },
        { $set: { last_login_at: new Date(), local_credentials_confirmed: true } }, { returnDocument: 'after' });
      if (!updated) return { ok: false, message: 'Please sign in again.' };
      return { ok: true, user: safeUser(updated), token: await issueSession(updated) };
    },
    async getSession(token) {
      const user = await session(token);
      return { authenticated: Boolean(user), user: safeUser(user) };
    },
    async logout(token) {
      if (typeof token === 'string') await repo.sessions.deleteOne({ _id: tokenHash(token) });
      return { ok: true };
    },
    async changePassword(token, oldPassword, newPassword) {
      const user = await session(token);
      if (!user) return { ok: false, message: 'You must be logged in.' };
      if (!validPassword(newPassword)) return { ok: false, message: 'Password must contain 8–128 characters.' };
      if (!validPassword(oldPassword) || !await argon2.verify(user.password_hash, oldPassword)) {
        return { ok: false, message: 'Incorrect current password.' };
      }
      const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
      const result = await repo.users.updateOne({ _id: user._id, authVersion: user.authVersion }, {
        $set: { password_hash: passwordHash, updated_at: new Date(), local_credentials_confirmed: true }, $inc: { authVersion: 1 },
      });
      if (!result.modifiedCount) return { ok: false, message: 'Account changed; sign in again.' };
      // The version change atomically revokes all old sessions, even during concurrent login.
      return { ok: true, message: 'Password updated. Sign in again.' };
    },
  };
}

module.exports = { collections, setupAccounts, createAccountService, safeUser, normalize, tokenHash };
