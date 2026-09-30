import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { serializableTransaction } from '../src/database/transaction.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { recordKickoffLineup } from '../src/modules/matches/lineup-record.js';
import { transitionMatchToStarted } from '../src/modules/matches/match-lifecycle.scheduler.js';
import { MatchesRepository } from '../src/modules/matches/matches.repository.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { FinancialRepository } from '../src/modules/wallet/financial.repository.js';
import { TestEmailProvider } from '../src/modules/auth/email.provider.js';
import { RefereeJobs } from '../src/modules/referees/referee.jobs.js';
import { RefereeResultsService } from '../src/modules/referees/referee-results.service.js';
import { resultOverdueDedupeKey } from '../src/modules/referees/referee-results.js';
import { RefereeViewService } from '../src/modules/referees/referee-view.service.js';
import { ResultEvidenceService } from '../src/modules/referees/result-evidence.service.js';
import { DisputesService } from '../src/modules/disputes/disputes.service.js';
import { managedVenueFixture } from './managed-venue-fixture.js';
import { refereeFixture } from './referee-fixture.js';

/**
 * Gate 8 smoke (DEC-020): the kickoff lineup record (TKT-803; team sides are covered in
 * smoke:team-go-no-go) and the referee's final result (TKT-804).
 */
const marker = `g8-results-${randomUUID().slice(0, 8)}`;
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const bookings = new BookingsService();
const repository = new MatchesRepository();
const matches = new MatchesService();
const financial = new FinancialRepository();
const venue = managedVenueFixture(marker);
const referee = refereeFixture(marker);
const results = new RefereeResultsService();
const refereeView = new RefereeViewService();
const evidence = new ResultEvidenceService();
const jobs = new RefereeJobs(undefined, new TestEmailProvider());
const rejectsWith = async (work: () => Promise<unknown>, code: string) => {
  try {
    await work();
  } catch (error) {
    return (error as { code?: string }).code === code;
  }
  return false;
};
const userIds: string[] = [];
const matchIds: string[] = [];

const user = async (label: string) => {
  const created = await prisma.user.create({
    data: {
      email: `${marker}-${label}@smoke.invalid`,
      username: `${marker.slice(-8)}_${label}`,
      passwordHash: 'smoke-test-only',
      emailVerifiedAt: new Date(),
      onboardingCompletedAt: new Date(),
      profile: { create: { displayName: `Player ${label}` } },
      walletAccount: { create: { currency: 'ZAR' } },
    },
  });
  userIds.push(created.id);
  await serializableTransaction((tx) =>
    financial.credit(tx, { userId: created.id, amountCents: 50_000, type: 'DEPOSIT_CREDIT', idempotencyKey: `${marker}:seed:${label}`, referenceType: 'SMOKE', referenceId: marker }),
  );
  return created;
};

/**
 * A confirmed Quick Match that has kicked off: every position claimed (5 a side) plus one
 * substitute per side, a referee assigned, the T-30 check passed, then kickoff.
 */
async function playedQuickMatch(label: string, host: { id: string }, players: Array<{ id: string }>) {
  const created = await bookings.createQuickMatch(
    { managedFieldId: venue.fieldId, name: `${marker}-${label}`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 5, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: venue.nextKickoff().toISOString() },
    host.id,
  );
  matchIds.push(created.id);
  await referee.assign(created.id);
  const slots = await prisma.formationSlot.findMany({ where: { matchId: created.id }, orderBy: [{ team: 'asc' }, { slotIndex: 'asc' }] });
  for (const [index, player] of players.entries()) {
    const slot = slots[index];
    const team = slot?.team ?? (index % 2 === 0 ? 'HOME' : 'AWAY');
    await repository.join(created.id, player.id, { team }, `${marker}:join:${created.id}:${player.id}`);
    if (slot) await repository.claimPosition(created.id, slot.id, player.id);
  }
  const record = await prisma.match.findUniqueOrThrow({ where: { id: created.id } });
  assert((await matches.decideGoNoGo(created.id, record.goNoGoAt!)).outcome === 'CONFIRMED', 'The full refereed match was not confirmed.');
  // Pretend kickoff has arrived.
  const startsAt = new Date(Date.now() - 60_000);
  await prisma.match.update({ where: { id: created.id }, data: { startsAt, goNoGoAt: new Date(startsAt.getTime() - 30 * 60_000) } });
  assert(await transitionMatchToStarted(created.id), 'The match did not kick off.');
  return created.id;
}

