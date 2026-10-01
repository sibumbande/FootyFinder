import {
  createDefaultFormation,
  getMatchFormatConfig,
  getMaxMatchParticipants,
  getMaxParticipantsPerTeam,
} from '@footy-finder/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Notification } from '../../generated/prisma/client.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { MatchesRepository } from './matches.repository.js';
import { MatchesService } from './matches.service.js';

describe('match format configuration', () => {
  it.each([
    ['FIVE_A_SIDE', 5, 10],
    ['SEVEN_A_SIDE', 7, 14],
    ['ELEVEN_A_SIDE', 11, 22],
  ] as const)(
    '%s derives its starter capacity and formation',
    (format, startersPerTeam, onFieldCapacity) => {
      expect(getMatchFormatConfig(format)).toMatchObject({
        startersPerTeam,
        onFieldCapacity,
      });
      const slots = createDefaultFormation(format);
      expect(slots).toHaveLength(onFieldCapacity);
      expect(slots.filter(({ team }) => team === 'HOME')).toHaveLength(startersPerTeam);
      expect(slots.filter(({ team }) => team === 'AWAY')).toHaveLength(startersPerTeam);
    },
  );

  it.each([
    ['FIVE_A_SIDE', 5],
    ['SEVEN_A_SIDE', 7],
    ['ELEVEN_A_SIDE', 11],
  ] as const)('%s derives capacity for 0, 5 and 10 substitutes', (format, startersPerTeam) => {
    for (const substitutes of [0, 5, 10]) {
      expect(getMaxParticipantsPerTeam(format, substitutes)).toBe(startersPerTeam + substitutes);
      expect(getMaxMatchParticipants(format, substitutes)).toBe(
        (startersPerTeam + substitutes) * 2,
      );
    }
  });
});

describe('host permissions', () => {
  it('prevents a non-host from cancelling a match', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue({
        id: 'match-1',
        mode: 'QUICK_GAME',
        createdById: 'host-1',
      }),
      cancelMatch: vi.fn(),
    } as unknown as MatchesRepository;
    await expect(
      new MatchesService(repository).remove('match-1', 'player-1'),
    ).rejects.toMatchObject({ statusCode: 403, code: 'HOST_REQUIRED' });
    expect(repository.cancelMatch).not.toHaveBeenCalled();
  });

  it('uses current Team roles instead of Quick Game host authority for Team fixtures', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue({
        id: 'match-1',
        mode: 'TEAM_MATCH',
        createdById: 'captain-1',
      }),
      managedTeamSides: vi.fn().mockResolvedValue([]),
      cancelMatch: vi.fn(),
    } as unknown as MatchesRepository;
    await expect(
      new MatchesService(repository).remove('match-1', 'member-1'),
    ).rejects.toMatchObject({ statusCode: 403, code: 'TEAM_FORBIDDEN' });
    expect(repository.cancelMatch).not.toHaveBeenCalled();
  });

  it('lets only the home team cancel a team match, for both sides (Gate 7, D6/N5)', async () => {
    const match = {
      id: 'match-1', mode: 'TEAM_MATCH', createdById: 'captain-1', otherSideMode: 'OPEN', status: 'OPEN',
      startsAt: new Date(Date.now() + 86_400_000), durationMinutes: 60, goNoGoAt: new Date(Date.now() + 84_600_000),
    };
    const away = {
      findById: vi.fn().mockResolvedValue(match),
      managedTeamSides: vi.fn().mockResolvedValue(['AWAY']),
      cancelMatch: vi.fn(),
    } as unknown as MatchesRepository;
    await expect(new MatchesService(away).remove('match-1', 'away-captain')).rejects.toMatchObject({ statusCode: 403, code: 'TEAM_FORBIDDEN' });
    expect(away.cancelMatch).not.toHaveBeenCalled();
    const home = {
      findById: vi.fn().mockResolvedValue(match),
      managedTeamSides: vi.fn().mockResolvedValue(['HOME']),
      cancelMatch: vi.fn().mockResolvedValue({ notifications: [] }),
    } as unknown as MatchesRepository;
    await new MatchesService(home, { publishPersistedMany: vi.fn() } as never).remove('match-1', 'home-captain');
    expect(home.cancelMatch).toHaveBeenCalledWith('match-1', 'TEAM_CANCELLED', 'home-captain');
  });

  it('lets the Host place a Quick Game marker anywhere on its side\'s own pitch', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue({
        id: 'match-1',
        mode: 'QUICK_GAME',
        createdById: 'host-1',
        status: 'OPEN',
        startsAt: new Date(Date.now() + 86_400_000),
        durationMinutes: 60,
        formationSlots: [{ id: 'slot-1', team: 'HOME' }],
      }),
      updateFormation: vi.fn().mockResolvedValue({ changed: true, match: { formationVersion: 2, formationSlots: [] }, notifications: [] }),
    } as unknown as MatchesRepository;
    await new MatchesService(repository, { publishPersistedMany: vi.fn() } as never).updateFormation(
      'match-1',
      'slot-1',
      { positionX: 50, positionY: 25 },
      'host-1',
    );
    expect(repository.updateFormation).toHaveBeenCalledWith('match-1', 'slot-1', { positionX: 50, positionY: 25 }, 'host-1');
  });

  it('still lets only the Host move Quick Game markers', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue({
        id: 'match-1',
        mode: 'QUICK_GAME',
        createdById: 'host-1',
        status: 'OPEN',
        startsAt: new Date(Date.now() + 86_400_000),
        durationMinutes: 60,
        formationSlots: [{ id: 'slot-1', team: 'HOME' }],
      }),
      updateFormation: vi.fn(),
    } as unknown as MatchesRepository;
    await expect(
      new MatchesService(repository).updateFormation('match-1', 'slot-1', { positionX: 50, positionY: 25 }, 'player-2'),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.updateFormation).not.toHaveBeenCalled();
  });
});

