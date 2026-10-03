import { visibleAccountWhere } from '../users/hidden-account.js';
import { Prisma, type Notification, type TeamSide } from '../../generated/prisma/client.js';
import type {
  AssignTeamMatchStarterInput,
  LineupPlayerAction,
  OpenTeamMatchLineupSlotInput,
  TeamMatchLineupChangeReason,
  UpdateTeamMatchLineupSlotPositionInput,
} from '@footy-finder/shared';
import { getPlayersPerTeam, mapMatchHalfPositionToTeam } from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import {
  notificationDedupeKey,
  persistNotifications,
  type NotificationDraft,
} from '../notifications/notification-writer.js';
import { safeUserInclude } from '../users/users.repository.js';
import { assertNoPlayerOverlap } from '../matches/player-overlap.js';
import { assertGirlsOnlyEligible } from '../matches/girls-only.js';
import { AppError } from '../../errors/app-error.js';

export class LineupTeamSideNotFoundError extends Error {}
export class LineupForbiddenError extends Error {}
export class LineupTeamMatchClosedError extends Error {}
/** Gate 8 / TKT-803: team lineups lock at kickoff, when the lineup record is taken. */
export class LineupKickedOffError extends Error {}
export class LineupSlotNotFoundError extends Error {}
export class LineupSlotOccupiedError extends Error {}
export class LineupActionRequiredError extends Error {}
export class LineupInvalidActionError extends Error {}
export class LineupTeamMemberNotFoundError extends Error {}
export class SubstituteCapacityReachedError extends Error {}
export class LineupSelectionNotFoundError extends Error {}
export class PlayerAlreadyStarterError extends Error {}
export class PositionNotOpenError extends Error {}
export class PositionAlreadyClaimedError extends Error {}
export class LineupIncompleteError extends Error {}
export class LineupMemberIneligibleError extends Error {}
export class PositionOutsideTeamHalfError extends Error {}

const selectionInclude = {
  user: { include: safeUserInclude },
} satisfies Prisma.TeamMatchSelectionInclude;
/**
 * Gate 9 / TKT-908: a player newly entering this lineup (as a starter, substitute or claimed open
 * slot) must not already be in an overlapping match. Players already active in this lineup are
 * only moving within it, so they are not checked again.
 */
const ACTIVE_SELECTION = ['SELECTED_STARTER', 'SELECTED_SUBSTITUTE', 'OPEN_SLOT_CLAIMED'];
async function assertEntersWithoutOverlap(
  tx: Prisma.TransactionClient,
  context: { match: { id: string; mode: string; otherSideMode: string | null; startsAt: Date; durationMinutes: number; girlsOnly: boolean } },
  playerId: string,
  actorId: string,
  existing?: { status: string } | null,
) {
  if (existing && ACTIVE_SELECTION.includes(existing.status)) return;
  // CEO touch-up batch 4, item 1: only eligible players enter a girls-only lineup (starter, substitute, claim).
  await assertGirlsOnlyEligible(tx, context.match, [playerId]);
  // Retired team planning fixtures are never played, so they do not take part in the rule.
  if (context.match.mode === 'TEAM_MATCH' && !context.match.otherSideMode) return;
  await assertNoPlayerOverlap(tx, playerId, context.match, playerId === actorId);
}

const lineupInclude = {
  match: {
    select: {
      id: true,
      name: true,
      mode: true,
      status: true,
      format: true,
      substituteCapacityPerTeam: true,
      startsAt: true,
      durationMinutes: true,
      otherSideMode: true,
      girlsOnly: true,
    },
  },
  team: {
    select: {
      id: true,
      // CEO batch 5: a member who is deleting their account cannot be picked for a lineup.
      memberships: { where: { user: visibleAccountWhere }, select: { id: true, userId: true, role: true } },
    },
  },
  lineupSlots: {
    include: { selection: { include: selectionInclude } },
    orderBy: { slotIndex: 'asc' },
  },
  selections: { include: selectionInclude, orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }] },
} satisfies Prisma.MatchTeamInclude;
const teamFormationInclude = {
  slots: {
    include: {
      membership: {
        include: { user: { include: safeUserInclude } },
      },
    },
    orderBy: { slotIndex: 'asc' },
  },
} satisfies Prisma.TeamFormationInclude;

