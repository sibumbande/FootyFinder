import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * TKT-607: AES-256-GCM encryption for sensitive admin-only fields (venue bank details).
 * Each value is bound to its row by additional authenticated data, so a ciphertext copied onto
 * another row fails to decrypt. Production requires a dedicated key; development/test derive a
 * distinct key from JWT_SECRET so local data is never readable with production keys.
 */
const KEY_VERSION = 1;

const keyFor = (secret: string | undefined = env.VENUE_BENEFICIARY_ENCRYPTION_KEY) =>
  createHash('sha256')
    .update(secret ?? `venue-beneficiary-dev-only:${env.JWT_SECRET}`)
    .digest();

export const fieldKeyVersion = KEY_VERSION;

export function encryptField(plaintext: string, boundTo: string, secret?: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret), iv);
  cipher.setAAD(Buffer.from(boundTo, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [`v${KEY_VERSION}`, iv, cipher.getAuthTag(), body]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

export function decryptField(ciphertext: string, boundTo: string, secret?: string) {
  const [version, iv, tag, body] = ciphertext.split('.');
  if (version !== `v${KEY_VERSION}` || !iv || !tag || !body) throw new Error('Unsupported encrypted field format.');
  const decipher = createDecipheriv('aes-256-gcm', keyFor(secret), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(boundTo, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}