describe('match scheduling updates', () => {
  const editableMatch = () => ({
    id: 'match-1',
    mode: 'QUICK_GAME' as const,
    createdById: 'host-1',
    status: 'OPEN' as const,
    startsAt: new Date(Date.now() + 86_400_000),
    durationMinutes: 60,
  });

  it('rejects moving kickoff into the past before persistence', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue(editableMatch()),
      update: vi.fn(),
    } as unknown as MatchesRepository;

    await expect(
      new MatchesService(repository).update(
        'match-1',
        { startsAt: new Date(Date.now() - 60_000).toISOString() },
        'host-1',
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'MATCH_START_TIME_INVALID' });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('rejects updates when the Match lifecycle is no longer mutable', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue({ ...editableMatch(), status: 'CANCELLED' }),
      update: vi.fn(),
    } as unknown as MatchesRepository;

    await expect(
      new MatchesService(repository).update('match-1', { name: 'Changed name' }, 'host-1'),
    ).rejects.toMatchObject({ statusCode: 409, code: 'MATCH_STARTED' });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('does not detach a managed reservation by changing its kickoff', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue(editableMatch()),
      hasFieldReservation: vi.fn().mockResolvedValue({ id: 'reservation-1' }),
      update: vi.fn(),
    } as unknown as MatchesRepository;

    await expect(
      new MatchesService(repository).update(
        'match-1',
        { startsAt: new Date(Date.now() + 172_800_000).toISOString() },
        'host-1',
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'MANAGED_SLOT_IMMUTABLE' });
    expect(repository.update).not.toHaveBeenCalled();
  });
});

