import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  events: [] as Array<{ payload: unknown }>,
  payment: null as { providerTransactionId: string | null } | null,
  eventQuery: undefined as unknown,
}));
vi.mock('../../database/prisma.js', () => ({
  prisma: {
    paymentWebhookEvent: {
      findMany: vi.fn(async (query: unknown) => {
        db.eventQuery = query;
        return db.events;
      }),
    },
    providerPayment: { findUnique: vi.fn(async () => db.payment) },
  },
}));

const {
  isPayfastCheckoutUrl,
  PayfastClient,
  PayfastError,
  payfastAmountCents,
  payfastApiSignature,
  payfastEncode,
  verifyPayfastItnSignature,
} = await import('./payfast.client.js');

// Fake merchant values shaped like PayFast's sandbox ones; real credentials are never read by unit tests.
const config = { merchantId: '10000100', merchantKey: '46f0cd694581a', passphrase: 'unit-fake passphrase', sandbox: true, notifyUrl: 'https://api.example.test/payments/payfast/itn' };
const md5 = (value: string) => createHash('md5').update(value).digest('hex');
const client = (fetchImpl: typeof fetch = vi.fn() as never, overrides = {}) => new PayfastClient({ ...config, ...overrides }, fetchImpl);
const input = {
  email: 'player@example.invalid',
  amountCents: 8_000,
  reference: 'ff_ticket_1',
  callbackUrl: 'http://localhost:5173/tickets/return?reference=ff_ticket_1',
  cancelUrl: 'http://localhost:5173/matches/m1',
  description: 'FootyFinder match ticket: Green Point Park, 9 Oct 2026, 19:00',
  metadata: { providerPaymentId: 'p1', checkoutId: 'c1' },
};

beforeEach(() => {
  db.events = [];
  db.payment = null;
});

describe('PayFast encoding and signatures', () => {
  it('encodes like PHP urlencode, which PayFast signs with', () => {
    expect(payfastEncode("Test & Co's (item) ~*! ok")).toBe('Test+%26+Co%27s+%28item%29+%7E%2A%21+ok');
    expect(payfastEncode('http://localhost:5173/tickets/return?reference=ff_ticket_1')).toBe('http%3A%2F%2Flocalhost%3A5173%2Ftickets%2Freturn%3Freference%3Dff_ticket_1');
  });

  it('reads rand amounts exactly and refuses anything else', () => {
    expect(payfastAmountCents('80.00')).toBe(8_000);
    expect(payfastAmountCents('160.5')).toBe(16_050);
    expect(payfastAmountCents('80,00')).toBeNaN();
    expect(payfastAmountCents(undefined)).toBeNaN();
  });

  it('checks an ITN signature over the fields before it, in order, empty ones included, with the passphrase', () => {
    const pairs: Array<[string, string]> = [['m_payment_id', 'ff_ticket_1'], ['pf_payment_id', '1089250'], ['payment_status', 'COMPLETE'], ['item_description', ''], ['amount_gross', '80.00'], ['merchant_id', '10000100']];
    const signature = md5('m_payment_id=ff_ticket_1&pf_payment_id=1089250&payment_status=COMPLETE&item_description=&amount_gross=80.00&merchant_id=10000100&passphrase=unit-fake+passphrase');
    expect(verifyPayfastItnSignature([...pairs, ['signature', signature]], signature, config.passphrase)).toBe(true);
    expect(verifyPayfastItnSignature([...pairs, ['signature', signature]], signature.toUpperCase(), config.passphrase)).toBe(true);
    const tampered = pairs.map(([key, value]) => [key, key === 'amount_gross' ? '0.80' : value] as [string, string]);
    expect(verifyPayfastItnSignature([...tampered, ['signature', signature]], signature, config.passphrase)).toBe(false);
    expect(verifyPayfastItnSignature([...pairs, ['signature', signature]], signature, 'another passphrase')).toBe(false);
    expect(verifyPayfastItnSignature(pairs, undefined, config.passphrase)).toBe(false);
    expect(verifyPayfastItnSignature(pairs, 'not-a-signature', config.passphrase)).toBe(false);
  });

  it('signs Refund API calls over the header and body values sorted by name, with the passphrase', () => {
    expect(payfastApiSignature({ version: 'v1', 'merchant-id': '10000100', timestamp: '2026-10-07T10:00:00', amount: '8000' }, config.passphrase)).toBe(
      md5('amount=8000&merchant-id=10000100&passphrase=unit-fake+passphrase&timestamp=2026-10-07T10%3A00%3A00&version=v1'),
    );
  });
});

