const crypto = require('node:crypto');
const argon2 = require('argon2');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const fail = message => ({ ok: false, message });
const invalidLink = () => fail('This link has expired or has already been used. Request a new link.');

function verificationEmail(code) {
  const explanation = 'You’re receiving this email because someone requested to add this address as a recovery email for a Seenary account.';
  const instruction = 'To confirm that this email belongs to you, enter the code below in the verification window in Seenary. Your recovery email helps you regain access if you forget your password.';
  const safety = 'If you didn’t request this, you can safely ignore this email. This address won’t be added without verification. If you have any concerns, contact us at support@seenary.app.';
  return {
    text: `Verify your Seenary recovery email\n\n${explanation}\n\n${instruction}\n\nYour verification code: ${code}\n\nThis code expires in 10 minutes and can only be used once. Keep it private; Seenary support will never ask you to share it.\n\n${safety}\n\nThe Seenary team`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f3f7;color:#27242e;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden">Confirm your recovery email with a one-time code. Expires in 10 minutes.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:40px 16px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e6e3ec;border-radius:20px;overflow:hidden"><tr><td style="padding:28px 32px;background:#17151c;border-bottom:3px solid #a78bfa"><span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:3px">SEENARY</span><p style="margin:8px 0 0;color:#bcb6ca;font-size:12px">Your anime and manga, all in one place.</p></td></tr><tr><td style="padding:32px"><p style="margin:0 0 12px;color:#78639f;font-size:11px;font-weight:700;letter-spacing:2px">ACCOUNT SECURITY</p><h1 style="margin:0 0 20px;font-size:26px;line-height:34px;color:#211c2c">Verify your recovery email</h1><p style="margin:0 0 16px;font-size:14px;line-height:23px">${explanation}</p><p style="margin:0 0 24px;font-size:14px;line-height:23px">${instruction}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px;background:#f4f0fc;border:1px solid #e6ddf8;border-radius:12px"><p style="margin:0 0 12px;color:#78639f;font-size:10px;font-weight:700;letter-spacing:2px">YOUR VERIFICATION CODE</p><p style="margin:0;color:#49316f;font-family:monospace;font-size:36px;font-weight:700;letter-spacing:8px">${code}</p></td></tr></table><p style="margin:16px 0 24px;color:#706977;font-size:12px;line-height:20px">Expires in <strong>10 minutes</strong> · Single use<br>Keep this code private. Seenary support will never ask you to share it.</p><div style="border-top:1px solid #eeeaf3;padding-top:24px"><h2 style="margin:0 0 8px;font-size:14px;color:#37303f">Didn't request this?</h2><p style="margin:0;color:#706977;font-size:13px;line-height:22px">You can safely ignore this email. This address won’t be added without verification. If you have any concerns, email <a href="mailto:support@seenary.app" style="color:#7051a8;text-decoration:underline">support@seenary.app</a>.</p></div><p style="margin:28px 0 0;font-size:13px;color:#706977">The Seenary team</p></td></tr></table><p style="margin:20px 0 0;color:#8a8492;font-size:11px;line-height:18px">This is an account-security email from Seenary.<br>Need help? <a href="mailto:support@seenary.app" style="color:#7051a8">Contact support</a></p></td></tr></table></body></html>`,
  };
}

function createRecoveryMailer(env = process.env) {
  const configured = Boolean(env.RESEND_API_KEY && env.RECOVERY_EMAIL_FROM && env.RECOVERY_APP_URL);
  let appUrl;
  if (configured) {
    appUrl = new URL(env.RECOVERY_APP_URL);
    if (appUrl.protocol !== 'https:' && !(['localhost', '127.0.0.1'].includes(appUrl.hostname) && appUrl.protocol === 'http:')) throw Error('RECOVERY_APP_URL must use HTTPS.');
    if (appUrl.username || appUrl.password || appUrl.search || appUrl.hash) throw Error('RECOVERY_APP_URL must not include credentials, query, or fragment.');
  }
  return {
    configured,
    async send(to, kind, token) {
      if (!configured) throw Error('Recovery email delivery is not configured.');
      const url = new URL(appUrl);
      // Fragments do not reach web servers or their access logs.
      url.hash = new URLSearchParams({ recovery: kind, token }).toString();
      const verify = kind === 'verify';
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.RECOVERY_EMAIL_FROM, to: [to],
          subject: verify ? 'Verify your Seenary recovery email' : 'Reset your Seenary password',
          ...(verify ? verificationEmail(token) : { text: `Choose a new Seenary password: ${url}\n\nThis link expires in 30 minutes and can be used once. If you did not request this, ignore this email.` }) }),
      });
      if (!response.ok) throw Error('Recovery email delivery failed.');
    },
  };
}

