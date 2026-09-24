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
      findAttachedTeamMembership: vi.fn().mockResolvedValue({ role: 'MEMBER' }),
      cancelMatch: vi.fn(),
    } as unknown as MatchesRepository;
    await expect(
      new MatchesService(repository).remove('match-1', 'member-1'),
    ).rejects.toMatchObject({ statusCode: 403, code: 'TEAM_FORBIDDEN' });
    expect(repository.cancelMatch).not.toHaveBeenCalled();
  });

  it('rejects Quick Game movement across the halfway line before persistence', async () => {
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
      new MatchesService(repository).updateFormation(
        'match-1',
        'slot-1',
        { positionX: 50, positionY: 25 },
        'host-1',
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'POSITION_OUTSIDE_TEAM_HALF' });
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
