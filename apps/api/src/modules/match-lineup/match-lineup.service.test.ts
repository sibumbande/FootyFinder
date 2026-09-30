import { describe, expect, it, vi } from 'vitest';
import type { MatchLineupRepository } from './match-lineup.repository.js';
import {
  LineupActionRequiredError,
  LineupForbiddenError,
  LineupIncompleteError,
  LineupMemberIneligibleError,
  LineupSlotNotFoundError,
  LineupSlotOccupiedError,
  LineupTeamMatchClosedError,
  LineupKickedOffError,
  LineupTeamSideNotFoundError,
  PlayerAlreadyStarterError,
  PositionAlreadyClaimedError,
  PositionNotOpenError,
  PositionOutsideTeamHalfError,
  SubstituteCapacityReachedError,
} from './match-lineup.repository.js';
import { MatchLineupService } from './match-lineup.service.js';
import { domainEvents } from '../../events/domain-events.js';
import type { NotificationsService } from '../notifications/notifications.service.js';

const safeUser = (id: string) => ({
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

const context = (role: 'OWNER' | 'CAPTAIN' | 'MEMBER' = 'CAPTAIN') => {
  const selection = {
    id: 'selection-1',
    matchTeamId: 'side-1',
    userId: 'player-1',
    status: 'SELECTED_STARTER',
    selectedByUserId: 'viewer',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    user: safeUser('player-1'),
  };
  return {
    id: 'side-1',
    matchId: 'match-1',
    teamId: 'team-1',
    side: 'HOME',
    organisingUserId: 'viewer',
    formationKey: 'BALANCED_1_1_2_1',
    teamNameSnapshot: 'Team One',
    teamImageUrlSnapshot: null,
    primaryColorSnapshot: null,
    secondaryColorSnapshot: null,
    availabilityRequestedAt: null,
    lineupFinalizedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    match: {
      id: 'match-1',
      mode: 'TEAM_MATCH',
      status: 'DRAFT',
      format: 'FIVE_A_SIDE',
      substituteCapacityPerTeam: 5,
    },
    team: {
      id: 'team-1',
      memberships: [
        { id: 'membership-viewer', userId: 'viewer', role },
        { id: 'membership-player', userId: 'player-1', role: 'MEMBER' },
      ],
    },
    lineupSlots: [
      {
        id: 'slot-1',
        matchTeamId: 'side-1',
        slotIndex: 1,
        positionX: 50,
        positionY: 90,
        isOpen: false,
        selectionId: selection.id,
        createdAt: new Date(),
        updatedAt: new Date(),
        selection,
      },
    ],
    selections: [selection],
  };
};

describe('MatchLineupService', () => {
  it('returns management selection state with privacy-safe users', async () => {
    const repository = {
      get: vi.fn().mockResolvedValue(context()),
    } as unknown as MatchLineupRepository;
    const lineup = await new MatchLineupService(repository).get('match-1', 'HOME', 'viewer');

    expect(lineup).toMatchObject({
      starterCapacity: 5,
      substituteCapacity: 5,
      viewerCanManage: true,
      selectionPool: [{ userId: 'player-1', status: 'SELECTED_STARTER' }],
      slots: [{ selection: { userId: 'player-1' } }],
    });
    expect(lineup.selectionPool?.[0]?.user).not.toHaveProperty('email');
    expect(lineup.selectionPool?.[0]?.user).not.toHaveProperty('passwordHash');
  });

  it('shows members the active lineup without the management selection pool', async () => {
    const repository = {
      get: vi.fn().mockResolvedValue(context('MEMBER')),
    } as unknown as MatchLineupRepository;
    const lineup = await new MatchLineupService(repository).get('match-1', 'HOME', 'viewer');
    expect(lineup.viewerCanManage).toBe(false);
    expect(lineup).not.toHaveProperty('selectionPool');
    expect(lineup.slots[0]?.selection?.userId).toBe('player-1');
  });

  it.each([
    [new LineupTeamSideNotFoundError(), 404, 'TEAM_MATCH_SIDE_NOT_FOUND'],
    [new LineupForbiddenError(), 403, 'TEAM_FORBIDDEN'],
    [new LineupTeamMatchClosedError(), 409, 'TEAM_MATCH_CLOSED'],
    [new LineupKickedOffError(), 409, 'LINEUP_LOCKED'],
    [new LineupSlotNotFoundError(), 404, 'LINEUP_SLOT_NOT_FOUND'],
    [new LineupSlotOccupiedError(), 409, 'LINEUP_SLOT_OCCUPIED'],
    [new LineupActionRequiredError(), 409, 'LINEUP_ACTION_REQUIRED'],
    [new SubstituteCapacityReachedError(), 409, 'SUBSTITUTE_CAPACITY_REACHED'],
    [new PlayerAlreadyStarterError(), 409, 'PLAYER_ALREADY_STARTER'],
    [new PositionNotOpenError(), 409, 'POSITION_NOT_OPEN'],
    [new PositionAlreadyClaimedError(), 409, 'POSITION_ALREADY_CLAIMED'],
    [new LineupIncompleteError(), 409, 'LINEUP_INCOMPLETE'],
    [new LineupMemberIneligibleError(), 409, 'LINEUP_MEMBER_NO_LONGER_ELIGIBLE'],
  ])('maps domain errors to stable API errors', async (error, statusCode, code) => {
    const repository = {
      get: vi.fn().mockRejectedValue(error),
    } as unknown as MatchLineupRepository;
    await expect(
      new MatchLineupService(repository).get('match-1', 'HOME', 'viewer'),
    ).rejects.toMatchObject({ statusCode, code });
  });

  it('publishes transaction-created notifications and metadata events only after success', async () => {
    const notification = {
      id: 'notification-1',
      userId: 'player-1',
      type: 'TEAM_MATCH_SELECTION_UPDATED',
      title: 'Updated',
      message: 'Updated',
      targetPath: '/matches/match-1',
      readAt: null,
      createdAt: new Date(),
    };
    const repository = {
      moveSlot: vi.fn().mockResolvedValue({
        context: context(),
        notifications: [notification],
        reason: 'MOVEMENT',
      }),
    } as unknown as MatchLineupRepository;
    const notifications = {
      publishPersistedMany: vi.fn(),
    } as unknown as NotificationsService;
    const event = vi.fn();
    domainEvents.once('match-lineup:changed', event);
    await new MatchLineupService(repository, notifications).moveSlot(
      'match-1',
      'HOME',
      'slot-1',
      { positionX: 50, positionY: 75 },
      'viewer',
    );
    expect(notifications.publishPersistedMany).toHaveBeenCalledWith([notification]);
    expect(event).toHaveBeenCalledWith({ matchId: 'match-1', side: 'HOME', reason: 'MOVEMENT' });
  });

  it('maps invalid half movement without publishing or broadcasting', async () => {
    const repository = {
      moveSlot: vi.fn().mockRejectedValue(new PositionOutsideTeamHalfError()),
    } as unknown as MatchLineupRepository;
    const notifications = {
      publishPersistedMany: vi.fn(),
    } as unknown as NotificationsService;
    const event = vi.fn();
    domainEvents.once('match-lineup:changed', event);
    await expect(
      new MatchLineupService(repository, notifications).moveSlot(
        'match-1',
        'HOME',
        'slot-1',
        { positionX: 50, positionY: 25 },
        'viewer',
      ),
    ).rejects.toMatchObject({ code: 'POSITION_OUTSIDE_TEAM_HALF' });
    expect(notifications.publishPersistedMany).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
    domainEvents.removeListener('match-lineup:changed', event);
  });
});
