import { randomUUID } from 'node:crypto';
import {
  createFormationPresetSlots,
  getDefaultFormationKey,
  mapTeamPositionToMatchHalf,
  type MatchFormat,
  type TeamSide,
} from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { lockPlayers, overlappingMatches, type TimedMatch } from '../matches/player-overlap.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';

/** The team's saved formation for a format (its key falls back to the default preset). */
export async function savedFormation(tx: Prisma.TransactionClient, teamId: string, format: MatchFormat) {
  const formation = await tx.teamFormation.findUnique({
    where: { teamId_format: { teamId, format } },
    include: {
      slots: { include: { membership: { select: { userId: true } } }, orderBy: { slotIndex: 'asc' } },
    },
  });
  return { formation, formationKey: formation?.formationKey ?? getDefaultFormationKey(format) };
}

/**
 * Copies a team's saved formation and starters into one side of a match: its lineup slots take
 * the saved coordinates (mapped onto that side's half) and each assigned member becomes a
 * selected starter. Members listed in `excludeUserIds` are left out (for example players who
 * are also on the other side). Used for HOME at creation and AWAY when a team takes the side.
 */
export async function copySavedSquad(
  tx: Prisma.TransactionClient,
  input: {
    matchTeamId: string;
    teamId: string;
    side: TeamSide;
    format: MatchFormat;
    formationKey: string;
    actorUserId: string;
    excludeUserIds?: Set<string>;
  },
) {
  const { formation } = await savedFormation(tx, input.teamId, input.format);
  const presetSlots = createFormationPresetSlots(input.format, input.formationKey);
  const coordinateSlots =
    formation?.formationKey === input.formationKey && formation.slots.length === presetSlots.length
      ? formation.slots.map(({ slotIndex, positionX, positionY }) => ({
          slotIndex,
          positionX: Number(positionX),
          positionY: Number(positionY),
        }))
      : presetSlots;
  const validSlotIndexes = new Set(coordinateSlots.map(({ slotIndex }) => slotIndex));
  const assignedUserBySlot = new Map(
    formation?.slots
      .filter(({ membership, slotIndex }) =>
        Boolean(membership) && validSlotIndexes.has(slotIndex) && !input.excludeUserIds?.has(membership!.userId))
      .map(({ slotIndex, membership }) => [slotIndex, membership!.userId]) ?? [],
  );
  const selectionIdByUser = new Map<string, string>();
  for (const assignedUserId of assignedUserBySlot.values())
    if (!selectionIdByUser.has(assignedUserId)) selectionIdByUser.set(assignedUserId, randomUUID());
  if (selectionIdByUser.size)
    await tx.teamMatchSelection.createMany({
      data: [...selectionIdByUser].map(([selectedUserId, id]) => ({
        id,
        matchTeamId: input.matchTeamId,
        userId: selectedUserId,
        status: 'SELECTED_STARTER' as const,
        selectedByUserId: input.actorUserId,
      })),
    });
  await tx.teamMatchLineupSlot.createMany({
    data: coordinateSlots.map((slot) => {
      const assignedUserId = assignedUserBySlot.get(slot.slotIndex);
      return {
        matchTeamId: input.matchTeamId,
        slotIndex: slot.slotIndex,
        ...mapTeamPositionToMatchHalf(input.side, slot),
        selectionId: assignedUserId ? selectionIdByUser.get(assignedUserId) : undefined,
      };
    }),
  });
}

/**
 * Gate 9 / TKT-908 (D17a): when a team is loaded into a match (or publishes one), members of its
 * saved squad who are already in an overlapping match are left out of the copied lineup, and the
 * captain who acted is told who and why. The team itself still loads.
 */
export async function overlappingSquadMembers(
  tx: Prisma.TransactionClient,
  input: { teamId: string; match: TimedMatch; matchName: string; actorUserId: string },
) {
  const members = await tx.teamMembership.findMany({
    where: { teamId: input.teamId },
    select: { userId: true, user: { select: { username: true, profile: { select: { displayName: true } } } } },
  });
  await lockPlayers(tx, members.map(({ userId }) => userId));
  const clashes = await overlappingMatches(tx, members.map(({ userId }) => userId), input.match);
  const skipped = new Set(clashes.map(({ userId }) => userId));
  if (skipped.size) {
    const names = members.filter(({ userId }) => skipped.has(userId)).map(({ user }) => user.profile?.displayName ?? user.username);
    await persistNotifications(tx, [{
      userId: input.actorUserId,
      type: 'TEAM_MATCH_SELECTION_UPDATED',
      title: 'Some players were left out',
      message: `${names.join(', ')} ${names.length === 1 ? 'was' : 'were'} not added to the lineup for ${input.matchName} because they are already in another match at the same time.`,
      targetPath: `/matches/${input.match.id}`,
      dedupeKey: notificationDedupeKey('team-squad-overlap', input.match.id, input.teamId),
    }]);
  }
  return skipped;
}
