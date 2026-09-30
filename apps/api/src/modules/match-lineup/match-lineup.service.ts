import type {
  AssignTeamMatchStarterInput,
  LineupPlayerAction,
  OpenTeamMatchLineupSlotInput,
  TeamMatchLineup,
  TeamMatchSelection,
  TeamSide,
  UpdateTeamMatchLineupSlotPositionInput,
} from '@footy-finder/shared';
import { getPlayersPerTeam } from '@footy-finder/shared';
import { AppError } from '../../errors/app-error.js';
import { PlayerOverlapError, playerOverlapAppError } from '../matches/player-overlap.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { toTeamFormation } from '../teams/team.mapper.js';
import { toPublicUser } from '../users/user.mapper.js';
import {
  LineupActionRequiredError,
  LineupForbiddenError,
  LineupIncompleteError,
  LineupInvalidActionError,
  LineupMemberIneligibleError,
  LineupSelectionNotFoundError,
  LineupSlotNotFoundError,
  LineupSlotOccupiedError,
  LineupTeamMatchClosedError,
  LineupKickedOffError,
  LineupTeamMemberNotFoundError,
  LineupTeamSideNotFoundError,
  MatchLineupRepository,
  PlayerAlreadyStarterError,
  PositionAlreadyClaimedError,
  PositionNotOpenError,
  PositionOutsideTeamHalfError,
  SubstituteCapacityReachedError,
  substituteCapacity,
  type TeamMatchLineupRecord,
  type TeamMatchLineupMutationResult,
  type TeamMatchSelectionRecord,
} from './match-lineup.repository.js';

const toSelection = (selection: TeamMatchSelectionRecord): TeamMatchSelection => ({
  id: selection.id,
  matchTeamId: selection.matchTeamId,
  userId: selection.userId,
  status: selection.status,
  selectedByUserId: selection.selectedByUserId,
  createdAt: selection.createdAt.toISOString(),
  updatedAt: selection.updatedAt.toISOString(),
  user: toPublicUser(selection.user),
});

const toLineup = (context: TeamMatchLineupRecord, userId: string): TeamMatchLineup => {
  const viewer = context.team!.memberships.find((member) => member.userId === userId)!;
  const viewerCanManage = viewer.role === 'OWNER' || viewer.role === 'CAPTAIN';
  const selections = context.selections.map(toSelection);
  const selectionById = new Map(selections.map((selection) => [selection.id, selection]));
  return {
    matchId: context.matchId,
    matchTeamId: context.id,
    teamId: context.team!.id,
    side: context.side,
    format: context.match.format,
    formationKey: context.formationKey,
    starterCapacity: getPlayersPerTeam(context.match.format),
    substituteCapacity: substituteCapacity(context),
    lineupFinalizedAt: context.lineupFinalizedAt?.toISOString() ?? null,
    viewerCanManage,
    slots: context.lineupSlots.map((slot) => ({
      id: slot.id,
      matchTeamId: slot.matchTeamId,
      slotIndex: slot.slotIndex,
      positionX: Number(slot.positionX),
      positionY: Number(slot.positionY),
      isOpen: slot.isOpen,
      selection: slot.selectionId ? (selectionById.get(slot.selectionId) ?? null) : null,
    })),
    substitutes: selections.filter(({ status }) => status === 'SELECTED_SUBSTITUTE'),
    viewerSelection: selections.find((selection) => selection.userId === userId) ?? null,
    ...(viewerCanManage ? { selectionPool: selections } : {}),
  };
};

export class MatchLineupService {
  constructor(
    private readonly lineups = new MatchLineupRepository(),
    private readonly notifications = new NotificationsService(),
  ) {}

  async get(matchId: string, side: TeamSide, userId: string) {
    return this.execute(() => this.lineups.get(matchId, side, userId), userId);
  }

  async invite(matchId: string, side: TeamSide, selectedUserId: string, userId: string) {
    return this.executeMutation(
      () => this.lineups.invite(matchId, side, selectedUserId, userId),
      userId,
    );
  }

  async assignStarter(
    matchId: string,
    side: TeamSide,
    slotId: string,
    input: AssignTeamMatchStarterInput,
    userId: string,
  ) {
    return this.executeMutation(
      () => this.lineups.assignStarter(matchId, side, slotId, input, userId),
      userId,
    );
  }

  async removeStarter(
    matchId: string,
    side: TeamSide,
    slotId: string,
    playerAction: LineupPlayerAction,
    userId: string,
  ) {
    return this.executeMutation(
      () => this.lineups.removeStarter(matchId, side, slotId, playerAction, userId),
      userId,
    );
  }

  async openSlot(
    matchId: string,
    side: TeamSide,
    slotId: string,
    input: OpenTeamMatchLineupSlotInput,
    userId: string,
  ) {
    return this.executeMutation(
      () => this.lineups.openSlot(matchId, side, slotId, input, userId),
      userId,
    );
  }

  async claim(matchId: string, side: TeamSide, slotId: string, userId: string) {
    return this.executeMutation(() => this.lineups.claim(matchId, side, slotId, userId), userId);
  }

  async selectSubstitute(matchId: string, side: TeamSide, selectedUserId: string, userId: string) {
    return this.executeMutation(
      () => this.lineups.selectSubstitute(matchId, side, selectedUserId, userId),
      userId,
    );
  }

