import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { registerDurableJobHandler } from '../../jobs/durable-jobs.js';
import { createEmailProvider, type EmailProvider } from '../auth/email.provider.js';
import { matchCancelledMessage } from './cancellation-message.js';
import { MATCH_CANCELLED_EMAIL_JOB_TYPE } from './match-cancelled-email.js';

const invalidPayload = () =>
  Object.assign(new Error('Invalid match-cancelled email payload.'), { code: 'JOB_PAYLOAD_INVALID' });

export const parseMatchCancelledEmailPayload = (payload: unknown) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalidPayload();
  const { matchId, userId, refundedCents } = payload as Record<string, unknown>;
  if (typeof matchId !== 'string' || typeof userId !== 'string' || typeof refundedCents !== 'number')
    throw invalidPayload();
  return { matchId, userId, refundedCents };
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
  const { matchId, userId, refundedCents } = parseMatchCancelledEmailPayload(payload);
  const match = await store.findMatch(matchId);
  if (!match || match.status !== 'CANCELLED') return;
  const to = await store.findEmail(userId);
  if (!to) return;
  const reason = match.cancellationReason === 'POSITIONS_UNFILLED' ? 'POSITIONS_UNFILLED' : 'ORGANISER_CANCELLED';
  const message = matchCancelledMessage({
    venueName: match.venue.name,
    startsAt: match.startsAt,
    reason,
    refundedCents,
  });
  await emails.send({
    to,
    subject: 'Your FootyFinder match was cancelled',
    text: `${message}\n\nView the match: ${env.CLIENT_URL.replace(/\/$/, '')}/matches/${matchId}`,
  });
};

export const registerMatchCancelledEmailJobHandlers = (emails: EmailProvider = createEmailProvider()) => {
  registerDurableJobHandler(MATCH_CANCELLED_EMAIL_JOB_TYPE, (payload) =>
    sendMatchCancelledEmail(payload, emails),
  );
};
