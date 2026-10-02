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
import { MessagingService } from '../src/modules/messaging/messaging.service.js';
import { CardRefundsService } from '../src/modules/payments/card-refunds.service.js';
import { ChargebacksService } from '../src/modules/payments/chargebacks.service.js';
import { PaystackClient } from '../src/modules/payments/paystack.client.js';
import { TopUpService } from '../src/modules/payments/top-up.service.js';
import { TopUpSettlementService } from '../src/modules/payments/top-up-settlement.service.js';
import { FriendsService } from '../src/modules/social/friends.service.js';
import { TeamWalletService } from '../src/modules/team-wallet/team-wallet.service.js';
import { TeamsService } from '../src/modules/teams/teams.service.js';
import { joinTeamAsMember } from '../src/modules/teams/teams.repository.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { AccountDeletionAdminService } from '../src/modules/account/account-deletion.admin.service.js';
import { AdminFinanceService } from '../src/modules/payments/admin-finance.service.js';
import { WalletReconciliationService } from '../src/modules/wallet/wallet-reconciliation.service.js';
import { FinancialRepository } from '../src/modules/wallet/financial.repository.js';
import { FAKE_PAYSTACK_SECRET, FakePaystack } from './support/fake-paystack-server.js';
import { deleteTeamWalletFixtures } from './team-wallet-fixtures.js';

/**
 * CEO batch 5, items 1-3 on PostgreSQL with a fake Paystack:
 * - blocked cases: admin, referee, owner of a team with members (fixed by "Make Owner"), a locked match, an open
 *   chargeback; a wrong password; a refused attempt is recorded for admins;
 * - cancel within grace: deactivated, signed out, hidden from search; signing in cancels it and emails;
 * - delete with a balance: own Team Wallet money returned first, then the whole balance refunded newest top-up
 *   first (card back automatically, Instant EFT needs attention for finance), a non-top-up credit left as an
 *   uncovered amount for finance, never wiped; ledgers reconcile;
 * - anonymisation: nothing personal left on the account or visible to other players.
 * Anonymised accounts, their audit rows and money records are kept in the disposable database by design
 * (the audit log and ledger are immutable), tagged with the smoke marker.
 */
const marker = `del-${randomUUID().slice(0, 8)}`;
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
const settlement = new TopUpSettlementService(gateway, undefined, undefined, [...channels]);
const topUps = new TopUpService(gateway, settlement, undefined, { clientUrl: 'http://localhost:5173', expiryMinutes: 60, paystackEnabled: () => true });
const emails = new TestEmailProvider();
const deletion = new AccountDeletionService(emails);
const finaliser = new AccountDeletionFinaliser(new CardRefundsService(gateway), undefined, undefined, deletion);
const adminDeletions = new AccountDeletionAdminService(finaliser);
const friends = new FriendsService();
const teams = new TeamsService();
const teamWallet = new TeamWalletService();
const userIds: string[] = [];
const teamIds: string[] = [];
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
      walletAccount: { create: {} },
    },
  });
  userIds.push(user.id);
  return user;
};
const topUp = async (userId: string, amountCents: number, channel: string) => {
  const started = await topUps.initiate(userId, amountCents, `${marker}-${randomUUID()}`);
  fake.pay(started.reference, { channel });
  await settlement.settleFromVerify(started.reference, 'webhook');
  return prisma.providerPayment.findUniqueOrThrow({ where: { reference: started.reference } });
};
const createTeam = async (ownerId: string, name: string) => {
  const created = await teams.create({ name: `${name} ${marker}`, primaryFormat: 'FIVE_A_SIDE', formationKey: getDefaultFormationKey('FIVE_A_SIDE'), primaryColor: '#114422', secondaryColor: '#ffffff' }, ownerId);
  teamIds.push(created.id);
  return created;
};
const join = (teamId: string, userId: string) => serializableTransaction((tx) => joinTeamAsMember(tx, teamId, userId, [marker, teamId, userId]));
const blockers = async (userId: string) => (await deletion.preview(userId)).blockers.map(({ code: blocker }) => blocker);
const reconciles = async (userId: string) => {
  const wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { userId } });
  const ledger = await prisma.walletTransaction.aggregate({ where: { walletAccountId: wallet.id, status: 'SUCCEEDED' }, _sum: { amountCents: true } });
  return (ledger._sum.amountCents ?? 0) === wallet.balanceCents;
};
const afterGrace = (scheduledFor: string) => new Date(new Date(scheduledFor).getTime() + 60_000);

