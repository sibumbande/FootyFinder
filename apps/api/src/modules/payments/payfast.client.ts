import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import type {
  PaystackGateway,
  PaystackInitializeInput,
  PaystackRefund,
  PaystackRefundInput,
  PaystackVerifiedTransaction,
} from './paystack.client.js';

/**
 * PayFast, an alternative to Paystack for DEC-021 match tickets (PAYMENT_PROVIDER=payfast). It fits the same gateway
 * shape, so checkout, settlement and refunds keep one path:
 * - initialize: the signed PayFast payment form (card only), as a checkout address on PayFast's process page.
 * - verify: the newest ITN for the reference that PayFast itself confirmed as genuine (the ITN handler checks the
 *   signature and merchant id; the ITN job posts it back to PayFast's validate endpoint). Nothing the browser sends
 *   counts, and the amount, currency and our payment id are checked against our own record by settlement.
 * - refund: PayFast's Refund API with the merchant credentials, to the original payment (partial amounts allowed).
 * The passphrase salts every signature and is never sent, logged or put in an error.
 */
export type PayfastErrorCode = 'PAYFAST_NOT_CONFIGURED' | 'PAYFAST_UNAVAILABLE' | 'PAYFAST_NOT_FOUND' | 'PAYFAST_REJECTED';

export class PayfastError extends Error {
  constructor(
    readonly code: PayfastErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PayfastError';
  }
}

export interface PayfastConfig {
  merchantId?: string;
  merchantKey?: string;
  passphrase?: string;
  sandbox: boolean;
  /** Where PayFast posts the ITN: PUBLIC_API_URL/payments/payfast/itn. */
  notifyUrl: string;
}

const defaultConfig = (): PayfastConfig => ({
  merchantId: env.PAYFAST_MERCHANT_ID,
  merchantKey: env.PAYFAST_MERCHANT_KEY,
  passphrase: env.PAYFAST_PASSPHRASE,
  sandbox: env.PAYFAST_SANDBOX,
  notifyUrl: `${env.PUBLIC_API_URL.replace(/\/$/, '')}/payments/payfast/itn`,
});

const host = (sandbox: boolean) => (sandbox ? 'sandbox.payfast.co.za' : 'www.payfast.co.za');
export const payfastProcessUrl = (sandbox: boolean) => `https://${host(sandbox)}/eng/process`;
export const payfastValidateUrl = (sandbox: boolean) => `https://${host(sandbox)}/eng/query/validate`;
const API_URL = 'https://api.payfast.co.za';
const TIMEOUT_MS = 10_000;

