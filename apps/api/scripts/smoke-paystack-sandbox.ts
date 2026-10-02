import { createHmac, randomUUID } from 'node:crypto';
import { env } from '../src/config/env.js';
import { isPaystackCheckoutUrl, PaystackClient, PaystackError } from '../src/modules/payments/paystack.client.js';
import { verifyPaystackSignature } from '../src/modules/payments/paystack-webhook.js';
import { evaluateVerification } from '../src/modules/payments/top-up-settlement.service.js';

/**
 * TKT-609: optional check against the real Paystack TEST API (no database). It initialises a
 * ZAR hosted checkout with the configured channels (PAYSTACK_CHANNELS) and verifies it is NOT paid, so nothing
 * could be credited. CEO touch-up batch 4, item 3: it also asks for each new channel (Capitec Pay, Instant EFT,
 * Apple Pay) on its own and reports exactly what Paystack answers. It
 * never prints, logs or returns the secret key, and refuses to run with anything but a test key.
 */
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const secret = env.PAYSTACK_SECRET_KEY;
if (!secret) {
  console.log('Paystack sandbox smoke skipped: PAYSTACK_SECRET_KEY is not set.');
  process.exit(0);
}
assert(secret.startsWith('sk_test_'), 'Refusing to run the sandbox smoke without a Paystack TEST key.');
assert(env.PAYSTACK_BASE_URL === 'https://api.paystack.co', 'Sandbox smoke must call the real Paystack API.');

const client = new PaystackClient({ secretKey: secret, baseUrl: env.PAYSTACK_BASE_URL });
const reference = `ff_topup_${randomUUID().replaceAll('-', '')}`;
const checkout = await client.initialize({
  email: 'gate6-sandbox@example.com',
  amountCents: 5_000,
  reference,
  callbackUrl: `${env.CLIENT_URL.replace(/\/$/, '')}/wallet/top-up/return`,
  metadata: { providerPaymentId: 'sandbox-smoke', userId: 'sandbox-smoke' },
});
assert(isPaystackCheckoutUrl(checkout.authorizationUrl), 'Paystack did not return a hosted checkout URL.');

const verified = await client.verify(reference);
assert(verified.reference === reference, 'Verify returned another reference.');
assert(verified.status !== 'success', 'An unpaid sandbox checkout verified as paid.');
assert(verified.amountCents === 5_000 && verified.currency === 'ZAR', 'Amount or currency changed at Paystack.');
const outcome = evaluateVerification(
  { id: 'sandbox-smoke', userId: 'sandbox-smoke', reference, amountCents: 5_000, createdAt: new Date() },
  verified,
  { finalAttempt: false },
);
assert(outcome.kind === 'WAIT', 'An unpaid checkout would have been acted on.');

const missing = await client.verify(`ff_topup_${'0'.repeat(32)}`).catch((error: unknown) => error);
assert(missing instanceof PaystackError && ['PAYSTACK_NOT_FOUND', 'PAYSTACK_REJECTED'].includes(missing.code), 'Unknown reference did not fail cleanly.');
assert(!String((missing as Error).message).includes(secret), 'A Paystack error message contained the secret key.');

// Our webhook check accepts Paystack's HMAC-SHA512 of the raw body with this key, and only that.
const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference } }));
assert(verifyPaystackSignature(body, createHmac('sha512', secret).update(body).digest('hex'), secret), 'Signature check rejected a correct signature.');
assert(!verifyPaystackSignature(body, createHmac('sha512', 'sk_test_other').update(body).digest('hex'), secret), 'Signature check accepted a forged signature.');

// CEO touch-up batch 4, item 3: what Paystack answers for each new channel on this account (test mode).
const probes: string[] = [];
for (const channel of ['capitec_pay', 'eft', 'apple_pay'] as const) {
  const probe = new PaystackClient({ secretKey: secret, baseUrl: env.PAYSTACK_BASE_URL, channels: [channel] });
  const result = await probe
    .initialize({
      email: 'gate6-sandbox@example.com',
      amountCents: 5_000,
      reference: `ff_topup_${randomUUID().replaceAll('-', '')}`,
      callbackUrl: `${env.CLIENT_URL.replace(/\/$/, '')}/wallet/top-up/return`,
      metadata: { providerPaymentId: 'sandbox-smoke', userId: 'sandbox-smoke' },
    })
    .then(
      (started) => `accepted (checkout ${isPaystackCheckoutUrl(started.authorizationUrl) ? 'on checkout.paystack.com' : 'on an unexpected host'})`,
      (error: unknown) => `refused: ${error instanceof PaystackError ? `${error.code} "${error.message}"` : 'unexpected error'}`,
    );
  probes.push(`${channel}: ${result}`);
}
console.log(`Paystack sandbox channel probes (test mode): ${probes.join('; ')}`);

console.log(`Paystack sandbox smoke passed: ZAR checkout with channels ${JSON.stringify(env.PAYSTACK_CHANNELS)} initialised, verify status "${verified.status}" (not credited), unknown reference rejected, signature check correct.`);
