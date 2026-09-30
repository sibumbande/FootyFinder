import {
  getMatchEndsAt,
  MATCH_RESULT_PROBLEM_MESSAGES,
  validateMatchResult,
  type RefereeResultInput,
} from '@footy-finder/shared';
import type { Notification, Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';
import { enqueueDurableJob } from '../../jobs/durable-jobs.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';

/**
 * Gate 8 / TKT-804 (DEC-020): writing a final result.
 * - The referee's result is final (D5). An admin enters it instead when the referee does not (D3)
 *   and only an admin corrects a clear recording error, with a reason (D5; TKT-807). All three
 *   paths write through `writeFinalResultInTx`, so every version is one permanent revision.
 * - Goals come from the kickoff lineup record; own goals name nobody (D7); unticked players did
 *   not play (D14). Statistics are read from these rows, so a correction flows through by itself.
 * - D4: two hours after the scheduled end, admins are alerted if there is still no result.
 */
export const RESULT_OVERDUE_JOB_TYPE = 'REFEREE_RESULT_OVERDUE';
export const RESULT_OVERDUE_HOURS = 2;
export const resultOverdueDedupeKey = (matchId: string) => `referee-result-overdue:${matchId}`;
export const resultOverdueAt = (match: { startsAt: Date; durationMinutes: number }) =>
  new Date(getMatchEndsAt(match).getTime() + RESULT_OVERDUE_HOURS * 3_600_000);

/** Scheduled at kickoff for refereed matches. */
export const enqueueResultOverdueJob = (tx: Prisma.TransactionClient, match: { id: string; startsAt: Date; durationMinutes: number }) =>
  enqueueDurableJob(tx, {
    type: RESULT_OVERDUE_JOB_TYPE,
    dedupeKey: resultOverdueDedupeKey(match.id),
    payload: { matchId: match.id },
    runAt: resultOverdueAt(match),
  });

export type FinalResultReason = 'REFEREE_SUBMISSION' | 'ADMIN_ENTRY' | 'ADMIN_CORRECTION';

const sideName = (teamSides: Array<{ side: string; teamNameSnapshot: string }>, side: 'HOME' | 'AWAY') =>
  teamSides.find((teamSide) => teamSide.side === side)?.teamNameSnapshot ?? (side === 'HOME' ? 'Team A' : 'Team B');

/** "Final result: Lions 2-1 Tigers." (Quick Match sides are Team A and Team B.) */
export const finalResultMessage = (
  input: Pick<RefereeResultInput, 'outcome' | 'homeScore' | 'awayScore' | 'forfeitWinner'>,
  match: { name: string; teamSides: Array<{ side: string; teamNameSnapshot: string }> },
  corrected: boolean,
) => {
  const home = sideName(match.teamSides, 'HOME');
  const away = sideName(match.teamSides, 'AWAY');
  const lead = corrected ? `The result of ${match.name} was corrected` : `Final result for ${match.name}`;
  if (input.outcome === 'ABANDONED') return `${lead}: the match was abandoned, so no result counts.`;
  if (input.outcome === 'FORFEIT')
    return `${lead}: ${input.forfeitWinner === 'HOME' ? home : away} win by forfeit.`;
  return `${lead}: ${home} ${input.homeScore}-${input.awayScore} ${away}.`;
};

/**
 * Writes the final result (first version or a correction) in the caller's transaction, under the
 * Match row lock: result, goals, didNotPlay flags, one new revision, status COMPLETED and one
 * in-app notice per lineup player and team member (D19). Returns the notices to publish.
 */
export async function writeFinalResultInTx(
  tx: Prisma.TransactionClient,
  input: {
    matchId: string;
    result: RefereeResultInput;
    actorUserId: string;
    reason: FinalResultReason;
    correctionReason?: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  await tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${input.matchId}::uuid FOR UPDATE`;
  const match = await tx.match.findUniqueOrThrow({
    where: { id: input.matchId },
    select: {
      id: true,
      name: true,
      status: true,
      result: { select: { id: true, finalSource: true, _count: { select: { revisions: true } } } },
      lineupEntries: { select: { id: true, userId: true, side: true } },
      teamSides: { select: { side: true, teamNameSnapshot: true, teamId: true } },
    },
  });
  if (match.status === 'CANCELLED') throw new AppError(409, 'This match was cancelled.', 'MATCH_CANCELLED');
  const correcting = input.reason === 'ADMIN_CORRECTION';
  if (!correcting && match.result)
    throw new AppError(409, 'This match already has a final result.', 'RESULT_ALREADY_FINAL');
  if (correcting && (!match.result || match.result.finalSource === 'LEGACY'))
    throw new AppError(409, 'Only a referee or admin result can be corrected here.', 'RESULT_NOT_CORRECTABLE');
  const problems = validateMatchResult(input.result, match.lineupEntries);
  if (problems.length)
    throw new AppError(400, problems.map((problem) => MATCH_RESULT_PROBLEM_MESSAGES[problem]).join(' '), 'RESULT_INVALID', { problems });

  const entryByUser = new Map(match.lineupEntries.map((entry) => [entry.userId, entry.id]));
  const source = input.reason === 'REFEREE_SUBMISSION' ? 'REFEREE' as const : 'ADMIN' as const;
  const values = {
    homeScore: input.result.homeScore,
    awayScore: input.result.awayScore,
    outcomeType: input.result.outcome,
    forfeitWinner: input.result.outcome === 'FORFEIT' ? input.result.forfeitWinner! : null,
  };
  const result = correcting
    ? await tx.matchResult.update({
        where: { id: match.result!.id },
        data: { ...values, finalSource: source, finalizedById: input.actorUserId, finalizedAt: now },
      })
    : await tx.matchResult.create({
        data: {
          ...values,
          matchId: match.id,
          submittedById: input.actorUserId,
          submittedAt: now,
          finalSource: source,
          finalizedById: input.actorUserId,
          finalizedAt: now,
        },
      });
  if (correcting) await tx.matchGoal.deleteMany({ where: { matchResultId: result.id } });
  if (input.result.goals.length)
    await tx.matchGoal.createMany({
      data: input.result.goals.map((goal, sortOrder) => ({
        matchResultId: result.id,
        side: goal.side,
        ownGoal: goal.ownGoal,
        scorerEntryId: goal.ownGoal ? null : entryByUser.get(goal.scorerUserId!)!,
        assistEntryId: !goal.ownGoal && goal.assistUserId ? entryByUser.get(goal.assistUserId)! : null,
        sortOrder,
      })),
    });
  const didNotPlay = new Set(input.result.didNotPlayUserIds);
  await tx.matchLineupEntry.updateMany({ where: { matchId: match.id, userId: { in: [...didNotPlay] } }, data: { didNotPlay: true } });
  await tx.matchLineupEntry.updateMany({ where: { matchId: match.id, userId: { notIn: [...didNotPlay] }, didNotPlay: true }, data: { didNotPlay: false } });
  const revisionNumber = (match.result?._count.revisions ?? 0) + 1;
  await tx.matchResultRevision.create({
    data: {
      matchResultId: result.id,
      revisionNumber,
      homeScore: values.homeScore,
      awayScore: values.awayScore,
      outcomeType: values.outcomeType,
      forfeitWinner: values.forfeitWinner,
      scorersSnapshot: {
        goals: input.result.goals.map(({ side, ownGoal, scorerUserId, assistUserId }) => ({
          side,
          ownGoal,
          scorerUserId: ownGoal ? null : scorerUserId ?? null,
          assistUserId: ownGoal ? null : assistUserId ?? null,
        })),
        didNotPlayUserIds: [...didNotPlay],
        ...(input.correctionReason ? { correctionReason: input.correctionReason } : {}),
      },
      reason: input.reason,
      createdByUserId: input.actorUserId,
      createdByAdminUserId: input.reason === 'REFEREE_SUBMISSION' ? null : input.actorUserId,
      createdAt: now,
    },
  });
  if (match.status !== 'COMPLETED') await tx.match.update({ where: { id: match.id }, data: { status: 'COMPLETED' } });

  const teamIds = match.teamSides.map(({ teamId }) => teamId).filter((id): id is string => Boolean(id));
  const members = teamIds.length
    ? await tx.teamMembership.findMany({ where: { teamId: { in: teamIds } }, select: { userId: true } })
    : [];
  const recipients = new Set([...match.lineupEntries.map(({ userId }) => userId), ...members.map(({ userId }) => userId)]);
  const notifications: Notification[] = await persistNotifications(
    tx,
    [...recipients].map((userId) => ({
      userId,
      type: correcting ? 'RESULT_CORRECTED' as const : 'RESULT_FINAL' as const,
      title: correcting ? 'Result corrected' : 'Final result',
      message: finalResultMessage(input.result, match, correcting),
      targetPath: `/matches/${match.id}`,
      dedupeKey: notificationDedupeKey('match', match.id, 'result', revisionNumber, userId),
    })),
  );
  return { resultId: result.id, revisionNumber, notifications };
}
