import { describe, expect, it } from 'vitest';
import { decryptField, encryptField } from './field-encryption.js';

const KEY = 'unit-test-beneficiary-key-000000000000';
const details = JSON.stringify({ accountNumber: '62000000001', branchCode: '250655' });

describe('field encryption (TKT-607)', () => {
  it('round-trips and never stores plaintext', () => {
    const sealed = encryptField(details, 'beneficiary-1', KEY);
    expect(sealed).not.toContain('62000000001');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(decryptField(sealed, 'beneficiary-1', KEY)).toBe(details);
    expect(encryptField(details, 'beneficiary-1', KEY)).not.toBe(sealed);
  });

  it('refuses a ciphertext moved to another row, a wrong key, or a tampered body', () => {
    const sealed = encryptField(details, 'beneficiary-1', KEY);
    expect(() => decryptField(sealed, 'beneficiary-2', KEY)).toThrow();
    expect(() => decryptField(sealed, 'beneficiary-1', 'another-key-that-is-long-enough-000000')).toThrow();
    const parts = sealed.split('.');
    parts[3] = `${parts[3]!.slice(0, -2)}AA`;
    expect(() => decryptField(parts.join('.'), 'beneficiary-1', KEY)).toThrow();
    expect(() => decryptField('v9.a.b.c', 'beneficiary-1', KEY)).toThrow();
  });
});
