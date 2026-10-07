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
import { isPaystackCheckoutUrl, PaystackClient, type PaystackGateway } from '../payments/paystack.client.js';
import { isPayfastCheckoutUrl, PayfastError } from '../payments/payfast.client.js';
import { gatewayResolver, providerErrorCode, type GatewayResolver } from '../payments/payment-gateways.js';
import { demoPaymentsEnabled, livePaymentProvider } from '../payments/payment-config.js';
import { assertTicketPlaceable, placeableMatchSelect, placeTicketInTx, refusal, releaseExpiredHolds } from './ticket-placement.js';
import { TicketSettlementService } from './ticket-settlement.service.js';
import { useOldestCreditInTx } from './match-credits.js';
import { enqueueTicketEmail } from './ticket-emails.js';

/** The return page re-verifies with the payment provider at most this often per payment. */
export const TICKET_STATUS_CHECK_MIN_INTERVAL_MS = 5_000;

export const TICKET_HOLD_EXPIRE_JOB_TYPE = 'TICKET_HOLD_EXPIRE';
const DEMO = 'demo';

type CardProvider = 'paystack' | 'payfast';
type CheckoutConfig = {
  clientUrl: string;
  demo: () => boolean;
  /** Card payments can be taken in this environment (the demo operator aside). */
  paystackEnabled: () => boolean;
  termsVersion: () => Promise<string | undefined>;
  /** Which provider takes new card payments; Paystack unless PAYMENT_PROVIDER=payfast. */
  cardProvider?: () => CardProvider;
};

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
 * match). The place is held for 10 minutes while the player pays on the provider's hosted checkout (Paystack, or
 * PayFast); the player is placed only after the payment is verified by our server, never because the browser says so. A free match gives an R0
 * ticket with no checkout. In development and test the demo operator confirms instantly.
 */
export class TicketCheckoutService {
  constructor(
    private readonly gateway: PaystackGateway = new PaystackClient(),
    private readonly notifications = new NotificationsService(),
    private readonly settlement = new TicketSettlementService(gateway),
    private readonly config: CheckoutConfig = {
      clientUrl: env.CLIENT_URL,
      demo: () => demoPaymentsEnabled(),
      paystackEnabled: () => !demoPaymentsEnabled() && livePaymentProvider() !== null,
      // The Terms version the player accepted the cancellation policy under (A8).
      termsVersion: async () => (await new OnboardingService().currentLegalDocuments())[0]?.version,
      cardProvider: () => (livePaymentProvider() === 'payfast' ? 'payfast' : 'paystack'),
    },
    private readonly gatewayFor: GatewayResolver = gatewayResolver(gateway),
  ) {}

