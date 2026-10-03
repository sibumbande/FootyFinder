import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { domainEvents } from '../../events/domain-events.js';
import {
  operationalMetricsSnapshot,
  resetOperationalMetricsForTests,
} from '../../observability/operational-metrics.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import {
  GoNoGoNotDueError,
  LineupLockedError,
  type MatchesRepository,
} from './matches.repository.js';
import { MatchesService } from './matches.service.js';

const notificationsStub = () =>
  ({ publishPersistedMany: vi.fn() }) as unknown as NotificationsService & {
    publishPersistedMany: ReturnType<typeof vi.fn>;
  };

const events: Array<[string, unknown]> = [];
const record = (name: string) => (payload: unknown) => events.push([name, payload]);
const onCancelled = record('match:cancelled');
const onUpdated = record('match:updated');
beforeEach(() => {
  events.length = 0;
  resetOperationalMetricsForTests();
  domainEvents.on('match:cancelled', onCancelled);
  domainEvents.on('match:updated', onUpdated);
});
afterEach(() => {
  domainEvents.off('match:cancelled', onCancelled);
  domainEvents.off('match:updated', onUpdated);
});

describe('T-30 go/no-go service (DEC-018)', () => {
  it('publishes cancellation notifications and the cancelled event only after the decision commits', async () => {
    const notification = { id: 'n1', userId: 'player-1' };
    const repository = {
      decideGoNoGo: vi.fn().mockResolvedValue({
        outcome: 'CANCELLED',
        notifications: [notification],
        filled: 7,
        total: 10,
      }),
    } as unknown as MatchesRepository;
    const notifications = notificationsStub();

    const result = await new MatchesService(repository, notifications).decideGoNoGo('match-1');

    expect(result.outcome).toBe('CANCELLED');
    expect(notifications.publishPersistedMany).toHaveBeenCalledWith([notification]);
    expect(events).toEqual([['match:cancelled', { matchId: 'match-1' }]]);
    expect(operationalMetricsSnapshot().counters).toMatchObject({ go_no_go_cancelled_total: 1 });
  });

  it('publishes a confirmation for a full lineup', async () => {
    const repository = {
      decideGoNoGo: vi
        .fn()
        .mockResolvedValue({ outcome: 'CONFIRMED', notifications: [], filled: 10, total: 10 }),
    } as unknown as MatchesRepository;

    await new MatchesService(repository, notificationsStub()).decideGoNoGo('match-1');

    expect(events).toEqual([['match:updated', { matchId: 'match-1' }]]);
    expect(operationalMetricsSnapshot().counters).toMatchObject({ go_no_go_confirmed_total: 1 });
  });

  it('emits nothing and counts nothing when the decision was already made (job ran twice)', async () => {
    const repository = {
      decideGoNoGo: vi
        .fn()
        .mockResolvedValue({ outcome: 'ALREADY_DECIDED', notifications: [], filled: 0, total: 0 }),
    } as unknown as MatchesRepository;

    await new MatchesService(repository, notificationsStub()).decideGoNoGo('match-1');

    expect(events).toEqual([]);
    expect(operationalMetricsSnapshot().counters.go_no_go_cancelled_total).toBeUndefined();
  });

  it('surfaces an early run as a retryable job failure', async () => {
    const repository = {
      decideGoNoGo: vi.fn().mockRejectedValue(new GoNoGoNotDueError()),
    } as unknown as MatchesRepository;

    await expect(
      new MatchesService(repository, notificationsStub()).decideGoNoGo('match-1'),
    ).rejects.toMatchObject({ code: 'GO_NO_GO_NOT_DUE' });
  });
});

describe('lineup freeze from T-30 (D1)', () => {
  const frozenMatch = {
    id: 'match-1',
    mode: 'QUICK_GAME' as const,
    createdById: 'host-1',
    status: 'OPEN' as const,
    startsAt: new Date(Date.now() + 10 * 60_000),
    durationMinutes: 60,
    goNoGoAt: new Date(Date.now() - 20 * 60_000),
    formationSlots: [{ id: 'slot-1', team: 'HOME' }],
  };

  it.each([
    ['organiser formation move', (service: MatchesService) =>
      service.updateFormation('match-1', 'slot-1', { participantId: null }, 'host-1')],
    ['host cancellation (D3)', (service: MatchesService) => service.remove('match-1', 'host-1')],
    ['match details update', (service: MatchesService) =>
      service.update('match-1', { name: 'Renamed' }, 'host-1')],
  ])('rejects %s with LINEUP_LOCKED before touching the database', async (_label, act) => {
    const repository = {
      findById: vi.fn().mockResolvedValue(frozenMatch),
      updateFormation: vi.fn(),
      cancelMatch: vi.fn(),
      update: vi.fn(),
    } as unknown as MatchesRepository;

    await expect(act(new MatchesService(repository, notificationsStub()))).rejects.toMatchObject({
      statusCode: 409,
      code: 'LINEUP_LOCKED',
    });
    expect(repository.updateFormation).not.toHaveBeenCalled();
    expect(repository.cancelMatch).not.toHaveBeenCalled();
  });

  it.each([
    ['claim', (service: MatchesService) => service.claimPosition('match-1', 'slot-1', 'u'), 'claimPosition'],
  ])('maps a frozen %s to LINEUP_LOCKED', async (_label, act, method) => {
    const repository = {
      [method]: vi.fn().mockRejectedValue(new LineupLockedError()),
    } as unknown as MatchesRepository;

    await expect(act(new MatchesService(repository, notificationsStub()))).rejects.toMatchObject({
      statusCode: 409,
      code: 'LINEUP_LOCKED',
    });
  });
});
