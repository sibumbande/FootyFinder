import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { DELETED_PLAYER_MESSAGE, DELETED_PLAYER_NAME, getDefaultFormationKey } from '@footy-finder/shared';
import argon2 from 'argon2';
import { prisma } from '../src/database/prisma.js';
import { serializableTransaction } from '../src/database/transaction.js';
import { AccountDeletionFinaliser } from '../src/modules/account/account-deletion.finalise.js';
import { AccountDeletionService } from '../src/modules/account/account-deletion.service.js';
import { TestEmailProvider } from '../src/modules/auth/email.provider.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { MessagingService } from '../src/modules/messaging/messaging.service.js';
import { CardRefundsService } from '../src/modules/payments/card-refunds.service.js';
import { PaymentDisputesService } from '../src/modules/payments/payment-disputes.service.js';
import { PaystackClient } from '../src/modules/payments/paystack.client.js';
import { FriendsService } from '../src/modules/social/friends.service.js';
import { TeamsService } from '../src/modules/teams/teams.service.js';
import { joinTeamAsMember } from '../src/modules/teams/teams.repository.js';
import { issueCreditInTx } from '../src/modules/tickets/match-credits.js';
import { TicketCheckoutService } from '../src/modules/tickets/ticket-checkout.service.js';
import { TicketLeaveService } from '../src/modules/tickets/ticket-leave.service.js';
import { TicketReconciliationService } from '../src/modules/tickets/ticket-reconciliation.service.js';
import { TicketSettlementService } from '../src/modules/tickets/ticket-settlement.service.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { AccountDeletionAdminService } from '../src/modules/account/account-deletion.admin.service.js';
import { AdminFinanceService } from '../src/modules/payments/admin-finance.service.js';
import { managedVenueFixture } from './managed-venue-fixture.js';
import { FAKE_PAYSTACK_SECRET, FakePaystack } from './support/fake-paystack-server.js';
import { removeTicketJobsSince } from './support/ticket-job-cleanup.js';

/**
 * CEO batch 5, items 1-3, adapted to DEC-021 (D11), on PostgreSQL with a fake Paystack:
 * - blocked cases: admin, referee, owner of a team with members (fixed by "Make Owner"), a locked match, an open
 *   chargeback; a wrong password; a refused attempt is recorded for admins;
 * - cancel within grace: deactivated, signed out, hidden from search; signing in cancels it and emails;
 * - delete with tickets and credits: an upcoming ticket more than 24 hours out is refunded to the card on confirm;
 *   at the final step an unused credit that came from a paid ticket is refunded to that ticket's payment method
 *   (Instant EFT, which needs attention for finance), a goodwill credit lapses, and the step waits while a refund is
 *   still with Paystack; nothing is kept or wiped;
 * - anonymisation: nothing personal left on the account or visible to other players.
 * Anonymised accounts, their audit rows, tickets and credits are kept in the disposable database by design (the
 * audit log and the credit ledger are append-only), tagged with the smoke marker.
 */
const marker = `del-${randomUUID().slice(0, 8)}`;
const smokeStartedAt = new Date();
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'OK';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
};
const PASSWORD = 'Smoke-test-password-1';
const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
const channels = ['card', 'apple_pay', 'capitec_pay', 'eft'] as const;
const fake = await new FakePaystack().start();
fake.expectedChannels = [...channels];
const gateway = new PaystackClient({ secretKey: FAKE_PAYSTACK_SECRET, baseUrl: fake.baseUrl, channels: [...channels] });
const ticketSettlement = new TicketSettlementService(gateway, undefined, [...channels]);
const checkouts = new TicketCheckoutService(gateway, undefined, ticketSettlement, {
  clientUrl: 'http://localhost:5173', demo: () => false, paystackEnabled: () => true, termsVersion: async () => '2.4',
});
const refunds = new CardRefundsService(gateway);
const emails = new TestEmailProvider();
const deletion = new AccountDeletionService(emails);
const finaliser = new AccountDeletionFinaliser(refunds, undefined, deletion);
const adminDeletions = new AccountDeletionAdminService(finaliser);
const friends = new FriendsService();
const teams = new TeamsService();
const managed = managedVenueFixture(marker);
const userIds: string[] = [];
const matchIds: string[] = [];
let n = 0;