describe('anonymous public Match preview', () => {
  const publicMatch = (overrides: Record<string, unknown> = {}) => ({
    id: 'internal-match-id',
    publicSlug: 'm-0123456789abcdef01234567',
    inviteTokenHash: 'must-never-leak',
    name: 'Friday football',
    description: 'Friendly game',
    format: 'FIVE_A_SIDE',
    substituteCapacityPerTeam: 0,
    rules: ['GOALKEEPERS_SWAP_AFTER_EVERY_GOAL'],
    status: 'OPEN',
    startsAt: new Date('2099-09-28T16:00:00.000Z'),
    durationMinutes: 60,
    feeCents: 8_000,
    venue: {
      name: 'Queens Park',
      city: 'Cape Town',
      region: 'Western Cape',
      addressLine1: 'Private street detail',
    },
    createdBy: { id: 'host-id', email: 'host@example.invalid' },
    participants: [{ user: { email: 'player@example.invalid', walletAccount: { balanceCents: 1 } } }],
    formationSlots: [],
    teamSides: [],
    result: null,
    ...overrides,
  });

  it('adds DEC-018 go/no-go facts and an aggregate position count, and locks joining from T-30', async () => {
    const goNoGoAt = new Date(Date.now() - 60_000);
    const repository = {
      findPublicPreviewBySlug: vi.fn().mockResolvedValue(
        publicMatch({
          startsAt: new Date(Date.now() + 29 * 60_000),
          goNoGoAt,
          confirmedAt: null,
          cancellationReason: null,
          formationSlots: [{ participantId: 'p1' }, { participantId: null }],
        }),
      ),
    } as unknown as MatchesRepository;

    const preview = await new MatchesService(repository).publicPreview('m-0123456789abcdef01234567');

    expect(preview).toMatchObject({
      goNoGoAt: goNoGoAt.toISOString(),
      positions: { filled: 1, total: 2 },
      joinability: { canJoin: false, reason: 'LINEUP_LOCKED' },
    });
    expect(JSON.stringify(preview)).not.toMatch(/p1/);
  });

  it('returns exactly the approved aggregate DTO without identities or private metadata', async () => {
    const repository = {
      findPublicPreviewBySlug: vi.fn().mockResolvedValue(publicMatch()),
    } as unknown as MatchesRepository;

    const preview = await new MatchesService(repository).publicPreview(
      'm-0123456789abcdef01234567',
    );

    expect(preview).toEqual({
      slug: 'm-0123456789abcdef01234567',
      canonicalUrl: 'http://localhost:5173/m/m-0123456789abcdef01234567',
      name: 'Friday football',
      description: 'Friendly game',
      venue: { name: 'Queens Park', city: 'Cape Town', region: 'Western Cape' },
      startsAt: '2099-09-28T16:00:00.000Z',
      durationMinutes: 60,
      format: 'FIVE_A_SIDE',
      feeCents: 8_000,
      currency: 'ZAR',
      rules: [
        {
          code: 'GOALKEEPERS_SWAP_AFTER_EVERY_GOAL',
          label: 'Goalkeepers swap after every goal',
        },
      ],
      status: 'OPEN',
      joinability: { canJoin: true, reason: 'AVAILABLE' },
      capacity: { filled: 1, total: 10 },
      positions: { filled: 0, total: 0 },
    });
    expect(JSON.stringify(preview)).not.toMatch(
      /internal-match-id|inviteToken|host@example|player@example|wallet|addressLine1/,
    );
  });

  it.each([
    [{ participants: Array.from({ length: 10 }, () => ({})) }, 'FULL', 'FULL'],
    [{ status: 'CANCELLED' }, 'CANCELLED', 'CANCELLED'],
    [{ status: 'COMPLETED' }, 'COMPLETED', 'COMPLETED'],
    [
      { status: 'IN_PROGRESS', startsAt: new Date(Date.now() - 10 * 60_000) },
      'IN_PROGRESS',
      'STARTED',
    ],
  ] as const)('keeps a safe %s status page', async (overrides, status, reason) => {
    const repository = {
      findPublicPreviewBySlug: vi.fn().mockResolvedValue(publicMatch(overrides)),
    } as unknown as MatchesRepository;

    await expect(new MatchesService(repository).publicPreview('m-0123456789abcdef01234567'))
      .resolves.toMatchObject({ status, joinability: { canJoin: false, reason } });
  });

  it('uses the same generic response for every non-public or unknown slug', async () => {
    const repository = {
      findPublicPreviewBySlug: vi.fn().mockResolvedValue(null),
    } as unknown as MatchesRepository;
    const service = new MatchesService(repository);

    for (const slug of ['m-aaaaaaaaaaaaaaaaaaaaaaaa', 'm-bbbbbbbbbbbbbbbbbbbbbbbb'])
      await expect(service.publicPreview(slug)).rejects.toMatchObject({
        statusCode: 404,
        code: 'PUBLIC_MATCH_NOT_FOUND',
        message: 'Public match not found.',
      });
  });
});

describe('Match notification publication', () => {
  it('publishes only notifications returned by the committed join transaction', async () => {
    const now = new Date('2026-08-23T00:00:00.000Z');
    const notification: Notification = {
      id: '33333333-3333-4333-8333-333333333333',
      userId: '22222222-2222-4222-8222-222222222222',
      dedupeKey: 'match:match-1:participant:participant-1:joined:user-1',
      type: 'MATCH_JOINED',
      title: 'Match joined',
      message: 'Confirmed',
      targetPath: '/matches/match-1',
      readAt: null,
      createdAt: now,
    };
    const repository = {
      join: vi.fn().mockResolvedValue({
        participant: {
          id: 'participant-1',
          matchId: 'match-1',
          userId: notification.userId,
          status: 'JOINED',
          team: 'HOME',
          joinedAt: now,
          leftAt: null,
          user: {
            id: notification.userId,
            email: 'player@example.invalid',
            username: 'player',
            createdAt: now,
            updatedAt: now,
            profile: null,
            walletAccount: null,
            teamMemberships: [],
          },
        },
        replacement: null,
        replayed: false,
        notifications: [notification],
      }),
    } as unknown as MatchesRepository;
    const notifications = {
      publishPersistedMany: vi.fn(),
    } as unknown as NotificationsService;

    await expect(
      new MatchesService(repository, notifications).join(
        'match-1',
        notification.userId,
        { team: 'HOME' },
        'join-key',
      ),
    ).resolves.toMatchObject({ id: 'participant-1' });
    expect(notifications.publishPersistedMany).toHaveBeenCalledWith([notification]);
  });
});