describe('PayfastClient checkout', () => {
  it('builds the signed payment form on the sandbox process page (methods are set in the PayFast dashboard)', async () => {
    const { authorizationUrl, reference } = await client().initialize(input);
    expect(reference).toBe('ff_ticket_1');
    const url = new URL(authorizationUrl);
    expect(`${url.origin}${url.pathname}`).toBe('https://sandbox.payfast.co.za/eng/process');
    expect(isPayfastCheckoutUrl(authorizationUrl, true)).toBe(true);
    const fields = [...url.searchParams.entries()];
    expect(fields.map(([key]) => key)).toEqual([
      'merchant_id', 'merchant_key', 'return_url', 'cancel_url', 'notify_url', 'email_address', 'm_payment_id', 'amount', 'item_name', 'custom_str1', 'custom_str2', 'signature',
    ]);
    const values = Object.fromEntries(fields);
    expect(values).toMatchObject({
      merchant_id: '10000100', return_url: input.callbackUrl, cancel_url: input.cancelUrl, notify_url: config.notifyUrl,
      m_payment_id: 'ff_ticket_1', amount: '80.00', item_name: input.description, custom_str1: 'p1', custom_str2: 'c1',
    });
    // The signature covers every other field in order, then the passphrase, which itself is never sent.
    const signed = fields.slice(0, -1).map(([key, value]) => `${key}=${payfastEncode(value)}`).join('&');
    expect(values.signature).toBe(md5(`${signed}&passphrase=${payfastEncode(config.passphrase)}`));
    expect(authorizationUrl).not.toContain('passphrase');
    expect(authorizationUrl).not.toContain(payfastEncode(config.passphrase));
  });

  it('uses the live process page outside the sandbox, and refuses to start without credentials', async () => {
    const { authorizationUrl } = await client(undefined, { sandbox: false }).initialize(input);
    expect(authorizationUrl.startsWith('https://www.payfast.co.za/eng/process?')).toBe(true);
    expect(isPayfastCheckoutUrl(authorizationUrl, false)).toBe(true);
    expect(isPayfastCheckoutUrl(authorizationUrl, true)).toBe(false);
    await expect(client(undefined, { passphrase: undefined }).initialize(input)).rejects.toMatchObject({ code: 'PAYFAST_NOT_CONFIGURED' });
    expect(isPayfastCheckoutUrl('https://sandbox.payfast.co.za.evil.example/eng/process')).toBe(false);
    expect(isPayfastCheckoutUrl('http://sandbox.payfast.co.za/eng/process', true)).toBe(false);
  });
});

