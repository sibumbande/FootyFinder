import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { MATCH_FEE_CENTS } from '@footy-finder/shared';
import { app } from '../src/app.js';
import { allowedOrigins } from '../src/config/cors.js';
import { prisma } from '../src/database/prisma.js';
import { serializableTransaction } from '../src/database/transaction.js';
import { SessionsService } from '../src/modules/auth/sessions.service.js';
import { TestEmailProvider } from '../src/modules/auth/email.provider.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { MatchesRepository } from '../src/modules/matches/matches.repository.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { refereeUnassignedAlertDedupeKey } from '../src/modules/referees/referee-assignment.js';
import { RefereeJobs } from '../src/modules/referees/referee.jobs.js';
import { FinancialRepository } from '../src/modules/wallet/financial.repository.js';
import { managedVenueFixture } from './managed-venue-fixture.js';
import { buyTicket } from './support/ticket-fixtures.js';

/**
 * Gate 8 smoke (DEC-020): the FootyFinder referee role (TKT-801) and referee assignment (TKT-802):
 * default referee auto-assignment (D28), the double-booking rule (D27), a referee who also plays
 * (D17 reversed), decline (D16), removal, admin alerts (D2) and the T-30 NO_REFEREE no-go.
 * Admins (users with audit rows) are kept in the disposable test database, as in the Gate 6 smokes:
 * AdminAuditLog is append-only by design.
 */
const marker = `g8-referees-${randomUUID().slice(0, 8)}`;
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const sessions = new SessionsService();
const bookings = new BookingsService();
const matchesRepository = new MatchesRepository();
const matchesService = new MatchesService();
const financial = new FinancialRepository();
const emails = new TestEmailProvider();
const jobs = new RefereeJobs(undefined, emails);
const venueA = managedVenueFixture(`${marker}-a`);
const venueB = managedVenueFixture(`${marker}-b`);
const venueC = managedVenueFixture(`${marker}-c`);
const origin = allowedOrigins[0]!;
const userIds: string[] = [];
const matchIds: string[] = [];
let previousDefaultRefereeUserId: string | null = null;

const user = async (label: string, extra: { platformRole?: 'ADMIN' } = {}) => {
  const created = await prisma.user.create({
    data: {
      email: `${marker}-${label}@smoke.invalid`,
      username: `${marker.slice(-8)}_${label}`,
      passwordHash: 'smoke-test-only',
      emailVerifiedAt: new Date(),
      onboardingCompletedAt: new Date(),
      profile: { create: { displayName: `${label} ${marker.slice(-4)}` } },
      walletAccount: { create: { currency: 'ZAR' } },
      ...extra,
    },
  });
  if (!extra.platformRole) userIds.push(created.id);
  return created;
};

/** A signed-in admin cookie whose MFA check happened `mfaAgeMinutes` ago. */
const adminCookie = async (adminId: string, mfaAgeMinutes: number) => {
  const session = await sessions.issue(adminId, { userAgent: marker });
  await prisma.authSession.update({
    where: { id: session.sessionId },
    data: { adminVerifiedAt: new Date(Date.now() - mfaAgeMinutes * 60_000) },
  });
  return `footy_finder_session=${session.token}`;
};
const cookieFor = async (userId: string) => `footy_finder_session=${(await sessions.issue(userId, {})).token}`;
const post = (path: string, cookie: string, body: object) =>
  request(app).post(path).set('Origin', origin).set('Cookie', cookie).send(body);
const put = (path: string, cookie: string, body: object) =>
  request(app).put(path).set('Origin', origin).set('Cookie', cookie).send(body);

const fund = (userId: string, index: number) =>
  serializableTransaction((tx) =>
    financial.credit(tx, { userId, amountCents: 50_000, type: 'DEPOSIT_CREDIT', idempotencyKey: `${marker}:seed:${index}`, referenceType: 'SMOKE', referenceId: marker }),
  );

