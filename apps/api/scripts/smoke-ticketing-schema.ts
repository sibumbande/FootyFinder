import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { assert, socialWorld } from './social-fixtures.js';

/**
 * DEC-021 (batch 5 brief, Part A) on PostgreSQL: the database itself enforces the ticketing rules, whatever the
 * application does. One live ticket per player per match; one checkout at a time per position ("Being booked");
 * a paid ticket has an amount and a free or credit ticket has none; a closed ticket has an outcome; a credit is
 * valid for at least 3 years (CPA s63); the credit ledger is append-only; a ticket payment has no wallet link and
 * a top-up keeps its own; a refund is either a legacy wallet refund or a ticket refund; the new cancellation
 * reasons are accepted.
 */
const world = socialWorld(`tkt-${randomUUID().slice(0, 8)}`);
const refused = async (work: () => Promise<unknown>) => {
  try {
    await work();
    return false;
  } catch {
    return true;
  }
};
const created = { checkoutIds: [] as string[], paymentIds: [] as string[] };

try {
  const [payer, teammate] = [await world.player('Payer'), await world.player('Teammate')];
  const match = await world.finishedMatch([payer.id], [teammate.id], { startsAt: new Date(Date.now() + 3 * 86_400_000) });
  await prisma.match.update({ where: { id: match.id }, data: { status: 'OPEN', confirmedAt: null } });
  const slot = await prisma.formationSlot.create({ data: { matchId: match.id, team: 'HOME', slotIndex: 1, positionX: 50, positionY: 50 } });

  const checkout = async (method: 'PAYMENT' | 'CREDIT' | 'FREE', amountCents: number) => {
    const row = await prisma.ticketCheckout.create({
      data: {
        matchId: match.id, payerId: payer.id, kind: 'QUICK', method, amountCents, idempotencyKey: randomUUID(),
        policyAcceptedAt: new Date(), termsVersion: '2.4', policyText: 'smoke', ipAddress: '127.0.0.1', userAgent: 'smoke',
      },
    });
    created.checkoutIds.push(row.id);
    return row;
  };
  const paid = await checkout('PAYMENT', 8_000);
  const ticket = (data: Partial<Parameters<typeof prisma.matchTicket.create>[0]['data']> = {}) =>
    prisma.matchTicket.create({
      data: {
        matchId: match.id, checkoutId: paid.id, playerId: payer.id, payerId: payer.id, side: 'HOME', seat: 'POSITION', slotId: slot.id,
        method: 'PAYMENT', amountCents: 8_000, holdExpiresAt: new Date(Date.now() + 600_000), ...data,
      } as Parameters<typeof prisma.matchTicket.create>[0]['data'],
    });

  // One checkout at a time per position, and one live ticket per player per match.
  const held = await ticket();
  assert(await refused(() => ticket({ playerId: teammate.id })), 'Two players could hold the same position.');
  assert(await refused(() => ticket({ seat: 'SUBSTITUTE', slotId: null })), 'A player could hold two live tickets for one match.');
  await prisma.matchTicket.update({ where: { id: held.id }, data: { status: 'RELEASED', releasedAt: new Date() } });
  const second = await ticket({ playerId: teammate.id });
  assert(second.status === 'HELD', 'A released position could not be booked again.');

  // Amounts, holds and outcomes.
  assert(await refused(() => ticket({ playerId: teammate.id, seat: 'SUBSTITUTE', slotId: null, amountCents: 0 })), 'A paid ticket was allowed with no amount.');
  const credit = await checkout('CREDIT', 0);
  assert(await refused(() => ticket({ checkoutId: credit.id, method: 'CREDIT', amountCents: 8_000, seat: 'SUBSTITUTE', slotId: null })), 'A credit ticket carried a rand amount.');
  assert(await refused(() => checkout('FREE', 8_000)), 'A free checkout carried an amount.');
  assert(await refused(() => prisma.matchTicket.update({ where: { id: second.id }, data: { status: 'CLOSED', closedAt: new Date() } })), 'A ticket closed without an outcome.');
  assert(await refused(() => prisma.matchTicket.update({ where: { id: second.id }, data: { status: 'CHOICE_PENDING', confirmedAt: new Date() } })), 'A cancellation choice had no deadline.');

  // Credits: at least 3 years, and the ledger is append-only. (A DEV_SEED credit links no ticket, so only its
  // user is retained by design: the ledger can never be deleted.)
  const holder = await prisma.user.create({ data: { email: `ledger-${world.marker}@smoke.invalid`, username: `tk_${world.marker.slice(-8)}_ledger`, passwordHash: 'smoke' } });
  const issuedAt = new Date();
  const shortExpiry = new Date(issuedAt.getTime() + 2 * 365 * 86_400_000);
  assert(await refused(() => prisma.matchCredit.create({ data: { userId: holder.id, reason: 'DEV_SEED', issuedAt, expiresAt: shortExpiry } })), 'A credit valid for less than 3 years was allowed.');
  assert(await refused(() => prisma.matchCredit.create({ data: { userId: holder.id, reason: 'LEFT_MATCH', issuedAt, expiresAt: new Date(issuedAt.getTime() + 4 * 365 * 86_400_000) } })), 'A credit for leaving a match had no ticket.');
  const good = await prisma.matchCredit.create({ data: { userId: holder.id, reason: 'DEV_SEED', issuedAt, expiresAt: new Date(issuedAt.getTime() + (3 * 365 + 1) * 86_400_000) } });
  const event = await prisma.matchCreditEvent.create({ data: { creditId: good.id, type: 'ISSUED', note: 'smoke' } });
  assert(await refused(() => prisma.matchCreditEvent.update({ where: { id: event.id }, data: { note: 'changed' } })), 'A credit ledger entry was changed.');
  assert(await refused(() => prisma.matchCreditEvent.delete({ where: { id: event.id } })), 'A credit ledger entry was deleted.');
  assert(await refused(() => prisma.matchCreditEvent.create({ data: { creditId: good.id, type: 'ISSUED' } })), 'A credit was issued twice.');

  // Payments: a ticket payment has no wallet link; a top-up must keep one. A refund is a wallet refund or a ticket refund.
  const payment = await prisma.providerPayment.create({
    data: { userId: payer.id, purpose: 'TICKETS', provider: 'paystack', reference: `ff_ticket_${randomUUID().replaceAll('-', '')}`, amountCents: 8_000 },
  });
  created.paymentIds.push(payment.id);
  assert(await refused(() => prisma.providerPayment.create({ data: { userId: payer.id, purpose: 'TOP_UP', provider: 'paystack', reference: `ff_topup_${randomUUID().replaceAll('-', '')}`, amountCents: 8_000 } })), 'A top-up was allowed without its wallet ledger row.');
  assert(await refused(() => prisma.providerRefund.create({ data: { providerPaymentId: payment.id, amountCents: 8_000, reason: 'smoke', initiatedByUserId: payer.id } })), 'A refund was allowed with neither a wallet debit nor a ticket.');
  const refund = await prisma.providerRefund.create({ data: { providerPaymentId: payment.id, ticketId: second.id, amountCents: 8_000, reason: 'smoke', source: 'TICKET_LEFT', initiatedByUserId: payer.id } });
  assert(await refused(() => prisma.providerRefund.create({ data: { providerPaymentId: payment.id, ticketId: second.id, amountCents: 8_000, reason: 'again', source: 'TICKET_LEFT', initiatedByUserId: payer.id } })), 'A ticket was refunded twice.');
  assert(await refused(() => prisma.providerRefund.update({ where: { id: refund.id }, data: { status: 'RESTORED_TO_WALLET' } })), 'A ticket refund was "returned to the wallet".');
  await prisma.providerRefund.delete({ where: { id: refund.id } });

  // Cancellation reasons for the T-2h team payment cutoff and the dev cutover.
  await prisma.match.update({ where: { id: match.id }, data: { status: 'CANCELLED', cancellationReason: 'TEAM_UNPAID' } });
  await prisma.match.update({ where: { id: match.id }, data: { cancellationReason: 'DEV_TICKETING_CUTOVER' } });
  assert(await refused(() => prisma.match.update({ where: { id: match.id }, data: { cancellationReason: 'MADE_UP' } })), 'An unknown cancellation reason was accepted.');
  console.log('Ticketing schema smoke passed: one live ticket per player per match and one hold per position; amounts match the payment method; closed tickets have an outcome and choices a deadline; credits last at least 3 years with an append-only ledger; ticket payments have no wallet link while top-ups keep theirs; refunds are wallet or ticket refunds, once per ticket, never "back to the wallet"; the new cancellation reasons are accepted.');
} finally {
  await prisma.matchTicket.deleteMany({ where: { checkoutId: { in: created.checkoutIds } } });
  await prisma.ticketCheckout.deleteMany({ where: { id: { in: created.checkoutIds } } });
  await prisma.providerPayment.deleteMany({ where: { id: { in: created.paymentIds } } });
  await prisma.formationSlot.deleteMany({ where: { matchId: { in: world.matchIds } } });
  await prisma.matchLineupEntry.deleteMany({ where: { matchId: { in: world.matchIds } } });
  await world.cleanup().catch((error) => console.error('cleanup failed', error));
  await prisma.$disconnect();
}
