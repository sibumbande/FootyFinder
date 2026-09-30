import type { RefereeResultInput } from '@footy-finder/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { writeFinalResultInTx } from './referee-results.js';
import { isActiveReferee } from './referee-status.js';

const alreadyFinal = () => new AppError(409, 'This match already has a final result.', 'RESULT_ALREADY_FINAL');

/**
 * Gate 8 / TKT-804 (DEC-020): the assigned referee records the final result, from kickoff (D12)
 * until a result exists (the first one wins; an admin entry also counts). The result is final (D5).
 */
export class RefereeResultsService {
  constructor(private readonly notifications = new NotificationsService()) {}

  async submit(matchId: string, refereeUserId: string, input: RefereeResultInput, now = new Date()) {
    let written;
    try {
      written = await serializableTransaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${matchId}::uuid FOR UPDATE`;
        const match = await tx.match.findUnique({ where: { id: matchId }, select: { refereeUserId: true, status: true } });
        if (!match) throw new AppError(404, 'Match not found.', 'MATCH_NOT_FOUND');
        if (match.refereeUserId !== refereeUserId || !(await isActiveReferee(tx, refereeUserId)))
          throw new AppError(403, 'Only the assigned FootyFinder referee can record this result.', 'NOT_MATCH_REFEREE');
        if (match.status === 'COMPLETED') throw alreadyFinal();
        if (!['IN_PROGRESS', 'AWAITING_RESULT'].includes(match.status))
          throw new AppError(409, 'You can record the result once the match has kicked off.', 'MATCH_NOT_STARTED');
        return writeFinalResultInTx(tx, { matchId, result: input, actorUserId: refereeUserId, reason: 'REFEREE_SUBMISSION', now });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw alreadyFinal();
      throw error;
    }
    this.notifications.publishPersistedMany(written.notifications);
    emitDomainEventBestEffort('match:updated', { matchId });
    return { matchId, revisionNumber: written.revisionNumber, final: true as const };
  }
}
