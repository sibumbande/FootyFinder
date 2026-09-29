import { randomUUID } from 'node:crypto';
import {
  createFormationPresetSlots,
  getDefaultFormationKey,
  mapTeamPositionToMatchHalf,
  type MatchFormat,
  type TeamSide,
} from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';

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
