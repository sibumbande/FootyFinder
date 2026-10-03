import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import type { CreateMatchInput } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { RefereeResultsService } from '../src/modules/referees/referee-results.service.js';
import { TeamMatchesService } from '../src/modules/team-matches/team-matches.service.js';
import { TeamReviewsService } from '../src/modules/team-reviews/team-reviews.service.js';
import { refereeFixture } from './referee-fixture.js';
import { assert, rejectsWith, teamMatchWorld } from './team-match-fixtures.js';

/**
 * Gate 8 smoke (DEC-017 as confirmed by DEC-020, D24): team reviews after a referee-final result.
 * The kickoff lineup record and the started state are fixture setup here; smoke:referee-results
 * and smoke:team-go-no-go cover how they are produced.
 */
const world = teamMatchWorld(`gate8-reviews-${randomUUID()}`);
const referee = refereeFixture(`ref-${world.marker}`);
const matches = new MatchesService();
const teamMatches = new TeamMatchesService();
const results = new RefereeResultsService();
const reviews = new TeamReviewsService();

async function newTeam(label: string) {
  const owner = await world.user(`${label} owner`);
  const captain = await world.user(`${label} captain`);
  const member = await world.user(`${label} member`);
  const team = await world.team(label, owner.id, [{ userId: captain.id, role: 'CAPTAIN' }, { userId: member.id, role: 'MEMBER' }]);
  return { owner, captain, member, team };
}

