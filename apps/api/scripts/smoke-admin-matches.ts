import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { FOOTYFINDER_HOST_ID } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { AdminMatchesService } from '../src/modules/matches/admin-matches.service.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { createVenuePayableForStartedMatch } from '../src/modules/settlement/venue-payables.js';
import { managedVenueFixture } from './managed-venue-fixture.js';
import { socialWorld } from './social-fixtures.js';
import { buyTicket } from './support/ticket-fixtures.js';

/**
 * CEO touch-up batch 3.5, item 5 on PostgreSQL: an admin creates a Quick Match that FootyFinder hosts. It is booked
 * like a player's match (the 2-hour/60-day window, closures, the reservation), can be free (R0) and first-time
 * only from the start, gives a private match a working invite link, never joins the admin, never exposes the
 * admin to players, gives the admin no host powers in the player app, and its venue payable is raised at
 * kick-off as normal. The list and match page show it with players and money.
 */
const world = socialWorld(`adm-${randomUUID().slice(0, 8)}`);
const venue = managedVenueFixture(world.marker);
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const rejectsWith = async (work: () => Promise<unknown>, code: string) => {
  try {
    await work();
    return false;
  } catch (error) {
    return (error as { code?: string }).code === code;
  }
};
const bookings = new BookingsService();
const matches = new MatchesService();
const admin = new AdminMatchesService();
const base = { format: 'FIVE_A_SIDE' as const, substituteCapacityPerTeam: 2, rollingSubstitutes: false, rules: [], freeOnFootyFinder: false, firstTimersOnly: false };

