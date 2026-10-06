import type { DataExportInput, PersonalDataExport } from '@footy-finder/shared';
import argon2 from 'argon2';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import { aggregatePlayerStatistics } from '../users/player-statistics.js';
import { UsersRepository } from '../users/users.repository.js';

export const DATA_EXPORT_AUDIT_ACTION = 'PERSONAL_DATA_EXPORTED';
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (date: Date | null | undefined) => date?.toISOString() ?? null;
const nameOf = (user: { username: string; profile: { displayName: string } | null }) => user.profile?.displayName ?? user.username;
const paymentRow = (row: { reference: string; amountCents: number; status: string; channel: string | null; createdAt: Date; refunds: Array<{ amountCents: number; status: string; createdAt: Date }> }) => ({
  reference: row.reference, amountCents: row.amountCents, status: row.status, method: row.channel, createdAt: row.createdAt.toISOString(),
  refunds: row.refunds.map((refund) => ({ amountCents: refund.amountCents, status: refund.status, createdAt: refund.createdAt.toISOString() })),
});

/**
 * CEO batch 5, item 5 (POPIA section 23, ToS 8.7 and 8.13): the player's own personal data as JSON. The password is
 * checked again, it can be downloaded once every 24 hours, and every download is in the audit log. Other players
 * appear only by their public display name (friends, blocks, requests); messages are only the ones this player sent.
 */
export class DataExportService {
  constructor(private readonly users = new UsersRepository()) {}

