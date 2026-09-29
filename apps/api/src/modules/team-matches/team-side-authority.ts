import type { TeamSide } from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../errors/app-error.js';

/**
 * Gate 7 / TKT-708: side-scoped team-match authority. It replaces the old "owner or captain of
 * any attached team" check: every command names the side that owns it, and only a current OWNER
 * or CAPTAIN of the team on that side may run it. Demoted or removed captains lose it at once
 * (membership is read on every command). Platform admins get no implicit team authority.
 *
 *   HOME  the home team owns the match itself (edit details, cancel the whole match (D6 as
 *         narrowed by N5), propose the result).
 *   AWAY  only the team that took the other side may withdraw it (N5).
 *   OWN   each team manages its own side (lineup, availability, subs, fill meter).
 */
export const TEAM_MATCH_COMMANDS = [
  'UPDATE_MATCH',
  'CANCEL_MATCH',
  'SUBMIT_RESULT',
  'WITHDRAW_TEAM',
  'MANAGE_LINEUP',
  'CHANGE_SUBSTITUTES',
  'FILL_METER',
] as const;
export type TeamMatchCommand = (typeof TEAM_MATCH_COMMANDS)[number];
export const TEAM_MATCH_COMMAND_SIDE: Record<TeamMatchCommand, 'HOME' | 'AWAY' | 'OWN'> = {
  UPDATE_MATCH: 'HOME',
  CANCEL_MATCH: 'HOME',
  SUBMIT_RESULT: 'HOME',
  WITHDRAW_TEAM: 'AWAY',
  MANAGE_LINEUP: 'OWN',
  CHANGE_SUBSTITUTES: 'OWN',
  FILL_METER: 'OWN',
};

/** Pure decision: may someone who manages `managedSides` run `command` on `targetSide`? */
export function canRunTeamMatchCommand(command: TeamMatchCommand, managedSides: readonly TeamSide[], targetSide?: TeamSide) {
  const owner = TEAM_MATCH_COMMAND_SIDE[command];
  if (owner === 'OWN') return Boolean(targetSide) && managedSides.includes(targetSide!);
  return managedSides.includes(owner);
}

type Db = Prisma.TransactionClient | typeof prisma;

/** The sides of this match whose (non-archived) team the user currently owns or captains. */
export async function managedTeamSides(db: Db, matchId: string, userId: string): Promise<TeamSide[]> {
  const sides = await db.matchTeam.findMany({
    where: {
      matchId,
      team: { archivedAt: null, memberships: { some: { userId, role: { in: ['OWNER', 'CAPTAIN'] } } } },
    },
    select: { side: true },
  });
  return sides.map(({ side }) => side);
}

/** Throws 403 TEAM_FORBIDDEN unless someone managing `managed` may run the command. */
export function assertCanRunTeamMatchCommand(command: TeamMatchCommand, managed: readonly TeamSide[], targetSide?: TeamSide) {
  if (canRunTeamMatchCommand(command, managed, targetSide)) return;
  const owner = TEAM_MATCH_COMMAND_SIDE[command];
  const side = owner === 'OWN' ? targetSide : owner;
  throw new AppError(
    403,
    side ? `Only the owner or a captain of the ${side === 'HOME' ? 'home' : 'away'} team can do that.` : 'Owner or captain permission is required.',
    'TEAM_FORBIDDEN',
  );
}

export async function assertTeamMatchCommand(
  db: Db,
  input: { matchId: string; userId: string; command: TeamMatchCommand; side?: TeamSide },
) {
  const managed = await managedTeamSides(db, input.matchId, input.userId);
  assertCanRunTeamMatchCommand(input.command, managed, input.side);
  return managed;
}