try {
  await venue.create();
  const adminUser = await prisma.user.create({ data: { email: `admin-${world.marker}@smoke.invalid`, username: `am_${randomUUID().slice(0, 10)}`, passwordHash: 'smoke-test-only', platformRole: 'ADMIN' } });
  const rookie = await world.player('Rookie');
  const veteran = await world.player('Veteran');
  await world.finishedMatch([veteran.id], []);
  const input = (name: string, extra: Partial<typeof base & { visibility: 'PUBLIC' | 'PRIVATE'; startsAt: string }> = {}) => ({
    ...base, managedFieldId: venue.fieldId, name: `${world.marker} ${name}`, visibility: 'PUBLIC' as const, startsAt: venue.nextKickoff().toISOString(), ...extra,
  });

  // A free, first-timers-only public match: R0, booked with the venue, hosted by FootyFinder, admin not joined.
  const created = await bookings.createAdminMatch(input('free night', { freeOnFootyFinder: true, firstTimersOnly: true }), adminUser.id, world.marker);
  world.matchIds.push(created.matchId);
  const row = await prisma.match.findUniqueOrThrow({ where: { id: created.matchId }, include: { fieldReservation: true, participants: true } });
  assert(row.hostedByFootyFinder && row.freeOnFootyFinder && row.firstTimersOnly && row.feeCents === 0, 'The admin match was not free, first-timers only and hosted by FootyFinder.');
  assert(row.fieldReservation?.source === 'ADMIN_LOADED' && row.fieldReservation.status === 'CONFIRMED' && row.fieldReservation.priceCentsSnapshot === 50_000, 'The admin match was not booked with the venue.');
  assert(row.participants.length === 0, 'The admin was joined to the match.');
  assert(created.publicUrl && !created.inviteUrl, 'A public match should have a public page and no invite link.');
  const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { requestId: world.marker, action: 'MATCH_LOADED' } });
  assert((audit.metadata as { freeOnFootyFinder?: boolean }).freeOnFootyFinder === true, 'Creating the match was not audited with its free flag.');

  // Players: the veteran is refused, the rookie joins for R0. Nobody sees the admin; the admin has no host powers.
  assert(await rejectsWith(() => buyTicket(created.matchId, veteran.id, 'HOME', `${world.marker}-vet`), 'FIRST_TIMERS_ONLY'), 'A player who has played joined a first-timers match.');
  await buyTicket(created.matchId, rookie.id, 'HOME', `${world.marker}-rookie`);
  assert((await prisma.matchPayment.findFirstOrThrow({ where: { matchId: created.matchId, userId: rookie.id } })).amountCents === 0, 'The player did not join for R0.');
  const seen = await matches.get(created.matchId, rookie.id);
  assert(seen.hostedByFootyFinder && seen.createdById === FOOTYFINDER_HOST_ID && !seen.createdBy, 'Players can see who created a FootyFinder match.');
  assert(!JSON.stringify(seen).includes(adminUser.id), 'The admin\'s id reached a player.');
  const asAdmin = await matches.get(created.matchId, adminUser.id);
  assert(!asAdmin.viewerCanManage, 'The admin got host powers in the player app.');
  assert(await rejectsWith(() => matches.update(created.matchId, { name: `${world.marker} renamed` }, adminUser.id), 'HOST_REQUIRED'), 'The admin could act as host in the player app.');
  assert((await prisma.notification.count({ where: { userId: adminUser.id } })) === 0, 'The admin got a host notification.');

  // A private match gets an invite link that works, and a new one replaces it.
  const privateMatch = await bookings.createAdminMatch(input('private', { visibility: 'PRIVATE' }), adminUser.id, world.marker);
  world.matchIds.push(privateMatch.matchId);
  assert(privateMatch.inviteUrl && !privateMatch.publicUrl, 'A private match got no invite link.');
  const token = privateMatch.inviteUrl.split('/').pop()!;
  assert((await matches.getByInvite(token)).id === privateMatch.matchId, 'The invite link does not open the match.');
  const rotated = await admin.rotateInvite(privateMatch.matchId, adminUser.id, world.marker);
  assert(await matches.getByInvite(token).then(() => false, () => true), 'The old invite link still works.');
  assert((await matches.getByInvite(rotated.inviteUrl.split('/').pop()!)).id === privateMatch.matchId, 'The new invite link does not work.');

  // Same booking rules as players: the 2-hour window, and closures.
  assert(await rejectsWith(() => bookings.createAdminMatch(input('too soon', { startsAt: new Date(Date.now() + 90 * 60_000).toISOString() }), adminUser.id), 'MATCH_START_TIME_INVALID'), 'An admin match 90 minutes away was allowed.');
  const closedAt = venue.nextKickoff();
  await prisma.managedFieldClosure.create({ data: { fieldId: venue.fieldId, kind: 'ONE_OFF', startsAt: new Date(closedAt.getTime() - 3_600_000), endsAt: new Date(closedAt.getTime() + 3 * 3_600_000), reason: 'Smoke closure', createdByUserId: adminUser.id } });
  assert(await rejectsWith(() => bookings.createAdminMatch(input('closed', { startsAt: closedAt.toISOString() }), adminUser.id), 'FIELD_CLOSED'), 'An admin match was booked into a closure.');

  // The list and the match page.
  const listed = await admin.list({ view: 'upcoming', q: world.marker });
  assert(listed.matches.some((match) => match.matchId === created.matchId && match.hostName === 'FootyFinder' && match.filled === 1), 'The match list does not show the admin match.');
  const page = await admin.detail(created.matchId);
  assert(page.hostedByFootyFinder && page.players.length === 1 && page.money.feesTakenCents === 0 && page.money.promotionalCostCents === 8_000, 'The match page money is wrong.');
  assert(page.money.venue.kind === 'EXPECTED' && page.money.venue.amountCents === 50_000 && page.canBeMadeFree === false && page.cancellable, 'The match page venue cost or actions are wrong.');

  // At kick-off the venue payable is raised as for any match that went ahead.
  await prisma.match.update({ where: { id: created.matchId }, data: { status: 'IN_PROGRESS', confirmedAt: new Date() } });
  const payable = await prisma.$transaction((tx) => createVenuePayableForStartedMatch(tx, created.matchId));
  assert(payable?.amountCents === 50_000 && payable.status === 'DUE', 'The venue payable was not raised at kick-off.');
  console.log('Admin matches smoke passed: an admin creates a FootyFinder-hosted match on a real slot (2-hour window, closures, reservation), free and first-time only from the start (R0, veterans refused), audited, never joined, the admin hidden from players and without host powers, private invite links work and can be replaced, the list and match page show players and money, and the venue payable is raised at kick-off.');
} finally {
  await prisma.managedFieldClosure.deleteMany({ where: { fieldId: venue.fieldId || undefined, reason: 'Smoke closure' } }).catch(() => undefined);
  await venue.cleanupMatches(world.matchIds);
  await prisma.walletTransaction.deleteMany({ where: { walletAccount: { userId: { in: world.userIds } } } }).catch(() => undefined);
  await venue.cleanupVenue().catch((error) => console.error('venue cleanup failed', error));
  await world.cleanup().catch((error) => console.error('cleanup failed', error));
  await prisma.$disconnect();
}
