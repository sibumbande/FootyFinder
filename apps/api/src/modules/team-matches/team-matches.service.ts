import {
  createDefaultFormation,
  formatRandAmount,
  getGoNoGoAt,
  getTeamFee,
  MATCH_DURATION_MINUTES,
  MATCH_FEE_CENTS,
  MAX_TEAM_MATCHES_AWAITING_OPPONENT,
  type CreateMatchInput,
  type Match,
} from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { assertPlayerSlotWindow, BookingsService, rethrowReservationConflict } from '../bookings/bookings.service.js';
import { toMatch } from '../matches/match.mapper.js';
import { matchInclude } from '../matches/match.query.js';
import { createPublicMatchSlug } from '../matches/public-match.js';
import { TeamWalletRepository } from '../team-wallet/team-wallet.repository.js';
import { copySavedSquad, savedFormation } from './team-squad.js';

/**
 * D12 / N6: published team matches of this home team whose other side is not taken yet. A side
 * is taken when a team has loaded it, or (individuals) when every starting position is claimed.
 */
export async function countTeamMatchesAwaitingOpponent(tx: Prisma.TransactionClient, teamId: string) {
  const matches = await tx.match.findMany({
    where: {
      otherSideMode: { not: null },
      status: { in: ['OPEN', 'READY'] },
      teamSides: { some: { teamId, side: 'HOME' } },
    },
    select: { otherSideTakenBy: true, formationSlots: { where: { team: 'AWAY' }, select: { participantId: true } } },
  });
  return matches.filter((match) =>
    match.otherSideTakenBy === null
    || (match.otherSideTakenBy === 'INDIVIDUALS' && match.formationSlots.some((slot) => !slot.participantId))).length;
}

/**
 * Gate 7 / TKT-704 (DEC-019): a team owner or captain publishes a team match at a managed venue
 * slot. It is always public; the captain chooses who can take the other side and how many subs
 * their team brings. Publishing needs the team wallet's AVAILABLE balance to cover the home fee
 * (a check, not a hold) and at most two published matches may be waiting for an opponent (D12).
 * No money moves at publication.
 */
export class TeamMatchesService {
  constructor(
    private readonly bookings = new BookingsService(),
    private readonly teamWallets = new TeamWalletRepository(),
  ) {}

  async create(input: CreateMatchInput, userId: string): Promise<Match> {
    const teamId = input.playAsTeamId;
    if (!teamId || !input.otherSideMode || input.teamSubstituteCount === undefined)
      throw new AppError(400, 'Choose your team, who can take the other side and your number of subs.', 'VALIDATION_ERROR');
    const startsAt = new Date(input.startsAt);
    const now = new Date();
    assertPlayerSlotWindow(startsAt, now);
    const fee = getTeamFee(input.format, input.teamSubstituteCount);
    try {
      const match = await serializableTransaction(async (tx) => {
        // Serialises the publish limit and wallet check for this team.
        await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${teamId}::uuid FOR UPDATE`;
        const team = await tx.team.findUnique({
          where: { id: teamId },
          include: { memberships: { where: { userId }, select: { role: true } } },
        });
        if (!team) throw new AppError(404, 'Team not found.', 'TEAM_NOT_FOUND');
        if (team.archivedAt) throw new AppError(409, 'This team has been closed.', 'TEAM_ARCHIVED');
        if (!team.memberships.some(({ role }) => role === 'OWNER' || role === 'CAPTAIN'))
          throw new AppError(403, 'Only the team owner or a captain can create a team match.', 'TEAM_FORBIDDEN');
        if ((await countTeamMatchesAwaitingOpponent(tx, teamId)) >= MAX_TEAM_MATCHES_AWAITING_OPPONENT)
          throw new AppError(
            409,
            `Your team already has ${MAX_TEAM_MATCHES_AWAITING_OPPONENT} matches waiting for an opponent. Wait for one to fill or cancel one before publishing another.`,
            'TEAM_MATCHES_AWAITING_OPPONENT_LIMIT',
          );
        const account = await this.teamWallets.lockAccount(tx, teamId);
        const available = account.balanceCents - (await this.teamWallets.heldCents(tx, account.id));
        if (available < fee.totalCents)
          throw new AppError(
            409,
            `Top up your team wallet to at least ${formatRandAmount(fee.totalCents)} to publish this match.`,
            'TEAM_WALLET_TOP_UP_REQUIRED',
          );
        const slot = await this.bookings.playerSlot(tx, input.managedFieldId, input.format, startsAt);
        const { formationKey } = await savedFormation(tx, teamId, input.format);
        const created = await tx.match.create({
          data: {
            name: input.name,
            description: input.description,
            createdBy: { connect: { id: userId } },
            mode: 'TEAM_MATCH',
            format: input.format,
            // N4: an individuals side gets as many sub places as the home team chose.
            substituteCapacityPerTeam: fee.substituteCount,
            rollingSubstitutes: input.rollingSubstitutes,
            rules: input.rules,
            visibility: 'PUBLIC',
            publicSlug: createPublicMatchSlug(),
            startsAt,
            durationMinutes: MATCH_DURATION_MINUTES,
            // Individuals who join an "Open to both" other side pay the DEC-018 R80 each.
            feeCents: MATCH_FEE_CENTS,
            status: 'OPEN',
            goNoGoAt: getGoNoGoAt(startsAt),
            otherSideMode: input.otherSideMode,
            venue: { create: slot.venue },
            formationSlots: { create: createDefaultFormation(input.format) },
            teamSides: {
              create: {
                team: { connect: { id: teamId } },
                side: 'HOME',
                organisingUser: { connect: { id: userId } },
                formationKey,
                teamNameSnapshot: team.name,
                teamImageUrlSnapshot: team.profileImageUrl,
                primaryColorSnapshot: team.primaryColor,
                secondaryColorSnapshot: team.secondaryColor,
                starterCount: fee.starterCount,
                substituteCount: fee.substituteCount,
                placeFeeCents: fee.placeFeeCents,
                teamFeeCents: fee.totalCents,
              },
            },
          },
          include: { teamSides: true },
        });
        await copySavedSquad(tx, {
          matchTeamId: created.teamSides[0]!.id,
          teamId,
          side: 'HOME',
          format: input.format,
          formationKey,
          actorUserId: userId,
        });
        await tx.fieldReservation.create({ data: slot.reservation(created.id, 'PUBLIC', now) });
        return tx.match.findUniqueOrThrow({ where: { id: created.id }, include: matchInclude });
      });
      return toMatch(match, { viewerCanManage: true, viewerCanChat: true });
    } catch (error) {
      return rethrowReservationConflict(error);
    }
  }
}
