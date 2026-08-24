import type {
  TeamMatchAvailabilityQuery,
  TeamMatchAvailabilityResponse,
  TeamMatchAvailabilityRow,
  TeamMatchSelectionStatus,
  TeamSide,
  UpdateMyTeamMatchAvailabilityInput,
} from '@footy-finder/shared';
import { AppError } from '../../errors/app-error.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { toPublicUser } from '../users/user.mapper.js';
import {
  AvailabilityNotRequestedError,
  MatchAvailabilityRepository,
  TeamAvailabilityForbiddenError,
  TeamMatchClosedError,
  TeamMatchSideNotFoundError,
  type TeamMatchAvailabilityRecord,
} from './match-availability.repository.js';

const toAvailabilityRow = (
  row: TeamMatchAvailabilityRecord,
  selectionStatus: TeamMatchSelectionStatus | null = null,
): TeamMatchAvailabilityRow => ({
  id: row.id,
  matchTeamId: row.matchTeamId,
  userId: row.userId,
  status: row.status,
  respondedAt: row.respondedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  user: toPublicUser(row.user),
  selectionStatus,
});

const selectedStatuses = new Set<TeamMatchSelectionStatus>([
  'INVITED',
  'SELECTED_STARTER',
  'SELECTED_SUBSTITUTE',
  'OPEN_SLOT_CLAIMED',
]);

export class MatchAvailabilityService {
  constructor(
    private readonly availability = new MatchAvailabilityRepository(),
    private readonly notifications = new NotificationsService(),
  ) {}

  async request(matchId: string, side: TeamSide, userId: string) {
    try {
      const result = await this.availability.request(matchId, side, userId);
      this.notifications.publishPersistedMany(result.notifications);
      const requestedAt = result.requestedAt.toISOString();
      emitDomainEventBestEffort('match-availability:requested', { matchId, side, requestedAt });
      return {
        requestedAt,
        addedMemberCount: result.addedMemberCount,
        notifiedMemberCount: result.notifiedMemberCount,
      };
    } catch (error) {
      this.rethrowRepositoryError(error);
    }
  }

  async get(
    matchId: string,
    side: TeamSide,
    query: TeamMatchAvailabilityQuery,
    userId: string,
  ): Promise<TeamMatchAvailabilityResponse> {
    const context = await this.availability.findContext(matchId, side, userId);
    this.assertAccessibleContext(context);
    const membership = context.team!.memberships[0]!;
    const [allRows, selections] = await Promise.all([
      this.availability.listForSide(context.id),
      this.availability.listSelectionStatuses(context.id),
    ]);
    const selectionByUser = new Map(
      selections.map((selection) => [selection.userId, selection.status]),
    );
    const summary = {
      squadPool: allRows.length,
      available: allRows.filter((row) => row.status === 'AVAILABLE').length,
      maybe: allRows.filter((row) => row.status === 'MAYBE').length,
      unavailable: allRows.filter((row) => row.status === 'UNAVAILABLE').length,
      noResponse: allRows.filter((row) => row.status === 'NO_RESPONSE').length,
    };
    const canInspectAll = membership.role === 'OWNER' || membership.role === 'CAPTAIN';
    const rows = allRows
      .filter((row) => canInspectAll || row.userId === userId)
      .filter((row) => !query.availability || row.status === query.availability)
      .filter((row) => {
        if (query.selected === undefined) return true;
        const selectionStatus = selectionByUser.get(row.userId);
        const selected = selectionStatus ? selectedStatuses.has(selectionStatus) : false;
        return selected === query.selected;
      })
      .map((row) => toAvailabilityRow(row, selectionByUser.get(row.userId) ?? null));
    return {
      requestedAt: context.availabilityRequestedAt?.toISOString() ?? null,
      summary,
      rows,
    };
  }

  async updateMine(
    matchId: string,
    side: TeamSide,
    input: UpdateMyTeamMatchAvailabilityInput,
    userId: string,
  ) {
    try {
      const row = toAvailabilityRow(
        await this.availability.updateMine(matchId, side, userId, input.status),
      );
      emitDomainEventBestEffort('match-availability:updated', { matchId, side });
      return row;
    } catch (error) {
      this.rethrowRepositoryError(error);
    }
  }

  private assertAccessibleContext(
    context: Awaited<ReturnType<MatchAvailabilityRepository['findContext']>>,
  ): asserts context is NonNullable<typeof context> & {
    team: NonNullable<typeof context>['team'];
  } {
    if (context?.match.mode !== 'TEAM_MATCH' || !context.team)
      throw new AppError(404, 'Team Match side not found.', 'TEAM_MATCH_SIDE_NOT_FOUND');
    if (['CANCELLED', 'COMPLETED'].includes(context.match.status))
      throw new AppError(409, 'This Team fixture is closed.', 'TEAM_MATCH_CLOSED');
    if (!context.team.memberships.length)
      throw new AppError(403, 'Current Team membership is required.', 'TEAM_FORBIDDEN');
  }

  private rethrowRepositoryError(error: unknown): never {
    if (error instanceof TeamMatchSideNotFoundError)
      throw new AppError(404, 'Team Match side not found.', 'TEAM_MATCH_SIDE_NOT_FOUND');
    if (error instanceof TeamAvailabilityForbiddenError)
      throw new AppError(403, 'Current Team permission is required.', 'TEAM_FORBIDDEN');
    if (error instanceof TeamMatchClosedError)
      throw new AppError(409, 'This Team fixture is closed.', 'TEAM_MATCH_CLOSED');
    if (error instanceof AvailabilityNotRequestedError)
      throw new AppError(
        409,
        'Availability has not been requested from this Team member.',
        'AVAILABILITY_NOT_REQUESTED',
      );
    throw error;
  }
}
