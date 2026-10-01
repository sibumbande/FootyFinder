import { describe, expect, it } from 'vitest';
import type { MatchRecord } from './match.query.js';
import { toMatch } from './match.mapper.js';

const now = new Date('2026-09-25T10:00:00.000Z');
const user = (id: string) => ({
  id,
  email: `${id}@private.invalid`,
  username: id,
  passwordHash: 'private',
  createdAt: now,
  updatedAt: now,
  profile: null,
  walletAccount: null,
  teamMemberships: [],
});
const record = (participantCount: number) =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    publicSlug: 'm-0123456789abcdef01234567',
    name: 'Capacity test',
    description: null,
    createdById: 'host',
    venueId: 'venue',
    mode: 'QUICK_GAME',
    format: 'FIVE_A_SIDE',
    substituteCapacityPerTeam: 0,
    rollingSubstitutes: false,
    rules: [],
    visibility: 'PUBLIC',
    inviteToken: null,
    inviteTokenHash: null,
    startsAt: new Date('2099-01-01T18:00:00.000Z'),
    durationMinutes: 60,
    feeCents: 8_000,
    currency: 'ZAR',
    status: 'OPEN',
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    createdBy: user('host'),
    venue: {
      id: 'venue',
      name: 'Test venue',
      addressLine1: '1 Test Road',
      addressLine2: null,
      locality: null,
      city: 'Cape Town',
      region: 'Western Cape',
      postalCode: null,
      countryCode: 'ZA',
      latitude: null,
      longitude: null,
      externalPlaceId: null,
      createdAt: now,
      updatedAt: now,
    },
    participants: Array.from({ length: participantCount }, (_, index) => ({
      id: `participant-${index}`,
      matchId: '11111111-1111-4111-8111-111111111111',
      userId: `user-${index}`,
      status: 'JOINED',
      team: index % 2 ? 'AWAY' : 'HOME',
      joinedAt: now,
      leftAt: null,
      user: user(`user-${index}`),
    })),
    formationSlots: [],
    result: null,
    teamSides: [],
  }) as unknown as MatchRecord;

describe('match mapper capacity status', () => {
  it('derives FULL when confirmed participants reach paid capacity', () => {
    expect(toMatch(record(10)).status).toBe('FULL');
  });

  it('reopens the DTO when a confirmed place is released', () => {
    expect(toMatch(record(9)).status).toBe('OPEN');
  });

  it('returns the canonical public identity on authenticated Match DTOs', () => {
    expect(toMatch(record(1))).toMatchObject({
      publicSlug: 'm-0123456789abcdef01234567',
      canonicalUrl: 'http://localhost:5173/m/m-0123456789abcdef01234567',
    });
  });
});

describe('home page upcoming matches (CEO batch 3, item 8)', () => {
  it('lists only matches that can still be joined: places left and before the 30-minute lobby lock', async () => {
    const { vi } = await import('vitest');
    const { MatchesService } = await import('./matches.service.js');
    const future = new Date(Date.now() + 3_600_000);
    const open = { ...record(0), id: 'open', goNoGoAt: future };
    const locked = { ...record(0), id: 'locked', goNoGoAt: new Date(Date.now() - 60_000) };
    const full = { ...record(10), id: 'full', goNoGoAt: future };
    const repository = { listPublic: vi.fn().mockResolvedValue([open, locked, full]) };
    const service = new MatchesService(repository as never);
    const listed = await service.list({ joinableOnly: true, availableOnly: false, limit: 5 });
    expect(listed.map(({ id }) => id)).toEqual(['open']);
    expect(repository.listPublic).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
  });
});
