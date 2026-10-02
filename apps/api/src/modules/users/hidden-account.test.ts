import { DELETED_PLAYER_NAME } from '@footy-finder/shared';
import { describe, expect, it } from 'vitest';
import { toSocialCard } from '../social/friends.service.js';
import { isHiddenAccount, shownName } from './hidden-account.js';
import { toPublicUser } from './user.mapper.js';

// CEO batch 5, items 2-3: a deleting (14-day grace) or deleted player shows nothing about themselves.
const createdAt = new Date('2026-10-01T10:00:00Z');
const user = (accountStatus: 'ACTIVE' | 'PENDING_DELETION' | 'DELETED') => ({
  id: 'user-1',
  email: 'thandi@example.invalid',
  username: 'thandi_m',
  accountStatus,
  createdAt,
  profile: {
    displayName: 'Thandi Mokoena',
    avatarUrl: null,
    bio: 'Left-back from Khayelitsha',
    dominantFoot: 'LEFT' as const,
    homeArea: 'Khayelitsha',
    yearsExperience: 6,
    city: { id: 'c1', code: 'CAPE_TOWN', name: 'Cape Town', countryCode: 'ZA', timezone: 'Africa/Johannesburg', supportStatus: 'ACTIVE' as const },
    photo: { hiddenAt: null },
    createdAt,
    updatedAt: createdAt,
    preferredPositions: [{ position: 'DEFENDER' as const }],
  },
  teamMemberships: [{ role: 'MEMBER' as const, team: { id: 't1', name: 'Langa FC', shortName: 'LFC', profileImageUrl: null } }],
});
const personal = ['Thandi', 'thandi_m', 'thandi@example', 'Khayelitsha', 'Left-back', 'Langa FC', '/photo'];

describe('hidden accounts (CEO batch 5)', () => {
  it('knows which statuses are hidden', () => {
    expect(isHiddenAccount('PENDING_DELETION')).toBe(true);
    expect(isHiddenAccount('DELETED')).toBe(true);
    expect(isHiddenAccount('ACTIVE')).toBe(false);
    expect(isHiddenAccount('SUSPENDED')).toBe(false);
    expect(shownName('DELETED', 'Thandi Mokoena')).toBe(DELETED_PLAYER_NAME);
    expect(shownName('ACTIVE', 'Thandi Mokoena')).toBe('Thandi Mokoena');
  });

  it.each(['PENDING_DELETION', 'DELETED'] as const)('a %s player appears only as "Deleted player"', (status) => {
    const shown = toPublicUser(user(status));
    expect(shown).toMatchObject({ id: 'user-1', displayName: DELETED_PLAYER_NAME, avatarUrl: null, deleted: true, teams: [] });
    const json = JSON.stringify(shown);
    for (const value of personal) expect(json).not.toContain(value);
  });

  it('an active player is shown as normal (negative control)', () => {
    const json = JSON.stringify(toPublicUser(user('ACTIVE')));
    expect(json).toContain('Thandi Mokoena');
    expect(json).toContain('Langa FC');
  });

  it('social cards anonymise a hidden player too', () => {
    const card = toSocialCard(
      { ...user('PENDING_DELETION'), onboardingCompletedAt: createdAt, friendRequestsEnabled: true, profile: { ...user('ACTIVE').profile, city: { name: 'Cape Town' } } },
      { userId: 'user-1', state: 'CAN_REQUEST' } as never,
    );
    expect(card.displayName).toBe(DELETED_PLAYER_NAME);
    expect(JSON.stringify(card)).not.toContain('Thandi');
    expect(card.relationship.state).toBe('UNAVAILABLE');
  });
});
