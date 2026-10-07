import type { PaymentChannel } from '@footy-finder/shared';
import { env } from '../../config/env.js';

/**
 * TKT-604: minimal Paystack REST client for hosted checkout. The secret key is only ever placed in
 * the Authorization header of the outgoing request. It is never logged, returned or put in an
 * error message, and errors carry only a code and Paystack's own public message.
 */
export type PaystackErrorCode =
  | 'PAYSTACK_NOT_CONFIGURED'
  | 'PAYSTACK_UNAVAILABLE'
  | 'PAYSTACK_DUPLICATE_REFERENCE'
  | 'PAYSTACK_NOT_FOUND'
  | 'PAYSTACK_REJECTED';

export class PaystackError extends Error {
  constructor(
    readonly code: PaystackErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PaystackError';
  }
}

export interface PaystackInitializeInput {
  email: string;
  amountCents: number;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
  /** Where the player lands if they cancel at the provider (PayFast's cancel_url; Paystack has none). */
  cancelUrl?: string;
  /** The line item the player sees at checkout (PayFast's item_name; Paystack uses metadata.custom_fields). */
  description?: string;
}

export interface PaystackVerifiedTransaction {
  id: string;
  reference: string;
  /** Paystack status: success, failed, abandoned, ongoing, pending, processing, queued, reversed. */
  status: string;
  amountCents: number;
  currency: string;
  channel: string | null;
  metadata: Record<string, unknown>;
}

export interface PaystackRefundInput {
  reference: string;
  amountCents: number;
  merchantNote: string;
}

export interface PaystackRefund {
  id: string;
  /** pending, processing, processed, failed, or needs-attention (a bank refund missing the customer's account). */
  status: string;
}

/** CEO touch-up batch 4, item 3 (D8): the customer's bank account for a refund Paystack marked "needs attention". */
export interface PaystackRefundAccount {
  accountNumber: string;
  bankId: string;
}

export interface PaystackBank {
  id: string;
  name: string;
}

export interface PaystackGateway {
  initialize(input: PaystackInitializeInput): Promise<{ authorizationUrl: string; reference: string }>;
  verify(reference: string): Promise<PaystackVerifiedTransaction>;
  refund(input: PaystackRefundInput): Promise<PaystackRefund>;
  retryRefundWithAccount?(refundId: string, account: PaystackRefundAccount): Promise<PaystackRefund>;
  listBanks?(): Promise<PaystackBank[]>;
}

type Fetch = typeof fetch;
const TIMEOUT_MS = 10_000;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export class PaystackClient implements PaystackGateway {
  constructor(
    private readonly config: { secretKey?: string; baseUrl: string; channels?: PaymentChannel[] } = {
      secretKey: env.PAYSTACK_SECRET_KEY,
      baseUrl: env.PAYSTACK_BASE_URL,
    },
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async call(path: string, init: { method: 'GET' | 'POST'; body?: unknown }) {
    if (!this.config.secretKey)
      throw new PaystackError('PAYSTACK_NOT_CONFIGURED', 'Card payments are not configured.');
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, '')}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.config.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new PaystackError('PAYSTACK_UNAVAILABLE', 'The payment provider could not be reached.');
    }
    const body = asRecord(await response.json().catch(() => ({})));
    const message =
      typeof body.message === 'string'
        ? body.message.split(this.config.secretKey).join('[redacted]').slice(0, 200)
        : 'Payment provider error.';
    if (response.status >= 500 || response.status === 429)
      throw new PaystackError('PAYSTACK_UNAVAILABLE', message);
    if (response.status === 404) throw new PaystackError('PAYSTACK_NOT_FOUND', message);
    if (!response.ok || body.status !== true) {
      if (/duplicate/i.test(message)) throw new PaystackError('PAYSTACK_DUPLICATE_REFERENCE', message);
      throw new PaystackError('PAYSTACK_REJECTED', message);
    }
    return asRecord(body.data);
  }

  async initialize(input: PaystackInitializeInput) {
    const data = await this.call('/transaction/initialize', {
      method: 'POST',
      body: {
        email: input.email,
        amount: input.amountCents,
        currency: 'ZAR',
        reference: input.reference,
        callback_url: input.callbackUrl,
        // CEO touch-up batch 4, item 3 (D7): exactly the channels FootyFinder supports (PAYSTACK_CHANNELS).
        channels: this.config.channels ?? env.PAYSTACK_CHANNELS,
        metadata: input.metadata,
      },
    });
    if (typeof data.authorization_url !== 'string' || data.reference !== input.reference)
      throw new PaystackError('PAYSTACK_REJECTED', 'The payment provider returned an unexpected response.');
    return { authorizationUrl: data.authorization_url, reference: input.reference };
  }

  async verify(reference: string): Promise<PaystackVerifiedTransaction> {
    const data = await this.call(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
    return {
      id: String(data.id ?? ''),
      reference: String(data.reference ?? ''),
      status: String(data.status ?? ''),
      amountCents: Number(data.amount),
      currency: String(data.currency ?? ''),
      channel: typeof data.channel === 'string' ? data.channel : null,
      metadata: asRecord(data.metadata),
    };
  }

  async refund(input: PaystackRefundInput): Promise<PaystackRefund> {
    const data = await this.call('/refund', {
      method: 'POST',
      body: { transaction: input.reference, amount: input.amountCents, merchant_note: input.merchantNote },
    });
    return { id: String(data.id ?? ''), status: String(data.status ?? '') };
  }

  /** CEO touch-up batch 4, item 3 (D8): sends the customer's bank account for a "needs attention" refund. Never stored. */
  async retryRefundWithAccount(refundId: string, account: PaystackRefundAccount): Promise<PaystackRefund> {
    const data = await this.call(`/refund/retry_with_customer_details/${encodeURIComponent(refundId)}`, {
      method: 'POST',
      body: { refund_account_details: { currency: 'ZAR', account_number: account.accountNumber, bank_id: account.bankId } },
    });
    return { id: String(data.id ?? refundId), status: String(data.status ?? 'processing') };
  }

  /** South African banks, for the "needs attention" refund form. */
  async listBanks(): Promise<PaystackBank[]> {
    const response = await this.callList('/bank?country=south%20africa&currency=ZAR&perPage=100');
    return response.flatMap((bank) => (bank.id !== undefined && typeof bank.name === 'string' ? [{ id: String(bank.id), name: bank.name }] : []));
  }

  private async callList(path: string) {
    if (!this.config.secretKey) throw new PaystackError('PAYSTACK_NOT_CONFIGURED', 'Card payments are not configured.');
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, '')}${path}`, {
        headers: { Authorization: `Bearer ${this.config.secretKey}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new PaystackError('PAYSTACK_UNAVAILABLE', 'The payment provider could not be reached.');
    }
    const body = asRecord(await response.json().catch(() => ({})));
    if (!response.ok || body.status !== true || !Array.isArray(body.data)) throw new PaystackError('PAYSTACK_UNAVAILABLE', 'The bank list is unavailable.');
    return (body.data as unknown[]).map(asRecord);
  }
}

/** Hosted checkout pages must be on Paystack's checkout domain; anything else is refused. */
export const isPaystackCheckoutUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'checkout.paystack.com';
  } catch {
    return false;
  }
};
