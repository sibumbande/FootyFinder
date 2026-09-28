import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { domainEvents } from '../../events/domain-events.js';
import {
  operationalMetricsSnapshot,
  resetOperationalMetricsForTests,
} from '../../observability/operational-metrics.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import {
  FormationSlotNotFoundError,
  MatchClosedError,
  NotMatchParticipantError,
  PositionAlreadyClaimedError,
  PositionWrongSideError,
  TeamMatchPlanningError,
  type MatchesRepository,
} from './matches.repository.js';
import { MatchesService } from './matches.service.js';

const slotRecord = (id: string, participantId: string | null = null) => ({
  id,
  matchId: 'match-1',
  team: 'HOME' as const,
  slotIndex: 0,
  positionX: 50,
  positionY: 80,
  participantId,
  participant: null,
});

const matchRecord = (formationVersion: number, slots = [slotRecord('slot-1', 'participant-1')]) => ({
  id: 'match-1',
  mode: 'QUICK_GAME' as const,
  createdById: 'host-1',
  status: 'OPEN' as const,
  startsAt: new Date(Date.now() + 86_400_000),
  durationMinutes: 60,
  formationVersion,
  formationSlots: slots,
});

const notificationsStub = () =>
  ({ publishPersistedMany: vi.fn() }) as unknown as NotificationsService & {
    publishPersistedMany: ReturnType<typeof vi.fn>;
  };

describe('Quick Match position claims', () => {
  const emitted: unknown[] = [];
  const listener = (payload: unknown) => emitted.push(payload);
  beforeEach(() => {
    emitted.length = 0;
    resetOperationalMetricsForTests();
    domainEvents.on('formation:updated', listener);
  });
  afterEach(() => domainEvents.off('formation:updated', listener));

  it('returns the committed formation snapshot and publishes it once', async () => {
    const repository = {
      claimPosition: vi.fn().mockResolvedValue({ match: matchRecord(4), replayed: false }),
    } as unknown as MatchesRepository;

    const snapshot = await new MatchesService(repository).claimPosition(
      'match-1',
      'slot-1',
      'player-1',
    );

    expect(repository.claimPosition).toHaveBeenCalledWith('match-1', 'slot-1', 'player-1');
    expect(snapshot).toMatchObject({
      matchId: 'match-1',
      formationVersion: 4,
      slots: [{ id: 'slot-1', participantId: 'participant-1' }],
    });
    expect(emitted).toHaveLength(1);
    expect(operationalMetricsSnapshot().counters).toMatchObject({ position_claims_total: 1 });
  });

  it('does not republish or count an idempotent repeat of the same claim', async () => {
    const repository = {
      claimPosition: vi.fn().mockResolvedValue({ match: matchRecord(4), replayed: true }),
    } as unknown as MatchesRepository;

    await new MatchesService(repository).claimPosition('match-1', 'slot-1', 'player-1');

    expect(emitted).toHaveLength(0);
    expect(operationalMetricsSnapshot().counters.position_claims_total).toBeUndefined();
  });

  it('returns a stable conflict carrying the authoritative formation to the losing claimant', async () => {
    const repository = {
      claimPosition: vi.fn().mockRejectedValue(new PositionAlreadyClaimedError()),
      findById: vi.fn().mockResolvedValue(matchRecord(7)),
    } as unknown as MatchesRepository;

    await expect(
      new MatchesService(repository).claimPosition('match-1', 'slot-1', 'player-2'),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'POSITION_ALREADY_CLAIMED',
      details: {
        matchId: 'match-1',
        formationVersion: 7,
        slots: [{ id: 'slot-1', participantId: 'participant-1' }],
      },
    });
    expect(emitted).toHaveLength(0);
    expect(operationalMetricsSnapshot().counters).toMatchObject({
      position_claim_conflicts_total: 1,
    });
  });

  it.each([
    [new NotMatchParticipantError(), 403, 'MATCH_PARTICIPANT_REQUIRED'],
    [new PositionWrongSideError(), 403, 'POSITION_WRONG_SIDE'],
    [new FormationSlotNotFoundError(), 404, 'FORMATION_SLOT_NOT_FOUND'],
    [new MatchClosedError(), 409, 'MATCH_STARTED'],
    [new TeamMatchPlanningError(), 409, 'TEAM_MATCH_PLANNING'],
  ])('maps %s to a stable error code without mutating', async (error, statusCode, code) => {
    const repository = {
      claimPosition: vi.fn().mockRejectedValue(error),
    } as unknown as MatchesRepository;

    await expect(
      new MatchesService(repository).claimPosition('match-1', 'slot-1', 'player-1'),
    ).rejects.toMatchObject({ statusCode, code });
    expect(emitted).toHaveLength(0);
  });
});

describe('organiser formation overrides', () => {
  const emitted: unknown[] = [];
  const listener = (payload: unknown) => emitted.push(payload);
  beforeEach(() => {
    emitted.length = 0;
    domainEvents.on('formation:updated', listener);
  });
  afterEach(() => domainEvents.off('formation:updated', listener));

  it('passes the organiser as the audited actor and publishes persisted notifications after commit', async () => {
    const notification = { id: 'notification-1', userId: 'player-1' };
    const repository = {
      findById: vi.fn().mockResolvedValue(matchRecord(2)),
      updateFormation: vi.fn().mockResolvedValue({
        match: matchRecord(3, [slotRecord('slot-1')]),
        notifications: [notification],
        changed: true,
      }),
    } as unknown as MatchesRepository;
    const notifications = notificationsStub();

    const slots = await new MatchesService(repository, notifications).updateFormation(
      'match-1',
      'slot-1',
      { participantId: null },
      'host-1',
    );

    expect(repository.updateFormation).toHaveBeenCalledWith(
      'match-1',
      'slot-1',
      { participantId: null },
      'host-1',
    );
    expect(slots).toEqual([expect.objectContaining({ id: 'slot-1', participantId: null })]);
    expect(notifications.publishPersistedMany).toHaveBeenCalledWith([notification]);
    expect(emitted).toHaveLength(1);
  });

  it('does not broadcast when the organiser request changed nothing', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue(matchRecord(2)),
      updateFormation: vi.fn().mockResolvedValue({
        match: matchRecord(2),
        notifications: [],
        changed: false,
      }),
    } as unknown as MatchesRepository;

    await new MatchesService(repository, notificationsStub()).updateFormation(
      'match-1',
      'slot-1',
      { participantId: 'participant-1' },
      'host-1',
    );

    expect(emitted).toHaveLength(0);
  });

  it('still rejects a non-organiser before any formation write', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue(matchRecord(2)),
      updateFormation: vi.fn(),
    } as unknown as MatchesRepository;

    await expect(
      new MatchesService(repository).updateFormation(
        'match-1',
        'slot-1',
        { participantId: null },
        'player-1',
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: 'HOST_REQUIRED' });
    expect(repository.updateFormation).not.toHaveBeenCalled();
  });
});