async function main() {
  await venue.create();
  const host = await user('host');
  const players = [];
  for (let index = 0; index < 12; index += 1) players.push(await user(`p${index}`));

  // TKT-803: kickoff writes one permanent entry per player: position holders start, others are subs.
  const matchId = await playedQuickMatch('lineup', host, players);
  const lineup = await prisma.matchLineupEntry.findMany({ where: { matchId } });
  assert(lineup.length === 12, `Expected 12 lineup entries, found ${lineup.length}.`);
  assert(lineup.filter(({ role }) => role === 'STARTER').length === 10 && lineup.filter(({ role }) => role === 'SUBSTITUTE').length === 2, 'Starters and substitutes were not recorded correctly.');
  assert(lineup.every(({ source, teamId }) => source === 'PARTICIPANT' && teamId === null), 'Quick Match entries were not recorded as participants.');
  assert(lineup.every(({ displayNameSnapshot }) => displayNameSnapshot.startsWith('Player ')), 'Display names were not snapshotted.');
  assert(!lineup.some(({ userId }) => userId === host.id), 'The host was recorded without joining.');
  assert(!(await transitionMatchToStarted(matchId)), 'Kickoff ran twice.');
  assert((await serializableTransaction((tx) => recordKickoffLineup(tx, matchId))) === 0, 'The lineup record was written twice.');
  let permanent = false;
  try {
    await prisma.$executeRaw`UPDATE "MatchLineupEntry" SET "role" = 'SUBSTITUTE' WHERE "matchId" = ${matchId}::uuid`;
  } catch (error) {
    permanent = String(error).includes('the kickoff lineup record is permanent');
  }
  assert(permanent, 'The kickoff lineup record could be edited.');
  const flagged = await prisma.matchLineupEntry.updateMany({ where: { matchId, userId: players[11]!.id }, data: { didNotPlay: true } });
  assert(flagged.count === 1, 'didNotPlay could not be set.');

  const racedId = await refereeResultSection(host, players, matchId);
  await captainEvidenceSection(host, players, matchId, racedId);
  console.log(
    'Gate 8 referee results smoke passed: kickoff lineup record (starters, substitutes, snapshots, once, permanent except didNotPlay); '
      + 'referee final result (only the assigned referee, from kickoff, validated against the lineup, goals/assists/own goals, didNotPlay, '
      + 'one revision, COMPLETED, notices once, first submission wins under a race, legacy self-report blocked, overdue alert); '
      + 'captain/host own version (window, authority, score-only, latest kept, permanent), report a problem (24h, one open), result disputes retired.',
  );
}

/**
 * TKT-804: HOME players are p0-p4 (positions) and p10 (sub); AWAY players are p5-p9 and p11.
 */