const publishQuickMatch = async (venue: ReturnType<typeof managedVenueFixture>, startsAt: Date, hostId: string, label: string) => {
  const match = await bookings.createQuickMatch(
    { managedFieldId: venue.fieldId, name: `${marker}-${label}`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 5, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: startsAt.toISOString() },
    hostId,
  );
  matchIds.push(match.id);
  return prisma.match.findUniqueOrThrow({ where: { id: match.id } });
};
const history = (matchId: string) => prisma.matchRefereeAssignment.findMany({ where: { matchId }, orderBy: { createdAt: 'asc' } });
const runNotices = async (matchId: string) => {
  for (const entry of await history(matchId)) await jobs.notice({ assignmentId: entry.id });
};

async function roleSection(admin: { id: string }, fresh: string, stale: string) {
  const referee = await user('ref');
  const player = await user('player');
  // TKT-801: granting needs a fresh MFA check (D25) and a written reason.
  const staleGrant = await post(`/admin/referees/${referee.id}`, stale, { reason: 'Qualified referee' });
  assert(staleGrant.status === 403 && staleGrant.body.code === 'ADMIN_MFA_REVERIFY_REQUIRED', 'Referee grant did not require fresh MFA.');
  const noReason = await post(`/admin/referees/${referee.id}`, fresh, { reason: '' });
  assert(noReason.status === 400, 'Referee grant accepted an empty reason.');
  const granted = await post(`/admin/referees/${referee.id}`, fresh, { reason: 'Qualified referee' });
  assert(granted.status === 201 && granted.body.data.userId === referee.id, 'Admin could not grant the referee role.');
  const again = await post(`/admin/referees/${referee.id}`, fresh, { reason: 'Qualified referee' });
  assert(again.status === 409 && again.body.code === 'ALREADY_REFEREE', 'A second active referee grant was allowed.');
  const list = await request(app).get('/admin/referees').set('Cookie', fresh);
  assert(list.status === 200 && list.body.data.some((row: { userId: string }) => row.userId === referee.id), 'Referee missing from the admin list.');

  // A referee sees isReferee on their own account; an ordinary player does not.
  const refereeCookie = await cookieFor(referee.id);
  const playerCookie = await cookieFor(player.id);
  assert((await request(app).get('/users/me').set('Cookie', refereeCookie)).body.data.isReferee === true, 'Referee account did not report isReferee.');
  assert((await request(app).get('/users/me').set('Cookie', playerCookie)).body.data.isReferee === false, 'Ordinary player reported isReferee.');
  // Only admins may manage referees.
  const byPlayer = await post(`/admin/referees/${player.id}`, playerCookie, { reason: 'Self promotion' });
  assert(byPlayer.status === 403, 'A non-admin could grant the referee role.');

  // Grants are permanent: only an active grant can be revoked, once, and never edited.
  let tamperBlocked = false;
  try {
    await prisma.$executeRaw`UPDATE "RefereeGrant" SET "grantReason" = 'tampered' WHERE "userId" = ${referee.id}::uuid`;
  } catch (error) {
    tamperBlocked = String(error).includes('referee grants are permanent');
  }
  assert(tamperBlocked, 'The database allowed a referee grant to be edited.');
  const staleRevoke = await post(`/admin/referees/${referee.id}/revoke`, stale, { reason: 'Stepped down' });
  assert(staleRevoke.status === 403, 'Referee revoke did not require fresh MFA.');
  const revoked = await post(`/admin/referees/${referee.id}/revoke`, fresh, { reason: 'Stepped down' });
  assert(revoked.status === 200, 'Admin could not revoke the referee role.');
  const revokedAgain = await post(`/admin/referees/${referee.id}/revoke`, fresh, { reason: 'Stepped down' });
  assert(revokedAgain.status === 404 && revokedAgain.body.code === 'NOT_A_REFEREE', 'A revoked grant was revoked twice.');
  assert((await request(app).get('/users/me').set('Cookie', refereeCookie)).body.data.isReferee === false, 'Revoked referee still reported isReferee.');
  // Re-granting creates a new permanent row and keeps the old one.
  assert((await post(`/admin/referees/${referee.id}`, fresh, { reason: 'Returned to refereeing' })).status === 201, 'Re-grant failed.');
  assert((await prisma.refereeGrant.count({ where: { userId: referee.id } })) === 2, 'Referee grant history was not kept.');
  const audits = await prisma.adminAuditLog.findMany({ where: { actorUserId: admin.id, entityId: referee.id }, select: { action: true } });
  assert(
    audits.filter(({ action }) => action === 'REFEREE_GRANTED').length === 2 && audits.filter(({ action }) => action === 'REFEREE_REVOKED').length === 1,
    'Referee role changes were not audited.',
  );
  // A restricted account cannot be made a referee.
  await prisma.user.update({ where: { id: player.id }, data: { accountStatus: 'SUSPENDED' } });
  const restricted = await post(`/admin/referees/${player.id}`, fresh, { reason: 'Qualified referee' });
  assert(restricted.status === 409 && restricted.body.code === 'REFEREE_ACCOUNT_RESTRICTED', 'A suspended account was made a referee.');
}

