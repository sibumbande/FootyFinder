import type { Prisma } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { enqueueDurableJob, registerDurableJobHandler } from '../../jobs/durable-jobs.js';
import { createEmailProvider, type EmailProvider } from '../auth/email.provider.js';

export const TICKET_EMAIL_JOB_TYPE = 'TICKET_EMAIL';

/**
 * DEC-021 ticketing emails. Each is queued in the transaction that caused it (sent after commit, once per dedupe
 * key) and logged in TicketEmail when sent, so a payment dispute's evidence pack can list them (A8).
 *   RECEIPT              the ticket receipt, straight after a confirmed purchase (A8)
 *   LATE_PAYMENT_REFUND  the payment arrived after the place or the match was gone: full refund (A1.4)
 */
export type TicketEmailKind = 'RECEIPT' | 'LATE_PAYMENT_REFUND';
type Payload = { kind: TicketEmailKind; userId: string; checkoutId: string };

export const enqueueTicketEmail = (tx: Prisma.TransactionClient, input: Payload) =>
  enqueueDurableJob(tx, {
    type: TICKET_EMAIL_JOB_TYPE,
    dedupeKey: `ticket-email:${input.kind}:${input.checkoutId}:${input.userId}`,
    payload: input,
    runAt: new Date(),
  });

const parse = (payload: unknown): Payload => {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  if (typeof record.kind !== 'string' || typeof record.userId !== 'string' || typeof record.checkoutId !== 'string')
    throw Object.assign(new Error('Invalid ticket email payload.'), { code: 'JOB_PAYLOAD_INVALID' });
  return { kind: record.kind as TicketEmailKind, userId: record.userId, checkoutId: record.checkoutId };
};

const kickoff = (date: Date) =>
  new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
const rands = (cents: number) => `R${Math.round(cents / 100).toLocaleString('en-ZA').replace(/\s/g, ',')}`;
const sideName = (side: string) => (side === 'HOME' ? 'Home' : 'Away');

async function compose(payload: Payload) {
  const checkout = await prisma.ticketCheckout.findUnique({
    where: { id: payload.checkoutId },
    include: {
      match: { select: { id: true, name: true, startsAt: true, venue: { select: { name: true, addressLine1: true, city: true } } } },
      tickets: { include: { slot: { select: { slotIndex: true } }, player: { select: { username: true, profile: { select: { displayName: true } } } } } },
      providerPayment: { select: { reference: true } },
    },
  });
  if (!checkout) return null;
  const { match } = checkout;
  const link = `${env.CLIENT_URL.replace(/\/$/, '')}/matches/${match.id}`;
  const where = [`Match: ${match.name}`, `Venue: ${match.venue.name}, ${match.venue.addressLine1}, ${match.venue.city}`, `Kick-off: ${kickoff(match.startsAt)}`];
  const place = (ticket: (typeof checkout.tickets)[number]) =>
    ticket.seat === 'POSITION' && ticket.slot ? `Position ${ticket.slot.slotIndex}, ${sideName(ticket.side)} side` : ticket.seat === 'SUBSTITUTE' ? `Substitute, ${sideName(ticket.side)} side` : `${sideName(ticket.side)} team`;
  if (payload.kind === 'RECEIPT') {
    const confirmed = checkout.tickets.filter(({ status }) => status === 'CONFIRMED');
    if (!confirmed.length) return null;
    const paid = checkout.method === 'PAYMENT' ? `${rands(checkout.amountCents)} (card or bank payment${checkout.providerPayment ? `, reference ${checkout.providerPayment.reference}` : ''})` : checkout.method === 'CREDIT' ? '1 match credit' : 'Free (R0)';
    const lines = [
      'Your FootyFinder match ticket is confirmed.',
      '',
      ...where,
      ...(confirmed.length === 1
        ? [`Your place: ${place(confirmed[0]!)}`]
        : ['Players:', ...confirmed.map((ticket) => `- ${ticket.player.profile?.displayName ?? ticket.player.username}: ${place(ticket)}`)]),
      `Paid: ${paid}`,
      '',
      'Cancellation policy (the one you accepted before paying):',
      ...checkout.policyText.split('\n').map((line) => `- ${line}`),
      '',
      `Manage my ticket: ${link}`,
    ];
    return { checkout, subject: `Your FootyFinder match ticket: ${match.venue.name}, ${kickoff(match.startsAt)}`, text: lines.join('\n') };
  }
  const refunded = checkout.tickets.filter(({ outcome }) => outcome === 'LATE_PAYMENT_REFUNDED' || outcome === 'DUPLICATE_REFUNDED');
  if (!refunded.length) return null;
  const amount = refunded.reduce((sum, ticket) => sum + ticket.amountCents, 0);
  const lines = [
    `Your payment of ${rands(amount)} for a FootyFinder match ticket is being refunded in full.`,
    '',
    ...where,
    '',
    ...refunded.map((ticket) => `Why: ${ticket.closedReason ?? 'The place was no longer available when your payment came through.'}`),
    '',
    'The money goes back to the card or bank account you paid with. Banks usually take a few working days to show it.',
    `See the match: ${link}`,
  ];
  return { checkout, subject: 'Your FootyFinder payment is being refunded', text: lines.join('\n') };
}

export async function sendTicketEmail(payload: unknown, emails: EmailProvider) {
  const input = parse(payload);
  const to = (await prisma.user.findUnique({ where: { id: input.userId }, select: { email: true } }))?.email;
  if (!to) return;
  const email = await compose(input);
  if (!email) return;
  await emails.send({ to, subject: email.subject, text: email.text });
  await prisma.ticketEmail.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      subject: email.subject,
      matchId: email.checkout.matchId,
      checkoutId: email.checkout.id,
      ticketId: email.checkout.tickets.length === 1 ? email.checkout.tickets[0]!.id : null,
    },
  });
}

export const registerTicketEmailJobHandlers = (emails: EmailProvider = createEmailProvider()) => {
  registerDurableJobHandler(TICKET_EMAIL_JOB_TYPE, (payload) => sendTicketEmail(payload, emails));
};