async function refereeResultSection(host: { id: string }, players: Array<{ id: string }>, matchId: string) {
  const [p0, p1, , , , p5] = players as [{ id: string }, { id: string }, unknown, unknown, unknown, { id: string }];
  const p11 = players[11]!;
  const valid = {
    outcome: 'PLAYED' as const,
    homeScore: 2,
    awayScore: 1,
    goals: [
      { side: 'HOME' as const, scorerUserId: p0.id, assistUserId: p1.id, ownGoal: false },
      { side: 'HOME' as const, ownGoal: true },
      { side: 'AWAY' as const, scorerUserId: p5.id, ownGoal: false },
    ],
    didNotPlayUserIds: [p11.id],
  };
  // TKT-805: the referee sees their own match with both lineups: names and sides, no contact,
  // payment or venue-cost data. Players and other people cannot open it.
  const mine = await refereeView.listMine(referee.userId);
  const card = mine.find(({ matchId: id }) => id === matchId);
  assert(card?.canRecordResult && !card.canDecline && card.sides.HOME === 'Team A', 'The referee list does not offer the result form.');
  const detail = await refereeView.detail(matchId, referee.userId);
  assert(detail.lineupRecorded && detail.lineup.length === 12 && detail.lineup.every(({ displayName }) => displayName.startsWith('Player ')), 'The referee does not see the recorded lineups.');
  const json = JSON.stringify(detail);
  assert(!/@|price|amountCents|feeCents|wallet|phone|dateOfBirth/i.test(json), 'The referee view exposed contact, payment or venue-cost data.');
  assert(await rejectsWith(() => refereeView.listMine(p0.id), 'NOT_A_REFEREE'), 'A player opened the referee view.');
  const otherReferee = refereeFixture(`${marker}-other`);
  await otherReferee.create();
  assert(await rejectsWith(() => refereeView.detail(matchId, otherReferee.userId), 'NOT_MATCH_REFEREE'), 'Another referee opened a match they do not referee.');
  await otherReferee.cleanup();
  // Only the assigned, active referee may record it.
  assert(await rejectsWith(() => results.submit(matchId, host.id, valid), 'NOT_MATCH_REFEREE'), 'Someone other than the referee recorded the result.');
  // It is checked against the kickoff lineup.
  assert(await rejectsWith(() => results.submit(matchId, referee.userId, { ...valid, homeScore: 3 }), 'RESULT_INVALID'), 'A result whose goals do not add up was accepted.');
  assert(await rejectsWith(() => results.submit(matchId, referee.userId, { ...valid, goals: [{ ...valid.goals[0]!, scorerUserId: host.id }, valid.goals[1]!, valid.goals[2]!] }), 'RESULT_INVALID'), 'A scorer outside the lineup was accepted.');
  assert(await rejectsWith(() => results.submit(matchId, referee.userId, { ...valid, goals: [valid.goals[0]!, valid.goals[1]!, { side: 'AWAY', scorerUserId: p11.id, ownGoal: false }] }), 'RESULT_INVALID'), 'A player marked as not playing scored.');
  const submitted = await results.submit(matchId, referee.userId, valid);
  assert(submitted.revisionNumber === 1, 'The first result was not revision 1.');
  const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId }, include: { result: { include: { goals: true, revisions: true } }, lineupEntries: true } });
  assert(match.status === 'COMPLETED', 'The match was not completed by the referee result.');
  assert(match.result?.finalSource === 'REFEREE' && match.result.finalizedById === referee.userId && match.result.homeScore === 2 && match.result.awayScore === 1, 'The referee result was not stored as final.');
  assert(match.result.goals.length === 3 && match.result.goals.filter(({ ownGoal }) => ownGoal).length === 1, 'Goals were not stored.');
  assert(match.result.revisions.length === 1 && match.result.revisions[0]!.reason === 'REFEREE_SUBMISSION' && match.result.revisions[0]!.createdByUserId === referee.userId, 'The referee revision was not recorded.');
  assert(match.lineupEntries.filter(({ didNotPlay }) => didNotPlay).map(({ userId }) => userId).join() === p11.id, 'didNotPlay was not recorded from the result.');
  const view = await matches.get(matchId, p0.id);
  assert(view.result?.goals?.[0]?.scorer?.userId === p0.id && view.result.goals[0].assist?.userId === p1.id && view.result.goals[1]!.ownGoal && !view.result.goals[1]!.scorer, 'Players do not see the goals, assists and own goal.');
  const notices = await prisma.notification.findMany({ where: { type: 'RESULT_FINAL', targetPath: `/matches/${matchId}` } });
  assert(notices.length === 12 && notices.every(({ message }) => message.endsWith('Team A 2-1 Team B.')), `Expected 12 final-result notices, found ${notices.length}.`);
  // Final is final: a second submission is refused (D5).
  assert(await rejectsWith(() => results.submit(matchId, referee.userId, valid), 'RESULT_ALREADY_FINAL'), 'A final result was submitted twice.');

  // A second match: the host cannot self-report (legacy path), the referee cannot record before
  // kickoff, the overdue alert fires while there is no result, and a race lets exactly one win.
  const second = await bookings.createQuickMatch(
    { managedFieldId: venue.fieldId, name: `${marker}-early`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 5, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: venue.nextKickoff().toISOString() },
    host.id,
  );
  matchIds.push(second.id);
  await referee.assign(second.id);
  assert(await rejectsWith(() => results.submit(second.id, referee.userId, { ...valid, homeScore: 0, awayScore: 0, goals: [], didNotPlayUserIds: [] }), 'MATCH_NOT_STARTED'), 'A result was recorded before kickoff.');
  const raced = await playedQuickMatch('race', host, players);
  assert(await rejectsWith(() => matches.submitResult(raced, { homeScore: 0, awayScore: 0, scorers: [] }, host.id), 'RESULT_BY_REFEREE'), 'The host self-reported a refereed match.');
  const overdueJob = await prisma.durableJob.findUnique({ where: { dedupeKey: resultOverdueDedupeKey(raced) } });
  const racedMatch = await prisma.match.findUniqueOrThrow({ where: { id: raced } });
  assert(overdueJob && overdueJob.runAt.getTime() === racedMatch.startsAt.getTime() + (racedMatch.durationMinutes + 120) * 60_000, 'The 2-hour overdue alert was not scheduled at kickoff.');
  const admin = await prisma.user.create({ data: { email: `${marker}-admin@smoke.invalid`, username: `${marker.slice(-8)}_adm`, passwordHash: 'smoke-test-only', platformRole: 'ADMIN' } });
  userIds.push(admin.id);
  await jobs.alertResultOverdue(overdueJob.payload);
  await jobs.alertResultOverdue(overdueJob.payload);
  assert((await prisma.notification.count({ where: { userId: admin.id, type: 'ADMIN_ALERT', title: 'Match result overdue' } })) === 1, 'Admins were not alerted once about the overdue result.');
  const nil = { outcome: 'PLAYED' as const, homeScore: 0, awayScore: 0, goals: [], didNotPlayUserIds: [] };
  const race = await Promise.allSettled([results.submit(raced, referee.userId, nil), results.submit(raced, referee.userId, { ...nil, outcome: 'ABANDONED' as const })]);
  assert(race.filter(({ status }) => status === 'fulfilled').length === 1, 'Not exactly one concurrent submission won.');
  assert((await prisma.matchResultRevision.count({ where: { matchResult: { matchId: raced } } })) === 1, 'A race wrote two revisions.');
  await prisma.notification.deleteMany({ where: { userId: admin.id } });
  const after = await jobs.alertResultOverdue(overdueJob.payload);
  assert(after.length === 0, 'An overdue alert fired for a match that has a result.');
  return raced;
}

