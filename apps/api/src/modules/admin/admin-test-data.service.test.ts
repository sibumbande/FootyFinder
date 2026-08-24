import { describe, expect, it } from 'vitest';
import { isAdminTestDataEnabled } from './admin-test-data.service.js';

describe('Admin test-data environment gate', () => {
  it('requires an explicit flag and always fails closed in production', () => {
    expect(isAdminTestDataEnabled(false, 'development')).toBe(false);
    expect(isAdminTestDataEnabled(true, 'development')).toBe(true);
    expect(isAdminTestDataEnabled(true, 'test')).toBe(true);
    expect(isAdminTestDataEnabled(true, 'production')).toBe(false);
  });
});