  async removeSubstitute(matchId: string, side: TeamSide, selectedUserId: string, userId: string) {
    return this.executeMutation(
      () => this.lineups.removeSubstitute(matchId, side, selectedUserId, userId),
      userId,
    );
  }

  async decline(matchId: string, side: TeamSide, userId: string) {
    return this.executeMutation(() => this.lineups.decline(matchId, side, userId), userId);
  }

  async moveSlot(
    matchId: string,
    side: TeamSide,
    slotId: string,
    input: UpdateTeamMatchLineupSlotPositionInput,
    userId: string,
  ) {
    return this.executeMutation(
      () => this.lineups.moveSlot(matchId, side, slotId, input, userId),
      userId,
    );
  }

  async finalize(matchId: string, side: TeamSide, userId: string) {
    return this.executeMutation(() => this.lineups.finalize(matchId, side, userId), userId);
  }

  async saveAsTeamDefault(matchId: string, side: TeamSide, userId: string) {
    try {
      const formation = toTeamFormation(
        await this.lineups.saveAsTeamDefault(matchId, side, userId),
      );
      emitDomainEventBestEffort('match-lineup:changed', {
        matchId,
        side,
        reason: 'DEFAULT_SAVED',
      });
      emitDomainEventBestEffort('team:formation-updated', {
        teamId: formation.teamId,
        format: formation.format,
        formation,
      });
      return formation;
    } catch (error) {
      this.rethrow(error);
    }
  }

  private async execute(work: () => Promise<TeamMatchLineupRecord>, userId: string) {
    try {
      return toLineup(await work(), userId);
    } catch (error) {
      this.rethrow(error);
    }
  }

  private async executeMutation(
    work: () => Promise<TeamMatchLineupMutationResult>,
    userId: string,
  ) {
    try {
      const result = await work();
      this.notifications.publishPersistedMany(result.notifications);
      if (result.reason)
        emitDomainEventBestEffort('match-lineup:changed', {
          matchId: result.context.matchId,
          side: result.context.side,
          reason: result.reason,
        });
      return toLineup(result.context, userId);
    } catch (error) {
      this.rethrow(error);
    }
  }

  private rethrow(error: unknown): never {
    if (error instanceof PlayerOverlapError) throw playerOverlapAppError(error);
    if (error instanceof LineupTeamSideNotFoundError)
      throw new AppError(404, 'Team Match side not found.', 'TEAM_MATCH_SIDE_NOT_FOUND');
    if (error instanceof LineupForbiddenError)
      throw new AppError(403, 'Current Team permission is required.', 'TEAM_FORBIDDEN');
    if (error instanceof LineupTeamMatchClosedError)
      throw new AppError(409, 'This Team fixture is closed.', 'TEAM_MATCH_CLOSED');
    if (error instanceof LineupKickedOffError)
      throw new AppError(409, 'The lineup is locked from kickoff.', 'LINEUP_LOCKED');
    if (error instanceof LineupSlotNotFoundError)
      throw new AppError(404, 'Lineup slot not found.', 'LINEUP_SLOT_NOT_FOUND');
    if (error instanceof LineupSlotOccupiedError)
      throw new AppError(409, 'That lineup slot is occupied.', 'LINEUP_SLOT_OCCUPIED');
    if (error instanceof LineupActionRequiredError)
      throw new AppError(
        409,
        'Choose how to handle the player currently in that slot.',
        'LINEUP_ACTION_REQUIRED',
      );
    if (error instanceof LineupInvalidActionError)
      throw new AppError(400, 'That lineup action is not valid.', 'INVALID_LINEUP_ACTION');
    if (error instanceof LineupTeamMemberNotFoundError)
      throw new AppError(404, 'Current Team member not found.', 'TEAM_MEMBER_NOT_FOUND');
    if (error instanceof SubstituteCapacityReachedError)
      throw new AppError(
        409,
        'This Match has reached its substitute capacity.',
        'SUBSTITUTE_CAPACITY_REACHED',
      );
    if (error instanceof LineupSelectionNotFoundError)
      throw new AppError(404, 'Match-Day selection not found.', 'LINEUP_SELECTION_NOT_FOUND');
    if (error instanceof PlayerAlreadyStarterError)
      throw new AppError(409, 'You already occupy a starting position.', 'PLAYER_ALREADY_STARTER');
    if (error instanceof PositionAlreadyClaimedError)
      throw new AppError(
        409,
        'That position has already been claimed.',
        'POSITION_ALREADY_CLAIMED',
      );
    if (error instanceof PositionNotOpenError)
      throw new AppError(409, 'That position is not open for claims.', 'POSITION_NOT_OPEN');
    if (error instanceof PositionOutsideTeamHalfError)
      throw new AppError(
        400,
        "That position is outside the Team's half.",
        'POSITION_OUTSIDE_TEAM_HALF',
      );
    if (error instanceof LineupIncompleteError)
      throw new AppError(
        409,
        'Complete or explicitly open every starting slot.',
        'LINEUP_INCOMPLETE',
      );
    if (error instanceof LineupMemberIneligibleError)
      throw new AppError(
        409,
        'The lineup contains a player who is no longer a current Team member.',
        'LINEUP_MEMBER_NO_LONGER_ELIGIBLE',
      );
    throw error;
  }
}
