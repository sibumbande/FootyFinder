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
 *   TEAM_PAYMENT_DUE     T-4h: the team isn't fully paid; what is still needed and by when (A5 / D1)
 *   SEAT_LEFT            a team player left; the payer and the player both hear what happens to the money (A5)
 *   WITHDRAWAL_CHOICE    the team that took the other side withdrew: choose a credit or a refund (A5 / A3)
 */
export type TicketEmailKind = 'RECEIPT' | 'LATE_PAYMENT_REFUND' | 'TEAM_PAYMENT_DUE' | 'SEAT_LEFT' | 'WITHDRAWAL_CHOICE';
type Payload = { kind: TicketEmailKind; userId: string; checkoutId?: string; matchId?: string; ticketId?: string; side?: string; message?: string };

export const enqueueTicketEmail = (tx: Prisma.TransactionClient, input: Payload & { checkoutId: string }) =>
  enqueueDurableJob(tx, {
    type: TICKET_EMAIL_JOB_TYPE,
    dedupeKey: `ticket-email:${input.kind}:${input.checkoutId}:${input.userId}`,
    payload: input,
    runAt: new Date(),
  });

/** D1: the T-4h team payment alert email (one per person, team side and match). */
export const enqueueTeamPaymentDueEmail = (tx: Prisma.TransactionClient, input: { userId: string; matchId: string; side: string; message: string }) =>
  enqueueDurableJob(tx, {
    type: TICKET_EMAIL_JOB_TYPE,
    dedupeKey: `ticket-email:TEAM_PAYMENT_DUE:${input.matchId}:${input.side}:${input.userId}`,
    payload: { kind: 'TEAM_PAYMENT_DUE', ...input },
    runAt: new Date(),
  });

/** A5: a team player left; the payer and the player are both told (one email each). */
export const enqueueSeatLeftEmail = (tx: Prisma.TransactionClient, input: { userId: string; ticketId: string; message: string }) =>
  enqueueDurableJob(tx, {
    type: TICKET_EMAIL_JOB_TYPE,
    dedupeKey: `ticket-email:SEAT_LEFT:${input.ticketId}:${input.userId}`,
    payload: { kind: 'SEAT_LEFT', ...input },
    runAt: new Date(),
  });

/** A5: the loading team withdrew; each of its payers chooses a credit or a refund (one email per payer). */
export const enqueueWithdrawalChoiceEmail = (tx: Prisma.TransactionClient, input: { userId: string; matchId: string; message: string }) =>
  enqueueDurableJob(tx, {
    type: TICKET_EMAIL_JOB_TYPE,
    dedupeKey: `ticket-email:WITHDRAWAL_CHOICE:${input.matchId}:${input.userId}`,
    payload: { kind: 'WITHDRAWAL_CHOICE', ...input },
    runAt: new Date(),
  });

const parse = (payload: unknown): Payload => {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const text = (key: string) => (typeof record[key] === 'string' ? (record[key] as string) : undefined);
  if (!text('kind') || !text('userId'))
    throw Object.assign(new Error('Invalid ticket email payload.'), { code: 'JOB_PAYLOAD_INVALID' });
  return { kind: text('kind') as TicketEmailKind, userId: text('userId')!, checkoutId: text('checkoutId'), matchId: text('matchId'), ticketId: text('ticketId'), side: text('side'), message: text('message') };
};

/** The emails that carry a ready-made sentence (deadlines, leaving, a withdrawal), with the match link. */
async function composeNotice(payload: Payload) {
  const ticket = payload.ticketId ? await prisma.matchTicket.findUnique({ where: { id: payload.ticketId }, select: { matchId: true, checkoutId: true } }) : null;
  const matchId = payload.matchId ?? ticket?.matchId;
  if (!matchId || !payload.message) return null;
  const match = await prisma.match.findUnique({ where: { id: matchId }, select: { id: true, name: true, startsAt: true, venue: { select: { name: true } } } });
  if (!match) return null;
  const link = `${env.CLIENT_URL.replace(/\/$/, '')}/matches/${match.id}`;
  const subject = payload.kind === 'TEAM_PAYMENT_DUE'
    ? 'Your team isn’t fully paid yet'
    : payload.kind === 'SEAT_LEFT'
      ? 'A player left your FootyFinder team match'
      : 'A team withdrew: choose a match credit or a refund';
  const lines = [
    payload.message,
    '',
    `Match: ${match.name}`,
    `Venue: ${match.venue.name}`,
    `Kick-off: ${kickoff(match.startsAt)}`,
    '',
    ...(payload.kind === 'TEAM_PAYMENT_DUE' ? [`Pay for your team: ${link}?pay=${(payload.side ?? 'home').toLowerCase()}`] : []),
    ...(payload.kind === 'WITHDRAWAL_CHOICE' ? [`Get a match credit (use it on any match): ${link}?choice=credit`, `Refund to my card / bank: ${link}?choice=refund`] : []),
    `View the match: ${link}`,
  ];
  return { subject, text: lines.join('\n'), matchId: match.id, checkoutId: ticket?.checkoutId ?? null, ticketId: payload.ticketId ?? null };
}

const kickoff = (date: Date) =>
  new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
const rands = (cents: number) => `R${Math.round(cents / 100).toLocaleString('en-ZA').replace(/\s/g, ',')}`;
const sideName = (side: string) => (side === 'HOME' ? 'Home' : 'Away');

async function compose(payload: Payload) {
  if (!payload.checkoutId) return null;
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
  if (input.kind === 'TEAM_PAYMENT_DUE' || input.kind === 'SEAT_LEFT' || input.kind === 'WITHDRAWAL_CHOICE') {
    const notice = await composeNotice(input);
    if (!notice) return;
    await emails.send({ to, subject: notice.subject, text: notice.text });
    await prisma.ticketEmail.create({ data: { userId: input.userId, kind: input.kind, subject: notice.subject, matchId: notice.matchId, checkoutId: notice.checkoutId, ticketId: notice.ticketId } });
    return;
  }
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
