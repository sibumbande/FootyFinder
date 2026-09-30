import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Gate 8 / TKT-803 (DEC-020): the lineup record taken at kickoff. It is what the referee picks
 * scorers and assisters from, what statistics count and who may review (DEC-017).
 * - Quick Matches and the individuals' side of an "Open to both" team match: every JOINED
 *   participant; a participant holding a formation position is a starter, anyone else a substitute.
 * - A team side: the team's selected starters (including claimed open positions) and substitutes.
 * A player appears once per match. The record is written in the kickoff transaction, once.
 */
export type LineupEntryDraft = {
  side: 'HOME' | 'AWAY';
  userId: string;
  teamId: string | null;
  displayNameSnapshot: string;
  role: 'STARTER' | 'SUBSTITUTE';
  source: 'PARTICIPANT' | 'TEAM_SELECTION';
  slotIndex: number | null;
};

type Named = { username: string; profile: { displayName: string } | null };
type ParticipantSource = { userId: string; team: 'HOME' | 'AWAY'; user: Named; formationSlot: { slotIndex: number } | null };
type SelectionSource = {
  userId: string;
  status: string;
  user: Named;
  lineupSlot: { slotIndex: number } | null;
};
type TeamSideSource = { side: 'HOME' | 'AWAY'; teamId: string | null; selections: SelectionSource[] };

const LINEUP_SELECTION_STATUSES = ['SELECTED_STARTER', 'OPEN_SLOT_CLAIMED', 'SELECTED_SUBSTITUTE'] as const;
const nameOf = (user: Named) => user.profile?.displayName ?? user.username;

/** Pure mapping from the live lineup to record entries (starters first, then substitutes). */
export function toLineupEntryDrafts(participants: ParticipantSource[], teamSides: TeamSideSource[]): LineupEntryDraft[] {
  const drafts: LineupEntryDraft[] = [];
  for (const teamSide of teamSides) {
    for (const selection of teamSide.selections) {
      if (!(LINEUP_SELECTION_STATUSES as readonly string[]).includes(selection.status)) continue;
      const starter = Boolean(selection.lineupSlot) || selection.status !== 'SELECTED_SUBSTITUTE';
      drafts.push({
        side: teamSide.side,
        userId: selection.userId,
        teamId: teamSide.teamId,
        displayNameSnapshot: nameOf(selection.user),
        role: starter ? 'STARTER' : 'SUBSTITUTE',
        source: 'TEAM_SELECTION',
        slotIndex: selection.lineupSlot?.slotIndex ?? null,
      });
    }
  }
  for (const participant of participants)
    drafts.push({
      side: participant.team,
      userId: participant.userId,
      teamId: null,
      displayNameSnapshot: nameOf(participant.user),
      role: participant.formationSlot ? 'STARTER' : 'SUBSTITUTE',
      source: 'PARTICIPANT',
      slotIndex: participant.formationSlot?.slotIndex ?? null,
    });
  const seen = new Set<string>();
  return drafts
    .filter(({ userId }) => (seen.has(userId) ? false : (seen.add(userId), true)))
    .sort((a, b) =>
      a.side.localeCompare(b.side)
      || (a.role === b.role ? 0 : a.role === 'STARTER' ? -1 : 1)
      || (a.slotIndex ?? 999) - (b.slotIndex ?? 999)
      || a.displayNameSnapshot.localeCompare(b.displayNameSnapshot));
}

const named = { select: { username: true, profile: { select: { displayName: true } } } } as const;

/** The lineup as it stands now (before kickoff the referee sees this; from kickoff, the record). */
export async function buildLineup(tx: Prisma.TransactionClient, matchId: string) {
  const match = await tx.match.findUniqueOrThrow({
    where: { id: matchId },
    select: {
      participants: {
        where: { status: 'JOINED' },
        select: { userId: true, team: true, user: named, formationSlot: { select: { slotIndex: true } } },
      },
      teamSides: {
        select: {
          side: true,
          teamId: true,
          selections: {
            where: { status: { in: [...LINEUP_SELECTION_STATUSES] } },
            select: { userId: true, status: true, user: named, lineupSlot: { select: { slotIndex: true } } },
          },
        },
      },
    },
  });
  return toLineupEntryDrafts(match.participants, match.teamSides);
}

/** Writes the kickoff lineup record once; later calls leave the first record untouched. */
export async function recordKickoffLineup(tx: Prisma.TransactionClient, matchId: string) {
  if (await tx.matchLineupEntry.count({ where: { matchId } })) return 0;
  const drafts = await buildLineup(tx, matchId);
  if (!drafts.length) return 0;
  const created = await tx.matchLineupEntry.createMany({
    data: drafts.map((draft) => ({ ...draft, matchId })),
    skipDuplicates: true,
  });
  return created.count;
}
