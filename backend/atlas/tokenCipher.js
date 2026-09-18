const crypto = require('node:crypto');
const PREFIX = 'seenary:v1:';

function createTokenCipher(encoded) {
  const value = String(encoded || '').trim();
  const key = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  if (!value || key.length !== 32) throw new Error('A 32-byte token encryption key is required.');
  return {
    encrypt(value) {
      if (value == null) return null;
      if (typeof value !== 'string' || !value.length || value.length > 20000) throw new Error('Invalid token.');
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return PREFIX + [iv, cipher.getAuthTag(), ciphertext].map((v) => v.toString('base64url')).join(':');
    },
    decrypt(value) {
      if (value == null) return null;
      if (typeof value !== 'string' || !value.startsWith(PREFIX)) throw new Error('Encrypted token required.');
      const parts = value.slice(PREFIX.length).split(':');
      if (parts.length !== 3) throw new Error('Invalid encrypted token.');
      const [iv, tag, ciphertext] = parts.map((v) => Buffer.from(v, 'base64url'));
      if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted token.');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    },
  };
}
module.exports = { createTokenCipher, PREFIX };
