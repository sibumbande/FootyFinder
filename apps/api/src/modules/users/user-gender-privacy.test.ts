import { describe, expect, it } from 'vitest';
import { toAuthenticatedUser, toPublicUser } from './user.mapper.js';

// CEO touch-up batch 4, item 1: gender is private. Only the player's own account data carries it.
const user = {
  id: 'user-1',
  email: 'player@example.invalid',
  username: 'ayanda',
  emailVerifiedAt: new Date('2026-10-01T10:00:00Z'),
  onboardingCompletedAt: new Date('2026-10-01T10:00:00Z'),
  createdAt: new Date('2026-10-01T10:00:00Z'),
  profile: {
    displayName: 'Ayanda Mokoena',
    avatarUrl: null,
    bio: null,
    dominantFoot: null,
    homeArea: null,
    gender: 'FEMALE' as const,
    dateOfBirth: new Date('1995-01-01T00:00:00Z'),
    yearsExperience: 4,
    onboardingStatus: 'COMPLETE' as const,
    city: { id: 'c1', code: 'CAPE_TOWN', name: 'Cape Town', countryCode: 'ZA', timezone: 'Africa/Johannesburg', supportStatus: 'ACTIVE' as const },
    photo: { hiddenAt: null },
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-10-01T10:00:00Z'),
    preferredPositions: [{ position: 'FORWARD' as const }],
  },
};

describe('gender privacy (CEO batch 4, item 1)', () => {
  it('never puts gender in the public player data other users and guests see', () => {
    expect(JSON.stringify(toPublicUser(user))).not.toMatch(/gender|FEMALE/i);
  });

  it("returns gender only in the player's own account data, and asks for it when missing", () => {
    expect(toAuthenticatedUser(user)).toMatchObject({ gender: 'FEMALE' });
    expect(toAuthenticatedUser(user).missingOnboardingRequirements).not.toContain('GENDER');
    const before = toAuthenticatedUser({ ...user, profile: { ...user.profile, gender: null } });
    expect(before.gender).toBeNull();
    expect(before.missingOnboardingRequirements).toContain('GENDER');
  });
});
