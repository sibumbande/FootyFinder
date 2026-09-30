import { describe, expect, it } from 'vitest';
import { refereeRoleChangeSchema } from './referee.js';

describe('referee role change schema (Gate 8 / D25)', () => {
  it('requires a written reason of 3 to 500 characters', () => {
    expect(refereeRoleChangeSchema.parse({ reason: '  Qualified referee ' })).toEqual({ reason: 'Qualified referee' });
    expect(refereeRoleChangeSchema.safeParse({ reason: 'ok' }).success).toBe(false);
    expect(refereeRoleChangeSchema.safeParse({}).success).toBe(false);
    expect(refereeRoleChangeSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
  });
});
