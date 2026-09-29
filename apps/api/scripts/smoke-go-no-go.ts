import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { getGoNoGoAt, MATCH_FEE_CENTS, type MatchFormat } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { serializableTransaction } from '../src/database/transaction.js';
import { runOneDurableJob } from '../src/jobs/durable-jobs.js';
import { registerBookingJobHandlers } from '../src/modules/bookings/booking.jobs.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { goNoGoJobDedupeKey } from '../src/modules/matches/go-no-go.js';
import { registerGoNoGoJobHandlers } from '../src/modules/matches/go-no-go.jobs.js';
import { TestEmailProvider } from '../src/modules/auth/email.provider.js';
import { matchCancelledMessage } from '../src/modules/matches/cancellation-message.js';
import { MATCH_CANCELLED_EMAIL_JOB_TYPE } from '../src/modules/matches/match-cancelled-email.js';
import { registerMatchCancelledEmailJobHandlers } from '../src/modules/matches/match-cancelled-email.jobs.js';
import {
  LineupLockedError,
  MatchClosedError,
  MatchesRepository,
} from '../src/modules/matches/matches.repository.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { registerModerationJobHandlers } from '../src/modules/moderation/moderation.jobs.js';
import { FinancialRepository } from '../src/modules/wallet/financial.repository.js';
import { registerWalletHoldJobHandlers } from '../src/modules/wallet/wallet-hold.jobs.js';
import { WalletReconciliationService } from '../src/modules/wallet/wallet-reconciliation.service.js';

// DEC-018 money-path proof against real PostgreSQL (disposable database only):
// fixed R80 join, no host hold, format-scoped venue cost snapshot, T-30 cancel + refund exactly
// once (including a second run, the durable queue path and a crashed/stale job), full lineup
// confirmed, the race between the last claim and the T-30 job, the T-30 freeze, and host cancel.
const marker = `dec-018-${randomUUID()}`;
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const bookings = new BookingsService();
const matches = new MatchesRepository();
const service = new MatchesService();
const financial = new FinancialRepository();
const PLAYER_COUNT = 12;
const RACE_ROUNDS = 4;
const userIds: string[] = [];
let hostId = '';
let venueId = '';
let fieldId = '';
let matchIndex = 0;
const matchIds: string[] = [];
const emails = new TestEmailProvider();

const emailJobsFor = (matchId: string) =>
  prisma.durableJob.findMany({
    where: { type: MATCH_CANCELLED_EMAIL_JOB_TYPE, dedupeKey: { startsWith: `match-cancelled-email:${matchId}:` } },
  });
const emailsFor = (matchId: string) => emails.messages.filter(({ text }) => text.includes(`/matches/${matchId}`));

/** Run the queue until every cancellation email job for the match has succeeded. */
async function drainCancellationEmails(matchId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const jobs = await emailJobsFor(matchId);
    if (jobs.every(({ status }) => status === 'SUCCEEDED')) return jobs;
    if (!(await runOneDurableJob(new Date()))) break;
  }
  return emailJobsFor(matchId);
}

/**
 * Each recipient has exactly one MATCH_CANCELLED notification, one email job and, after the queue is
 * drained twice, exactly one email, all with the expected wording.
 */
