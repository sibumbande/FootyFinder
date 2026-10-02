import { randomUUID } from 'node:crypto';
import {
  ticketCancellationPolicy,
  ticketHoldExpiresAt,
  ticketLeaveOutcome,
  TICKET_REFERENCE_PREFIX,
  type MatchTicketContext,
  type TicketCheckoutInput,
  type TicketCheckoutResult,
} from '@footy-finder/shared';
import type { MatchTicket, ProviderPayment, TicketCheckout } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { enqueueDurableJob } from '../../jobs/durable-jobs.js';
import { logError } from '../../observability/logger.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OnboardingService } from '../onboarding/onboarding.service.js';
import { lockMatchForFormation } from '../matches/matches.repository.js';
import { isPaystackCheckoutUrl, PaystackClient, PaystackError, type PaystackGateway } from '../payments/paystack.client.js';
import { demoDepositsEnabled } from '../wallet/payment-config.js';
import { assertTicketPlaceable, placeableMatchSelect, placeTicketInTx, refusal, releaseExpiredHolds } from './ticket-placement.js';

export const TICKET_HOLD_EXPIRE_JOB_TYPE = 'TICKET_HOLD_EXPIRE';
const PAYSTACK = 'paystack';
const DEMO = 'demo';

type CheckoutRecord = TicketCheckout & { tickets: MatchTicket[]; providerPayment: ProviderPayment | null };

export const toCheckoutResult = (checkout: CheckoutRecord): TicketCheckoutResult => {
  const payment = checkout.providerPayment;
  const ticket = checkout.tickets[0];
  const refunded = checkout.tickets.find(({ outcome }) => outcome === 'LATE_PAYMENT_REFUNDED' || outcome === 'DUPLICATE_REFUNDED');
  const state: TicketCheckoutResult['state'] =
    checkout.status === 'COMPLETED' ? 'CONFIRMED'
      : checkout.status === 'FAILED' || payment?.status === 'FAILED' ? 'FAILED'
        : checkout.status === 'EXPIRED' && !refunded ? 'EXPIRED'
          : refunded ? 'FAILED'
            : 'PROCESSING';
  return {
    checkoutId: checkout.id,
    matchId: checkout.matchId,
    method: checkout.method,
    state,
    amountCents: checkout.amountCents,
    ...(payment ? { reference: payment.reference } : {}),
    ...(state === 'PROCESSING' && payment?.status === 'INITIALIZED' && payment.authorizationUrl ? { authorizationUrl: payment.authorizationUrl } : {}),
    ...(ticket?.holdExpiresAt && state === 'PROCESSING' ? { holdExpiresAt: ticket.holdExpiresAt.toISOString() } : {}),
    ticketIds: checkout.tickets.map(({ id }) => id),
    ...(refunded?.closedReason ? { refundReason: refunded.closedReason } : {}),
  };
};

const checkoutInclude = { tickets: true, providerPayment: true } as const;

/**
 * DEC-021 A1: buying a ticket for one place in a Quick Match (or the individuals side of an "Open to both" team
 * match). The place is held for 10 minutes while the player pays on Paystack's hosted checkout; the player is placed
 * only after the payment is verified by our server, never because the browser says so. A free match gives an R0
 * ticket with no checkout. In development and test the demo operator confirms instantly.
 */
export class TicketCheckoutService {
  constructor(
    private readonly gateway: PaystackGateway = new PaystackClient(),
    private readonly notifications = new NotificationsService(),
    private readonly config: { clientUrl: string; demo: () => boolean; paystackEnabled: () => boolean; termsVersion: () => Promise<string | undefined> } = {
      clientUrl: env.CLIENT_URL,
      demo: () => demoDepositsEnabled(),
      paystackEnabled: () => !demoDepositsEnabled() && Boolean(env.PAYSTACK_SECRET_KEY),
      // The Terms version the player accepted the cancellation policy under (A8).
      termsVersion: async () => (await new OnboardingService().currentLegalDocuments())[0]?.version,
    },
  ) {}