function createRecoveryService(repo, accounts, mailer = createRecoveryMailer()) {
  async function requestVerification(token, rawEmail, password, resending = false) {
    const user = await accounts.getAuthenticatedUser(token);
    if (!user) return fail('You must be logged in.');
    if (user.local_credentials_confirmed !== true) return { ...fail('Set a Seenary password before adding a recovery email.'), needsLocalPassword: true };
    if (!mailer.configured) return fail('Recovery email delivery is not configured yet.');
    if (resending && (!user.recoveryPending?.codeHash || user.recoveryPending.authVersion !== user.authVersion || user.recoveryPending.expiresAt <= new Date())) return fail('Start again with your email and current password to request a new code.');
    const email = resending ? user.recoveryPending.email : normalizeEmail(rawEmail);
    if (!validEmail(email)) return fail('Enter a valid email address.');
    // Password accounts must reauthenticate before changing their recovery address.
    if (!resending && (typeof password !== 'string' || password.length > 128 || !await argon2.verify(user.password_hash, password))) return fail('Incorrect current password.');
    const secret = crypto.randomBytes(32).toString('hex');
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const codeHash = await argon2.hash(code, { type: argon2.argon2id });
    const now = new Date();
    const result = await repo.users.updateOne({ _id: user._id, authVersion: user.authVersion, status: { $ne: 'deleted' }, ...(resending ? { 'recoveryPending.hash': user.recoveryPending.hash } : {}),
      $or: [{ recoverySentAt: { $exists: false } }, { recoverySentAt: { $lt: new Date(Date.now() - 60000) } }] },
    { $set: { recoveryPending: { email, hash: hash(secret), codeHash, attempts: 0, expiresAt: new Date(Date.now() + 600000), authVersion: user.authVersion }, recoverySentAt: now } });
    if (!result.modifiedCount) return fail('Wait a minute before requesting another email, or sign in again.');
    try { await mailer.send(email, 'verify', code); }
    catch { await repo.users.updateOne({ _id: user._id, 'recoveryPending.hash': hash(secret) }, { $unset: { recoveryPending: '', recoverySentAt: '' } }); return fail('Could not send the verification email. Try again later.'); }
    return { ok: true, message: 'We sent a six-digit verification code. It expires in 10 minutes.', resendAt: new Date(now.getTime() + 60000).toISOString() };
  }
  return {
    async getRecoveryEmail(token) {
      const user = await accounts.getAuthenticatedUser(token);
      if (!user) return { ok: true, configured: mailer.configured };
      return { ok: true, configured: mailer.configured, email: user.recoveryEmail || null, pendingEmail: user.recoveryPending?.email || null, pendingCode: Boolean(user.recoveryPending?.codeHash), resendAt: user.recoverySentAt ? new Date(user.recoverySentAt.getTime() + 60000).toISOString() : null };
    },
    setRecoveryEmail: (token, email, password) => requestVerification(token, email, password),
    resendRecoveryEmailCode: token => requestVerification(token, null, null, true),
    async verifyRecoveryEmailCode(token, code) {
      if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return fail('Enter the six-digit code from your email.');
      const user = await accounts.getAuthenticatedUser(token);
      if (!user) return fail('You must be logged in.');
      const pending = user.recoveryPending;
      const invalid = () => fail('Incorrect or expired code. Codes allow five attempts; request a new one if needed.');
      if (!pending?.codeHash || pending.authVersion !== user.authVersion) return invalid();
      // Reserve an attempt before checking the hash, including concurrent guesses.
      const reserved = await repo.users.findOneAndUpdate({ _id: user._id, authVersion: user.authVersion, status: { $ne: 'deleted' },
        'recoveryPending.hash': pending.hash, 'recoveryPending.expiresAt': { $gt: new Date() }, 'recoveryPending.attempts': { $lt: 5 } },
        { $inc: { 'recoveryPending.attempts': 1 } }, { returnDocument: 'after' });
      if (!reserved || !await argon2.verify(pending.codeHash, code)) return invalid();
      try {
        const result = await repo.users.updateOne({ _id: user._id, authVersion: user.authVersion, status: { $ne: 'deleted' },
          'recoveryPending.hash': pending.hash, 'recoveryPending.attempts': { $lte: 5 }, 'recoveryPending.expiresAt': { $gt: new Date() } },
          { $set: { recoveryEmail: pending.email, updated_at: new Date() }, $unset: { recoveryPending: '', passwordReset: '' } });
        return result.modifiedCount ? { ok: true, message: 'Recovery email verified.' } : invalid();
      } catch (error) {
        if (error.code === 11000) return fail('This email is already used by another account. Choose a different recovery email.');
        throw error;
      }
    },
    async verifyRecoveryEmail(secret) {
      if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) return invalidLink();
      const user = await repo.users.findOne({ 'recoveryPending.hash': hash(secret), 'recoveryPending.codeHash': { $exists: false }, 'recoveryPending.expiresAt': { $gt: new Date() }, status: { $ne: 'deleted' } });
      if (!user || user.recoveryPending.authVersion !== user.authVersion) return invalidLink();
      try {
        const result = await repo.users.updateOne({ _id: user._id, authVersion: user.authVersion, 'recoveryPending.hash': hash(secret), 'recoveryPending.expiresAt': { $gt: new Date() }, status: { $ne: 'deleted' } },
          { $set: { recoveryEmail: user.recoveryPending.email, updated_at: new Date() }, $unset: { recoveryPending: '', passwordReset: '' } });
        return result.modifiedCount ? { ok: true, message: 'Recovery email verified. You can now use it to reset your password.' } : invalidLink();
      } catch (error) {
        if (error.code === 11000) return fail('This email is already used by another account. Choose a different recovery email.');
        throw error;
      }
    },
    async requestPasswordReset(rawEmail) {
      if (!mailer.configured) return fail('Recovery email delivery is not configured yet.');
      const email = normalizeEmail(rawEmail);
      if (!validEmail(email)) return fail('Enter a valid email address.');
      const generic = { ok: true, message: 'If an account has this verified recovery email, a reset link will arrive shortly. Check your spam folder too.' };
      const user = await repo.users.findOne({ recoveryEmail: email, status: { $ne: 'deleted' } });
      if (!user) return generic;
      const secret = crypto.randomBytes(32).toString('hex');
      const result = await repo.users.updateOne({ _id: user._id, authVersion: user.authVersion, recoveryEmail: email, status: { $ne: 'deleted' },
        $or: [{ resetSentAt: { $exists: false } }, { resetSentAt: { $lt: new Date(Date.now() - 60000) } }] },
      { $set: { passwordReset: { hash: hash(secret), expiresAt: new Date(Date.now() + 1800000), authVersion: user.authVersion }, resetSentAt: new Date() } });
      if (!result.modifiedCount) return generic;
      try { await mailer.send(email, 'reset', secret); }
      catch { await repo.users.updateOne({ _id: user._id, 'passwordReset.hash': hash(secret) }, { $unset: { passwordReset: '', resetSentAt: '' } }); }
      return generic;
    },
    async resetPassword(secret, password) {
      if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) return invalidLink();
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) return fail('Password must contain 8–128 characters.');
      const user = await repo.users.findOne({ 'passwordReset.hash': hash(secret), 'passwordReset.expiresAt': { $gt: new Date() }, status: { $ne: 'deleted' } });
      if (!user || user.passwordReset.authVersion !== user.authVersion) return invalidLink();
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      const result = await repo.users.updateOne({ _id: user._id, authVersion: user.authVersion, 'passwordReset.hash': hash(secret), 'passwordReset.expiresAt': { $gt: new Date() }, status: { $ne: 'deleted' } },
        { $set: { password_hash: passwordHash, local_credentials_confirmed: true, updated_at: new Date() }, $inc: { authVersion: 1 }, $unset: { passwordReset: '', recoveryPending: '' } });
      return result.modifiedCount ? { ok: true, message: 'Password reset. Sign in with your new password. All previous sessions are signed out.' } : invalidLink();
    },
  };
}

module.exports = { createRecoveryService, createRecoveryMailer, verificationEmail };
