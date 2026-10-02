import type { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';

type Tx = Prisma.TransactionClient;

/**
 * CEO touch-up batch 4, item 1: girls-only matches. Only players whose (private) gender is FEMALE can join, claim a
 * position, be selected or invited into a lineup, be asked for availability or be loaded with their team. The
 * referee can be anyone. A player with no gender saved yet is not eligible.
 */
export const girlsOnlyError = () => new AppError(409, 'This match is for female players only.', 'GIRLS_ONLY');

/** The given players who may not take part in a girls-only match. */
export async function ineligibleForGirlsOnly(tx: Tx, userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const female = await tx.playerProfile.findMany({ where: { userId: { in: userIds }, gender: 'FEMALE' }, select: { userId: true } });
  const allowed = new Set(female.map(({ userId }) => userId));
  return new Set(userIds.filter((userId) => !allowed.has(userId)));
}

/** Throws GIRLS_ONLY when the match is girls-only and any of the players is not eligible. */
export async function assertGirlsOnlyEligible(tx: Tx, match: { girlsOnly: boolean }, userIds: string[]) {
  if (!match.girlsOnly) return;
  if ((await ineligibleForGirlsOnly(tx, userIds)).size) throw girlsOnlyError();
}

/**
 * When a team publishes or is loaded into a girls-only match, its saved squad members who are not eligible are
 * left out of the copied lineup and the Owner or Captain who acted is told who (D2). The team itself still loads.
 */
export async function girlsOnlySquadExclusions(
  tx: Tx,
  input: { teamId: string; match: { id: string; name: string; girlsOnly: boolean }; actorUserId: string },
): Promise<Set<string>> {
  if (!input.match.girlsOnly) return new Set();
  const members = await tx.teamMembership.findMany({
    where: { teamId: input.teamId },
    select: { userId: true, user: { select: { username: true, profile: { select: { displayName: true } } } } },
  });
  const skipped = await ineligibleForGirlsOnly(tx, members.map(({ userId }) => userId));
  const left = members.filter(({ userId }) => skipped.has(userId));
  if (left.length) {
    const names = left.map(({ user }) => user.profile?.displayName ?? user.username);
    await persistNotifications(tx, [{
      userId: input.actorUserId,
      type: 'TEAM_MATCH_SELECTION_UPDATED',
      title: 'Girls-only match: some players were left out',
      message: `${names.join(', ')} ${names.length === 1 ? 'was' : 'were'} not added to the lineup for ${input.match.name} because it is a girls-only match.`,
      targetPath: `/matches/${input.match.id}`,
      dedupeKey: notificationDedupeKey('team-squad-girls-only', input.match.id, input.teamId),
    }]);
  }
  return skipped;
}