  async start(
    matchId: string,
    userId: string,
    input: TicketCheckoutInput,
    idempotencyKey: string,
    request: { ip?: string; userAgent?: string } = {},
    now = new Date(),
  ): Promise<TicketCheckoutResult> {
    if (!idempotencyKey || idempotencyKey.length > 200)
      throw new AppError(400, 'A valid Idempotency-Key header is required.', 'IDEMPOTENCY_KEY_REQUIRED');
    const replay = await prisma.ticketCheckout.findUnique({ where: { payerId_idempotencyKey: { payerId: userId, idempotencyKey } }, include: checkoutInclude });
    if (replay) {
      if (replay.matchId !== matchId) throw new AppError(409, 'That idempotency key was used for a different purchase.', 'IDEMPOTENCY_KEY_REUSED');
      return toCheckoutResult(replay);
    }
    if (input.method === 'CREDIT')
      throw new AppError(409, 'Paying with a match credit is not available yet.', 'CREDIT_CHECKOUT_UNAVAILABLE');
    const termsVersion = await this.config.termsVersion();
    if (!termsVersion) throw new AppError(503, 'Approved legal documents are not yet available.', 'LEGAL_DOCUMENTS_UNAVAILABLE');
    const demo = this.config.demo();
    if (!demo && !this.config.paystackEnabled())
      throw new AppError(409, 'Card payments are not enabled in this environment.', 'CARD_PAYMENTS_DISABLED');

    const outcome = await serializableTransaction(async (tx) => {
      await lockMatchForFormation(tx, matchId);
      const match = await tx.match.findUnique({ where: { id: matchId }, select: placeableMatchSelect });
      if (!match) throw new AppError(404, 'Match not found.', 'MATCH_NOT_FOUND');
      const payer = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { bookingRestrictedAt: true } });
      if (payer.bookingRestrictedAt) throw refusal('BOOKING_RESTRICTED');
      await releaseExpiredHolds(tx, matchId, now);
      await assertTicketPlaceable(tx, { match, playerId: userId, side: input.side, seat: input.seat, slotId: input.slotId, now });
      const free = match.freeOnFootyFinder;
      const amountCents = free ? 0 : match.feeCents;
      const paymentId = free ? null : randomUUID();
      if (paymentId)
        await tx.providerPayment.create({
          data: {
            id: paymentId,
            userId,
            purpose: 'TICKETS',
            provider: demo ? DEMO : PAYSTACK,
            reference: `${TICKET_REFERENCE_PREFIX}${randomUUID().replaceAll('-', '')}`,
            amountCents,
          },
        });
      const checkout = await tx.ticketCheckout.create({
        data: {
          matchId,
          payerId: userId,
          kind: 'QUICK',
          method: free ? 'FREE' : 'PAYMENT',
          providerPaymentId: paymentId,
          amountCents,
          idempotencyKey,
          policyAcceptedAt: now,
          termsVersion,
          policyText: ticketCancellationPolicy(match.feeCents).join('\n'),
          ipAddress: request.ip?.slice(0, 100) ?? null,
          userAgent: request.userAgent?.slice(0, 500) ?? null,
        },
      });
      const holdExpiresAt = ticketHoldExpiresAt(now);
      const ticket = await tx.matchTicket.create({
        data: {
          matchId,
          checkoutId: checkout.id,
          playerId: userId,
          payerId: userId,
          side: input.side,
          seat: input.seat,
          slotId: input.seat === 'POSITION' ? input.slotId : null,
          method: free ? 'FREE' : 'PAYMENT',
          amountCents,
          holdExpiresAt,
        },
      });
      // A free place, or the demo operator: no checkout to wait for, so place the player straight away.
      if (free || demo) {
        if (paymentId)
          await tx.providerPayment.update({ where: { id: paymentId }, data: { status: 'SUCCEEDED', verifiedAt: now, creditedBy: DEMO, providerStatus: 'success', channel: 'card' } });
        const placed = await placeTicketInTx(tx, ticket.id, now);
        if (!placed.placed) throw new Error(`Placement failed right after the checks passed: ${"reason" in placed ? placed.reason : ""}`);
        return { checkoutId: checkout.id, notifications: placed.notifications, needsPaystack: false };
      }
      await enqueueDurableJob(tx, {
        type: TICKET_HOLD_EXPIRE_JOB_TYPE,
        dedupeKey: `ticket-hold-expire:${checkout.id}`,
        payload: { checkoutId: checkout.id },
        runAt: holdExpiresAt,
      });
      return { checkoutId: checkout.id, notifications: [], needsPaystack: true };
    });
    this.notifications.publishPersistedMany(outcome.notifications);
    emitDomainEventBestEffort('match:updated', { matchId });
    if (!outcome.needsPaystack) return this.result(outcome.checkoutId);
    return this.initializePaystack(outcome.checkoutId, userId);
  }

  /**
   * Asks Paystack for the hosted checkout page. One Paystack transaction = one ticket, with the match facts in its
   * metadata and on the customer's receipt ("FootyFinder match ticket: <venue>, <date time>", A1.5).
   */
  private async initializePaystack(checkoutId: string, userId: string): Promise<TicketCheckoutResult> {
    const checkout = await prisma.ticketCheckout.findUniqueOrThrow({
      where: { id: checkoutId },
      include: { ...checkoutInclude, match: { select: { id: true, startsAt: true, venue: { select: { name: true } } } } },
    });
    const payment = checkout.providerPayment!;
    const claim = await prisma.providerPayment.updateMany({ where: { id: payment.id, initializeStartedAt: null }, data: { initializeStartedAt: new Date() } });
    if (claim.count !== 1) return this.result(checkoutId);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    const kickoff = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(checkout.match.startsAt);
    const ticket = checkout.tickets[0]!;
    const description = `FootyFinder match ticket: ${checkout.match.venue.name}, ${kickoff}`;
    try {
      const started = await this.gateway.initialize({
        email: user.email,
        amountCents: payment.amountCents,
        reference: payment.reference,
        callbackUrl: `${this.config.clientUrl.replace(/\/$/, '')}/tickets/return`,
        metadata: {
          providerPaymentId: payment.id,
          checkoutId: checkout.id,
          matchId: checkout.matchId,
          ticketId: ticket.id,
          positionId: ticket.slotId ?? 'substitute',
          venue: checkout.match.venue.name,
          kickoff: checkout.match.startsAt.toISOString(),
          custom_fields: [{ display_name: 'Item', variable_name: 'item', value: description }],
        },
      });
      if (!isPaystackCheckoutUrl(started.authorizationUrl))
        throw new PaystackError('PAYSTACK_REJECTED', 'The payment provider returned an unexpected checkout address.');
      await prisma.providerPayment.update({ where: { id: payment.id }, data: { authorizationUrl: started.authorizationUrl } });
      return this.result(checkoutId);
    } catch (error) {
      // No checkout page reached the player, so nothing can be paid: release the place. If Paystack ever reports
      // it paid anyway, settlement treats it as a late payment (placed if still free, otherwise refunded).
      const reason = error instanceof PaystackError ? error.code : 'initialize_error';
      await serializableTransaction(async (tx) => {
        const now = new Date();
        await tx.providerPayment.updateMany({ where: { id: payment.id, status: 'INITIALIZED' }, data: { status: 'FAILED', failureReason: reason } });
        await tx.ticketCheckout.updateMany({ where: { id: checkoutId, status: 'PENDING' }, data: { status: 'FAILED' } });
        await tx.matchTicket.updateMany({ where: { checkoutId, status: 'HELD' }, data: { status: 'RELEASED', releasedAt: now } });
      });
      emitDomainEventBestEffort('match:updated', { matchId: checkout.matchId });
      logError('ticket_checkout_initialize_failed', error, { checkoutId });
      throw new AppError(502, 'Card payments are unavailable right now. Please try again.', 'PAYMENT_PROVIDER_UNAVAILABLE');
    }
  }

  async result(checkoutId: string) {
    return toCheckoutResult(await prisma.ticketCheckout.findUniqueOrThrow({ where: { id: checkoutId }, include: checkoutInclude }));
  }

  /** The payer's own checkout, by id (the return page asks this; it never confirms anything itself). */
  async status(userId: string, checkoutId: string): Promise<TicketCheckoutResult> {
    const checkout = await prisma.ticketCheckout.findFirst({ where: { id: checkoutId, payerId: userId }, include: checkoutInclude });
    if (!checkout) throw new AppError(404, 'Checkout not found.', 'CHECKOUT_NOT_FOUND');
    return toCheckoutResult(checkout);
  }

  /** The payer's own checkout, by Paystack reference (Paystack's return URL carries the reference). */
  async statusByReference(userId: string, reference: string): Promise<TicketCheckoutResult> {
    const checkout = await prisma.ticketCheckout.findFirst({ where: { payerId: userId, providerPayment: { reference } }, include: checkoutInclude });
    if (!checkout) throw new AppError(404, 'Checkout not found.', 'CHECKOUT_NOT_FOUND');
    return toCheckoutResult(checkout);
  }

  /** What the confirm and leave sheets need: the viewer's ticket, their credits and the policy (A1.1, A2). */
  async context(matchId: string, userId: string, now = new Date()): Promise<MatchTicketContext> {
    const match = await prisma.match.findUnique({ where: { id: matchId }, select: { id: true, feeCents: true, startsAt: true, status: true, goNoGoAt: true } });
    if (!match) throw new AppError(404, 'Match not found.', 'MATCH_NOT_FOUND');
    const [ticket, credits, user] = await Promise.all([
      prisma.matchTicket.findFirst({
        where: { matchId, playerId: userId, status: { in: ['HELD', 'CONFIRMED', 'CHOICE_PENDING'] } },
        orderBy: { createdAt: 'desc' },
        include: { payer: { select: { id: true, username: true, profile: { select: { displayName: true } } } } },
      }),
      prisma.matchCredit.count({ where: { userId, status: 'AVAILABLE', expiresAt: { gt: now } } }),
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { bookingRestrictedAt: true } }),
    ]);
    const locked = Boolean(match.goNoGoAt && now >= match.goNoGoAt);
    const open = ['OPEN', 'READY'].includes(match.status) && now < match.startsAt;
    const confirmed = ticket?.status === 'CONFIRMED';
    return {
      matchId,
      feeCents: match.feeCents,
      ticket: ticket
        ? {
            id: ticket.id,
            status: ticket.status,
            seat: ticket.seat,
            side: ticket.side,
            method: ticket.method,
            amountCents: ticket.amountCents,
            paidByMe: ticket.payerId === userId,
            ...(ticket.payerId !== userId ? { payerDisplayName: ticket.payer.profile?.displayName ?? ticket.payer.username } : {}),
            ...(ticket.status === 'HELD' && ticket.holdExpiresAt ? { holdExpiresAt: ticket.holdExpiresAt.toISOString() } : {}),
            ...(ticket.choiceDeadlineAt ? { choiceDeadlineAt: ticket.choiceDeadlineAt.toISOString() } : {}),
          }
        : null,
      creditsAvailable: credits,
      bookingRestricted: Boolean(user.bookingRestrictedAt),
      policy: ticketCancellationPolicy(match.feeCents),
      leave: !confirmed
        ? { allowed: false, outcome: 'NOTHING', reason: 'NOT_IN_MATCH' }
        : !open
          ? { allowed: false, outcome: 'NOTHING', reason: 'MATCH_CLOSED' }
          : locked
            ? { allowed: false, outcome: 'NOTHING', reason: 'LINEUP_LOCKED' }
            : ticket.method === 'FREE'
              ? { allowed: true, outcome: 'NOTHING' }
              : ticket.method === 'CREDIT' && ticketLeaveOutcome(match.startsAt, now) === 'CHOICE'
                ? { allowed: true, outcome: 'CREDIT_BACK' }
                : { allowed: true, outcome: ticketLeaveOutcome(match.startsAt, now) },
    };
  }
}

