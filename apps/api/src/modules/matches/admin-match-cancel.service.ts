import type { AdminCancelMatchInput } from '@footy-finder/shared';
import { AppError } from '../../errors/app-error.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AdminCancelRefusedError, MatchesRepository } from './matches.repository.js';

const REFUSALS = {
  MATCH_NOT_FOUND: [404, 'Match not found.'],
  ALREADY_CANCELLED: [409, 'This match is already cancelled.'],
  MATCH_STARTED: [409, 'A match can be cancelled by FootyFinder only before kick-off.'],
  TEAM_MATCH_LOCKED: [409, 'A team match can be cancelled by FootyFinder only before its 30-minute check, because the team fees have been taken.'],
} as const;

/**
 * CEO Q4: admin "Cancel match (weather/venue)". Fresh MFA is enforced on the route; the written
 * reason is kept in the admin audit log only. Players see a fixed sentence (FOOTYFINDER_CANCELLED).
 */
export class AdminMatchCancelService {
  constructor(
    private readonly matches = new MatchesRepository(),
    private readonly notifications = new NotificationsService(),
  ) {}

  async cancel(matchId: string, adminUserId: string, input: AdminCancelMatchInput, requestId: string, now = new Date()) {
    let cancelled;
    try {
      cancelled = await this.matches.cancelByFootyFinder(matchId, adminUserId, input.reason, requestId, now);
    } catch (error) {
      if (error instanceof AdminCancelRefusedError) {
        const [status, message] = REFUSALS[error.reason];
        throw new AppError(status, message, error.reason);
      }
      throw error;
    }
    this.notifications.publishPersistedMany(cancelled.notifications);
    emitDomainEventBestEffort('match:cancelled', { matchId });
    return { matchId, status: 'CANCELLED' as const, payersAskedToChoose: cancelled.payerIds.length };
  }
}
