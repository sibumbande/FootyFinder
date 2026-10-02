import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Gate 6 smoke support: an in-memory stand-in for the Paystack REST API on 127.0.0.1, so smokes
 * exercise the real PaystackClient over HTTP without a network or real credentials. It also signs
 * synthetic webhooks the way Paystack does (HMAC-SHA512 of the raw body with the secret key).
 */
export const FAKE_PAYSTACK_SECRET = 'sk_test_smoke-fake-secret-not-a-real-key';

export interface FakeTransaction {
  reference: string;
  amount: number;
  currency: string;
  status: string;
  channel: string;
  metadata: Record<string, unknown>;
  id: number;
}

export class FakePaystack {
  readonly transactions = new Map<string, FakeTransaction>();
  readonly refunds: Array<{ id: number; transaction: string; amount: number; status: string; accountDetails?: Record<string, unknown> }> = [];
  readonly calls = { initialize: 0, verify: 0, refund: 0, retry: 0 };
  failNext: { path: 'initialize' | 'verify' | 'refund'; status: number } | null = null;
  refundStatus = 'pending';
  /** CEO batch 5: a per-transaction refund status (by our reference), overriding refundStatus. */
  readonly refundStatusByReference = new Map<string, string>();
  /** CEO touch-up batch 4, item 3: the exact checkout channels the smoke expects the app to send (PAYSTACK_CHANNELS). */
  expectedChannels: string[] = ['card'];
  private server?: Server;
  private nextId = 1_000;
  baseUrl = '';

  async start() {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const send = (status: number, body: unknown) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        if (req.headers.authorization !== `Bearer ${FAKE_PAYSTACK_SECRET}`)
          return send(401, { status: false, message: 'Invalid key' });
        const path = req.url ?? '';
        // CEO touch-up batch 4, item 3: "needs attention" refunds are retried with the customer's bank account.
        if (path.startsWith('/refund/retry_with_customer_details/')) {
          this.calls.retry += 1;
          const id = Number(decodeURIComponent(path.slice('/refund/retry_with_customer_details/'.length)));
          const refund = this.refunds.find((item) => item.id === id);
          if (!refund) return send(404, { status: false, message: 'Refund not found' });
          const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
          refund.accountDetails = body.refund_account_details as Record<string, unknown>;
          refund.status = 'processing';
          return send(200, { status: true, message: 'Refund retried and has been queued for processing', data: refund });
        }
        if (path.startsWith('/bank')) return send(200, { status: true, message: 'Banks retrieved', data: [{ id: 140, name: 'Capitec Bank' }, { id: 141, name: 'FNB' }] });
        const kind = path.startsWith('/transaction/initialize') ? 'initialize' : path.startsWith('/transaction/verify/') ? 'verify' : path.startsWith('/refund') ? 'refund' : null;
        if (!kind) return send(404, { status: false, message: 'Not found' });
        this.calls[kind] += 1;
        if (this.failNext?.path === kind) {
          const { status } = this.failNext;
          this.failNext = null;
          return send(status, { status: false, message: 'Simulated provider failure' });
        }
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        if (kind === 'initialize') {
          const reference = String(body.reference);
          if (this.transactions.has(reference)) return send(400, { status: false, message: 'Duplicate Transaction Reference' });
          const channels = body.channels as string[] | undefined;
          if (JSON.stringify(channels) !== JSON.stringify(this.expectedChannels) || body.currency !== 'ZAR')
            return send(400, { status: false, message: `Smoke expects exactly ${JSON.stringify(this.expectedChannels)} and ZAR` });
          this.transactions.set(reference, {
            reference,
            amount: Number(body.amount),
            currency: 'ZAR',
            status: 'ongoing',
            channel: 'card',
            metadata: (body.metadata as Record<string, unknown>) ?? {},
            id: this.nextId++,
          });
          return send(200, { status: true, message: 'Authorization URL created', data: { authorization_url: `https://checkout.paystack.com/${reference}`, access_code: 'x', reference } });
        }
        if (kind === 'verify') {
          const reference = decodeURIComponent(path.slice('/transaction/verify/'.length));
          const transaction = this.transactions.get(reference);
          if (!transaction) return send(404, { status: false, message: 'Transaction reference not found' });
          return send(200, { status: true, message: 'Verification successful', data: transaction });
        }
        const refund = { id: this.nextId++, transaction: String(body.transaction), amount: Number(body.amount), status: this.refundStatusByReference.get(String(body.transaction)) ?? this.refundStatus };
        this.refunds.push(refund);
        return send(200, { status: true, message: 'Refund has been queued for processing', data: refund });
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.baseUrl = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
    return this;
  }

  pay(reference: string, overrides: Partial<FakeTransaction> = {}) {
    const transaction = this.transactions.get(reference);
    if (!transaction) throw new Error(`Fake Paystack has no transaction ${reference}`);
    Object.assign(transaction, { status: 'success', ...overrides });
    return transaction;
  }

  /** A webhook body and signature exactly as Paystack would send them. */
  signedEvent(event: string, data: Record<string, unknown>, secret = FAKE_PAYSTACK_SECRET) {
    const raw = JSON.stringify({ event, data });
    return { raw, signature: createHmac('sha512', secret).update(raw).digest('hex') };
  }

  async stop() {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
