import type { Prisma, TeamSide } from '../../generated/prisma/client.js';

/** Gate 7 commands recorded in the append-only TeamMatchAuditEvent (TKT-705/708). */
export type TeamMatchCommand =
  | 'TEAM_MATCH_PUBLISHED'
  | 'OTHER_SIDE_TEAM_LOADED'
  | 'OTHER_SIDE_TEAM_WITHDRAWN'
  | 'OTHER_SIDE_INDIVIDUALS_OPENED'
  | 'OTHER_SIDE_REOPENED'
  | 'SUBSTITUTES_CHANGED'
  | 'METER_FILLED'
  | 'METER_RELEASED'
  | 'TEAM_MATCH_CANCELLED'
  | 'TEAM_MATCH_CONFIRMED'
  | 'TEAM_MATCH_NO_GO'
  | 'LINEUP_CHANGED'
  | 'MATCH_UPDATED';

export const appendTeamMatchAudit = (
  tx: Prisma.TransactionClient,
  event: {
    matchId: string;
    command: TeamMatchCommand;
    teamId?: string | null;
    side?: TeamSide | null;
    actorUserId?: string | null;
    payload?: Prisma.InputJsonObject;
  },
) =>
  tx.teamMatchAuditEvent.create({
    data: {
      matchId: event.matchId,
      command: event.command,
      teamId: event.teamId ?? null,
      side: event.side ?? null,
      actorUserId: event.actorUserId ?? null,
      payload: event.payload ?? {},
    },
  });