const player = async (label: string) => {
  const i = n++;
  const user = await prisma.user.create({
    data: {
      email: `${marker}-${i}@smoke.invalid`,
      username: `${marker.replace('-', '_')}_${i}`,
      passwordHash,
      emailVerifiedAt: new Date(),
      onboardingCompletedAt: new Date(),
      profile: { create: { displayName: `${label} ${marker}`, onboardingStatus: 'COMPLETE', gender: 'MALE', bio: `Bio of ${label}`, homeArea: `${label} Area`, dateOfBirth: new Date('1994-05-05') } },
    },
  });
  userIds.push(user.id);
  return user;
};
const quickMatch = async (hostId: string) => {
  const match = await new BookingsService().createQuickMatch(
    { managedFieldId: managed.fieldId, name: `${marker}-${matchIds.length}`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 2, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: managed.nextKickoff().toISOString() },
    hostId,
  );
  matchIds.push(match.id);
  return match;
};
/** Buys a substitute place on Paystack with this method; the verified webhook path confirms it. */
const buyTicket = async (matchId: string, userId: string, channel: string) => {
  const started = await checkouts.start(matchId, userId, { seat: 'SUBSTITUTE', side: 'HOME', method: 'PAYMENT', acceptPolicy: true }, randomUUID());
  fake.pay(started.reference!, { channel });
  await ticketSettlement.settleFromVerify(started.reference!, 'webhook');
  return prisma.providerPayment.findUniqueOrThrow({ where: { reference: started.reference! } });
};
const createTeam = async (ownerId: string, name: string) =>
  teams.create({ name: `${name} ${marker}`, primaryFormat: 'FIVE_A_SIDE', formationKey: getDefaultFormationKey('FIVE_A_SIDE'), primaryColor: '#0B5D2A', secondaryColor: '#FFFFFF' }, ownerId);
const join = (teamId: string, userId: string) => serializableTransaction((tx) => joinTeamAsMember(tx, teamId, userId, [marker, teamId, userId]));
const blockers = async (userId: string) => (await deletion.preview(userId)).blockers.map(({ code: blocker }) => blocker);
const afterGrace = (scheduledFor: string) => new Date(new Date(scheduledFor).getTime() + 60_000);