  async export(userId: string, input: DataExportInput, requestId?: string, now = new Date()): Promise<PersonalDataExport> {
    const account = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!account || !(await argon2.verify(account.passwordHash, input.password)))
      throw new AppError(401, 'Your password is incorrect.', 'CURRENT_PASSWORD_INVALID');
    await serializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const last = await tx.adminAuditLog.findFirst({
        where: { actorUserId: userId, action: DATA_EXPORT_AUDIT_ACTION, createdAt: { gt: new Date(now.getTime() - DAY_MS) } },
        orderBy: { createdAt: 'desc' },
      });
      if (last)
        throw new AppError(429, 'You can download your data once every 24 hours.', 'DATA_EXPORT_RATE_LIMITED', {
          availableAt: new Date(last.createdAt.getTime() + DAY_MS).toISOString(),
        });
      await appendAdminAudit(tx, { actorUserId: userId, action: DATA_EXPORT_AUDIT_ACTION, entityType: 'USER', entityId: userId, requestId });
    });
    return this.build(userId, now);
  }

  async build(userId: string, now = new Date()): Promise<PersonalDataExport> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        profile: { include: { city: true, photo: true, preferredPositions: { orderBy: { sortOrder: 'asc' } } } },
        walletAccount: true,
      },
    });
    const person = { select: { username: true, profile: { select: { displayName: true } } } } as const;
    const [
      participations, lineup, statistics, ledger, payments, memberships, contributions, tickets, credits,
      friendships, requests, blocks, dms, lobby, team, reviews, lookingCard, joinRequests, posts,
      interests, acceptances, deletionRequests,
    ] = await Promise.all([
      prisma.matchParticipant.findMany({
        where: { userId },
        select: { team: true, status: true, joinedAt: true, leftAt: true, match: { select: { id: true, name: true, startsAt: true, status: true } } },
        orderBy: { joinedAt: 'asc' },
      }),
      prisma.matchLineupEntry.findMany({
        where: { userId },
        select: { side: true, role: true, didNotPlay: true, match: { select: { id: true, name: true, startsAt: true, result: { select: { homeScore: true, awayScore: true, outcomeType: true } } } } },
      }),
      this.users.statistics(userId),
      user.walletAccount
        ? prisma.walletTransaction.findMany({ where: { walletAccountId: user.walletAccount.id }, select: { type: true, amountCents: true, status: true, description: true, createdAt: true }, orderBy: { createdAt: 'asc' } })
        : [],
      prisma.providerPayment.findMany({
        where: { userId },
        select: { purpose: true, reference: true, amountCents: true, status: true, channel: true, createdAt: true, refunds: { select: { amountCents: true, status: true, createdAt: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.teamMembership.findMany({ where: { userId }, select: { role: true, joinedAt: true, team: { select: { id: true, name: true } } } }),
      prisma.teamWalletTransaction.findMany({
        where: { contributorUserId: userId },
        select: { type: true, amountCents: true, createdAt: true, account: { select: { team: { select: { name: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),
      // DEC-021: tickets they hold or paid for, and their match credits.
      prisma.matchTicket.findMany({
        where: { OR: [{ playerId: userId }, { payerId: userId }] },
        select: {
          seat: true, side: true, status: true, method: true, amountCents: true, outcome: true, createdAt: true, playerId: true, payerId: true,
          match: { select: { id: true, name: true, startsAt: true } }, player: person, payer: person,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.matchCredit.findMany({ where: { userId }, select: { status: true, reason: true, issuedAt: true, expiresAt: true, usedAt: true }, orderBy: { issuedAt: 'asc' } }),
      prisma.friendship.findMany({ where: { OR: [{ userLowId: userId }, { userHighId: userId }] }, select: { createdAt: true, userLow: person, userHigh: person, userLowId: true } }),
      prisma.friendRequest.findMany({ where: { OR: [{ requesterId: userId }, { recipientId: userId }] }, select: { status: true, createdAt: true, requesterId: true, requester: person, recipient: person } }),
      prisma.userBlock.findMany({ where: { blockerId: userId }, select: { createdAt: true, blocked: person } }),
      prisma.directMessage.findMany({ where: { senderId: userId }, select: { conversationId: true, content: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
      prisma.lobbyMessage.findMany({ where: { senderId: userId }, select: { matchId: true, content: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
      prisma.teamMessage.findMany({ where: { senderId: userId }, select: { teamId: true, content: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
      prisma.teamReview.findMany({ where: { authorUserId: userId }, select: { rating: true, text: true, status: true, createdAt: true, team: { select: { name: true } }, match: { select: { name: true } } } }),
      prisma.playerLookingCard.findUnique({ where: { userId }, select: { enabled: true, positions: true, area: true, days: true, times: true, note: true, updatedAt: true } }),
      prisma.teamJoinRequest.findMany({ where: { userId }, select: { status: true, createdAt: true, team: { select: { name: true } } } }),
      prisma.teamRecruitmentPost.findMany({ where: { createdById: userId }, select: { status: true, area: true, note: true, createdAt: true, team: { select: { name: true } } } }),
      prisma.cityInterest.findMany({ where: { userId }, select: { email: true, consentedAt: true, unsubscribedAt: true, source: true, city: { select: { name: true } } } }),
      prisma.legalAcceptance.findMany({ where: { userId }, select: { acceptedAt: true, source: true, evidence: true, legalDocument: { select: { type: true, version: true, title: true } } }, orderBy: { acceptedAt: 'asc' } }),
      prisma.accountDeletionRequest.findMany({ where: { userId }, select: { status: true, requestedAt: true, scheduledFor: true, cancelledAt: true } }),
    ]);
    const profile = user.profile;
    return {
      format: 'footyfinder-personal-data',
      version: 1,
      generatedAt: now.toISOString(),
      about:
        'Your personal data held by FootyFinder (Pty) Ltd, under section 23 of the Protection of Personal Information Act and clause 8.7 of our Terms. Other players appear only by their public display name. Messages are the ones you sent.',
      account: {
        id: user.id,
        email: user.email,
        username: user.username,
        createdAt: user.createdAt.toISOString(),
        emailVerifiedAt: iso(user.emailVerifiedAt),
        onboardingCompletedAt: iso(user.onboardingCompletedAt),
        accountStatus: user.accountStatus,
        friendRequestsEnabled: user.friendRequestsEnabled,
      },
      profile: {
        displayName: profile?.displayName ?? null,
        bio: profile?.bio ?? null,
        dateOfBirth: profile?.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        gender: profile?.gender ?? null,
        city: profile?.city?.name ?? null,
        homeArea: profile?.homeArea ?? null,
        dominantFoot: profile?.dominantFoot ?? null,
        yearsExperience: profile?.yearsExperience ?? null,
        preferredPositions: profile?.preferredPositions.map(({ position }) => position) ?? [],
        photo: profile?.photo ? { uploadedAt: profile.photo.createdAt.toISOString(), hiddenByFootyFinder: Boolean(profile.photo.hiddenAt) } : null,
      },
      matches: participations.map(({ match, team: side, status, joinedAt, leftAt }) => ({
        matchId: match.id, name: match.name, startsAt: match.startsAt.toISOString(), matchStatus: match.status,
        side, yourStatus: status, joinedAt: joinedAt.toISOString(), leftAt: iso(leftAt),
      })),
      results: lineup.map(({ match, side, role, didNotPlay }) => ({
        matchId: match.id, name: match.name, startsAt: match.startsAt.toISOString(), side, role, didNotPlay,
        score: match.result ? { home: match.result.homeScore, away: match.result.awayScore, outcome: match.result.outcomeType } : null,
      })),
      statistics: aggregatePlayerStatistics(statistics),
      tickets: tickets.map((row) => ({
        matchId: row.match.id, match: row.match.name, startsAt: row.match.startsAt.toISOString(), seat: row.seat, side: row.side, status: row.status,
        method: row.method, amountCents: row.amountCents, outcome: row.outcome ?? null,
        forPlayer: row.playerId === userId ? 'you' : nameOf(row.player), paidBy: row.payerId === userId ? 'you' : nameOf(row.payer),
        createdAt: row.createdAt.toISOString(),
      })),
      matchCredits: credits.map((row) => ({ status: row.status, reason: row.reason, issuedAt: row.issuedAt.toISOString(), expiresAt: row.expiresAt.toISOString(), usedAt: iso(row.usedAt) })),
      payments: payments.filter(({ purpose }) => purpose === 'TICKETS').map(paymentRow),
      // D13: wallet and Team Wallet rows from before DEC-021, kept read-only as history.
      earlierPaymentRecords: {
        walletEntries: ledger.map((row) => ({ type: row.type, amountCents: row.amountCents, status: row.status, description: row.description ?? null, createdAt: row.createdAt.toISOString() })),
        topUps: payments.filter(({ purpose }) => purpose === 'TOP_UP').map(paymentRow),
        teamWalletEntries: contributions.map((row) => ({ team: row.account.team.name, type: row.type, amountCents: row.amountCents, createdAt: row.createdAt.toISOString() })),
      },
      teams: memberships.map(({ role, joinedAt, team: t }) => ({ teamId: t.id, name: t.name, role, joinedAt: joinedAt.toISOString() })),
      friends: friendships.map((row) => ({ displayName: nameOf(row.userLowId === userId ? row.userHigh : row.userLow), since: row.createdAt.toISOString() })),
      friendRequests: requests.map((row) => ({
        direction: row.requesterId === userId ? ('SENT' as const) : ('RECEIVED' as const),
        otherPlayer: nameOf(row.requesterId === userId ? row.recipient : row.requester),
        status: row.status, createdAt: row.createdAt.toISOString(),
      })),
      blockedPlayers: blocks.map((row) => ({ displayName: nameOf(row.blocked), since: row.createdAt.toISOString() })),
      messagesSent: {
        direct: dms.map((row) => ({ conversationId: row.conversationId, content: row.content, sentAt: row.createdAt.toISOString() })),
        lobbyChat: lobby.map((row) => ({ matchId: row.matchId, content: row.content, sentAt: row.createdAt.toISOString() })),
        teamChat: team.map((row) => ({ teamId: row.teamId, content: row.content, sentAt: row.createdAt.toISOString() })),
      },
      teamReviews: reviews.map((row) => ({ team: row.team.name, match: row.match.name, rating: row.rating, comment: row.text, status: row.status, createdAt: row.createdAt.toISOString() })),
      recruitment: {
        lookingCard: lookingCard ? { ...lookingCard, updatedAt: lookingCard.updatedAt.toISOString() } : null,
        joinRequests: joinRequests.map((row) => ({ team: row.team.name, status: row.status, createdAt: row.createdAt.toISOString() })),
        postsCreated: posts.map((row) => ({ team: row.team.name, status: row.status, area: row.area, note: row.note, createdAt: row.createdAt.toISOString() })),
      },
      consents: {
        cityWaitingList: interests.map((row) => ({ city: row.city.name, email: row.email, source: row.source, consentedAt: row.consentedAt.toISOString(), unsubscribedAt: iso(row.unsubscribedAt) })),
      },
      termsAcceptances: acceptances.map((row) => ({
        document: row.legalDocument.title, type: row.legalDocument.type, version: row.legalDocument.version,
        acceptedAt: row.acceptedAt.toISOString(), source: row.source, evidence: row.evidence,
      })),
      deletionRequests: deletionRequests.map((row) => ({ status: row.status, requestedAt: row.requestedAt.toISOString(), scheduledFor: iso(row.scheduledFor), cancelledAt: iso(row.cancelledAt) })),
    };
  }
}
