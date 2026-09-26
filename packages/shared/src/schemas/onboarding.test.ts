import { describe, expect, it } from 'vitest';
import { isAtLeastAge, onboardingProfileSchema } from './onboarding.js';

describe('Gate 2 onboarding schema', () => {
  it('uses calendar-date semantics for the 18-year boundary', () => {
    const today = new Date('2026-09-25T12:00:00.000Z');
    expect(isAtLeastAge('2008-09-25', 18, today)).toBe(true);
    expect(isAtLeastAge('2008-09-26', 18, today)).toBe(false);
  });

  it('accepts ordered unique positions and whole 0-60 experience years', () => {
    expect(onboardingProfileSchema.safeParse({
      dateOfBirth: '2000-02-29',
      yearsExperience: 0,
      cityId: '10000000-0000-4000-8000-000000000001',
      preferredPositions: ['FORWARD', 'MIDFIELDER'],
    }).success).toBe(true);
    expect(onboardingProfileSchema.safeParse({
      dateOfBirth: '2000-02-29',
      yearsExperience: 61,
      cityId: '10000000-0000-4000-8000-000000000001',
      preferredPositions: ['FORWARD', 'FORWARD'],
    }).success).toBe(false);
  });

  it('rejects malformed calendar dates and under-age users', () => {
    const underAge = new Date();
    underAge.setUTCFullYear(underAge.getUTCFullYear() - 10);
    for (const dateOfBirth of ['2020-02-30', underAge.toISOString().slice(0, 10)])
      expect(onboardingProfileSchema.safeParse({
        dateOfBirth,
        yearsExperience: 1,
        cityId: '10000000-0000-4000-8000-000000000001',
        preferredPositions: ['GOALKEEPER'],
      }).success).toBe(false);
  });
});
