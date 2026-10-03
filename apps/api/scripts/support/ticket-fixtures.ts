import { randomUUID } from 'node:crypto';
import type { TeamSide } from '@footy-finder/shared';
import { prisma } from '../../src/database/prisma.js';
import { TicketCheckoutService } from '../../src/modules/tickets/ticket-checkout.service.js';
import { TicketLeaveService } from '../../src/modules/tickets/ticket-leave.service.js';

/**
 * DEC-021 smoke fixtures: players join by buying a match ticket. The development demo operator confirms a payment
 * straight away, so a player is placed by exactly the same rules (capacity, overlap, girls-only, first-timers,
 * the other side of a team match) as a player who paid on Paystack.
 */
export const demoTickets = new TicketCheckoutService(undefined, undefined, undefined, {
  clientUrl: 'http://localhost:5173',
  demo: () => true,
  paystackEnabled: () => false,
  termsVersion: async () => '2.4',
});
export const ticketLeaving = new TicketLeaveService();

/** Buys a substitute place on a side (the player can then claim an open position). Returns the participant. */
export async function buyTicket(matchId: string, userId: string, side: TeamSide, idempotencyKey: string = randomUUID()) {
  const result = await demoTickets.start(matchId, userId, { seat: 'SUBSTITUTE', side, method: 'PAYMENT', acceptPolicy: true }, idempotencyKey);
  if (result.state !== 'CONFIRMED') throw new Error(`The demo ticket was not confirmed (${result.state}).`);
  const participant = await prisma.matchParticipant.findUniqueOrThrow({ where: { matchId_userId: { matchId, userId } } });
  return { result, participant };
}

/** Leaves under the ticket rules; a choice is needed more than 24 hours before kick-off (a refund by default). */
export const leaveTicket = (matchId: string, userId: string, choice: 'CREDIT' | 'REFUND' = 'REFUND', now?: Date) =>
  ticketLeaving.leave(matchId, userId, choice, now);

/**
 * Removes the ticket rows of these matches so the matches can be deleted. Credits and their ledger are append-only,
 * so a smoke that issues credits keeps those rows (and their matches) in the disposable database instead.
 */
export async function removeTicketRows(matchIds: string[]) {
  if (!matchIds.length) return;
  const checkouts = await prisma.ticketCheckout.findMany({ where: { matchId: { in: matchIds } }, select: { id: true, providerPaymentId: true } });
  await prisma.ticketEmail.deleteMany({ where: { OR: [{ matchId: { in: matchIds } }, { checkoutId: { in: checkouts.map(({ id }) => id) } }] } });
  await prisma.providerRefund.deleteMany({ where: { ticket: { matchId: { in: matchIds } } } });
  await prisma.matchTicket.deleteMany({ where: { matchId: { in: matchIds } } });
  await prisma.ticketCheckout.deleteMany({ where: { matchId: { in: matchIds } } });
  const paymentIds = checkouts.flatMap(({ providerPaymentId }) => (providerPaymentId ? [providerPaymentId] : []));
  await prisma.providerRefund.deleteMany({ where: { providerPaymentId: { in: paymentIds } } });
  await prisma.providerPayment.deleteMany({ where: { id: { in: paymentIds } } });
}
