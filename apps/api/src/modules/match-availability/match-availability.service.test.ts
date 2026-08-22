import { describe, expect, it, vi } from 'vitest';
import { domainEvents } from '../../events/domain-events.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import {
  AvailabilityNotRequestedError,
  type MatchAvailabilityRepository,
  TeamAvailabilityForbiddenError,
  TeamMatchClosedError,
  TeamMatchSideNotFoundError,
} from './match-availability.repository.js';
import { MatchAvailabilityService } from './match-availability.service.js';

const user = (id: string) => ({
  id,
  email: `${id}@private.invalid`,
  username: id,
  passwordHash: 'private',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  profile: null,
  walletAccount: null,
  teamMemberships: [],
});
const row = (id: string, status: string, respondedAt: Date | null = null) => ({
  id: `availability-${id}`,
  matchTeamId: 'side-1',
  userId: id,
  status,
  respondedAt,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  user: user(id),
});
const context = (role: 'OWNER' | 'CAPTAIN' | 'MEMBER' = 'CAPTAIN') => ({
  id: 'side-1',
  matchId: 'match-1',
  teamId: 'team-1',
  side: 'HOME',
  organisingUserId: 'owner',
  formationKey: 'formation',
  teamNameSnapshot: 'Team One',
  teamImageUrlSnapshot: null,
  primaryColorSnapshot: null,
  secondaryColorSnapshot: null,
  availabilityRequestedAt: new Date('2026-01-01T10:00:00.000Z'),
  lineupFinalizedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  match: { mode: 'TEAM_MATCH', status: 'DRAFT' },
  team: { id: 'team-1', memberships: [{ userId: 'viewer', role }] },
});

const makeService = (overrides: Record<string, unknown> = {}) => {
  const repository = {
    findContext: vi.fn().mockResolvedValue(context()),
    listForSide: vi.fn().mockResolvedValue([]),
    request: vi.fn(),
    updateMine: vi.fn(),
    ...overrides,
  } as unknown as MatchAvailabilityRepository;
  const notifications = {
    publishPersistedMany: vi.fn(),
  } as unknown as NotificationsService;
  return {
    service: new MatchAvailabilityService(repository, notifications),
    repository,
    notifications,
  };
};