  /** The provider new card payments go to (recorded on each payment, which is then always settled and refunded there). */
  cardProvider(): CardProvider {
    return this.config.cardProvider?.() ?? 'paystack';
  }

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
    const termsVersion = await this.config.termsVersion();
    if (!termsVersion) throw new AppError(503, 'Approved legal documents are not yet available.', 'LEGAL_DOCUMENTS_UNAVAILABLE');
    const demo = this.config.demo();
    if (input.method !== 'CREDIT' && !demo && !this.config.paystackEnabled())
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
      // A4: 1 credit = 1 ticket to any paid match (a free match needs no credit). Only for the payer's own seat.
      const credit = !free && input.method === 'CREDIT';
      const method = free ? 'FREE' : credit ? 'CREDIT' : 'PAYMENT';
      const amountCents = method === 'PAYMENT' ? match.feeCents : 0;
      const paymentId = method === 'PAYMENT' ? randomUUID() : null;
      if (paymentId)
        await tx.providerPayment.create({
          data: {
            id: paymentId,
            userId,
            purpose: 'TICKETS',
            provider: demo ? DEMO : this.cardProvider(),
            reference: `${TICKET_REFERENCE_PREFIX}${randomUUID().replaceAll('-', '')}`,
            amountCents,
          },
        });
      const checkout = await tx.ticketCheckout.create({
        data: {
          matchId,
          payerId: userId,
          kind: 'QUICK',
          method,
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
          method,
          amountCents,
          holdExpiresAt,
        },
      });
      if (credit && !(await useOldestCreditInTx(tx, { userId, ticketId: ticket.id, now })))
        throw new AppError(409, 'You have no match credits to use.', 'NO_MATCH_CREDIT');
      // A free place, a credit, or the demo operator: no checkout to wait for, so place the player straight away.
      if (method !== 'PAYMENT' || demo) {
        if (paymentId)
          await tx.providerPayment.update({ where: { id: paymentId }, data: { status: 'SUCCEEDED', verifiedAt: now, creditedBy: DEMO, providerStatus: 'success', channel: 'card' } });
        const placed = await placeTicketInTx(tx, ticket.id, now);
        if (!placed.placed) throw new Error(`Placement failed right after the checks passed: ${"reason" in placed ? placed.reason : ""}`);
        await tx.ticketCheckout.update({ where: { id: checkout.id }, data: { status: 'COMPLETED', completedAt: now } });
        // A8: the ticket receipt straight after a confirmed purchase (paid, credit or free).
        await enqueueTicketEmail(tx, { kind: 'RECEIPT', userId, checkoutId: checkout.id });
        return { checkoutId: checkout.id, notifications: placed.notifications, needsCheckout: false };
      }
      await enqueueDurableJob(tx, {
        type: TICKET_HOLD_EXPIRE_JOB_TYPE,
        dedupeKey: `ticket-hold-expire:${checkout.id}`,
        payload: { checkoutId: checkout.id },
        runAt: holdExpiresAt,
      });
      return { checkoutId: checkout.id, notifications: [], needsCheckout: true };
    });
    this.notifications.publishPersistedMany(outcome.notifications);
    emitDomainEventBestEffort('match:updated', { matchId });
    if (!outcome.needsCheckout) return this.result(outcome.checkoutId);
    return this.initializeCheckout(outcome.checkoutId, userId);
  }

  /**
   * Gets the hosted checkout page from the payment's provider. One transaction = one ticket (A1.5), or, for a team,
   * the named teammates' tickets (A5), with the match facts in its metadata and on the customer's receipt
   * ("FootyFinder match ticket: <venue>, <date time>"). Paystack returns to /tickets/return with the reference added;
   * PayFast returns to the same page with the reference in its return_url, and its cancel_url is the match lobby.
   */
  async initializeCheckout(checkoutId: string, userId: string): Promise<TicketCheckoutResult> {
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
    const count = checkout.tickets.length;
    const description = `FootyFinder match ticket${count > 1 ? `s (${count} players)` : ''}: ${checkout.match.venue.name}, ${kickoff}`;
    const client = this.config.clientUrl.replace(/\/$/, '');
    const payfast = payment.provider === 'payfast';
    try {
      const started = await this.gatewayFor(payment.provider).initialize({
        email: user.email,
        amountCents: payment.amountCents,
        reference: payment.reference,
        callbackUrl: payfast ? `${client}/tickets/return?reference=${encodeURIComponent(payment.reference)}` : `${client}/tickets/return`,
        cancelUrl: `${client}/matches/${checkout.matchId}`,
        description,
        metadata: {
          providerPaymentId: payment.id,
          checkoutId: checkout.id,
          matchId: checkout.matchId,
          ticketId: count === 1 ? ticket.id : checkout.tickets.map(({ id }) => id).join(','),
          positionId: ticket.seat === 'TEAM' ? 'team' : ticket.slotId ?? 'substitute',
          venue: checkout.match.venue.name,
          kickoff: checkout.match.startsAt.toISOString(),
          custom_fields: [{ display_name: 'Item', variable_name: 'item', value: description }],
        },
      });
      if (!(payfast ? isPayfastCheckoutUrl(started.authorizationUrl) : isPaystackCheckoutUrl(started.authorizationUrl)))
        throw new PayfastError('PAYFAST_REJECTED', 'The payment provider returned an unexpected checkout address.');
      await prisma.providerPayment.update({ where: { id: payment.id }, data: { authorizationUrl: started.authorizationUrl } });
      return this.result(checkoutId);
    } catch (error) {
      // No checkout page reached the player, so nothing can be paid: release the place. If the provider ever reports
      // it paid anyway, settlement treats it as a late payment (placed if still free, otherwise refunded).
      const reason = providerErrorCode(error) ?? 'initialize_error';
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

  /** The payer's own checkout, by id. */
  async status(userId: string, checkoutId: string, now = new Date()): Promise<TicketCheckoutResult> {
    const checkout = await prisma.ticketCheckout.findFirst({ where: { id: checkoutId, payerId: userId }, include: checkoutInclude });
    if (!checkout) throw new AppError(404, 'Checkout not found.', 'CHECKOUT_NOT_FOUND');
    return this.verifiedStatus(checkout, now);
  }

  /** The payer's own checkout, by our reference (both providers' return URLs carry it). */
  async statusByReference(userId: string, reference: string, now = new Date()): Promise<TicketCheckoutResult> {
    const checkout = await prisma.ticketCheckout.findFirst({ where: { payerId: userId, providerPayment: { reference } }, include: checkoutInclude });
    if (!checkout) throw new AppError(404, 'Checkout not found.', 'CHECKOUT_NOT_FOUND');
    return this.verifiedStatus(checkout, now);
  }

  /**
   * While a payment is still open, our server re-verifies it with its provider (at most every few seconds) through the
   * shared settlement path, which may place the player. The browser never supplies payment facts.
   */
  private async verifiedStatus(checkout: CheckoutRecord, now: Date) {
    const payment = checkout.providerPayment;
    const due = payment && (!payment.lastVerifiedAt || now.getTime() - payment.lastVerifiedAt.getTime() >= TICKET_STATUS_CHECK_MIN_INTERVAL_MS);
    if (!payment || payment.status !== 'INITIALIZED' || !payment.authorizationUrl || !due) return toCheckoutResult(checkout);
    try {
      await this.settlement.settleFromVerify(payment.reference, 'status_check', { now });
    } catch (error) {
      logError('ticket_status_check_failed', error, { checkoutId: checkout.id });
    }
    return this.result(checkout.id);
  }

  /** What the confirm and leave sheets need: the viewer's ticket, their credits and the policy (A1.1, A2). */
  async context(matchId: string, userId: string, now = new Date()): Promise<MatchTicketContext> {
    const match = await prisma.match.findUnique({ where: { id: matchId }, select: { id: true, feeCents: true, startsAt: true, status: true, goNoGoAt: true } });
    if (!match) throw new AppError(404, 'Match not found.', 'MATCH_NOT_FOUND');
    const [ticket, credits, user, pending] = await Promise.all([
      prisma.matchTicket.findFirst({
        where: { matchId, playerId: userId, status: { in: ['HELD', 'CONFIRMED', 'CHOICE_PENDING'] } },
        orderBy: { createdAt: 'desc' },
        include: { payer: { select: { id: true, username: true, profile: { select: { displayName: true } } } } },
      }),
      prisma.matchCredit.count({ where: { userId, status: 'AVAILABLE', expiresAt: { gt: now } } }),
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { bookingRestrictedAt: true } }),
      prisma.matchTicket.findMany({
        where: { matchId, payerId: userId, status: 'CHOICE_PENDING' },
        orderBy: { createdAt: 'asc' },
        include: { player: { select: { username: true, profile: { select: { displayName: true } } } } },
      }),
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
      pendingChoices: pending.map((item) => ({
        ticketId: item.id,
        playerDisplayName: item.player.profile?.displayName ?? item.player.username,
        amountCents: item.amountCents,
        choiceDeadlineAt: (item.choiceDeadlineAt ?? new Date()).toISOString(),
      })),
      policy: ticketCancellationPolicy(match.feeCents),
      ...(!this.config.demo() && this.config.paystackEnabled() ? { paymentProvider: this.cardProvider() } : {}),
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
