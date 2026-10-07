import './assert-disposable-test-database.js';
import { removeTicketJobsSince } from './support/ticket-job-cleanup.js';
const smokeStartedAt = new Date();
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { prisma } from '../src/database/prisma.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { CardRefundsService } from '../src/modules/payments/card-refunds.service.js';
import { createPayfastItnRouter, PayfastItnProcessor } from '../src/modules/payments/payfast-itn.js';
import { isPayfastCheckoutUrl, PayfastClient, payfastEncode, payfastItnSignature } from '../src/modules/payments/payfast.client.js';
import { gatewayResolver } from '../src/modules/payments/payment-gateways.js';
import { PaystackClient } from '../src/modules/payments/paystack.client.js';
import { TicketCheckoutService } from '../src/modules/tickets/ticket-checkout.service.js';
import { TicketLeaveService } from '../src/modules/tickets/ticket-leave.service.js';
import { TicketSettlementService } from '../src/modules/tickets/ticket-settlement.service.js';
import { managedVenueFixture } from './managed-venue-fixture.js';

/**
 * PayFast as the ticket payment provider, on PostgreSQL, through the real ITN route and the shared settlement path.
 * PayFast's own servers are faked (the validate post-back and the Refund API); everything else is real.
 * - Checkout: a signed sandbox payment form; the place is held and nothing is placed yet.
 * - ITN: a forged notice is refused; a genuine one is stored once and, only after PayFast validates it, places the
 *   player (payment SUCCEEDED with PayFast's payment id). A wrong amount goes to review; a notice PayFast does not
 *   recognise is never applied, and the status check alone never places anyone.
 * - Refund: leaving more than 24 hours out for a refund goes to PayFast's Refund API for the ticket's amount.
 */
const marker = `payfast-${randomUUID().slice(0, 8)}`;
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const MERCHANT = '10000100';
const PASSPHRASE = 'smoke-only sandbox passphrase';
const venue = managedVenueFixture(marker);
const bookings = new BookingsService();
const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
const invalid = new Set<string>();
// PayFast's servers: the ITN validate endpoint answers VALID (INVALID for references listed in `invalid`), and the
// Refund API accepts the refund.
const fakePayfast: typeof fetch = async (input, init) => {
  const url = String(input);
  const body = String(init?.body ?? '');
  calls.push({ url, body, headers: (init?.headers ?? {}) as Record<string, string> });
  if (url.endsWith('/eng/query/validate')) {
    const reference = new URLSearchParams(body).get('m_payment_id') ?? '';
    return new Response(invalid.has(reference) ? 'INVALID' : 'VALID');
  }
  if (url.startsWith('https://api.payfast.co.za/refunds/'))
    return new Response(JSON.stringify({ code: 200, status: 'success', data: { response: true, message: 'Success' } }), { status: 200 });
  return new Response('not found', { status: 404 });
};
const payfast = new PayfastClient(
  { merchantId: MERCHANT, merchantKey: '46f0cd694581a', passphrase: PASSPHRASE, sandbox: true, notifyUrl: 'http://localhost:3000/payments/payfast/itn' },
  fakePayfast,
);
// Paystack is never called here: every payment in this smoke is a PayFast payment.
const resolver = gatewayResolver(new PaystackClient({ secretKey: undefined, baseUrl: 'https://paystack.invalid' }), () => payfast);
const settlement = new TicketSettlementService(undefined, undefined, ['card'], resolver);
const checkouts = new TicketCheckoutService(
  undefined,
  undefined,
  settlement,
  { clientUrl: 'http://localhost:5173', demo: () => false, paystackEnabled: () => true, termsVersion: async () => '2.5', cardProvider: () => 'payfast' },
  resolver,
);
const processor = new PayfastItnProcessor(payfast, settlement);
const refunds = new CardRefundsService(undefined, undefined, resolver);
const matchIds: string[] = [];
const userIds: string[] = [];
const references: string[] = [];

const player = async (label: string) => {
  const user = await prisma.user.create({
    data: {
      email: `${marker}-${label}@smoke.invalid`,
      username: `pf_${randomUUID().slice(0, 12)}`,
      passwordHash: 'smoke-test-only',
      emailVerifiedAt: new Date(),
      onboardingCompletedAt: new Date(),
      profile: { create: { displayName: `${label} ${marker.slice(-4)}`, onboardingStatus: 'COMPLETE', gender: 'MALE' } },
    },
  });
  userIds.push(user.id);
  return user.id;
};
/** An ITN as PayFast posts it: form-encoded fields in PayFast's order, signed with the passphrase. */
const itn = (fields: Record<string, string>, passphrase = PASSPHRASE) => {
  const pairs: Array<[string, string]> = Object.entries({
    m_payment_id: '', pf_payment_id: '', payment_status: 'COMPLETE', item_name: 'FootyFinder match ticket', item_description: '',
    amount_gross: '80.00', amount_fee: '-2.30', amount_net: '77.70', custom_str1: '', email_address: 'player@smoke.invalid', merchant_id: MERCHANT, ...fields,
  });
  return [...pairs, ['signature', payfastItnSignature(pairs, passphrase)]].map(([key, value]) => `${key}=${payfastEncode(value!)}`).join('&');
};