export type TeamMatchLineupRecord = Prisma.MatchTeamGetPayload<{ include: typeof lineupInclude }>;
export type TeamMatchSelectionRecord = Prisma.TeamMatchSelectionGetPayload<{
  include: typeof selectionInclude;
}>;
export type SavedTeamFormationRecord = Prisma.TeamFormationGetPayload<{
  include: typeof teamFormationInclude;
}>;
export interface TeamMatchLineupMutationResult {
  context: TeamMatchLineupRecord;
  notifications: Notification[];
  reason: TeamMatchLineupChangeReason | null;
}

const activeStarterStatuses = ['SELECTED_STARTER', 'OPEN_SLOT_CLAIMED'] as const;

async function loadLocked(
  tx: Prisma.TransactionClient,
  matchId: string,
  side: TeamSide,
): Promise<TeamMatchLineupRecord> {
  const initial = await tx.matchTeam.findUnique({
    where: { matchId_side: { matchId, side } },
    select: { id: true },
  });
  if (!initial) throw new LineupTeamSideNotFoundError();
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "MatchTeam" WHERE "id" = ${initial.id}::uuid FOR UPDATE`,
  );
  const context = await tx.matchTeam.findUniqueOrThrow({
    where: { id: initial.id },
    include: lineupInclude,
  });
  assertTeamSide(context);
  // D11 lets captains arrange their lineup until kickoff; from kickoff the lineup record is final.
  if (['IN_PROGRESS', 'AWAITING_RESULT'].includes(context.match.status) || Date.now() >= context.match.startsAt.getTime())
    throw new LineupKickedOffError();
  return context;
}

function assertTeamSide(context: TeamMatchLineupRecord) {
  if (context.match.mode !== 'TEAM_MATCH' || !context.team) throw new LineupTeamSideNotFoundError();
  if (['CANCELLED', 'COMPLETED'].includes(context.match.status))
    throw new LineupTeamMatchClosedError();
}

function membership(context: TeamMatchLineupRecord, userId: string) {
  return context.team?.memberships.find((member) => member.userId === userId);
}

function assertMember(context: TeamMatchLineupRecord, userId: string) {
  const member = membership(context, userId);
  if (!member) throw new LineupForbiddenError();
  return member;
}

function assertManager(context: TeamMatchLineupRecord, userId: string) {
  const member = assertMember(context, userId);
  if (!['OWNER', 'CAPTAIN'].includes(member.role)) throw new LineupForbiddenError();
  return member;
}

function findSlot(context: TeamMatchLineupRecord, slotId: string) {
  const slot = context.lineupSlots.find((candidate) => candidate.id === slotId);
  if (!slot) throw new LineupSlotNotFoundError();
  return slot;
}

function findSelection(context: TeamMatchLineupRecord, userId: string) {
  return context.selections.find((selection) => selection.userId === userId);
}

function starterSlotFor(context: TeamMatchLineupRecord, selectionId: string | undefined) {
  return selectionId
    ? context.lineupSlots.find((slot) => slot.selectionId === selectionId)
    : undefined;
}

/** Gate 7 / DEC-019: each team brings its own number of subs; legacy sides use the match setting. */
export function substituteCapacity(context: { substituteCount: number | null; match: { substituteCapacityPerTeam: number } }) {
  return context.substituteCount ?? context.match.substituteCapacityPerTeam;
}

function substituteCount(context: TeamMatchLineupRecord, excludeUserId?: string) {
  return context.selections.filter(
    (selection) => selection.status === 'SELECTED_SUBSTITUTE' && selection.userId !== excludeUserId,
  ).length;
}

async function saveSelection(
  tx: Prisma.TransactionClient,
  context: TeamMatchLineupRecord,
  userId: string,
  status:
    | 'INVITED'
    | 'SELECTED_STARTER'
    | 'SELECTED_SUBSTITUTE'
    | 'OPEN_SLOT_CLAIMED'
    | 'DECLINED'
    | 'REMOVED',
  selectedByUserId: string | null,
) {
  // DEC-021 D6: a paid place is the player's. The captain cannot take a paid player out of the lineup, and the
  // player leaves through the ticket rules (24 hours; the credit or refund goes to whoever paid), not by declining.
  if ((status === 'REMOVED' || status === 'DECLINED') && (await tx.matchTicket.count({ where: { matchTeamId: context.id, playerId: userId, status: 'CONFIRMED' } })))
    throw status === 'DECLINED'
      ? new AppError(409, 'Your place is paid for. Leave the match instead (the 24-hour rule applies).', 'TICKET_LEAVE_REQUIRED')
      : new AppError(409, 'This player is paid for. They must leave the match themselves (the 24-hour rule applies) before you can replace them.', 'PAID_PLAYER_IN_LINEUP');
  return tx.teamMatchSelection.upsert({
    where: { matchTeamId_userId: { matchTeamId: context.id, userId } },
    create: { matchTeamId: context.id, userId, status, selectedByUserId },
    update: { status, selectedByUserId },
  });
}

async function clearFinalization(tx: Prisma.TransactionClient, context: TeamMatchLineupRecord) {
  if (context.lineupFinalizedAt)
    await tx.matchTeam.update({
      where: { id: context.id },
      data: { lineupFinalizedAt: null },
    });
}

function refreshed(tx: Prisma.TransactionClient, id: string) {
  return tx.matchTeam.findUniqueOrThrow({ where: { id }, include: lineupInclude });
}

const unchanged = (context: TeamMatchLineupRecord): TeamMatchLineupMutationResult => ({
  context,
  notifications: [],
  reason: null,
});

async function changed(
  tx: Prisma.TransactionClient,
  context: TeamMatchLineupRecord,
  reason: TeamMatchLineupChangeReason,
  notifications: Notification[] = [],
): Promise<TeamMatchLineupMutationResult> {
  return { context: await refreshed(tx, context.id), notifications, reason };
}

function notificationDraft(
  userId: string,
  type:
    | 'TEAM_MATCH_SELECTION_UPDATED'
    | 'TEAM_MATCH_POSITION_OPENED'
    | 'TEAM_MATCH_POSITION_CLAIMED'
    | 'TEAM_MATCH_LINEUP_FINALIZED',
  title: string,
  message: string,
  matchId: string,
  dedupeKey: string,
): NotificationDraft {
  return { userId, type, title, message, targetPath: `/matches/${matchId}`, dedupeKey };
}

async function selectionNotification(
  tx: Prisma.TransactionClient,
  context: TeamMatchLineupRecord,
  actorUserId: string,
  selectedUserId: string,
  message: string,
) {
  if (actorUserId === selectedUserId) return [];
  const priorVersion = findSelection(context, selectedUserId)?.updatedAt.toISOString() ?? 'new';
  return persistNotifications(tx, [
    notificationDraft(
      selectedUserId,
      'TEAM_MATCH_SELECTION_UPDATED',
      'Match-Day selection updated',
      message,
      context.matchId,
      notificationDedupeKey(
        'team-match-lineup',
        context.id,
        'selection',
        selectedUserId,
        priorVersion,
        message,
      ),
    ),
  ]);
}

async function managerNotifications(
  tx: Prisma.TransactionClient,
  context: TeamMatchLineupRecord,
  actorUserId: string,
  type: 'TEAM_MATCH_SELECTION_UPDATED' | 'TEAM_MATCH_POSITION_CLAIMED',
  title: string,
  message: string,
) {
  const managers = context.team!.memberships.filter(
    (member) => member.userId !== actorUserId && ['OWNER', 'CAPTAIN'].includes(member.role),
  );
  const actorVersion = findSelection(context, actorUserId)?.updatedAt.toISOString() ?? 'new';
  return persistNotifications(
    tx,
    managers.map((member) =>
      notificationDraft(
        member.userId,
        type,
        title,
        message,
        context.matchId,
        notificationDedupeKey(
          'team-match-lineup',
          context.id,
          type,
          actorUserId,
          actorVersion,
          member.userId,
        ),
      ),
    ),
  );
}

export class MatchLineupRepository {
  async get(matchId: string, side: TeamSide, userId: string) {
    const context = await prisma.matchTeam.findUnique({
      where: { matchId_side: { matchId, side } },
      include: lineupInclude,
    });
    if (!context) throw new LineupTeamSideNotFoundError();
    assertTeamSide(context);
    assertMember(context, userId);
    return context;
  }

  invite(matchId: string, side: TeamSide, selectedUserId: string, userId: string) {
    return serializableTransaction(async (tx) => {
      const context = await loadLocked(tx, matchId, side);
      assertManager(context, userId);
      if (!membership(context, selectedUserId)) throw new LineupTeamMemberNotFoundError();
      const existing = findSelection(context, selectedUserId);
      if (
        existing &&
        ['INVITED', 'SELECTED_STARTER', 'SELECTED_SUBSTITUTE', 'OPEN_SLOT_CLAIMED'].includes(
          existing.status,
        )
      )
        return unchanged(context);
      await assertGirlsOnlyEligible(tx, context.match, [selectedUserId]);
      await saveSelection(tx, context, selectedUserId, 'INVITED', userId);
      await clearFinalization(tx, context);
      const notifications = await selectionNotification(
        tx,
        context,
        userId,
        selectedUserId,
        `${context.teamNameSnapshot} invited you to the Match-Day squad for ${context.match.name}.`,
      );
      return changed(tx, context, 'SELECTION', notifications);
    });
  }

  assignStarter(
    matchId: string,
    side: TeamSide,
    slotId: string,
    input: AssignTeamMatchStarterInput,
    userId: string,
  ) {
    return serializableTransaction(async (tx) => {
      const context = await loadLocked(tx, matchId, side);
      assertManager(context, userId);
      if (!membership(context, input.userId)) throw new LineupTeamMemberNotFoundError();
      const target = findSlot(context, slotId);
      const incomingExisting = findSelection(context, input.userId);
      await assertEntersWithoutOverlap(tx, context, input.userId, userId, incomingExisting);
      const source = starterSlotFor(context, incomingExisting?.id);
      if (target.selection?.userId === input.userId) {
        if (target.selection.status !== 'SELECTED_STARTER') {
          await saveSelection(tx, context, input.userId, 'SELECTED_STARTER', userId);
          await clearFinalization(tx, context);
          const notifications = await selectionNotification(
            tx,
            context,
            userId,
            input.userId,
            `You were selected as a starter for ${context.match.name}.`,
          );
          return changed(tx, context, 'SELECTION', notifications);
        }
        return unchanged(context);
      }

      const displaced = target.selection;
      if (displaced && !input.displacedPlayerAction) throw new LineupActionRequiredError();
      if (displaced && input.displacedPlayerAction === 'SWAP' && !source)
        throw new LineupInvalidActionError();
      if (
        displaced &&
        input.displacedPlayerAction === 'BENCH' &&
        substituteCount(context, input.userId) >= substituteCapacity(context)
      )
        throw new SubstituteCapacityReachedError();

      const incoming = await saveSelection(tx, context, input.userId, 'SELECTED_STARTER', userId);
      if (source)
        await tx.teamMatchLineupSlot.update({
          where: { id: source.id },
          data: { selectionId: null },
        });
      if (displaced)
        await tx.teamMatchLineupSlot.update({
          where: { id: target.id },
          data: { selectionId: null },
        });

      if (displaced && input.displacedPlayerAction === 'SWAP') {
        await saveSelection(tx, context, displaced.userId, 'SELECTED_STARTER', userId);
        await tx.teamMatchLineupSlot.update({
          where: { id: source!.id },
          data: { selectionId: displaced.id, isOpen: false },
        });
      } else if (displaced && input.displacedPlayerAction === 'BENCH') {
        await saveSelection(tx, context, displaced.userId, 'SELECTED_SUBSTITUTE', userId);
      } else if (displaced) {
        await saveSelection(tx, context, displaced.userId, 'REMOVED', userId);
      }
      await tx.teamMatchLineupSlot.update({
        where: { id: target.id },
        data: { selectionId: incoming.id, isOpen: false },
      });
      await clearFinalization(tx, context);
      const notifications = await selectionNotification(
        tx,
        context,
        userId,
        input.userId,
        `You were selected as a starter for ${context.match.name}.`,
      );
      if (displaced && displaced.userId !== input.userId)
        notifications.push(
          ...(await selectionNotification(
            tx,
            context,
            userId,
            displaced.userId,
            input.displacedPlayerAction === 'SWAP'
              ? `Your starting position changed for ${context.match.name}.`
              : input.displacedPlayerAction === 'BENCH'
                ? `You were moved to the substitutes for ${context.match.name}.`
                : `You were removed from the active lineup for ${context.match.name}.`,
          )),
        );
      return changed(tx, context, 'SELECTION', notifications);
    });
  }

  removeStarter(
    matchId: string,
    side: TeamSide,
    slotId: string,
    playerAction: LineupPlayerAction,
    userId: string,
  ) {
    return serializableTransaction(async (tx) => {
      const context = await loadLocked(tx, matchId, side);
      assertManager(context, userId);
      const slot = findSlot(context, slotId);
      if (!slot.selection) throw new LineupSelectionNotFoundError();
      if (
        playerAction === 'BENCH' &&
        substituteCount(context) >= substituteCapacity(context)
      )
        throw new SubstituteCapacityReachedError();
      await saveSelection(
        tx,
        context,
        slot.selection.userId,
        playerAction === 'BENCH' ? 'SELECTED_SUBSTITUTE' : 'REMOVED',
        userId,
      );
      await tx.teamMatchLineupSlot.update({
        where: { id: slot.id },
        data: { selectionId: null, isOpen: false },
      });
      await clearFinalization(tx, context);
      const notifications = await selectionNotification(
        tx,
        context,
        userId,
        slot.selection.userId,
        playerAction === 'BENCH'
          ? `You were moved to the substitutes for ${context.match.name}.`
          : `You were removed from the active lineup for ${context.match.name}.`,
      );
      return changed(tx, context, 'SELECTION', notifications);
    });
  }

  openSlot(
    matchId: string,
    side: TeamSide,
    slotId: string,
    input: OpenTeamMatchLineupSlotInput,
    userId: string,
  ) {
    return serializableTransaction(async (tx) => {
      const context = await loadLocked(tx, matchId, side);
      assertManager(context, userId);
      const slot = findSlot(context, slotId);
      if (!slot.selection && slot.isOpen) return unchanged(context);
      if (slot.selection && !input.occupiedPlayerAction) throw new LineupActionRequiredError();
      if (
        slot.selection &&
        input.occupiedPlayerAction === 'BENCH' &&
        substituteCount(context) >= substituteCapacity(context)
      )
        throw new SubstituteCapacityReachedError();
      if (slot.selection)
        await saveSelection(
          tx,
          context,
          slot.selection.userId,
          input.occupiedPlayerAction === 'BENCH' ? 'SELECTED_SUBSTITUTE' : 'REMOVED',
          userId,
        );
      await tx.teamMatchLineupSlot.update({
        where: { id: slot.id },
        data: { selectionId: null, isOpen: true },
      });
      await clearFinalization(tx, context);
      const notifications: Notification[] = [];
      if (slot.selection)
        notifications.push(
          ...(await selectionNotification(
            tx,
            context,
            userId,
            slot.selection.userId,
            input.occupiedPlayerAction === 'BENCH'
              ? `You were moved to the substitutes for ${context.match.name}.`
              : `You were removed from the active lineup for ${context.match.name}.`,
          )),
        );
      notifications.push(
        ...(await persistNotifications(
          tx,
          context
            .team!.memberships.filter((member) => member.userId !== userId)
            .map((member) =>
              notificationDraft(
                member.userId,
                'TEAM_MATCH_POSITION_OPENED',
                'Match-Day position available',
                `${context.teamNameSnapshot} opened a starting position for ${context.match.name}.`,
                context.matchId,
                notificationDedupeKey(
                  'team-match-lineup',
                  context.id,
                  'slot-opened',
                  slot.id,
                  slot.updatedAt.toISOString(),
                  member.userId,
                ),
              ),
            ),
        )),
      );
      return changed(tx, context, 'POSITION_OPENED', notifications);
    });
  }

  claim(matchId: string, side: TeamSide, slotId: string, userId: string) {
    return serializableTransaction(async (tx) => {
      const context = await loadLocked(tx, matchId, side);
      assertMember(context, userId);
      const slot = findSlot(context, slotId);
      if (slot.selection) {
        if (slot.selection.status === 'OPEN_SLOT_CLAIMED') throw new PositionAlreadyClaimedError();
        throw new LineupSlotOccupiedError();
      }
      if (!slot.isOpen) throw new PositionNotOpenError();
      const existing = findSelection(context, userId);
      if (starterSlotFor(context, existing?.id) || existing?.status === 'SELECTED_STARTER')
        throw new PlayerAlreadyStarterError();
      await assertEntersWithoutOverlap(tx, context, userId, userId, existing);
      const selection = await saveSelection(tx, context, userId, 'OPEN_SLOT_CLAIMED', null);
      await tx.teamMatchLineupSlot.update({
        where: { id: slot.id },
        data: { selectionId: selection.id, isOpen: false },
      });
      const notifications = await managerNotifications(
        tx,
        context,
        userId,
        'TEAM_MATCH_POSITION_CLAIMED',
        'Match-Day position claimed',
        `A Team member claimed an open position for ${context.match.name}.`,
      );
      return changed(tx, context, 'POSITION_CLAIMED', notifications);
    });
  }

  selectSubstitute(matchId: string, side: TeamSide, selectedUserId: string, userId: string) {
    return serializableTransaction(async (tx) => {
      const context = await loadLocked(tx, matchId, side);
      assertManager(context, userId);
      if (!membership(context, selectedUserId)) throw new LineupTeamMemberNotFoundError();
      const existing = findSelection(context, selectedUserId);
      if (existing?.status === 'SELECTED_SUBSTITUTE') return unchanged(context);
      await assertEntersWithoutOverlap(tx, context, selectedUserId, userId, existing);
      if (substituteCount(context) >= substituteCapacity(context))
        throw new SubstituteCapacityReachedError();
      const source = starterSlotFor(context, existing?.id);
      if (source)
        await tx.teamMatchLineupSlot.update({
          where: { id: source.id },
          data: { selectionId: null, isOpen: false },
        });
      await saveSelection(tx, context, selectedUserId, 'SELECTED_SUBSTITUTE', userId);
      await clearFinalization(tx, context);
      const notifications = await selectionNotification(
        tx,
        context,
        userId,
        selectedUserId,
        `You were selected as a substitute for ${context.match.name}.`,
      );
      return changed(tx, context, 'SELECTION', notifications);
    });
  }

  removeSubstitute(matchId: string, side: TeamSide, selectedUserId: string, userId: string) {
    return serializableTransaction(async (tx) => {
      const context = await loadLocked(tx, matchId, side);
      assertManager(context, userId);
      const existing = findSelection(context, selectedUserId);
      if (existing?.status === 'REMOVED') return unchanged(context);
      if (existing?.status !== 'SELECTED_SUBSTITUTE') throw new LineupSelectionNotFoundError();
      await saveSelection(tx, context, selectedUserId, 'REMOVED', userId);
      await clearFinalization(tx, context);
      const notifications = await selectionNotification(
        tx,
        context,
        userId,
        selectedUserId,
        `You were removed from the substitutes for ${context.match.name}.`,
      );
      return changed(tx, context, 'SELECTION', notifications);
    });
  }

  decline(matchId: string, side: TeamSide, userId: string) {
    return serializableTransaction(async (tx) => {
      const context = await loadLocked(tx, matchId, side);
      assertMember(context, userId);
      const existing = findSelection(context, userId);
      if (!existing || existing.status === 'REMOVED') throw new LineupSelectionNotFoundError();
      if (existing.status === 'DECLINED') return unchanged(context);
      const slot = starterSlotFor(context, existing.id);
      if (slot)
        await tx.teamMatchLineupSlot.update({
          where: { id: slot.id },
          data: { selectionId: null, isOpen: true },
        });
      await saveSelection(tx, context, userId, 'DECLINED', null);
      await clearFinalization(tx, context);
      const notifications = await managerNotifications(
        tx,
        context,
        userId,
        'TEAM_MATCH_SELECTION_UPDATED',
        'Match-Day selection declined',
        `A Team member declined their selection for ${context.match.name}.`,
      );
      return changed(tx, context, 'SELECTION', notifications);
    });
  }

  moveSlot(
    matchId: string,
    side: TeamSide,
    slotId: string,
    input: UpdateTeamMatchLineupSlotPositionInput,
    userId: string,
  ) {
    return serializableTransaction(async (tx) => {
      const context = await loadLocked(tx, matchId, side);
      assertManager(context, userId);
      const slot = findSlot(context, slotId);
      const outsideHalf =
        (side === 'HOME' && input.positionY < 50) || (side === 'AWAY' && input.positionY > 50);
      if (outsideHalf) throw new PositionOutsideTeamHalfError();
      if (Number(slot.positionX) === input.positionX && Number(slot.positionY) === input.positionY)
        return unchanged(context);
      await tx.teamMatchLineupSlot.update({
        where: { id: slot.id },
        data: { positionX: input.positionX, positionY: input.positionY },
      });
      await clearFinalization(tx, context);
      return changed(tx, context, 'MOVEMENT');
    });
  }

  finalize(matchId: string, side: TeamSide, userId: string) {
    return serializableTransaction(async (tx) => {
      const context = await loadLocked(tx, matchId, side);
      assertManager(context, userId);
      const expected = getPlayersPerTeam(context.match.format);
      const completeSlots =
        context.lineupSlots.length === expected &&
        context.lineupSlots.every(
          (slot) =>
            (slot.isOpen && !slot.selection) ||
            (!slot.isOpen &&
              slot.selection &&
              activeStarterStatuses.includes(
                slot.selection.status as (typeof activeStarterStatuses)[number],
              ) &&
              slot.selection.matchTeamId === context.id),
        );
      const slottedSelectionIds = new Set(
        context.lineupSlots.flatMap((slot) => (slot.selectionId ? [slot.selectionId] : [])),
      );
      const hasOrphanStarter = context.selections.some(
        (selection) =>
          activeStarterStatuses.includes(
            selection.status as (typeof activeStarterStatuses)[number],
          ) && !slottedSelectionIds.has(selection.id),
      );
      const substitutes = context.selections.filter(
        (selection) => selection.status === 'SELECTED_SUBSTITUTE',
      );
      if (
        !completeSlots ||
        hasOrphanStarter ||
        substitutes.length > substituteCapacity(context)
      )
        throw new LineupIncompleteError();
      const activeUserIds = new Set([
        ...context.lineupSlots.flatMap((slot) => (slot.selection ? [slot.selection.userId] : [])),
        ...substitutes.map((selection) => selection.userId),
      ]);
      const currentUserIds = new Set(context.team!.memberships.map((member) => member.userId));
      if ([...activeUserIds].some((selectedUserId) => !currentUserIds.has(selectedUserId)))
        throw new LineupMemberIneligibleError();
      if (context.lineupFinalizedAt) return unchanged(context);
      await tx.matchTeam.update({
        where: { id: context.id },
        data: { lineupFinalizedAt: new Date() },
      });
      const notifications = await persistNotifications(
        tx,
        [...activeUserIds]
          .filter((selectedUserId) => selectedUserId !== userId)
          .map((selectedUserId) =>
            notificationDraft(
              selectedUserId,
              'TEAM_MATCH_LINEUP_FINALIZED',
              'Match-Day lineup finalized',
              `${context.teamNameSnapshot} finalized the lineup for ${context.match.name}.`,
              context.matchId,
              notificationDedupeKey(
                'team-match-lineup',
                context.id,
                'finalized',
                context.updatedAt.toISOString(),
                selectedUserId,
              ),
            ),
          ),
      );
      return changed(tx, context, 'FINALIZED', notifications);
    });
  }

  saveAsTeamDefault(matchId: string, side: TeamSide, userId: string) {
    return serializableTransaction(async (tx) => {
      const context = await loadLocked(tx, matchId, side);
      assertManager(context, userId);
      const expected = getPlayersPerTeam(context.match.format);
      if (context.lineupSlots.length !== expected) throw new LineupIncompleteError();
      const membershipIdByUser = new Map(
        context.team!.memberships.map((member) => [member.userId, member.id]),
      );
      const formation = await tx.teamFormation.findUniqueOrThrow({
        where: { teamId_format: { teamId: context.team!.id, format: context.match.format } },
      });
      await tx.teamFormationSlot.deleteMany({ where: { formationId: formation.id } });
      await tx.teamFormation.update({
        where: { id: formation.id },
        data: {
          formationKey: context.formationKey,
          slots: {
            create: context.lineupSlots.map((slot) => ({
              slotIndex: slot.slotIndex,
              ...mapMatchHalfPositionToTeam(context.side, {
                positionX: Number(slot.positionX),
                positionY: Number(slot.positionY),
              }),
              membershipId: slot.selection
                ? (membershipIdByUser.get(slot.selection.userId) ?? null)
                : null,
            })),
          },
        },
      });
      return tx.teamFormation.findUniqueOrThrow({
        where: { id: formation.id },
        include: teamFormationInclude,
      });
    });
  }
}
