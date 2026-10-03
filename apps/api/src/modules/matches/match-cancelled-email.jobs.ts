import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { registerDurableJobHandler } from '../../jobs/durable-jobs.js';
import { createEmailProvider, type EmailProvider } from '../auth/email.provider.js';
import { isMatchCancellationReason, matchCancelledMessage } from './cancellation-message.js';
import { MATCH_CANCELLED_EMAIL_JOB_TYPE } from './match-cancelled-email.js';

const invalidPayload = () =>
  Object.assign(new Error('Invalid match-cancelled email payload.'), { code: 'JOB_PAYLOAD_INVALID' });

export const parseMatchCancelledEmailPayload = (payload: unknown) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalidPayload();
  // Jobs queued before DEC-021 may also carry refundedCents/teamMember; that wallet wording is no longer sent.
  const { matchId, userId, choiceSeats, choiceCents, creditsReturned } = payload as Record<string, unknown>;
  if (typeof matchId !== 'string' || typeof userId !== 'string') throw invalidPayload();
  const count = (value: unknown) => (typeof value === 'number' && value > 0 ? value : 0);
  return { matchId, userId, choiceSeats: count(choiceSeats), choiceCents: count(choiceCents), creditsReturned: count(creditsReturned) };
};

type MatchCancelledEmailStore = {
  findMatch(matchId: string): Promise<{
    status: string;
    startsAt: Date;
    cancellationReason: string | null;
    venue: { name: string };
  } | null>;
  findEmail(userId: string): Promise<string | null>;
};

const prismaStore: MatchCancelledEmailStore = {
  findMatch: (matchId) =>
    prisma.match.findUnique({
      where: { id: matchId },
      select: { status: true, startsAt: true, cancellationReason: true, venue: { select: { name: true } } },
    }),
  findEmail: async (userId) =>
    (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? null,
};

/**
 * Sends one transactional email for a cancelled match. Delivery is at-least-once: a crash after the
 * provider accepts the email but before the job is marked SUCCEEDED can resend it.
 */
export const sendMatchCancelledEmail = async (
  payload: unknown,
  emails: EmailProvider,
  store: MatchCancelledEmailStore = prismaStore,
) => {
  const { matchId, userId, choiceSeats, choiceCents, creditsReturned } = parseMatchCancelledEmailPayload(payload);
  const match = await store.findMatch(matchId);
  if (!match || match.status !== 'CANCELLED') return;
  const to = await store.findEmail(userId);
  if (!to) return;
  const reason = isMatchCancellationReason(match.cancellationReason) ? match.cancellationReason : 'ORGANISER_CANCELLED';
  const message = matchCancelledMessage({
    venueName: match.venue.name,
    startsAt: match.startsAt,
    reason,
    choiceSeats,
    choiceCents,
    creditsReturned,
  });
  const link = `${env.CLIENT_URL.replace(/\/$/, '')}/matches/${matchId}`;
  // DEC-021 A3: the alert carries both choices; each opens the match page with that choice ready to confirm.
  const choices = choiceSeats
    ? `\n\nGet a match credit (use it on any match): ${link}?choice=credit\nRefund to my card / bank: ${link}?choice=refund`
    : '';
  await emails.send({
    to,
    subject: 'Your FootyFinder match was cancelled',
    text: `${message}${choices}\n\nView the match: ${link}`,
  });
};

export const registerMatchCancelledEmailJobHandlers = (emails: EmailProvider = createEmailProvider()) => {
  registerDurableJobHandler(MATCH_CANCELLED_EMAIL_JOB_TYPE, (payload) =>
    sendMatchCancelledEmail(payload, emails),
  );
};