/** PHP's urlencode (what PayFast signs with): spaces as '+', uppercase hex, and !'()*~ encoded too. */
export const payfastEncode = (value: string) =>
  encodeURIComponent(value)
    .replace(/[!'()*~]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');

const md5 = (value: string) => createHash('md5').update(value, 'utf8').digest('hex');
const paramString = (pairs: ReadonlyArray<readonly [string, string]>) => pairs.map(([key, value]) => `${key}=${payfastEncode(value)}`).join('&');
const withPassphrase = (base: string, passphrase?: string) => (passphrase ? `${base}${base ? '&' : ''}passphrase=${payfastEncode(passphrase.trim())}` : base);

/** The checkout signature: the non-empty fields, trimmed, in the order they are sent, plus the passphrase. */
export const payfastCheckoutSignature = (pairs: ReadonlyArray<readonly [string, string]>, passphrase?: string) =>
  md5(withPassphrase(paramString(pairs.map(([key, value]) => [key, value.trim()] as const).filter(([, value]) => value !== '')), passphrase));

/** The ITN signature: every field PayFast posted before `signature`, in the order received, plus the passphrase. */
export const payfastItnSignature = (pairs: ReadonlyArray<readonly [string, string]>, passphrase?: string) => md5(withPassphrase(paramString(pairs), passphrase));

/** The fields an ITN carries before its signature, in order (what was signed, and what is posted back to validate). */
export const itnSignedPairs = (pairs: ReadonlyArray<readonly [string, string]>) => {
  const end = pairs.findIndex(([key]) => key === 'signature');
  return end === -1 ? [...pairs] : pairs.slice(0, end);
};

export const verifyPayfastItnSignature = (pairs: ReadonlyArray<readonly [string, string]>, signature: string | undefined, passphrase?: string) => {
  if (!signature || !/^[0-9a-f]{32}$/i.test(signature)) return false;
  const expected = Buffer.from(payfastItnSignature(itnSignedPairs(pairs), passphrase), 'hex');
  const actual = Buffer.from(signature.toLowerCase(), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

/** The Refund API signature: header and body values sorted by name, plus the passphrase. */
export const payfastApiSignature = (values: Record<string, string>, passphrase?: string) =>
  md5(paramString(Object.entries({ ...values, ...(passphrase ? { passphrase: passphrase.trim() } : {}) }).sort(([a], [b]) => a.localeCompare(b))));

/** "80.00" -> 8000; anything that is not a plain rand amount is NaN (settlement then sends the payment to review). */
export const payfastAmountCents = (value: string | undefined) => (value && /^\d+(\.\d{1,2})?$/.test(value) ? Math.round(Number(value) * 100) : Number.NaN);

/** PayFast's payment_status, in the words settlement uses for every provider. */
const STATUS: Record<string, string> = { COMPLETE: 'success', FAILED: 'failed', CANCELLED: 'abandoned', PENDING: 'pending' };

type Fetch = typeof fetch;

export class PayfastClient implements PaystackGateway {
  constructor(
    private readonly config: PayfastConfig = defaultConfig(),
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private credentials() {
    const { merchantId, merchantKey, passphrase } = this.config;
    if (!merchantId || !merchantKey || !passphrase) throw new PayfastError('PAYFAST_NOT_CONFIGURED', 'Card payments are not configured.');
    return { merchantId, merchantKey, passphrase };
  }

  /** The signed payment form, as fields in PayFast's documented order (the order they are signed and sent in). */
  checkoutFields(input: PaystackInitializeInput): Array<[string, string]> {
    const { merchantId, merchantKey, passphrase } = this.credentials();
    const fields: Array<[string, string]> = [
      ['merchant_id', merchantId],
      ['merchant_key', merchantKey],
      ['return_url', input.callbackUrl],
      ['cancel_url', input.cancelUrl ?? input.callbackUrl],
      ['notify_url', this.config.notifyUrl],
      ['email_address', input.email],
      ['m_payment_id', input.reference],
      ['amount', (input.amountCents / 100).toFixed(2)],
      ['item_name', (input.description ?? 'FootyFinder match ticket').slice(0, 100)],
      ['custom_str1', String(input.metadata.providerPaymentId ?? '')],
      ['custom_str2', String(input.metadata.checkoutId ?? '')],
      // Card only: the methods the Terms of Service name (clause 13.3), refunded automatically to the card.
      ['payment_method', 'cc'],
    ];
    const kept = fields.filter(([, value]) => value.trim() !== '').map(([key, value]) => [key, value.trim()] as [string, string]);
    return [...kept, ['signature', payfastCheckoutSignature(kept, passphrase)]];
  }

  async initialize(input: PaystackInitializeInput) {
    const query = paramString(this.checkoutFields(input));
    return { authorizationUrl: `${payfastProcessUrl(this.config.sandbox)}?${query}`, reference: input.reference };
  }

  /** Asks PayFast whether an ITN is genuine: the signed fields posted back to its validate endpoint answer "VALID". */
  async validateItn(pairs: ReadonlyArray<readonly [string, string]>) {
    let response: Response;
    try {
      response = await this.fetchImpl(payfastValidateUrl(this.config.sandbox), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: paramString(itnSignedPairs(pairs)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new PayfastError('PAYFAST_UNAVAILABLE', 'PayFast could not be reached to validate a payment notification.');
    }
    if (response.status >= 500) throw new PayfastError('PAYFAST_UNAVAILABLE', 'PayFast could not validate the payment notification right now.');
    return (await response.text()).trim() === 'VALID';
  }

  async verify(reference: string): Promise<PaystackVerifiedTransaction> {
    const events = await prisma.paymentWebhookEvent.findMany({
      where: { provider: 'payfast', reference, signatureValid: true, payload: { path: ['validated'], equals: true } },
      orderBy: { receivedAt: 'desc' },
      select: { payload: true },
    });
    const notices = events.map(({ payload }) => {
      const fields = (payload as { fields?: Record<string, string> } | null)?.fields ?? {};
      return fields;
    });
    // A completed payment wins over an earlier or later pending notice for the same reference.
    const itn = notices.find((fields) => fields.payment_status === 'COMPLETE') ?? notices[0];
    if (!itn) throw new PayfastError('PAYFAST_NOT_FOUND', 'No validated PayFast notification for this payment yet.');
    return {
      id: itn.pf_payment_id ?? '',
      reference: itn.m_payment_id ?? '',
      status: STATUS[itn.payment_status ?? ''] ?? (itn.payment_status ?? '').toLowerCase(),
      amountCents: payfastAmountCents(itn.amount_gross),
      // PayFast settles in rand only.
      currency: 'ZAR',
      channel: 'payfast',
      metadata: { ...(itn.custom_str1 ? { providerPaymentId: itn.custom_str1 } : {}) },
    };
  }

  /**
   * PayFast's Refund API (POST /refunds/{pf_payment_id}) for the ticket's own amount. PayFast does not send refund
   * webhooks, so an accepted card refund is recorded as processed; one PayFast refuses stays FAILED for finance.
   */
  async refund(input: PaystackRefundInput): Promise<PaystackRefund> {
    const { merchantId, passphrase } = this.credentials();
    const payment = await prisma.providerPayment.findUnique({ where: { reference: input.reference }, select: { providerTransactionId: true } });
    if (!payment?.providerTransactionId) throw new PayfastError('PAYFAST_REJECTED', 'The PayFast payment id for this refund is unknown.');
    const body = { amount: String(input.amountCents), reason: input.merchantNote.slice(0, 100), notify_buyer: '1' };
    const headers = { 'merchant-id': merchantId, version: 'v1', timestamp: new Date().toISOString().slice(0, 19) };
    const url = `${API_URL}/refunds/${encodeURIComponent(payment.providerTransactionId)}${this.config.sandbox ? '?testing=true' : ''}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { ...headers, signature: payfastApiSignature({ ...headers, ...body }, passphrase), 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: input.amountCents, reason: body.reason, notify_buyer: 1 }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new PayfastError('PAYFAST_UNAVAILABLE', 'PayFast could not be reached.');
    }
    const result = (await response.json().catch(() => ({}))) as { status?: unknown; data?: { response?: unknown; message?: unknown } };
    const message = typeof result.data?.message === 'string' ? result.data.message.split(passphrase).join('[redacted]').slice(0, 200) : 'PayFast refused the refund.';
    if (response.status >= 500 || response.status === 429) throw new PayfastError('PAYFAST_UNAVAILABLE', message);
    if (!response.ok || result.status !== 'success' || result.data?.response === false) throw new PayfastError('PAYFAST_REJECTED', message);
    return { id: '', status: 'processed' };
  }
}

/** PayFast's hosted payment page (sandbox or live, as configured); any other address is refused. */
export const isPayfastCheckoutUrl = (value: string, sandbox = env.PAYFAST_SANDBOX) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === host(sandbox) && url.pathname === '/eng/process';
  } catch {
    return false;
  }
};