async function assignmentSection(admin: { id: string }, fresh: string, stale: string) {
  const refA = await user('refa');
  const refB = await user('refb');
  const host = await user('host');
  const players = [];
  for (let index = 0; index < 10; index += 1) players.push(await user(`p${index}`));
  for (const [index, player] of [refB, ...players].entries()) await fund(player.id, index);
  for (const referee of [refA, refB])
    assert((await post(`/admin/referees/${referee.id}`, fresh, { reason: 'Match official' })).status === 201, 'Could not grant a referee.');
  await venueA.create();
  await venueB.create();
  await venueC.create();

  // D28: setting the default referee needs a fresh MFA check and an active referee.
  assert((await put('/admin/referee-settings', stale, { defaultRefereeUserId: refA.id })).status === 403, 'Default referee change did not need fresh MFA.');
  const notReferee = await put('/admin/referee-settings', fresh, { defaultRefereeUserId: host.id });
  assert(notReferee.status === 409 && notReferee.body.code === 'REFEREE_NOT_ACTIVE', 'A non-referee became the default referee.');
  const setDefault = await put('/admin/referee-settings', fresh, { defaultRefereeUserId: refA.id });
  assert(setDefault.status === 200 && setDefault.body.data.defaultReferee.userId === refA.id, 'Default referee was not saved.');
  assert(await prisma.adminAuditLog.count({ where: { actorUserId: admin.id, action: 'DEFAULT_REFEREE_SET' } }), 'Default referee change was not audited.');

  // D28: a published match is auto-assigned to the default referee when they are free.
  const kickoff = venueA.nextKickoff();
  const m1 = await publishQuickMatch(venueA, kickoff, host.id, 'm1');
  assert(m1.refereeUserId === refA.id && m1.refereeAssignedAt, 'Default referee was not auto-assigned.');
  const m1History = await history(m1.id);
  assert(m1History.length === 1 && m1History[0]!.action === 'AUTO_ASSIGNED' && m1History[0]!.actorUserId === null, 'Auto-assignment was not recorded.');
  assert(!(await prisma.durableJob.findUnique({ where: { dedupeKey: refereeUnassignedAlertDedupeKey(m1.id, 'published') } })), 'An auto-assigned match alerted admins.');
  assert(await prisma.durableJob.findUnique({ where: { dedupeKey: refereeUnassignedAlertDedupeKey(m1.id, 't-24h') } }), 'The kickoff -24h check was not scheduled.');
  await runNotices(m1.id);
  const assignedNotice = await prisma.notification.findFirst({ where: { userId: refA.id, type: 'REFEREE_ASSIGNED' } });
  assert(assignedNotice?.targetPath === '/referee', 'The referee was not told about the assignment.');
  const noticeEmail = await prisma.durableJob.findFirst({ where: { type: 'REFEREE_EMAIL', dedupeKey: { startsWith: `referee-email:REFEREE_ASSIGNED:${m1.id}:` } } });
  assert(noticeEmail, 'The assignment email was not queued.');
  await jobs.email(noticeEmail.payload);
  assert(emails.messages.some(({ to, subject }) => to === `${marker}-refa@smoke.invalid` && subject === 'You have a match to referee'), 'The assignment email was not sent.');
  await runNotices(m1.id);
  assert((await prisma.notification.count({ where: { userId: refA.id, type: 'REFEREE_ASSIGNED' } })) === 1, 'The assignment notice was duplicated.');

  // D28 + D27: at the same time on another venue the default referee is busy, so the match is
  // unassigned and every admin is alerted straight away (once).
  const m2 = await publishQuickMatch(venueB, kickoff, host.id, 'm2');
  assert(m2.refereeUserId === null, 'A busy default referee was double-booked.');
  const published = await prisma.durableJob.findUnique({ where: { dedupeKey: refereeUnassignedAlertDedupeKey(m2.id, 'published') } });
  assert(published, 'Admins were not alerted about an unassigned match.');
  await jobs.alertUnassigned(published.payload);
  await jobs.alertUnassigned(published.payload);
  assert((await prisma.notification.count({ where: { userId: admin.id, type: 'ADMIN_ALERT', message: { contains: m2.name } } })) === 1, 'The admin alert was missing or duplicated.');
  const adminEmail = await prisma.durableJob.findFirst({ where: { type: 'REFEREE_EMAIL', dedupeKey: `referee-email:ADMIN_REFEREE_UNASSIGNED:${m2.id}:published:${admin.id}` } });
  assert(adminEmail, 'The admin alert email was not queued.');
  const unassignedView = await request(app).get('/admin/referee-matches?view=unassigned').set('Cookie', fresh);
  assert(unassignedView.body.data.some((row: { matchId: string }) => row.matchId === m2.id), 'Unassigned view is missing the match.');
  assert(!unassignedView.body.data.some((row: { matchId: string }) => row.matchId === m1.id), 'Unassigned view listed an assigned match.');

  // D27: the admin panel shows the busy referee and the clash; assigning them is refused.
  const options = await request(app).get(`/admin/matches/${m2.id}/referee-options`).set('Cookie', fresh);
  const optionA = options.body.data.find((row: { userId: string }) => row.userId === refA.id);
  const optionB = options.body.data.find((row: { userId: string }) => row.userId === refB.id);
  assert(optionA?.busy && optionA.clash?.matchId === m1.id && optionA.isDefault, 'The busy default referee was not flagged.');
  assert(optionB && !optionB.busy, 'A free referee was flagged busy.');
  const clash = await put(`/admin/matches/${m2.id}/referee`, fresh, { refereeUserId: refA.id });
  assert(clash.status === 409 && clash.body.code === 'REFEREE_BUSY' && clash.body.details.clash.matchId === m1.id, 'An overlapping assignment was not refused.');
  const notARef = await put(`/admin/matches/${m2.id}/referee`, fresh, { refereeUserId: host.id });
  assert(notARef.status === 409 && notARef.body.code === 'REFEREE_NOT_ACTIVE', 'A non-referee was assigned.');

  // D17 (reversed): a referee may also play in the match they referee.
  await buyTicket(m2.id, refB.id, 'HOME', `${marker}:join:${m2.id}:${refB.id}`);
  const assignB = await put(`/admin/matches/${m2.id}/referee`, fresh, { refereeUserId: refB.id });
  assert(assignB.status === 200 && assignB.body.data.referee.id === refB.id, 'A referee in the lineup could not be assigned.');
  assert(await prisma.matchParticipant.count({ where: { matchId: m2.id, userId: refB.id, status: 'JOINED' } }), 'Assigning the referee removed them from the lineup.');
  // Players see the referee's display name (D18).
  const hostView = await request(app).get(`/matches/${m2.id}`).set('Cookie', await cookieFor(host.id));
  assert(hostView.body.data.referee?.id === refB.id && hostView.body.data.referee.displayName, 'Players cannot see the referee.');
  assert(!JSON.stringify(hostView.body.data.referee).includes('@'), 'The match page exposed referee contact details.');

  // D27: back-to-back matches are fine once the travel buffer has passed (kickoff to end + 30 min).
  const m3 = await publishQuickMatch(venueC, new Date(kickoff.getTime() + 90 * 60_000), host.id, 'm3');
  assert(m3.refereeUserId === refA.id, 'A back-to-back match was not auto-assigned to the free default referee.');

  // D16: the referee declines until T-30; the match is unassigned again and admins are alerted.
  const refACookie = await cookieFor(refA.id);
  const wrongDecline = await post(`/referee/matches/${m1.id}/decline`, await cookieFor(refB.id), {});
  assert(wrongDecline.status === 404, 'Someone other than the referee declined.');
  const declined = await post(`/referee/matches/${m1.id}/decline`, refACookie, { reason: 'Travelling' });
  assert(declined.status === 200, 'The referee could not decline.');
  const afterDecline = await prisma.match.findUniqueOrThrow({ where: { id: m1.id } });
  const declineEntry = (await history(m1.id)).at(-1)!;
  assert(afterDecline.refereeUserId === null && declineEntry.action === 'DECLINED' && declineEntry.actorUserId === refA.id, 'Decline was not recorded.');
  assert(await prisma.durableJob.findUnique({ where: { dedupeKey: refereeUnassignedAlertDedupeKey(m1.id, declineEntry.id) } }), 'Admins were not alerted about the decline.');
  const lateDecline = await (async () => {
    await prisma.match.update({ where: { id: m3.id }, data: { goNoGoAt: new Date(Date.now() - 60_000) } });
    const response = await post(`/referee/matches/${m3.id}/decline`, refACookie, {});
    await prisma.match.update({ where: { id: m3.id }, data: { goNoGoAt: new Date(m3.startsAt.getTime() - 30 * 60_000) } });
    return response;
  })();
  assert(lateDecline.status === 409 && lateDecline.body.code === 'REFEREE_DECLINE_CLOSED', 'A referee declined after T-30.');

  // An admin removal needs a reason, is audited, and tells the referee.
  assert((await post(`/admin/matches/${m2.id}/referee/remove`, fresh, { reason: '' })).status === 400, 'A removal without a reason was accepted.');
  const removed = await post(`/admin/matches/${m2.id}/referee/remove`, fresh, { reason: 'Referee unwell' });
  assert(removed.status === 200 && removed.body.data.referee === null, 'The admin could not remove the referee.');
  assert(await prisma.adminAuditLog.count({ where: { actorUserId: admin.id, action: 'REFEREE_REMOVED', entityId: m2.id } }), 'The removal was not audited.');
  await runNotices(m2.id);
  assert(await prisma.notification.count({ where: { userId: refB.id, type: 'REFEREE_UNASSIGNED' } }), 'The removed referee was not told.');
  let historyImmutable = false;
  try {
    await prisma.$executeRaw`UPDATE "MatchRefereeAssignment" SET "reason" = 'tampered' WHERE "matchId" = ${m2.id}::uuid`;
  } catch (error) {
    historyImmutable = String(error).includes('referee assignment history is permanent');
  }
  assert(historyImmutable, 'Referee assignment history could be edited.');

  // D2 + D23: at T-30 a full match with no referee is cancelled (NO_REFEREE) and refunded once;
  // an unfilled match without a referee keeps the players' own reason.
  const m5 = await publishQuickMatch(venueB, venueA.nextKickoff(), host.id, 'm5');
  assert(m5.refereeUserId === refA.id, 'The free default referee was not auto-assigned.');
  assert((await post(`/admin/matches/${m5.id}/referee/remove`, fresh, { reason: 'Testing no referee' })).status === 200, 'Could not remove the referee.');
  const slots = await prisma.formationSlot.findMany({ where: { matchId: m5.id }, orderBy: [{ team: 'asc' }, { slotIndex: 'asc' }] });
  for (const [index, player] of players.entries()) {
    const slot = slots[index]!;
    await buyTicket(m5.id, player.id, slot.team, `${marker}:join:${m5.id}:${player.id}`);
    await matchesRepository.claimPosition(m5.id, slot.id, player.id);
  }
  const noReferee = await matchesService.decideGoNoGo(m5.id, m5.goNoGoAt!);
  assert(noReferee.outcome === 'CANCELLED', 'A full match with no referee went ahead.');
  const cancelledM5 = await prisma.match.findUniqueOrThrow({ where: { id: m5.id } });
  assert(cancelledM5.cancellationReason === 'NO_REFEREE', `Wrong cancellation reason: ${cancelledM5.cancellationReason}`);
  assert((await matchesService.decideGoNoGo(m5.id, m5.goNoGoAt!)).outcome === 'ALREADY_DECIDED', 'The no-go ran twice.');
  const payments = await prisma.matchPayment.findMany({ where: { matchId: m5.id }, select: { id: true } });
  const credits = await prisma.walletTransaction.findMany({ where: { type: 'MATCH_CANCELLATION_CREDIT', referenceId: { in: payments.map(({ id }) => id) } } });
  assert(credits.length === 10 && credits.every(({ amountCents }) => amountCents === MATCH_FEE_CENTS), 'Players were not refunded exactly once.');
  const cancelNotice = await prisma.notification.findFirst({ where: { userId: players[0]!.id, type: 'MATCH_CANCELLED', targetPath: `/matches/${m5.id}` } });
  assert(cancelNotice?.message.includes('because no FootyFinder referee was available'), 'The cancellation did not explain the missing referee.');
  const unfilled = await matchesService.decideGoNoGo(m2.id, m2.goNoGoAt!);
  assert(unfilled.outcome === 'CANCELLED', 'An unfilled match went ahead.');
  assert((await prisma.match.findUniqueOrThrow({ where: { id: m2.id } })).cancellationReason === 'POSITIONS_UNFILLED', 'D23: the players\' reason was not given first.');

  // Revoking the role takes the referee off unfinished matches and clears them as the default.
  assert((await prisma.match.findUniqueOrThrow({ where: { id: m3.id } })).refereeUserId === refA.id, 'Setup: refA should referee m3.');
  const revokeA = await post(`/admin/referees/${refA.id}/revoke`, fresh, { reason: 'No longer refereeing' });
  assert(revokeA.status === 200, `Revoke failed: ${JSON.stringify(revokeA.body)}`);
  const m3After = await prisma.match.findUniqueOrThrow({ where: { id: m3.id } });
  assert(m3After.refereeUserId === null && (await history(m3.id)).at(-1)!.action === 'ROLE_REVOKED', 'A revoked referee kept their match.');
  const settings = await prisma.refereeSettings.findUniqueOrThrow({ where: { id: 1 } });
  assert(settings.defaultRefereeUserId === null, 'A revoked referee stayed the default referee.');
}