async function main() {
  await world.venue();
  const home = await newTeam('home');
  const away = await newTeam('away');
  const dual = await world.user('Dual member');
  const sub = await world.user('Away sub');
  const outsider = await world.user('Outsider');
  // "dual" plays for the away side but is also a member of the home team (cannot review it).
  // (The home membership is added after the away team loads: Gate 7 refuses a team that shares a
  // player with the home team, so here it stands for someone who joined the home team later.)
  await prisma.teamMembership.createMany({ data: [{ teamId: away.team.id, userId: dual.id, role: 'MEMBER' }, { teamId: away.team.id, userId: sub.id, role: 'MEMBER' }] });
  const input: CreateMatchInput = {
    managedFieldId: world.fieldId, name: `${world.marker}-m`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 0, rollingSubstitutes: false,
    rules: [], visibility: 'PUBLIC', startsAt: world.nextKickoff().toISOString(), playAsTeamId: home.team.id, otherSideMode: 'TEAMS_ONLY', teamSubstituteCount: 0,
  };
  const match = await matches.create(input, home.owner.id);
  world.matchIds.push(match.id);
  await teamMatches.loadTeam(match.id, away.owner.id, { teamId: away.team.id, substituteCount: 0 });
  await prisma.teamMembership.create({ data: { teamId: home.team.id, userId: dual.id, role: 'MEMBER' } });
  await referee.assign(match.id);
  // Fixture: the match kicked off with these lineups (the sub did not play).
  const lineup = [
    ...[home.owner, home.captain, home.member].map((user) => ({ user, side: 'HOME' as const, teamId: home.team.id })),
    ...[away.owner, away.captain, away.member, dual, sub].map((user) => ({ user, side: 'AWAY' as const, teamId: away.team.id })),
  ];
  await prisma.matchLineupEntry.createMany({
    data: lineup.map(({ user, side, teamId }, index) => ({ matchId: match.id, userId: user.id, side, teamId, displayNameSnapshot: `Player ${index}`, role: 'STARTER', source: 'TEAM_SELECTION' })),
  });
  await prisma.match.update({ where: { id: match.id }, data: { status: 'IN_PROGRESS', confirmedAt: new Date() } });

  // Before the result is final nobody can review.
  assert((await reviews.context(match.id, away.owner.id)).reason === 'NOT_FINAL', 'A review was offered before the final result.');
  assert(await rejectsWith(() => reviews.create(match.id, away.owner.id, { rating: 5 }), 'REVIEW_NOT_ALLOWED'), 'A review was accepted before the final result.');
  await results.submit(match.id, referee.userId, { outcome: 'PLAYED', homeScore: 1, awayScore: 0, goals: [{ side: 'HOME', scorerUserId: home.member.id, ownGoal: false }], didNotPlayUserIds: [sub.id] });

  // D24: players who played review the opposing team; not outsiders, non-players or own-team members.
  const context = await reviews.context(match.id, away.owner.id);
  assert(context.eligible && context.team?.id === home.team.id && context.editableUntil, 'An away player could not review the home team.');
  assert((await reviews.context(match.id, home.captain.id)).team?.id === away.team.id, 'A home player was not offered the away team.');
  assert((await reviews.context(match.id, outsider.id)).reason === 'NOT_IN_LINEUP', 'Someone outside the lineup was offered a review.');
  assert((await reviews.context(match.id, sub.id)).reason === 'NOT_IN_LINEUP', 'A player who did not play was offered a review.');
  assert((await reviews.context(match.id, dual.id)).reason === 'OWN_TEAM', 'A member of the reviewed team was offered a review.');
  assert(await rejectsWith(() => reviews.create(match.id, dual.id, { rating: 1 }), 'REVIEW_NOT_ALLOWED'), 'A self-team review was accepted.');

  // A review can be left for 14 days after the final result (CEO, 2026-09-30).
  const later = new Date(Date.now() + 15 * 86_400_000);
  assert((await reviews.context(match.id, home.captain.id, later)).reason === 'REVIEW_WINDOW_CLOSED', 'A review was offered more than 14 days after the final result.');
  assert(await rejectsWith(() => reviews.create(match.id, home.captain.id, { rating: 3 }, later), 'REVIEW_NOT_ALLOWED'), 'A review was accepted more than 14 days after the final result.');
  assert(context.reviewableUntil && new Date(context.reviewableUntil).getTime() - new Date(context.editableUntil!).getTime() === 7 * 86_400_000, 'The review window is not 14 days.');

  // Ratings count at once; text waits for an admin. Fewer than three: "Not enough reviews."
  await reviews.create(match.id, away.owner.id, { rating: 5 });
  await reviews.create(match.id, away.captain.id, { rating: 4 });
  assert(await rejectsWith(() => reviews.create(match.id, away.owner.id, { rating: 1 }), 'REVIEW_EXISTS'), 'A duplicate review was accepted.');
  assert(!(await reviews.teamSummary(home.team.id)).enoughReviews, 'An average was shown with two reviews.');
  const withText = await reviews.create(match.id, away.member.id, { rating: 3, text: 'Great hosts, fair game.' });
  assert(withText.textStatus === 'PENDING', 'Review text was not held for approval.');
  let summary = await reviews.teamSummary(home.team.id);
  assert(summary.enoughReviews && summary.averageRating === 4 && summary.reviewCount === 3, `Wrong summary: ${JSON.stringify(summary)}`);
  assert(summary.reviews.every(({ text }) => text === null), 'Unapproved text was public.');
  const json = JSON.stringify(summary);
  assert(![away.owner.id, away.captain.id, away.member.id, 'away owner', 'Player '].some((needle) => json.includes(needle)), 'The public summary identified an author.');

  // Admin moderation: approve text (audited).
  // Admins with audit rows stay in the disposable database (AdminAuditLog is append-only).
  const admin = await prisma.user.create({ data: { email: `admin-${world.marker}@smoke.invalid`, username: `g8r_${world.marker.slice(-10)}_adm`, passwordHash: 'smoke-test-only', platformRole: 'ADMIN' } });
  await reviews.moderate(withText.id, admin.id, { action: 'APPROVE_TEXT' }, world.marker);
  summary = await reviews.teamSummary(home.team.id);
  assert(summary.reviews.some(({ text }) => text === 'Great hosts, fair game.'), 'Approved text was not public.');
  assert(await prisma.adminAuditLog.count({ where: { actorUserId: admin.id, action: 'TEAM_REVIEW_APPROVE_TEXT' } }), 'Moderation was not audited.');

  // Edits: within 7 days; changing the text sends it back for approval; not after the window.
  const edited = await reviews.update(match.id, away.member.id, { rating: 2, text: 'Good game.' });
  assert(edited.rating === 2 && edited.textStatus === 'PENDING', 'An edited text was not held for approval again.');
  await prisma.teamReview.update({ where: { id: withText.id }, data: { editableUntil: new Date(Date.now() - 1_000) } });
  assert(await rejectsWith(() => reviews.update(match.id, away.member.id, { rating: 5 }), 'REVIEW_EDIT_CLOSED'), 'A review was edited after 7 days.');

  // Reported reviews stop counting until an admin restores them; hidden and deleted never count.
  assert(await rejectsWith(() => reviews.report(home.team.id, withText.id, outsider.id), 'TEAM_FORBIDDEN'), 'A non-member reported a review.');
  await reviews.report(home.team.id, withText.id, home.member.id);
  assert(!(await reviews.teamSummary(home.team.id)).enoughReviews, 'A reported review still counted.');
  const reported = await reviews.adminList({ queue: 'reported' });
  assert(reported.some(({ id, author }) => id === withText.id && author.id === away.member.id), 'Admins cannot see the reported review and its author.');
  await reviews.moderate(withText.id, admin.id, { action: 'RESTORE', note: 'Fair comment' }, world.marker);
  assert((await reviews.teamSummary(home.team.id)).reviewCount === 3, 'A restored review did not count again.');
  await reviews.moderate(withText.id, admin.id, { action: 'HIDE', note: 'Abusive' }, world.marker);
  assert(!(await reviews.teamSummary(home.team.id)).enoughReviews, 'A hidden review still counted.');
  await reviews.remove(match.id, away.owner.id);
  assert((await reviews.context(match.id, away.owner.id)).review === null, 'A deleted review was still shown to its author.');
  assert((await prisma.teamReview.findUniqueOrThrow({ where: { matchId_authorUserId: { matchId: match.id, authorUserId: away.owner.id } } })).status === 'DELETED', 'A deleted review was not kept for the audit trail.');

  console.log('Gate 8 team reviews smoke passed: eligibility from the lineup record after a final result (not before, not outsiders, non-players or own-team members), one per match, anonymous public summary with a 3-review minimum, text approval, 14-day review window, 7-day edits, reports, hide, restore, author deletion, audited moderation.');
}

try {
  await main();
} finally {
  await referee.cleanupJobs(world.matchIds);
  await prisma.teamReview.deleteMany({ where: { matchId: { in: world.matchIds } } });
  await world.cleanup().catch((error: unknown) => {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  });
  await referee.cleanup();
  await prisma.$disconnect();
}