const app = express().use('/payments', createPayfastItnRouter({ merchantId: () => MERCHANT, passphrase: () => PASSPHRASE }));
const server = app.listen(0);
const itnUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/payments/payfast/itn`;
const postItn = (body: string) => fetch(itnUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
/** Runs the queued ITN job for this reference (the durable worker does this in the API). */
const processItns = async (reference: string) => {
  for (const event of await prisma.paymentWebhookEvent.findMany({ where: { provider: 'payfast', reference, processedAt: null, signatureValid: true } }))
    await processor.process(event.id);
};

try {
  await venue.create();
  const [host, a, b, c] = [await player('host'), await player('a'), await player('b'), await player('c')];
  const match = await bookings.createQuickMatch(
    { managedFieldId: venue.fieldId, name: `${marker}-match`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 2, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: venue.nextKickoff().toISOString() },
    host,
  );
  matchIds.push(match.id);
  const sub = { seat: 'SUBSTITUTE' as const, side: 'HOME' as const, method: 'PAYMENT' as const, acceptPolicy: true as const };

  // 1. Checkout: PayFast's signed sandbox form; the place is held, nothing is placed yet.
  const started = await checkouts.start(match.id, a, sub, randomUUID());
  references.push(started.reference!);
  assert(started.state === 'PROCESSING' && started.authorizationUrl && isPayfastCheckoutUrl(started.authorizationUrl, true), 'Checkout did not go to the PayFast sandbox.');
  const form = new URL(started.authorizationUrl).searchParams;
  assert(form.get('m_payment_id') === started.reference && form.get('amount') === '80.00' && /^[0-9a-f]{32}$/.test(form.get('signature') ?? ''), 'The PayFast form is missing the reference, amount or signature.');
  assert(form.get('return_url') === `http://localhost:5173/tickets/return?reference=${started.reference}` && form.get('cancel_url') === `http://localhost:5173/matches/${match.id}`, 'The return or cancel address is wrong.');
  assert(!started.authorizationUrl.includes(payfastEncode(PASSPHRASE)), 'The passphrase reached the checkout address.');
  const payment = await prisma.providerPayment.findUniqueOrThrow({ where: { reference: started.reference! } });
  assert(payment.provider === 'payfast' && payment.status === 'INITIALIZED', 'The payment was not recorded as a PayFast payment.');
  assert((await prisma.matchTicket.findFirstOrThrow({ where: { checkoutId: started.checkoutId } })).status === 'HELD', 'The place was not held.');

  // 2. Before any ITN, the player's status check finds nothing to apply.
  assert((await checkouts.status(a, started.checkoutId)).state === 'PROCESSING', 'The status check placed a player without a PayFast notice.');

  // 3. A forged notice (wrong passphrase) is refused and changes nothing.
  const forged = await postItn(itn({ m_payment_id: started.reference!, pf_payment_id: 'pf-forged', custom_str1: payment.id }, 'guessed passphrase'));
  assert(forged.status === 400, `A forged ITN was not refused (${forged.status}).`);
  assert((await prisma.paymentWebhookEvent.count({ where: { provider: 'payfast', reference: started.reference!, signatureValid: true } })) === 0, 'A forged ITN was stored as genuine.');

  // 4. The genuine notice: 200, stored once, validated with PayFast, then the player is placed.
  const genuine = itn({ m_payment_id: started.reference!, pf_payment_id: 'pf-1089250', custom_str1: payment.id });
  assert((await postItn(genuine)).status === 200 && (await postItn(genuine)).status === 200, 'PayFast did not get 200 for its ITN.');
  assert((await prisma.paymentWebhookEvent.count({ where: { provider: 'payfast', reference: started.reference!, signatureValid: true } })) === 1, 'A repeated ITN was stored twice.');
  await processItns(started.reference!);
  assert(calls.some(({ url, body }) => url === 'https://sandbox.payfast.co.za/eng/query/validate' && body.includes(`m_payment_id=${started.reference}`) && !body.includes('signature=')), 'The ITN was not validated with PayFast.');
  const paid = await prisma.providerPayment.findUniqueOrThrow({ where: { id: payment.id } });
  assert(paid.status === 'SUCCEEDED' && paid.creditedBy === 'webhook' && paid.providerTransactionId === 'pf-1089250', 'The PayFast payment was not confirmed with its PayFast id.');
  assert((await prisma.matchTicket.findFirstOrThrow({ where: { checkoutId: started.checkoutId } })).status === 'CONFIRMED', 'The player was not placed.');
  assert((await checkouts.status(a, started.checkoutId)).state === 'CONFIRMED', 'The return page would not show the place as confirmed.');

  // 5. A genuine notice with the wrong amount goes to review and places nobody.
  const short = await checkouts.start(match.id, b, sub, randomUUID());
  references.push(short.reference!);
  const shortPayment = await prisma.providerPayment.findUniqueOrThrow({ where: { reference: short.reference! } });
  await postItn(itn({ m_payment_id: short.reference!, pf_payment_id: 'pf-short', custom_str1: shortPayment.id, amount_gross: '0.80' }));
  await processItns(short.reference!);
  const reviewed = await prisma.providerPayment.findUniqueOrThrow({ where: { id: shortPayment.id } });
  assert(reviewed.status === 'REVIEW' && reviewed.reviewReason === 'amount_mismatch', 'A short PayFast payment was not sent to review.');
  assert((await prisma.matchTicket.findFirstOrThrow({ where: { checkoutId: short.checkoutId } })).status === 'HELD', 'A short payment placed the player.');

  // 6. A notice PayFast does not recognise is recorded and never applied.
  const unknown = await checkouts.start(match.id, c, sub, randomUUID());
  references.push(unknown.reference!);
  invalid.add(unknown.reference!);
  const unknownPayment = await prisma.providerPayment.findUniqueOrThrow({ where: { reference: unknown.reference! } });
  await postItn(itn({ m_payment_id: unknown.reference!, pf_payment_id: 'pf-unknown', custom_str1: unknownPayment.id }));
  await processItns(unknown.reference!);
  const ignored = await prisma.paymentWebhookEvent.findFirstOrThrow({ where: { provider: 'payfast', reference: unknown.reference! } });
  assert(ignored.outcome === 'itn_not_valid', 'An ITN PayFast did not validate was applied.');
  await prisma.providerPayment.update({ where: { id: unknownPayment.id }, data: { lastVerifiedAt: null } });
  assert((await checkouts.status(c, unknown.checkoutId)).state === 'PROCESSING', 'An unvalidated ITN placed the player through the status check.');

  // 7. Leaving more than 24 hours out with a refund: PayFast's Refund API, for the ticket's amount.
  await new TicketLeaveService().leave(match.id, a, 'REFUND');
  const refund = await prisma.providerRefund.findFirstOrThrow({ where: { providerPaymentId: payment.id } });
  const submitted = await refunds.submitQueued(refund.id);
  assert(submitted?.status === 'PROCESSED', `The PayFast refund was not recorded as processed (${submitted?.status}).`);
  const refundCall = calls.find(({ url }) => url.startsWith('https://api.payfast.co.za/refunds/'));
  assert(refundCall?.url === 'https://api.payfast.co.za/refunds/pf-1089250?testing=true' && JSON.parse(refundCall.body).amount === 8_000, 'The refund did not go to PayFast for R80.');
  assert(refundCall.headers['merchant-id'] === MERCHANT && /^[0-9a-f]{32}$/.test(refundCall.headers.signature ?? '') && !JSON.stringify(refundCall).includes(PASSPHRASE), 'The refund call is not signed properly, or leaks the passphrase.');

  console.log('PayFast smoke passed: checkout is a signed PayFast sandbox form that holds the place; a forged ITN is refused; a genuine ITN gets 200, is stored once and, only after PayFast validates it, places the player (SUCCEEDED with PayFast\'s payment id; the return page shows it confirmed); a wrong amount goes to review; a notice PayFast does not recognise is never applied; and a refund goes to PayFast\'s Refund API for the ticket\'s amount.');
} finally {
  server.close();
  await removeTicketJobsSince(smokeStartedAt);
  await prisma.durableJob.deleteMany({ where: { type: 'PAYFAST_ITN_PROCESS', createdAt: { gte: smokeStartedAt } } });
  await prisma.paymentWebhookEvent.deleteMany({ where: { provider: 'payfast', OR: [{ reference: { in: references } }, { receivedAt: { gte: smokeStartedAt }, signatureValid: false }] } });
  const checkoutRows = await prisma.ticketCheckout.findMany({ where: { matchId: { in: matchIds } }, select: { providerPaymentId: true } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.ticketEmail.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.providerRefund.deleteMany({ where: { ticket: { matchId: { in: matchIds } } } });
  await prisma.matchTicket.deleteMany({ where: { matchId: { in: matchIds } } });
  await prisma.ticketCheckout.deleteMany({ where: { matchId: { in: matchIds } } });
  await prisma.providerPayment.deleteMany({ where: { id: { in: checkoutRows.flatMap(({ providerPaymentId }) => (providerPaymentId ? [providerPaymentId] : [])) } } });
  await venue.cleanupMatches(matchIds);
  await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  await venue.cleanupVenue();
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}
