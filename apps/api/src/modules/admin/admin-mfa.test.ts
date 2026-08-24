import { describe, expect, it } from 'vitest';
import {
  adminTotpCode,
  createAdminMfaSecret,
  decryptAdminMfaSecret,
  encryptAdminMfaSecret,
  verifyAdminTotp,
} from './admin-mfa.js';

describe('Admin MFA', () => {
  it('encrypts authenticator secrets at rest and decrypts them losslessly', () => {
    const secret = createAdminMfaSecret();
    const encrypted = encryptAdminMfaSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptAdminMfaSecret(encrypted)).toBe(secret);
  });

  it('accepts a current TOTP code with bounded clock skew and rejects another code', () => {
    const secret = createAdminMfaSecret();
    const now = Date.parse('2026-08-24T12:00:00.000Z');
    expect(verifyAdminTotp(secret, adminTotpCode(secret, now), now)).toBe(true);
    expect(verifyAdminTotp(secret, '000000', now)).toBe(false);
  });
});