async function assertCancellationAlertsOnce(
  matchId: string,
  recipients: string[],
  expected: (userId: string) => string,
  label: string,
) {
  const notifications = await prisma.notification.findMany({
    where: { type: 'MATCH_CANCELLED', targetPath: `/matches/${matchId}` },
  });
  for (const userId of recipients) {
    const mine = notifications.filter((item) => item.userId === userId);
    assert(mine.length === 1, `${label}: ${userId} got ${mine.length} cancellation notifications.`);
    assert(mine[0]!.message === expected(userId), `${label}: wrong notification wording: ${mine[0]!.message}`);
  }
  assert(notifications.length === recipients.length, `${label}: unexpected cancellation notification recipients.`);
  const jobs = await drainCancellationEmails(matchId);
  assert(jobs.length === recipients.length, `${label}: expected one email job per recipient, found ${jobs.length}.`);
  assert(jobs.every(({ status }) => status === 'SUCCEEDED'), `${label}: an email job did not succeed.`);
  await drainCancellationEmails(matchId);
  const sent = emailsFor(matchId);
  const addresses = await prisma.user.findMany({ where: { id: { in: recipients } }, select: { id: true, email: true } });
  assert(sent.length === recipients.length, `${label}: expected ${recipients.length} emails, sent ${sent.length}.`);
  for (const { id, email } of addresses) {
    const mine = sent.filter(({ to }) => to === email);
    assert(mine.length === 1, `${label}: ${email} received ${mine.length} emails.`);
    assert(mine[0]!.text.startsWith(expected(id)), `${label}: wrong email wording: ${mine[0]!.text}`);
    assert(mine[0]!.subject === 'Your FootyFinder match was cancelled', `${label}: wrong email subject.`);
  }
}

async function expectedCancellation(matchId: string, reason: 'POSITIONS_UNFILLED' | 'ORGANISER_CANCELLED') {
  const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId }, include: { venue: true } });
  return (userId: string, paid = userId !== hostId) =>
    matchCancelledMessage({
      venueName: match.venue.name,
      startsAt: match.startsAt,
      reason,
      refundedCents: paid ? MATCH_FEE_CENTS : 0,
    });
}

const balanceOf = async (userId: string) =>
  (await prisma.walletAccount.findUniqueOrThrow({ where: { userId } })).balanceCents;
const creditsFor = (paymentIds: string[]) =>
  prisma.walletTransaction.count({
    where: { type: 'MATCH_CANCELLATION_CREDIT', referenceId: { in: paymentIds } },
  });

/** Kickoff at 12:00 Africa/Johannesburg on a distinct day per match (10:00Z), 3+ days ahead. */
const nextKickoff = () => {
  const day = new Date(Date.now() + (3 + matchIndex++) * 86_400_000);
  day.setUTCHours(10, 0, 0, 0);
  return day;
};

async function createMatch(format: MatchFormat = 'FIVE_A_SIDE', startsAt = nextKickoff()) {
  const match = await bookings.createQuickMatch(
    {
      managedFieldId: fieldId,
      name: `${marker}-${matchIndex}`,
      format,
      substituteCapacityPerTeam: 5,
      rollingSubstitutes: false,
      rules: [],
      visibility: 'PUBLIC',
      startsAt: startsAt.toISOString(),
    },
    hostId,
  );
  matchIds.push(match.id);
  return match;
}

async function joinAndClaim(
  matchId: string,
  players: string[],
  claim: { home: number; away: number },
) {
  const slots = await prisma.formationSlot.findMany({
    where: { matchId },
    orderBy: [{ team: 'asc' }, { slotIndex: 'asc' }],
  });
  const home = slots.filter((slot) => slot.team === 'HOME');
  const away = slots.filter((slot) => slot.team === 'AWAY');
  const payments: string[] = [];
  for (const [index, userId] of players.entries()) {
    const team = index % 2 === 0 ? 'HOME' : 'AWAY';
    await matches.join(matchId, userId, { team }, `${marker}:join:${matchId}:${userId}`);
    const payment = await prisma.matchPayment.findFirstOrThrow({ where: { matchId, userId } });
    payments.push(payment.id);
    const sideIndex = Math.floor(index / 2);
    const target = team === 'HOME' ? home[sideIndex] : away[sideIndex];
    if (target && sideIndex < (team === 'HOME' ? claim.home : claim.away))
      await matches.claimPosition(matchId, target.id, userId);
  }
  return { payments, home, away };
}

async function runQueuedGoNoGo(matchId: string, now: Date) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = await prisma.durableJob.findUniqueOrThrow({
      where: { dedupeKey: goNoGoJobDedupeKey(matchId) },
    });
    if (job.status === 'SUCCEEDED') return job;
    if (!(await runOneDurableJob(now))) break;
  }
  return prisma.durableJob.findUniqueOrThrow({ where: { dedupeKey: goNoGoJobDedupeKey(matchId) } });
}

