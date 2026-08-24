import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { env } from '../../config/env.js';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const encryptionKey = () =>
  createHash('sha256')
    .update(env.ADMIN_MFA_ENCRYPTION_KEY ?? env.JWT_SECRET)
    .digest();

const base32Encode = (input: Buffer) => {
  let bits = '';
  for (const byte of input) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let index = 0; index < bits.length; index += 5)
    output += alphabet[Number.parseInt(bits.slice(index, index + 5).padEnd(5, '0'), 2)];
  return output;
};

const base32Decode = (input: string) => {
  let bits = '';
  for (const character of input.replace(/=+$/g, '').toUpperCase()) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error('Invalid base32 secret');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8)
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
};

export const createAdminMfaSecret = () => base32Encode(randomBytes(20));

export const encryptAdminMfaSecret = (secret: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((value) => value.toString('base64url')).join('.');
};

export const decryptAdminMfaSecret = (encrypted: string) => {
  const [iv, tag, value] = encrypted.split('.').map((item) => Buffer.from(item!, 'base64url'));
  if (!iv || !tag || !value) throw new Error('Invalid encrypted MFA secret');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(value), decipher.final()]).toString('utf8');
};

export const adminTotpCode = (secret: string, at = Date.now()) => {
  const counter = Math.floor(at / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, '0');
};

export const verifyAdminTotp = (secret: string, submitted: string, now = Date.now()) =>
  [-1, 0, 1].some((step) => {
    const expected = Buffer.from(adminTotpCode(secret, now + step * 30_000));
    const actual = Buffer.from(submitted);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });

export const adminOtpauthUri = (secret: string, email: string) =>
  `otpauth://totp/${encodeURIComponent(`Footy Finder Admin:${email}`)}?secret=${secret}&issuer=${encodeURIComponent('Footy Finder Admin')}`;