describe('PayfastClient ITN validation and verify', () => {
  it('posts the signed fields (without the signature) back to PayFast and needs VALID', async () => {
    const fetchImpl = vi.fn(async () => new Response('VALID'));
    const pairs: Array<[string, string]> = [['m_payment_id', 'ff_ticket_1'], ['amount_gross', '80.00'], ['signature', 'abc']];
    expect(await client(fetchImpl as never).validateItn(pairs)).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://sandbox.payfast.co.za/eng/query/validate');
    expect(init.body).toBe('m_payment_id=ff_ticket_1&amount_gross=80.00');
    expect(await client(vi.fn(async () => new Response('INVALID')) as never).validateItn(pairs)).toBe(false);
    await expect(client(vi.fn(async () => new Response('', { status: 502 })) as never).validateItn(pairs)).rejects.toMatchObject({ code: 'PAYFAST_UNAVAILABLE' });
    await expect(client(vi.fn(async () => { throw new Error('down'); }) as never).validateItn(pairs)).rejects.toBeInstanceOf(PayfastError);
  });

  it('verifies only from ITNs PayFast validated, preferring the completed one', async () => {
    await expect(client().verify('ff_ticket_1')).rejects.toMatchObject({ code: 'PAYFAST_NOT_FOUND' });
    expect(db.eventQuery).toMatchObject({ where: { provider: 'payfast', reference: 'ff_ticket_1', signatureValid: true, payload: { path: ['validated'], equals: true } } });
    db.events = [
      { payload: { validated: true, fields: { m_payment_id: 'ff_ticket_1', payment_status: 'PENDING', amount_gross: '80.00' } } },
      { payload: { validated: true, fields: { m_payment_id: 'ff_ticket_1', pf_payment_id: '1089250', payment_status: 'COMPLETE', amount_gross: '80.00', custom_str1: 'p1' } } },
    ];
    expect(await client().verify('ff_ticket_1')).toEqual({
      id: '1089250', reference: 'ff_ticket_1', status: 'success', amountCents: 8_000, currency: 'ZAR', channel: 'payfast', metadata: { providerPaymentId: 'p1' },
    });
    db.events = [{ payload: { validated: true, fields: { m_payment_id: 'ff_ticket_1', payment_status: 'FAILED', amount_gross: '80.00' } } }];
    expect((await client().verify('ff_ticket_1')).status).toBe('failed');
  });
});

describe('PayfastClient refunds', () => {
  it('refunds the ticket amount on the PayFast payment through the Refund API (sandbox: testing=true)', async () => {
    db.payment = { providerTransactionId: '1089250' };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 200, status: 'success', data: { response: true, message: 'Success' } }), { status: 200 }));
    expect(await client(fetchImpl as never).refund({ reference: 'ff_ticket_1', amountCents: 8_000, merchantNote: 'FootyFinder match ticket refund' })).toEqual({ id: '', status: 'processed' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.payfast.co.za/refunds/1089250?testing=true');
    const headers = init.headers as Record<string, string>;
    expect(headers['merchant-id']).toBe('10000100');
    expect(headers.version).toBe('v1');
    expect(headers.signature).toBe(
      payfastApiSignature({ 'merchant-id': '10000100', version: 'v1', timestamp: headers.timestamp!, amount: '8000', reason: 'FootyFinder match ticket refund', notify_buyer: '1' }, config.passphrase),
    );
    expect(JSON.parse(String(init.body))).toEqual({ amount: 8_000, reason: 'FootyFinder match ticket refund', notify_buyer: 1 });
    expect(JSON.stringify(init)).not.toContain(config.passphrase);
  });

  it('leaves a refused or unreachable refund to finance, and never refunds without the PayFast payment id', async () => {
    await expect(client().refund({ reference: 'ff_ticket_1', amountCents: 8_000, merchantNote: 'x' })).rejects.toMatchObject({ code: 'PAYFAST_REJECTED' });
    db.payment = { providerTransactionId: '1089250' };
    const refused = vi.fn(async () => new Response(JSON.stringify({ status: 'failed', data: { response: false, message: 'Amount exceeds the payment' } }), { status: 400 }));
    await expect(client(refused as never).refund({ reference: 'ff_ticket_1', amountCents: 8_000, merchantNote: 'x' })).rejects.toMatchObject({ code: 'PAYFAST_REJECTED', message: 'Amount exceeds the payment' });
    const down = vi.fn(async () => new Response('{}', { status: 503 }));
    await expect(client(down as never).refund({ reference: 'ff_ticket_1', amountCents: 8_000, merchantNote: 'x' })).rejects.toMatchObject({ code: 'PAYFAST_UNAVAILABLE' });
  });
});