/** Pretend the clock has reached T-30 for a match that is still in the future. */
async function reachGoNoGo(matchId: string) {
  const now = new Date();
  await prisma.match.update({ where: { id: matchId }, data: { goNoGoAt: new Date(now.getTime() - 1_000) } });
  await prisma.durableJob.update({
    where: { dedupeKey: goNoGoJobDedupeKey(matchId) },
    data: { runAt: new Date(now.getTime() - 1_000) },
  });
  return now;
}

async function main() {
  registerWalletHoldJobHandlers();
  registerBookingJobHandlers();
  registerModerationJobHandlers();
  registerGoNoGoJobHandlers();
  registerMatchCancelledEmailJobHandlers(emails);

  // Fixtures: one physical field supporting 5/7/11-a-side with admin-only format-scoped costs
  // R500 / R600 / R800 (Italian Club example), all-week availability, and an effective policy.
  const users = await Promise.all(
    Array.from({ length: PLAYER_COUNT + 1 }, (_, index) =>
      prisma.user.create({
        data: {
          email: `${marker}-${index}@smoke.invalid`,
          username: `${marker.slice(-18)}_${index}`,
          passwordHash: 'smoke',
          profile: { create: { displayName: `Go/no-go ${index}` } },
          walletAccount: { create: {} },
        },
      }),
    ),
  );
  hostId = users[0]!.id;
  userIds.push(...users.map(({ id }) => id));
  for (const [index, userId] of userIds.entries())
    await serializableTransaction((tx) =>
      financial.credit(tx, {
        userId,
        amountCents: index === 0 ? 0 : 200_000,
        type: 'DEPOSIT_CREDIT',
        idempotencyKey: `${marker}:seed:${index}`,
        referenceType: 'SMOKE',
        referenceId: marker,
      }),
    );
  const priceFrom = new Date(Date.now() - 86_400_000);
  const venue = await prisma.managedVenue.create({
    data: {
      slug: `${marker}-venue`,
      name: marker,
      addressLine1: '1 Go No Go Road',
      city: 'Cape Town',
      region: 'Western Cape',
      countryCode: 'ZA',
      fields: {
        create: {
          name: 'Main Pitch',
          supportedFormats: {
            create: [{ format: 'FIVE_A_SIDE' }, { format: 'SEVEN_A_SIDE' }, { format: 'ELEVEN_A_SIDE' }],
          },
          availabilityPeriods: {
            create: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 })),
          },
          prices: {
            create: [
              { amountCents: 50_000, format: 'FIVE_A_SIDE', effectiveFrom: priceFrom },
              { amountCents: 60_000, format: 'SEVEN_A_SIDE', effectiveFrom: priceFrom },
              { amountCents: 80_000, format: 'ELEVEN_A_SIDE', effectiveFrom: priceFrom },
            ],
          },
        },
      },
      cancellationPolicies: {
        create: { effectiveFrom: priceFrom, policyText: 'Full credit more than 24 hours before kickoff.' },
      },
    },
    include: { fields: true },
  });
  venueId = venue.id;
  fieldId = venue.fields[0]!.id;
  await prisma.managedVenue.update({
    where: { id: venueId },
    data: {
      publicationStatus: 'PUBLISHED',
      submittedByUserId: userIds[1],
      submittedAt: new Date(),
      approvedByUserId: userIds[2],
      approvedAt: new Date(),
    },
  });
  const players = userIds.slice(1);

  // 1. Item 7: the reservation snapshots the format-specific admin-only venue cost.
  for (const [format, cents] of [
    ['FIVE_A_SIDE', 50_000],
    ['SEVEN_A_SIDE', 60_000],
    ['ELEVEN_A_SIDE', 80_000],
  ] as const) {
    const match = await createMatch(format);
    const reservation = await prisma.fieldReservation.findUniqueOrThrow({ where: { matchId: match.id } });
    assert(reservation.priceCentsSnapshot === cents, `${format} did not snapshot its format-scoped venue cost.`);
  }

  // 2. Fixed R80 join and no host hold. The host (empty wallet) created every match above.
  assert((await balanceOf(hostId)) === 0, 'Host wallet changed by creating matches.');
  assert(
    (await prisma.walletHold.count({ where: { walletAccount: { userId: hostId } } })) === 0,
    'Host has a wallet hold.',
  );
  const unfilled = await createMatch();
  const before = await Promise.all(players.slice(0, 3).map(balanceOf));
  const { payments: unfilledPayments } = await joinAndClaim(unfilled.id, players.slice(0, 3), {
    home: 1,
    away: 1,
  });
  const afterJoin = await Promise.all(players.slice(0, 3).map(balanceOf));
  assert(
    afterJoin.every((balance, index) => balance === before[index]! - MATCH_FEE_CENTS),
    'Join did not debit exactly R80.',
  );
  const entryDebits = await prisma.walletTransaction.findMany({
    where: { type: 'MATCH_ENTRY_DEBIT', referenceId: unfilled.id },
  });
  assert(
    entryDebits.length === 3 && entryDebits.every(({ amountCents }) => amountCents === -MATCH_FEE_CENTS),
    'Entry debits were not exactly -R80 each.',
  );

  // 3. Not full at T-30: auto-cancelled, every R80 refunded exactly once, venue owed nothing.
  const unfilledRecord = await prisma.match.findUniqueOrThrow({ where: { id: unfilled.id } });
  const first = await service.decideGoNoGo(unfilled.id, unfilledRecord.goNoGoAt!);
  const second = await service.decideGoNoGo(unfilled.id, new Date(unfilledRecord.goNoGoAt!.getTime() + 60_000));
  assert(first.outcome === 'CANCELLED' && first.filled === 2 && first.total === 10, 'Unfilled match was not cancelled.');
  assert(second.outcome === 'ALREADY_DECIDED', 'Second go/no-go run was not idempotent.');
  assert((await creditsFor(unfilledPayments)) === 3, 'Refunds were not issued exactly once per payment.');
  const refunded = await Promise.all(players.slice(0, 3).map(balanceOf));
  assert(refunded.every((balance, index) => balance === before[index]), 'Refund did not restore R80.');
  const cancelledMatch = await prisma.match.findUniqueOrThrow({
    where: { id: unfilled.id },
    include: { fieldReservation: true },
  });
  assert(
    cancelledMatch.status === 'CANCELLED' && cancelledMatch.cancellationReason === 'POSITIONS_UNFILLED',
    'Cancelled match does not record POSITIONS_UNFILLED.',
  );
  assert(cancelledMatch.fieldReservation?.status === 'CANCELLED', 'Cancelled match left its reservation active.');
  assert(
    (await prisma.walletTransaction.count({ where: { referenceId: cancelledMatch.fieldReservation!.id } })) === 0,
    'A cancelled match created a venue-related ledger entry.',
  );
  const notified = await prisma.notification.findMany({
    where: { type: 'MATCH_CANCELLED', targetPath: `/matches/${unfilled.id}` },
    select: { userId: true },
  });
  assert(
    [...players.slice(0, 3), hostId].every((userId) => notified.some((item) => item.userId === userId)),
    'Not every joined player and the host were notified of the cancellation.',
  );
  // Part 4a: one in-app alert and one email per joined player and the host, even though the
  // decision ran twice; the host did not play, so their message has no refund sentence.
  const unfilledWording = await expectedCancellation(unfilled.id, 'POSITIONS_UNFILLED');
  await assertCancellationAlertsOnce(unfilled.id, [...players.slice(0, 3), hostId], (userId) => unfilledWording(userId), 'Auto-cancel');

  // 4. The durable queue path, including a job whose worker crashed mid-run (stale RUNNING lock).
  for (const crashed of [false, true]) {
    const queued = await createMatch();
    const { payments } = await joinAndClaim(queued.id, players.slice(3, 5), { home: 1, away: 0 });
    const now = await reachGoNoGo(queued.id);
    if (crashed)
      await prisma.durableJob.update({
        where: { dedupeKey: goNoGoJobDedupeKey(queued.id) },
        data: { status: 'RUNNING', lockedAt: new Date(now.getTime() - 60 * 60_000), attempts: 1 },
      });
    const job = await runQueuedGoNoGo(queued.id, now);
    assert(job.status === 'SUCCEEDED', `Queued go/no-go job did not succeed (crashed=${crashed}).`);
    assert((await prisma.match.findUniqueOrThrow({ where: { id: queued.id } })).status === 'CANCELLED', 'Queued job did not cancel the unfilled match.');
    await runOneDurableJob(new Date(now.getTime() + 60_000));
    assert((await creditsFor(payments)) === 2, `Queued job refunded more or less than once (crashed=${crashed}).`);
    const queuedWording = await expectedCancellation(queued.id, 'POSITIONS_UNFILLED');
    await assertCancellationAlertsOnce(queued.id, [...players.slice(3, 5), hostId], (userId) => queuedWording(userId), `Queued auto-cancel (crashed=${crashed})`);
  }

  // 5. Full at T-30: confirmed, no refunds, reservation still owed to the venue after the match.
  const full = await createMatch();
  const { payments: fullPayments } = await joinAndClaim(full.id, players.slice(0, 10), { home: 5, away: 5 });
  const fullRecord = await prisma.match.findUniqueOrThrow({ where: { id: full.id } });
  const confirmed = await service.decideGoNoGo(full.id, fullRecord.goNoGoAt!);
  assert(confirmed.outcome === 'CONFIRMED' && confirmed.filled === 10, 'Full lineup was not confirmed.');
  const confirmedMatch = await prisma.match.findUniqueOrThrow({ where: { id: full.id }, include: { fieldReservation: true } });
  assert(confirmedMatch.confirmedAt && confirmedMatch.status === 'OPEN', 'Confirmed match state is wrong.');
  assert(confirmedMatch.fieldReservation?.status === 'CONFIRMED', 'Confirmed match lost its reservation.');
  assert((await creditsFor(fullPayments)) === 0, 'A confirmed match refunded players.');
  assert(
    (await service.decideGoNoGo(full.id, new Date(fullRecord.goNoGoAt!.getTime() + 1))).outcome === 'ALREADY_DECIDED',
    'Re-running a confirmed decision was not idempotent.',
  );

  // 6. Race: the last open position is claimed just before T-30 while the T-30 job runs.
  const outcomes = { confirmed: 0, cancelled: 0 };
  for (let round = 0; round < RACE_ROUNDS; round += 1) {
    const race = await createMatch();
    const lineup = players.slice(0, 10);
    const { payments, home } = await joinAndClaim(race.id, lineup, { home: 4, away: 5 });
    const record = await prisma.match.findUniqueOrThrow({ where: { id: race.id } });
    const lastSlot = home[4]!;
    const lastPlayer = lineup[8]!;
    const [claim, decision] = await Promise.allSettled([
      matches.claimPosition(race.id, lastSlot.id, lastPlayer, new Date(record.goNoGoAt!.getTime() - 1)),
      service.decideGoNoGo(race.id, record.goNoGoAt!),
    ]);
    assert(decision.status === 'fulfilled', `Round ${round}: go/no-go failed: ${String((decision as PromiseRejectedResult).reason)}`);
    const slot = await prisma.formationSlot.findUniqueOrThrow({ where: { id: lastSlot.id } });
    const after = await prisma.match.findUniqueOrThrow({ where: { id: race.id } });
    if (claim.status === 'fulfilled') {
      assert(decision.value.outcome === 'CONFIRMED' && after.confirmedAt && slot.participantId, `Round ${round}: claim won but match not confirmed.`);
      assert((await creditsFor(payments)) === 0, `Round ${round}: confirmed match refunded.`);
      outcomes.confirmed += 1;
    } else {
      assert(
        claim.reason instanceof MatchClosedError || claim.reason instanceof LineupLockedError,
        `Round ${round}: unexpected claim failure ${String(claim.reason)}`,
      );
      assert(decision.value.outcome === 'CANCELLED' && after.status === 'CANCELLED' && !slot.participantId, `Round ${round}: claim lost but match not cancelled cleanly.`);
      assert((await creditsFor(payments)) === 10, `Round ${round}: cancelled match did not refund all ten players once.`);
      outcomes.cancelled += 1;
    }
  }

  // 7. A claim at the go/no-go instant itself is locked out, and the match is cancelled.
  const boundary = await createMatch();
  const { home: boundaryHome } = await joinAndClaim(boundary.id, players.slice(0, 10), { home: 4, away: 5 });
  const boundaryRecord = await prisma.match.findUniqueOrThrow({ where: { id: boundary.id } });
  let lockedOut = false;
  try {
    await matches.claimPosition(boundary.id, boundaryHome[4]!.id, players[8]!, boundaryRecord.goNoGoAt!);
  } catch (error) {
    lockedOut = error instanceof LineupLockedError;
  }
  assert(lockedOut, 'A claim at exactly T-30 was not rejected with LineupLockedError.');
  assert((await service.decideGoNoGo(boundary.id, boundaryRecord.goNoGoAt!)).outcome === 'CANCELLED', 'Boundary match was not cancelled.');

  // 8. The lobby is frozen from T-30 (D1): join, leave, organiser moves and host cancel (D3).
  const frozen = await createMatch();
  const { home: frozenHome } = await joinAndClaim(frozen.id, players.slice(0, 2), { home: 1, away: 0 });
  await reachGoNoGo(frozen.id);
  const rejects = async (action: () => Promise<unknown>, code: string) => {
    try {
      await action();
      return false;
    } catch (error) {
      return (error as { code?: string }).code === code;
    }
  };
  assert(await rejects(() => service.join(frozen.id, players[5]!, { team: 'HOME' }, `${marker}:late-join`), 'LINEUP_LOCKED'), 'Join after T-30 was not rejected.');
  assert(await rejects(() => service.leave(frozen.id, players[0]!), 'LINEUP_LOCKED'), 'Leave after T-30 was not rejected.');
  assert(await rejects(() => service.updateFormation(frozen.id, frozenHome[0]!.id, { participantId: null }, hostId), 'LINEUP_LOCKED'), 'Organiser move after T-30 was not rejected.');
  assert(await rejects(() => service.remove(frozen.id, hostId), 'LINEUP_LOCKED'), 'Host cancel after T-30 was not rejected.');

  // 9. Host cancel before T-30 (D3): full refunds, host never charged, and a later T-30 run is a no-op.
  const hostCancelled = await createMatch();
  const { payments: hostCancelPayments } = await joinAndClaim(hostCancelled.id, players.slice(0, 2), { home: 1, away: 1 });
  await service.remove(hostCancelled.id, hostId);
  assert((await balanceOf(hostId)) === 0, 'Host cancellation charged the host.');
  assert((await creditsFor(hostCancelPayments)) === 2, 'Host cancellation did not refund both players.');
  const hostCancelRecord = await prisma.match.findUniqueOrThrow({ where: { id: hostCancelled.id } });
  assert(hostCancelRecord.cancellationReason === 'ORGANISER_CANCELLED', 'Host cancellation reason not recorded.');
  assert((await service.decideGoNoGo(hostCancelled.id, hostCancelRecord.goNoGoAt!)).outcome === 'ALREADY_DECIDED', 'T-30 ran again after host cancel.');
  assert((await creditsFor(hostCancelPayments)) === 2, 'Host cancel plus T-30 refunded twice.');
  // Part 4a: host cancel alerts both players and the host once each, including after the T-30 re-run.
  const hostCancelWording = await expectedCancellation(hostCancelled.id, 'ORGANISER_CANCELLED');
  await assertCancellationAlertsOnce(hostCancelled.id, [...players.slice(0, 2), hostId], (userId) => hostCancelWording(userId), 'Host cancel');

  // 10. D2: a player who left within 12 hours (no credit) is refunded if the match is auto-cancelled.
  let lateMatch: Awaited<ReturnType<typeof createMatch>> | undefined;
  for (let offset = 150; offset <= 11 * 60 && !lateMatch; offset += 30) {
    const candidate = new Date(Date.now() + offset * 60_000);
    candidate.setUTCMinutes(candidate.getUTCMinutes() >= 30 ? 30 : 0, 0, 0);
    try {
      lateMatch = await createMatch('FIVE_A_SIDE', candidate);
    } catch {
      // Not bookable (for example crossing local midnight); try the next half hour.
    }
  }
  assert(lateMatch, 'Could not create a match within 12 hours of kickoff.');
  const { payments: latePayments } = await joinAndClaim(lateMatch.id, [players[11]!], { home: 0, away: 0 });
  await matches.cancelParticipation(lateMatch.id, players[11]!, new Date());
  const lateBefore = await balanceOf(players[11]!);
  const latePayment = await prisma.matchPayment.findUniqueOrThrow({ where: { id: latePayments[0]! } });
  assert(latePayment.status === 'SUCCEEDED', 'A late leaver should have received no initial credit.');
  const lateRecord = await prisma.match.findUniqueOrThrow({ where: { id: lateMatch.id } });
  await service.decideGoNoGo(lateMatch.id, lateRecord.goNoGoAt!);
  assert((await balanceOf(players[11]!)) === lateBefore + MATCH_FEE_CENTS, 'Late leaver was not refunded on auto-cancel.');

  // 11. The ledger still reconciles for every smoke wallet.
  const report = await new WalletReconciliationService().report();
  const ours = report.issues.filter((issue) => issue.userId && userIds.includes(issue.userId));
  assert(ours.length === 0, `Wallet reconciliation found issues: ${JSON.stringify(ours)}`);

  console.log(
    `DEC-018 go/no-go smoke test passed (race rounds: ${outcomes.confirmed} confirmed, ${outcomes.cancelled} cancelled).`,
  );
}