/** TKT-806 (D6, D10, D11, D21), with the Quick Match host acting as captain. */
async function captainEvidenceSection(host: { id: string }, players: Array<{ id: string }>, matchId: string, racedId: string) {
  const p0 = players[0]!;
  // The own-version window opens at the scheduled end; the raced match has not reached it yet.
  assert(await rejectsWith(() => evidence.submitVersion(racedId, host.id, { outcome: 'PLAYED', homeScore: 1, awayScore: 0, goals: [] }), 'RESULT_VERSION_CLOSED'), 'A version was accepted before the match ended.');
  // Move the first match's schedule back so its end has passed.
  const startsAt = new Date(Date.now() - 2 * 3_600_000);
  await prisma.match.update({ where: { id: matchId }, data: { startsAt, goNoGoAt: new Date(startsAt.getTime() - 30 * 60_000) } });
  const context = await evidence.context(matchId, host.id);
  assert(context.canSubmitVersion && context.canReportProblem && context.viewerSide === null && context.lineup.length === 12, 'The host does not get the captain options.');
  const playerContext = await evidence.context(matchId, p0.id);
  assert(!playerContext.canSubmitVersion && !playerContext.canReportProblem && playerContext.lineup.length === 0, 'A plain player got captain options.');
  assert(await rejectsWith(() => evidence.submitVersion(matchId, p0.id, { outcome: 'PLAYED', homeScore: 3, awayScore: 0, goals: [] }), 'RESULT_VERSION_FORBIDDEN'), 'A plain player sent a version.');
  assert(await rejectsWith(() => evidence.submitVersion(matchId, host.id, { outcome: 'PLAYED', homeScore: 1, awayScore: 0, goals: [{ side: 'HOME', scorerUserId: players[5]!.id, ownGoal: false }] }), 'RESULT_INVALID'), 'A version with a scorer from the wrong side was accepted.');
  await evidence.submitVersion(matchId, host.id, { outcome: 'PLAYED', homeScore: 3, awayScore: 1, goals: [] });
  const latest = await evidence.submitVersion(matchId, host.id, { outcome: 'PLAYED', homeScore: 2, awayScore: 1, goals: [{ side: 'HOME', ownGoal: false }, { side: 'HOME', scorerUserId: p0.id, ownGoal: false }, { side: 'AWAY', ownGoal: true }] });
  assert((await prisma.captainResultSubmission.count({ where: { matchId } })) === 2 && (await evidence.context(matchId, host.id)).mySubmission?.id === latest.id, 'The latest version was not kept alongside the earlier one.');
  const final = await prisma.matchResult.findUniqueOrThrow({ where: { matchId } });
  assert(final.homeScore === 2 && final.awayScore === 1 && final.finalSource === 'REFEREE', 'A captain version changed the referee result.');
  let immutable = false;
  try {
    await prisma.$executeRaw`UPDATE "CaptainResultSubmission" SET "homeScore" = 9 WHERE "matchId" = ${matchId}::uuid`;
  } catch (error) {
    immutable = String(error).includes('captain result submissions are permanent');
  }
  assert(immutable, 'A captain version could be edited.');

  // D6: report a problem within 24 hours of the final result; one open report per person.
  assert(await rejectsWith(() => evidence.reportProblem(matchId, p0.id, { message: 'The second goal was offside.' }), 'RESULT_PROBLEM_FORBIDDEN'), 'A plain player reported a problem.');
  assert(await rejectsWith(() => evidence.reportProblem(matchId, host.id, { message: 'short' }), 'RESULT_PROBLEM_FORBIDDEN') === false, 'Setup: the host may report.');
  const report = await evidence.reportProblem(matchId, host.id, { message: 'Ann scored the first goal, not Ben.' });
  assert(report.status === 'OPEN', 'The problem report was not opened.');
  assert(await rejectsWith(() => evidence.reportProblem(matchId, host.id, { message: 'Another problem with the result.' }), 'RESULT_PROBLEM_ALREADY_OPEN'), 'A second open report was accepted.');
  assert(!(await evidence.context(matchId, host.id)).canReportProblem, 'The report form stayed open with a report under review.');
  await prisma.matchResult.update({ where: { matchId: racedId }, data: { submittedAt: new Date(Date.now() - 25 * 3_600_000) } });
  assert(await rejectsWith(() => evidence.reportProblem(racedId, host.id, { message: 'Too late to report this one.' }), 'RESULT_PROBLEM_CLOSED'), 'A problem was reported after 24 hours.');

  // D21: results can no longer be disputed.
  const resultId = final.id;
  assert(await rejectsWith(() => new DisputesService().create(host.id, { type: 'MATCH_RESULT', referenceId: resultId, reason: 'INCORRECT_SCORE', details: 'The score was wrong.' }), 'RESULT_DISPUTES_RETIRED'), 'A result dispute was opened.');
}

async function cleanup() {
  await referee.cleanupJobs(matchIds);
  await venue.cleanupMatches(matchIds);
  await prisma.matchPayment.deleteMany({ where: { matchId: { in: matchIds } } });
  const venueIds = (await prisma.match.findMany({ where: { id: { in: matchIds } }, select: { venueId: true } })).map(({ venueId }) => venueId);
  await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
  await venue.cleanupVenue();
  await referee.cleanup();
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.walletHold.deleteMany({ where: { walletAccount: { userId: { in: userIds } } } });
  await prisma.walletTransaction.deleteMany({ where: { walletAccount: { userId: { in: userIds } } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

try {
  await main();
} finally {
  await cleanup().catch((error: unknown) => {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  });
  await prisma.$disconnect();
}
