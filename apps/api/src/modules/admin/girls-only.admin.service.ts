import type { AdminCorrectGenderInput, AdminGirlsOnlyInput } from '@footy-finder/shared';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { ineligibleForGirlsOnly } from '../matches/girls-only.js';
import { appendAdminAudit } from './admin-audit.js';

const ACTIVE_SELECTION = ['INVITED', 'SELECTED_STARTER', 'SELECTED_SUBSTITUTE', 'OPEN_SLOT_CLAIMED'] as const;

/**
 * CEO touch-up batch 4, item 1. D3: an admin switches a match's girls-only rule on (only while no ineligible player is
 * in it) or off (only while nobody is in it). D4: an admin corrects a player's gender. Both need fresh MFA (route),
 * a reason and an audit entry; nothing else changes automatically.
 */
export class GirlsOnlyAdminService {
  async setMatch(matchId: string, input: AdminGirlsOnlyInput, actorUserId: string, requestId?: string) {
    return serializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${matchId}::uuid FOR UPDATE`;
      const match = await tx.match.findUnique({
        where: { id: matchId },
        select: {
          id: true, status: true, startsAt: true, girlsOnly: true,
          participants: { where: { status: 'JOINED' }, select: { userId: true } },
          teamSides: { select: { selections: { where: { status: { in: [...ACTIVE_SELECTION] } }, select: { userId: true } } } },
        },
      });
      if (!match) throw new AppError(404, 'Match not found.', 'MATCH_NOT_FOUND');
      if (!['DRAFT', 'OPEN', 'READY'].includes(match.status) || match.startsAt <= new Date())
        throw new AppError(409, 'This match can no longer be changed.', 'MATCH_CLOSED');
      const players = [...match.participants.map(({ userId }) => userId), ...match.teamSides.flatMap(({ selections }) => selections.map(({ userId }) => userId))];
      if (input.girlsOnly && (await ineligibleForGirlsOnly(tx, players)).size)
        throw new AppError(409, 'A player who is not eligible has already joined, so this match cannot become girls-only.', 'GIRLS_ONLY_HAS_INELIGIBLE');
      if (!input.girlsOnly && players.length)
        throw new AppError(409, 'Players have already joined this girls-only match, so it cannot be opened to everyone.', 'GIRLS_ONLY_HAS_PLAYERS');
      const updated = await tx.match.update({ where: { id: matchId }, data: { girlsOnly: input.girlsOnly }, select: { id: true, girlsOnly: true } });
      await appendAdminAudit(tx, {
        actorUserId, action: input.girlsOnly ? 'MATCH_GIRLS_ONLY_ON' : 'MATCH_GIRLS_ONLY_OFF', entityType: 'MATCH', entityId: matchId, requestId,
        metadata: { reason: input.reason },
      });
      return { matchId: updated.id, girlsOnly: updated.girlsOnly };
    });
  }

  /** Returns the upcoming girls-only matches the player is now not eligible for, for the admin to follow up. */
  async correctGender(userId: string, input: AdminCorrectGenderInput, actorUserId: string, requestId?: string) {
    return serializableTransaction(async (tx) => {
      const profile = await tx.playerProfile.findUnique({ where: { userId }, select: { gender: true } });
      if (!profile) throw new AppError(404, 'Player not found.', 'PLAYER_NOT_FOUND');
      await tx.playerProfile.update({ where: { userId }, data: { gender: input.gender } });
      await appendAdminAudit(tx, {
        actorUserId, action: 'PLAYER_GENDER_CORRECTED', entityType: 'USER', entityId: userId, requestId,
        metadata: { from: profile.gender, to: input.gender, reason: input.reason },
      });
      if (input.gender === 'FEMALE') return { gender: input.gender, affectedMatches: [] };
      const affected = await tx.match.findMany({
        where: {
          girlsOnly: true,
          status: { in: ['DRAFT', 'OPEN', 'READY'] },
          startsAt: { gt: new Date() },
          OR: [
            { participants: { some: { userId, status: 'JOINED' } } },
            { teamSides: { some: { selections: { some: { userId, status: { in: [...ACTIVE_SELECTION] } } } } } },
          ],
        },
        select: { id: true, name: true, startsAt: true },
        orderBy: { startsAt: 'asc' },
      });
      return { gender: input.gender, affectedMatches: affected.map((match) => ({ matchId: match.id, name: match.name, startsAt: match.startsAt.toISOString() })) };
    });
  }
}