async function cleanup() {
  const reservationIds = (
    await prisma.fieldReservation.findMany({ where: { matchId: { in: matchIds } }, select: { id: true } })
  ).map(({ id }) => id);
  await prisma.durableJob.deleteMany({
    where: {
      OR: [
        ...matchIds.map((id) => ({ dedupeKey: goNoGoJobDedupeKey(id) })),
        ...matchIds.map((id) => ({ dedupeKey: { startsWith: `match-cancelled-email:${id}:` } })),
        ...reservationIds.map((id) => ({ dedupeKey: `reservation-expire:${id}` })),
      ],
    },
  });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.fieldReservation.deleteMany({ where: { id: { in: reservationIds } } });
  const venueIds = (
    await prisma.match.findMany({ where: { id: { in: matchIds } }, select: { venueId: true } })
  ).map(({ venueId: id }) => id);
  await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
  await prisma.walletHold.deleteMany({ where: { walletAccount: { userId: { in: userIds } } } });
  await prisma.walletTransaction.deleteMany({ where: { walletAccount: { userId: { in: userIds } } } });
  if (venueId) {
    await prisma.managedFieldPrice.deleteMany({ where: { field: { venueId } } });
    await prisma.venueCancellationPolicy.deleteMany({ where: { venueId } });
    await prisma.managedField.deleteMany({ where: { venueId } });
    await prisma.managedVenue.update({ where: { id: venueId }, data: { publicationStatus: 'DRAFT', submittedByUserId: null, submittedAt: null, approvedByUserId: null, approvedAt: null } });
    await prisma.managedVenue.delete({ where: { id: venueId } });
  }
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  assert((await prisma.user.count({ where: { email: { startsWith: marker } } })) === 0, 'Smoke users remained.');
  assert((await prisma.match.count({ where: { id: { in: matchIds } } })) === 0, 'Smoke matches remained.');
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