describe('MatchAvailabilityService', () => {
  it('returns the full privacy-safe snapshot and unfiltered totals to a captain', async () => {
    const rows = [
      row('one', 'AVAILABLE', new Date()),
      row('two', 'MAYBE', new Date()),
      row('three', 'UNAVAILABLE', new Date()),
      row('four', 'NO_RESPONSE'),
    ];
    const { service } = makeService({ listForSide: vi.fn().mockResolvedValue(rows) });

    const result = await service.get('match-1', 'HOME', { availability: 'AVAILABLE' }, 'viewer');

    expect(result.summary).toEqual({
      squadPool: 4,
      available: 1,
      maybe: 1,
      unavailable: 1,
      noResponse: 1,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ userId: 'one', selectionStatus: null });
    expect(result.rows[0]?.user).not.toHaveProperty('email');
    expect(result.rows[0]?.user).not.toHaveProperty('passwordHash');
  });

  it('limits a member to their own row while retaining aggregate counts', async () => {
    const rows = [row('viewer', 'AVAILABLE', new Date()), row('other', 'NO_RESPONSE')];
    const { service } = makeService({
      findContext: vi.fn().mockResolvedValue(context('MEMBER')),
      listForSide: vi.fn().mockResolvedValue(rows),
    });

    const result = await service.get('match-1', 'HOME', {}, 'viewer');
    expect(result.summary.squadPool).toBe(2);
    expect(result.rows.map(({ userId }) => userId)).toEqual(['viewer']);
  });

  it('reserves selected filters without exposing rows as selected in Phase 1C', async () => {
    const { service } = makeService({
      listForSide: vi.fn().mockResolvedValue([row('one', 'AVAILABLE')]),
    });
    expect((await service.get('match-1', 'HOME', { selected: true }, 'viewer')).rows).toEqual([]);
    expect((await service.get('match-1', 'HOME', { selected: false }, 'viewer')).rows).toHaveLength(
      1,
    );
  });

  it('publishes persisted notifications before broadcasting the request invalidation', async () => {
    const notification = {
      id: 'notification-1',
      userId: 'member',
      type: 'TEAM_MATCH_AVAILABILITY_REQUESTED',
      title: 'Availability requested',
      message: 'Respond',
      targetPath: '/matches/match-1',
      readAt: null,
      createdAt: new Date(),
    };
    const request = vi.fn().mockResolvedValue({
      requestedAt: new Date('2026-01-01T10:00:00.000Z'),
      addedMemberCount: 2,
      notifiedMemberCount: 1,
      notifications: [notification],
    });
    const { service, notifications } = makeService({ request });
    const emit = vi.spyOn(domainEvents, 'emit');

    await expect(service.request('match-1', 'HOME', 'owner')).resolves.toEqual({
      requestedAt: '2026-01-01T10:00:00.000Z',
      addedMemberCount: 2,
      notifiedMemberCount: 1,
    });
    expect(notifications.publishPersistedMany).toHaveBeenCalledWith([notification]);
    expect(emit).toHaveBeenCalledWith('match-availability:requested', {
      matchId: 'match-1',
      side: 'HOME',
      requestedAt: '2026-01-01T10:00:00.000Z',
    });
    expect(vi.mocked(notifications.publishPersistedMany).mock.invocationCallOrder[0]).toBeLessThan(
      emit.mock.invocationCallOrder[0]!,
    );
    emit.mockRestore();
  });

  it('broadcasts only invalidation metadata after an own-response update', async () => {
    const updateMine = vi.fn().mockResolvedValue(row('viewer', 'NO_RESPONSE'));
    const { service } = makeService({ updateMine });
    const emit = vi.spyOn(domainEvents, 'emit');

    const result = await service.updateMine('match-1', 'HOME', { status: 'NO_RESPONSE' }, 'viewer');
    expect(result.respondedAt).toBeNull();
    expect(updateMine).toHaveBeenCalledWith('match-1', 'HOME', 'viewer', 'NO_RESPONSE');
    expect(emit).toHaveBeenCalledWith('match-availability:updated', {
      matchId: 'match-1',
      side: 'HOME',
    });
    expect(emit.mock.calls.at(-1)?.[1]).not.toHaveProperty('userId');
    expect(emit.mock.calls.at(-1)?.[1]).not.toHaveProperty('status');
    emit.mockRestore();
  });

  it.each([
    [new TeamMatchSideNotFoundError(), 404, 'TEAM_MATCH_SIDE_NOT_FOUND'],
    [new TeamAvailabilityForbiddenError(), 403, 'TEAM_FORBIDDEN'],
    [new TeamMatchClosedError(), 409, 'TEAM_MATCH_CLOSED'],
    [new AvailabilityNotRequestedError(), 409, 'AVAILABILITY_NOT_REQUESTED'],
  ])('maps repository failures without broadcasting', async (error, statusCode, code) => {
    const { service, notifications } = makeService({ request: vi.fn().mockRejectedValue(error) });
    const emit = vi.spyOn(domainEvents, 'emit');
    await expect(service.request('match-1', 'HOME', 'viewer')).rejects.toMatchObject({
      statusCode,
      code,
    });
    expect(notifications.publishPersistedMany).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalledWith('match-availability:requested', expect.anything());
    emit.mockRestore();
  });

  it.each([
    [null, 404, 'TEAM_MATCH_SIDE_NOT_FOUND'],
    [{ ...context(), team: { id: 'team-1', memberships: [] } }, 403, 'TEAM_FORBIDDEN'],
    [
      { ...context(), match: { mode: 'TEAM_MATCH', status: 'CANCELLED' } },
      409,
      'TEAM_MATCH_CLOSED',
    ],
  ])('protects availability reads with current Team context', async (value, statusCode, code) => {
    const { service } = makeService({ findContext: vi.fn().mockResolvedValue(value) });
    await expect(service.get('match-1', 'HOME', {}, 'viewer')).rejects.toMatchObject({
      statusCode,
      code,
    });
  });
});