async function main() {
  previousDefaultRefereeUserId = (await prisma.refereeSettings.findUniqueOrThrow({ where: { id: 1 } })).defaultRefereeUserId;
  const admin = await user('admin', { platformRole: 'ADMIN' });
  const fresh = await adminCookie(admin.id, 1);
  const stale = await adminCookie(admin.id, 20);
  await roleSection(admin, fresh, stale);
  // A second admin, so the per-user costly-action rate limit (20 a minute) is not hit.
  const opsAdmin = await user('ops', { platformRole: 'ADMIN' });
  await assignmentSection(opsAdmin, await adminCookie(opsAdmin.id, 1), await adminCookie(opsAdmin.id, 20));
  console.log(
    'Gate 8 referees smoke passed: referee role (fresh MFA, reasons, permanent audited history, isReferee), default referee auto-assign (D28), '
      + 'double-booking refusal and busy flag (D27), referee also in the lineup (D17), decline (D16), removal, admin alerts once, '
      + 'T-30 NO_REFEREE no-go with one refund each, D23 reason order, and revocation unassigning.',
  );
}

async function cleanup() {
  await prisma.refereeSettings.update({ where: { id: 1 }, data: { defaultRefereeUserId: previousDefaultRefereeUserId } });
  const entries = await prisma.matchRefereeAssignment.findMany({ where: { matchId: { in: matchIds } }, select: { id: true } });
  await prisma.durableJob.deleteMany({ where: { dedupeKey: { in: entries.map(({ id }) => `referee-notice:${id}`) } } });
  await venueA.cleanupMatches(matchIds);
  await prisma.matchPayment.deleteMany({ where: { matchId: { in: matchIds } } });
  const venueIds = (await prisma.match.findMany({ where: { id: { in: matchIds } }, select: { venueId: true } })).map(({ venueId }) => venueId);
  await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
  await venueA.cleanupVenue();
  await venueB.cleanupVenue();
  await venueC.cleanupVenue();
  await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { message: { contains: marker } }] } });
  await prisma.walletHold.deleteMany({ where: { walletAccount: { userId: { in: userIds } } } });
  await prisma.walletTransaction.deleteMany({ where: { walletAccount: { userId: { in: userIds } } } });
  await prisma.refereeGrant.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
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
