import { paymentChannelLabel, type MyMatchCredit, type MyTicketRefund, type MyTicketRow, type MyTicketsOverview } from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';

const LIST_LIMIT = 100;
const nameOf = (user: { username: string; profile: { displayName: string } | null }) => user.profile?.displayName ?? user.username;

const ticketInclude = {
  match: { select: { id: true, name: true, startsAt: true, status: true, venue: { select: { name: true } } } },
  player: { select: { username: true, profile: { select: { displayName: true } } } },
  payer: { select: { username: true, profile: { select: { displayName: true } } } },
  checkout: { select: { providerPayment: { select: { channel: true } } } },
} satisfies Prisma.MatchTicketInclude;
type TicketRow = Prisma.MatchTicketGetPayload<{ include: typeof ticketInclude }>;

const refundState = (status: string): MyTicketRefund['state'] =>
  status === 'PROCESSED' ? 'REFUNDED' : status === 'NEEDS_ATTENTION' ? 'NEEDS_BANK_DETAILS' : status === 'FAILED' ? 'HANDLED_BY_SUPPORT' : 'IN_PROGRESS';

/**
 * DEC-021 "Tickets & credits" (replaces the wallet page): the viewer's upcoming and past tickets (their own places and
 * places they paid for), match credits with their expiry, and refunds to their card or bank with the status.
 */
export class MyTicketsService {
  async overview(userId: string, now = new Date()): Promise<MyTicketsOverview> {
    const [tickets, credits, refunds, user] = await Promise.all([
      prisma.matchTicket.findMany({
        where: { OR: [{ playerId: userId }, { payerId: userId }], status: { not: 'RELEASED' } },
        include: ticketInclude,
        orderBy: { match: { startsAt: 'desc' } },
        take: LIST_LIMIT * 2,
      }),
      prisma.matchCredit.findMany({
        where: { userId },
        include: { usedTicket: { select: { match: { select: { name: true } } } } },
        orderBy: [{ issuedAt: 'desc' }],
        take: LIST_LIMIT,
      }),
      prisma.providerRefund.findMany({
        where: { providerPayment: { userId, purpose: 'TICKETS' } },
        include: {
          providerPayment: { select: { channel: true } },
          ticket: { select: { match: { select: { name: true } } } },
          credit: { select: { originTicket: { select: { match: { select: { name: true } } } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: LIST_LIMIT,
      }),
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { bookingRestrictedAt: true } }),
    ]);
    const row = (ticket: TicketRow): MyTicketRow => ({
      id: ticket.id,
      matchId: ticket.match.id,
      matchName: ticket.match.name,
      venueName: ticket.match.venue.name,
      startsAt: ticket.match.startsAt.toISOString(),
      matchStatus: ticket.match.status,
      seat: ticket.seat,
      side: ticket.side,
      status: ticket.status,
      method: ticket.method,
      amountCents: ticket.amountCents,
      outcome: ticket.outcome ?? undefined,
      playerDisplayName: nameOf(ticket.player),
      isMine: ticket.playerId === userId,
      paidByMe: ticket.payerId === userId,
      payerDisplayName: ticket.payerId === userId ? undefined : nameOf(ticket.payer),
      paymentMethodLabel: ticket.method === 'PAYMENT' ? (paymentChannelLabel(ticket.checkout.providerPayment?.channel) ?? undefined) : undefined,
      choiceDeadlineAt: ticket.status === 'CHOICE_PENDING' ? ticket.choiceDeadlineAt?.toISOString() : undefined,
    });
    // Upcoming: live tickets (held, confirmed, or waiting for a credit-or-refund choice) for matches not yet played.
    const live = (ticket: TicketRow) =>
      ticket.status === 'CHOICE_PENDING' || (['HELD', 'CONFIRMED'].includes(ticket.status) && ticket.match.startsAt > now && !['CANCELLED', 'COMPLETED'].includes(ticket.match.status));
    const upcoming = tickets.filter(live).sort((a, b) => a.match.startsAt.getTime() - b.match.startsAt.getTime());
    const past = tickets.filter((ticket) => !live(ticket)).slice(0, LIST_LIMIT);
    // Available credits first, soonest to expire first (the order they are used in).
    const rank = (credit: (typeof credits)[number]) => (credit.status === 'AVAILABLE' ? 0 : 1);
    const sortedCredits = [...credits].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? a.expiresAt.getTime() - b.expiresAt.getTime() : 0));
    return {
      upcoming: upcoming.map(row),
      past: past.map(row),
      creditsAvailable: credits.filter((credit) => credit.status === 'AVAILABLE' && credit.expiresAt > now).length,
      credits: sortedCredits.map(
        (credit): MyMatchCredit => ({
          id: credit.id,
          status: credit.status,
          reason: credit.reason,
          issuedAt: credit.issuedAt.toISOString(),
          expiresAt: credit.expiresAt.toISOString(),
          usedAt: credit.usedAt?.toISOString(),
          usedOnMatchName: credit.usedTicket?.match.name,
        }),
      ),
      refunds: refunds.map(
        (refund): MyTicketRefund => ({
          id: refund.id,
          amountCents: refund.amountCents,
          state: refundState(refund.status),
          matchName: refund.ticket?.match.name ?? refund.credit?.originTicket?.match.name,
          paymentMethodLabel: paymentChannelLabel(refund.providerPayment.channel) ?? undefined,
          createdAt: refund.createdAt.toISOString(),
          processedAt: refund.processedAt?.toISOString(),
        }),
      ),
      bookingRestricted: Boolean(user.bookingRestrictedAt),
    };
  }
}