try {
  await managed.create();
  // ---------- Blocked cases ----------
  const admin = await player('Admin');
  await prisma.user.update({ where: { id: admin.id }, data: { platformRole: 'ADMIN' } });
  assert((await blockers(admin.id)).includes('ADMIN'), 'An admin could self-delete.');

  const referee = await player('Referee');
  await prisma.refereeGrant.create({ data: { userId: referee.id, grantedById: admin.id, grantReason: `${marker} referee` } });
  assert((await blockers(referee.id)).includes('REFEREE'), 'A referee could self-delete.');

  const owner = await player('Owner');
  const captain = await player('Captain');
  const team = await createTeam(owner.id, 'Owners XI');
  await join(team.id, captain.id);
  assert((await blockers(owner.id)).includes('TEAM_OWNER_HAS_MEMBERS'), 'The owner of a team with members could self-delete.');
  assert((await code(teams.transferOwnership(team.id, captain.id, owner.id))) === 'TEAM_CAPTAIN_REQUIRED', 'Ownership went to a member who is not a Captain.');
  await teams.updateMemberRole(team.id, captain.id, 'CAPTAIN', owner.id);
  const transferred = await teams.transferOwnership(team.id, captain.id, owner.id);
  assert(transferred.ownerUserId === captain.id, 'Ownership was not transferred to the Captain.');
  assert(transferred.members.find(({ userId }) => userId === owner.id)?.role === 'CAPTAIN', 'The old Owner is not a Captain.');
  assert(!(await blockers(owner.id)).some((item) => item.startsWith('TEAM_OWNER')), 'The old Owner is still blocked as an owner.');

  const locked = await player('Locked');
  const venue = await prisma.venue.create({ data: { name: `${marker} venue`, addressLine1: '1 Smoke Road', city: 'Cape Town', region: 'Western Cape', countryCode: 'ZA' } });
  const startsAt = new Date(Date.now() + 10 * 60_000);
  const lockedMatch = await prisma.match.create({
    data: { venueId: venue.id, name: `${marker} locked`, createdById: admin.id, mode: 'QUICK_GAME', format: 'FIVE_A_SIDE', visibility: 'PUBLIC', publicSlug: `m-${randomUUID().replace(/-/g, '').slice(0, 24)}`, startsAt, durationMinutes: 60, feeCents: 8_000, status: 'READY', goNoGoAt: new Date(startsAt.getTime() - 30 * 60_000) },
  });
  await prisma.matchParticipant.create({ data: { matchId: lockedMatch.id, userId: locked.id, team: 'HOME' } });
  assert((await blockers(locked.id)).includes('MATCH_LOCKED'), 'A player in a locked match could self-delete.');
  assert((await code(deletion.request(locked.id, { password: PASSWORD, confirmation: 'DELETE' }))) === 'ACCOUNT_DELETION_BLOCKED', 'A blocked request was accepted.');
  const blockedRow = await prisma.accountDeletionRequest.findFirst({ where: { userId: locked.id, status: 'BLOCKED' } });
  assert(blockedRow?.blockedReasons.includes('MATCH_LOCKED'), 'The refused attempt was not recorded for admins.');
  assert((await prisma.user.findUniqueOrThrow({ where: { id: locked.id } })).accountStatus === 'ACTIVE', 'A blocked request changed the account.');

  const disputer = await player('Disputer');
  const disputed = await prisma.providerPayment.create({
    data: { userId: disputer.id, purpose: 'TICKETS', provider: 'paystack', reference: `ff_ticket_${randomUUID().replaceAll('-', '')}`, amountCents: 8_000, status: 'SUCCEEDED', verifiedAt: new Date(), creditedBy: 'webhook', channel: 'card' },
  });
  await new PaymentDisputesService().open(disputed.reference, { id: `${marker}-dispute`, refund_amount: 8_000, transaction: { reference: disputed.reference, amount: 8_000 } });
  const disputeBlockers = await blockers(disputer.id);
  assert(disputeBlockers.includes('OPEN_DISPUTE'), 'A player with an open chargeback could self-delete.');

  assert((await code(deletion.request(owner.id, { password: 'wrong-password', confirmation: 'DELETE' }))) === 'CURRENT_PASSWORD_INVALID', 'A wrong password was accepted.');

  // ---------- Cancel within grace ----------
  const changer = await player('Changer');
  const viewer = await player('Viewer');
  const scheduled = await deletion.request(changer.id, { password: PASSWORD, confirmation: 'DELETE' });
  const pending = await prisma.user.findUniqueOrThrow({ where: { id: changer.id } });
  assert(pending.accountStatus === 'PENDING_DELETION', 'The account was not deactivated on confirm.');
  assert(new Date(scheduled.scheduledFor).getTime() - Date.now() > 13.9 * 86_400_000, 'The final step is not 14 days away.');
  assert((await prisma.authSession.count({ where: { userId: changer.id, revokedAt: null } })) === 0, 'Sessions were not revoked.');
  assert(!(await friends.search(viewer.id, { q: 'Changer' })).some(({ id }) => id === changer.id), 'A deleting player still shows in search.');
  assert((await code(new UsersService().get(changer.id))) === 'PLAYER_LEFT', 'A deleting player\'s profile is still shown.');
  assert(emails.messages.some(({ to, subject }) => to === changer.email && /received your request/.test(subject)), 'No request email was sent.');
  const signIn = await new AuthService().login({ identifier: changer.username, password: PASSWORD });
  assert(signIn.deletionCancelled && signIn.user.accountStatus === 'ACTIVE', 'Signing in did not cancel the deletion.');
  const cancelledRequest = await prisma.accountDeletionRequest.findFirstOrThrow({ where: { userId: changer.id } });
  assert(cancelledRequest.status === 'CANCELLED' && cancelledRequest.cancelledAt, 'The request was not marked cancelled.');
  assert((await finaliser.finalise(cancelledRequest.id, 0, afterGrace(scheduled.scheduledFor))).outcome === 'NOTHING_TO_DO', 'The final step ran after a cancel.');
  assert((await friends.search(viewer.id, { q: 'Changer' })).some(({ id }) => id === changer.id), 'The player did not come back after cancelling.');

  // ---------- Delete with tickets and credits (DEC-021 D11) ----------
  const leaver = await player('Leaver');
  const friend = await player('Friend');
  const otherOwner = await player('OtherOwner');
  const host = await player('Host');
  const kept = await quickMatch(host.id);
  const left = await quickMatch(host.id);
  // An upcoming ticket paid by card (refunded on confirm), and an Instant EFT ticket left for a match credit.
  const card = await buyTicket(kept.id, leaver.id, 'card');
  const eft = await buyTicket(left.id, leaver.id, 'eft');
  assert((await new TicketLeaveService().leave(left.id, leaver.id, 'CREDIT')).outcome === 'CREDIT_ISSUED', 'Leaving for a credit did not issue one.');
  fake.refundStatusByReference.set(eft.reference, 'needs-attention');
  // A goodwill credit has no cash origin: it lapses.
  await serializableTransaction((tx) => issueCreditInTx(tx, { userId: leaver.id, reason: 'GOODWILL', note: `${marker} goodwill` }));
  const otherTeam = await createTeam(otherOwner.id, 'Others FC');
  await join(otherTeam.id, leaver.id);
  // Social and messages to anonymise.
  await prisma.friendship.create({ data: { userLowId: [leaver.id, friend.id].sort()[0]!, userHighId: [leaver.id, friend.id].sort()[1]! } });
  const messaging = new MessagingService();
  const conversation = await messaging.start(friend.id, leaver.id);
  await messaging.send(conversation.id, leaver.id, `Secret plan from ${marker}`);
  await messaging.send(conversation.id, friend.id, 'Reply from my friend');
  await prisma.notification.create({ data: { userId: friend.id, type: 'INFO', title: 'Hello', message: `Leaver ${marker} sent you a message`, dedupeKey: `${marker}-note` } });
  await prisma.playerLookingCard.create({ data: { userId: leaver.id, enabled: true, positions: ['FORWARD'], days: [6], times: ['EVENING'], area: 'Observatory', note: 'Keen striker' } });

  const preview = await deletion.preview(leaver.id);
  assert(preview.canDelete, `The leaver is blocked: ${preview.blockers.map(({ code: c }) => c).join(', ')}`);
  assert(preview.matches.some(({ matchId, outcome, refundCents }) => matchId === kept.id && outcome === 'REFUNDED' && refundCents === 8_000), 'The preview does not say the upcoming ticket is refunded.');
  assert(preview.credits.refunded === 1 && preview.credits.lapsing === 1, `The preview does not count the credits right: ${JSON.stringify(preview.credits)}`);
  assert(['card', 'eft'].every((method) => preview.credits.paymentMethods.includes(method)), 'The preview does not name the payment methods.');
  const leaverScheduled = await deletion.request(leaver.id, { password: PASSWORD, confirmation: 'DELETE' });
  assert(!(await prisma.playerLookingCard.findUniqueOrThrow({ where: { userId: leaver.id } })).enabled, 'The looking card was not switched off on confirm.');
  const request = await prisma.accountDeletionRequest.findFirstOrThrow({ where: { userId: leaver.id, status: 'GRACE' } });
  assert((await code(finaliser.finalise(request.id, 0, new Date()))) === 'ACCOUNT_DELETION_NOT_DUE', 'The final step ran before 14 days.');

  // On confirm the upcoming ticket was left for a refund to the card; it is still with Paystack.
  const ticketRefund = await prisma.providerRefund.findFirstOrThrow({ where: { providerPaymentId: card.id, source: 'TICKET_LEFT' } });
  const sentTicketRefund = await refunds.submitQueued(ticketRefund.id);
  assert(sentTicketRefund?.status === 'PENDING' && sentTicketRefund.providerRefundId && sentTicketRefund.amountCents === 8_000, 'The upcoming ticket was not refunded to the card on confirm.');

  const waiting = await finaliser.finalise(request.id, 0, afterGrace(leaverScheduled.scheduledFor));
  assert(waiting.outcome === 'WAITING' && 'reason' in waiting && waiting.reason === 'REFUNDS_IN_PROGRESS', `The final step did not wait for the refund with Paystack: ${JSON.stringify(waiting)}`);
  await refunds.applyWebhook('refund.processed', card.reference, { id: Number(sentTicketRefund.providerRefundId), amount: 8_000, status: 'processed' });
  const result = await finaliser.finalise(request.id, 1, afterGrace(leaverScheduled.scheduledFor));
  assert(result.outcome === 'COMPLETED', `The final step did not complete: ${JSON.stringify(result)}`);
  const closureRefunds = await prisma.providerRefund.findMany({ where: { source: 'ACCOUNT_CLOSURE', providerPayment: { userId: leaver.id } } });
  assert(closureRefunds.length === 1, `Expected 1 closure refund (the credit from a paid ticket), got ${closureRefunds.length}.`);
  const closureRefund = closureRefunds[0]!;
  assert(closureRefund.providerPaymentId === eft.id && closureRefund.amountCents === 8_000 && closureRefund.creditId && closureRefund.status === 'NEEDS_ATTENTION', 'The credit was not refunded to the EFT payment it came from, or did not go to finance.');
  const credits = await prisma.matchCredit.findMany({ where: { userId: leaver.id }, include: { events: true } });
  assert(credits.find(({ reason }) => reason === 'LEFT_MATCH')?.status === 'REFUNDED', 'The credit from a paid ticket was not refunded.');
  assert(credits.find(({ reason }) => reason === 'GOODWILL')?.status === 'FORFEITED', 'The goodwill credit did not lapse.');
  assert(credits.every(({ status, events }) => events.some(({ type }) => type === status)), 'A credit closed without its ledger entry.');
  const completed = await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } });
  assert(completed.status === 'COMPLETED' && completed.uncoveredCents === 0, 'The deletion did not complete cleanly.');
  assert(completed.contactEmail === leaver.email, 'The finance contact email was not kept while a refund needs finance (D2).');
  assert(emails.messages.some(({ to, subject, text }) => to === leaver.email && /has been deleted/.test(subject) && /match credits have been refunded/.test(text)), 'No final email about the refunded credits was sent.');

  // ---------- Anonymisation ----------
  const gone = await prisma.user.findUniqueOrThrow({ where: { id: leaver.id }, include: { profile: { include: { preferredPositions: true, photo: true } } } });
  assert(gone.accountStatus === 'DELETED', 'The account is not DELETED.');
  assert(gone.email.endsWith('@deleted.invalid') && !gone.email.includes(marker), 'The email was not tombstoned.');
  assert(gone.username.startsWith('deleted_'), 'The username was not released.');
  assert(gone.profile?.displayName === DELETED_PLAYER_NAME && !gone.profile.bio && !gone.profile.homeArea && !gone.profile.dateOfBirth && !gone.profile.gender && !gone.profile.photo && !gone.profile.preferredPositions.length, 'Profile data remained.');
  assert(!(await argon2.verify(gone.passwordHash, PASSWORD)), 'The old password still works.');
  assert((await prisma.friendship.count({ where: { OR: [{ userLowId: leaver.id }, { userHighId: leaver.id }] } })) === 0, 'Friendships remained.');
  assert((await prisma.teamMembership.count({ where: { userId: leaver.id } })) === 0, 'Team memberships remained.');
  assert(!(await prisma.playerLookingCard.findUnique({ where: { userId: leaver.id } })), 'The looking card remained.');
  assert((await prisma.notification.count({ where: { userId: leaver.id } })) === 0, 'Their notifications remained.');
  const messages = await prisma.directMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'asc' } });
  assert(messages[0]!.content === DELETED_PLAYER_MESSAGE, 'Their DM content remained.');
  assert(messages[1]!.content === 'Reply from my friend', "The other person's message was changed.");
  const friendNote = await prisma.notification.findFirstOrThrow({ where: { dedupeKey: `${marker}-note` } });
  assert(!friendNote.message.includes(`Leaver ${marker}`) && friendNote.message.includes(DELETED_PLAYER_NAME), "Another player's notification still names them.");
  assert((await code(new UsersService().get(leaver.id))) === 'PLAYER_LEFT', 'The deleted profile is still shown.');
  const seenByFriend = JSON.stringify([await friends.friends(friend.id), await friends.search(friend.id, { q: 'Leaver' }), await messaging.list(friend.id)]);
  for (const secret of [`Leaver ${marker}`, leaver.username, leaver.email, 'Leaver Area', 'Bio of Leaver', 'Secret plan'])
    assert(!seenByFriend.includes(secret), `Another player can still see "${secret}".`);

  // ---------- Admin and finance (item 6) ----------
  const listed = (await adminDeletions.list()).find(({ id }) => id === request.id);
  assert(listed?.status === 'COMPLETED' && listed.displayName === DELETED_PLAYER_NAME && listed.creditsRefunded === 1 && listed.creditsLapsed === 1, 'The admin page does not show the completed deletion and its credits.');
  assert(listed.refunds.some(({ status }) => status === 'NEEDS_ATTENTION'), 'The admin page does not show the EFT refund needing attention.');
  assert((await adminDeletions.list('BLOCKED')).some(({ userId }) => userId === locked.id), 'The admin page does not show the refused attempt.');
  const queue = await new AdminFinanceService().refundsNeedingAttention();
  assert(queue.find(({ id }) => id === eft.id)?.accountClosure?.contactEmail === leaver.email, 'Finance does not see the EFT closure refund with the contact email.');
  const issues = (await new TicketReconciliationService().report()).issues;
  assert(issues.some(({ code: c, referenceId }) => c === 'REFUND_NEEDS_FINANCE' && referenceId === closureRefund.id), 'Reconciliation does not flag the needs-attention closure refund.');
  assert((await code(adminDeletions.settle(request.id, admin.id, 'Paid by EFT'))) === 'DELETION_REFUNDS_OPEN', 'Finance could settle while a refund was still open.');

  // D2: once every refund is processed, the case is settled and the contact email is erased.
  await prisma.providerRefund.update({ where: { id: closureRefund.id }, data: { status: 'PROCESSED', processedAt: new Date() } });
  assert((await finaliser.settleCheck(request.id)).settled, 'The case did not settle once every refund was processed.');
  assert(!(await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } })).contactEmail, 'The contact email was not erased once settled.');
  assert((await code(adminDeletions.settle(request.id, admin.id, 'Again'))) === 'DELETION_ALREADY_SETTLED', 'A settled case could be settled again.');
  console.log('Account deletion smoke passed: admin, referee, team owner with members (fixed by Make Owner), locked match and chargeback are blocked and the attempt recorded; a wrong password is refused; signing in during grace cancels it; on confirm an upcoming ticket more than 24 hours out is refunded to the card; the final step waits while a refund is with Paystack, refunds the credit from a paid ticket to its EFT payment (to finance), lets a goodwill credit lapse, anonymises the account, DMs and notifications, and erases the contact email once every refund is processed; admins see requests, credits and refused attempts, finance sees the closure refund with the contact email, reconciliation flags it, and settling is refused while a refund is open.');
} finally {
  const requests = await prisma.accountDeletionRequest.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  for (const { id } of requests) await prisma.durableJob.deleteMany({ where: { dedupeKey: { contains: id } } });
  await removeTicketJobsSince(smokeStartedAt);
  await prisma.durableJob.deleteMany({ where: { OR: matchIds.map((id) => ({ dedupeKey: { contains: id } })) } });
  // Refund and dispute rows are removed (the fake Paystack's ids restart every run). Accounts, tickets and credits
  // stay: the audit log and the credit ledger are append-only.
  await prisma.providerDispute.deleteMany({ where: { providerPayment: { userId: { in: userIds } } } });
  await prisma.providerRefund.deleteMany({ where: { providerPayment: { userId: { in: userIds } } } });
  await fake.stop();
  await prisma.$disconnect();
}