try {
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
  const disputed = await topUp(disputer.id, 20_000, 'card');
  await new ChargebacksService().open(disputed.reference, { id: `${marker}-dispute`, refund_amount: 20_000, transaction: { reference: disputed.reference, amount: 20_000 } });
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

  // ---------- Delete with a balance ----------
  const leaver = await player('Leaver');
  const friend = await player('Friend');
  const otherOwner = await player('OtherOwner');
  const card = await topUp(leaver.id, 30_000, 'card');
  const eft = await topUp(leaver.id, 20_000, 'eft');
  fake.refundStatusByReference.set(eft.reference, 'needs-attention');
  // R25 credited without a top-up (for example a goodwill credit): no top-up can carry it back.
  await serializableTransaction((tx) => new FinancialRepository().credit(tx, { userId: leaver.id, amountCents: 2_500, type: 'MATCH_CANCELLATION_CREDIT', idempotencyKey: `${marker}-credit`, description: 'Smoke credit' }));
  const otherTeam = await createTeam(otherOwner.id, 'Others FC');
  await join(otherTeam.id, leaver.id);
  await teamWallet.contribute(otherTeam.id, leaver.id, 10_000, `${marker}-contribution`);
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
  assert(preview.wallet.teamContributionsCents === 10_000, 'The preview does not show the Team Wallet money.');
  const leaverScheduled = await deletion.request(leaver.id, { password: PASSWORD, confirmation: 'DELETE' });
  assert(!(await prisma.playerLookingCard.findUniqueOrThrow({ where: { userId: leaver.id } })).enabled, 'The looking card was not switched off on confirm.');
  const request = await prisma.accountDeletionRequest.findFirstOrThrow({ where: { userId: leaver.id, status: 'GRACE' } });
  assert((await code(finaliser.finalise(request.id, 0, new Date()))) === 'ACCOUNT_DELETION_NOT_DUE', 'The final step ran before 14 days.');

  const result = await finaliser.finalise(request.id, 0, afterGrace(leaverScheduled.scheduledFor));
  assert(result.outcome === 'COMPLETED', `The final step did not complete: ${JSON.stringify(result)}`);
  const refunds = await prisma.providerRefund.findMany({ where: { source: 'ACCOUNT_CLOSURE', providerPayment: { userId: leaver.id } }, include: { providerPayment: true }, orderBy: { createdAt: 'asc' } });
  assert(refunds.length === 2, `Expected 2 closure refunds, got ${refunds.length}.`);
  assert(refunds[0]!.providerPaymentId === eft.id && refunds[0]!.amountCents === 20_000 && refunds[0]!.status === 'NEEDS_ATTENTION', 'The newest (EFT) top-up was not refunded first, or did not go to finance.');
  assert(refunds[1]!.providerPaymentId === card.id && refunds[1]!.amountCents === 30_000, 'The card top-up was not refunded in full (the R100 Team Wallet money was not returned first?).');
  const leaverWallet = await prisma.walletAccount.findUniqueOrThrow({ where: { userId: leaver.id } });
  assert(leaverWallet.balanceCents === 2_500, `R25 not covered by any top-up should stay visible for finance, not be wiped (balance ${leaverWallet.balanceCents}).`);
  assert(await reconciles(leaver.id), 'The deleted wallet does not reconcile to its ledger.');
  const completed = await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } });
  assert(completed.status === 'COMPLETED' && completed.uncoveredCents === 2_500, 'The uncovered amount was not recorded for finance.');
  assert(completed.contactEmail === leaver.email, 'The finance contact email was not kept while money is outstanding (D2).');
  assert(emails.messages.some(({ to, subject }) => to === leaver.email && /has been deleted/.test(subject)), 'No final email was sent.');

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
  assert(listed?.status === 'COMPLETED' && listed.displayName === DELETED_PLAYER_NAME && listed.uncoveredCents === 2_500, 'The admin page does not show the completed deletion.');
  assert(listed.refunds.some(({ status }) => status === 'NEEDS_ATTENTION'), 'The admin page does not show the EFT refund needing attention.');
  assert((await adminDeletions.list('BLOCKED')).some(({ userId }) => userId === locked.id), 'The admin page does not show the refused attempt.');
  const queue = await new AdminFinanceService().refundsNeedingAttention();
  const queued = queue.find(({ id }) => id === eft.id);
  assert(queued?.accountClosure?.contactEmail === leaver.email, 'Finance does not see the EFT closure refund with the contact email.');
  const issues = (await new WalletReconciliationService().report()).issues;
  assert(issues.some(({ code: c, referenceId }) => c === 'ACCOUNT_CLOSURE_UNREFUNDED' && referenceId === request.id), 'Reconciliation does not flag the uncovered closure amount.');
  assert(issues.some(({ code: c, referenceId }) => c === 'REFUND_NEEDS_FINANCE' && referenceId === refunds[0]!.id), 'Reconciliation does not flag the needs-attention refund.');
  assert((await code(adminDeletions.settle(request.id, admin.id, 'Paid R25 by EFT'))) === 'DELETION_REFUNDS_OPEN', 'Finance could settle while a closure refund was still open.');

  // D2: once every closure refund is processed and finance has settled the rest, the contact email is erased.
  await prisma.providerRefund.updateMany({ where: { id: { in: refunds.map(({ id }) => id) } }, data: { status: 'PROCESSED' } });
  assert(!(await finaliser.settleCheck(request.id)).settled, 'The case settled with an uncovered amount.');
  const settled = await adminDeletions.settle(request.id, admin.id, 'Paid R25 by EFT, ref smoke');
  assert(settled.financeSettledAt && !settled.contactEmail, 'Settling did not erase the contact email.');
  assert((await prisma.adminAuditLog.count({ where: { actorUserId: admin.id, action: 'ACCOUNT_CLOSURE_SETTLED', entityId: request.id } })) === 1, 'Settling was not audited.');
  assert(!(await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } })).contactEmail, 'The contact email was not erased once settled.');

  for (const userId of [disputer.id, otherOwner.id]) assert(await reconciles(userId), 'A wallet does not reconcile to its ledger.');
  console.log('Account deletion smoke passed: admin, referee, team owner with members (fixed by Make Owner), locked match and chargeback are blocked and the attempt recorded; a wrong password is refused; signing in during grace cancels it; the final step returns Team Wallet money, refunds the newest top-up first (EFT to finance, card automatic), keeps an uncovered amount for finance, anonymises the account, DMs and notifications, and erases the contact email once settled; admins see requests and refused attempts, finance sees the closure refund with the contact email, reconciliation flags what is open, settling is refused while a refund is open and is audited; ledgers reconcile.');
} finally {
  const requests = await prisma.accountDeletionRequest.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  for (const { id } of requests) await prisma.durableJob.deleteMany({ where: { dedupeKey: { contains: id } } });
  const payments = await prisma.providerPayment.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  for (const { id } of payments) await prisma.durableJob.deleteMany({ where: { dedupeKey: { startsWith: `paystack-topup-expire:${id}` } } });
  // Money rows are removed (the fake Paystack's ids restart every run); the accounts themselves stay, because
  // the append-only audit log names them as actors.
  await deleteTeamWalletFixtures(teamIds);
  await prisma.providerDispute.deleteMany({ where: { providerPayment: { userId: { in: userIds } } } });
  await prisma.providerRefund.deleteMany({ where: { providerPayment: { userId: { in: userIds } } } });
  await prisma.providerPayment.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.walletTransaction.deleteMany({ where: { walletAccount: { userId: { in: userIds } } } });
  await prisma.walletAccount.updateMany({ where: { userId: { in: userIds } }, data: { balanceCents: 0, spendingRestrictedAt: null, spendingRestrictionReason: null } });
  await prisma.matchParticipant.deleteMany({ where: { userId: { in: userIds } } });
  await fake.stop();
  await prisma.$disconnect();
}