/**
 * The hold-expiry job (A1.2): 10 minutes after a checkout started, a place that is still not paid is released for
 * others. Safe to run twice; a payment confirmed after this is a late payment (placed if the position is still free,
 * otherwise refunded in full).
 */
export async function expireTicketHold(checkoutId: string, now = new Date()) {
  const matchId = await serializableTransaction(async (tx) => {
    const checkout = await tx.ticketCheckout.findUnique({ where: { id: checkoutId } });
    if (!checkout || checkout.status !== 'PENDING') return null;
    await lockMatchForFormation(tx, checkout.matchId);
    // Run early (clock skew): let the durable queue retry it later.
    if (await tx.matchTicket.count({ where: { checkoutId, status: 'HELD', holdExpiresAt: { gt: now } } }))
      throw Object.assign(new Error('The ticket hold has not expired yet.'), { code: 'TICKET_HOLD_NOT_DUE' });
    await tx.matchTicket.updateMany({ where: { checkoutId, status: 'HELD' }, data: { status: 'RELEASED', releasedAt: now } });
    await tx.ticketCheckout.update({ where: { id: checkoutId }, data: { status: 'EXPIRED' } });
    return checkout.matchId;
  });
  if (matchId) emitDomainEventBestEffort('match:updated', { matchId });
}
