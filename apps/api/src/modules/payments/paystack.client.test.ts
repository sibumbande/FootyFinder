import { describe, expect, it, vi } from 'vitest';
import { isPaystackCheckoutUrl, PaystackClient, PaystackError } from './paystack.client.js';

// A fake value shaped like a test key; the real key is never read by unit tests.
const FAKE_SECRET = 'sk_test_unit-fake-secret-000000';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const client = (fetchImpl: typeof fetch) =>
  new PaystackClient({ secretKey: FAKE_SECRET, baseUrl: 'https://api.paystack.test/' }, fetchImpl);

describe('PaystackClient (TKT-604)', () => {
  it('initialises a card-only ZAR hosted checkout with our reference and metadata', async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, { status: true, data: { authorization_url: 'https://checkout.paystack.com/abc', reference: 'ff_topup_1' } }),
    );
    const result = await client(fetchImpl as never).initialize({
      email: 'player@example.invalid',
      amountCents: 16_000,
      reference: 'ff_topup_1',
      callbackUrl: 'http://localhost:5173/wallet/top-up/return',
      metadata: { providerPaymentId: 'p1', userId: 'u1' },
    });
    expect(result).toEqual({ authorizationUrl: 'https://checkout.paystack.com/abc', reference: 'ff_topup_1' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.paystack.test/transaction/initialize');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_SECRET}`);
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'player@example.invalid',
      amount: 16_000,
      currency: 'ZAR',
      reference: 'ff_topup_1',
      callback_url: 'http://localhost:5173/wallet/top-up/return',
      channels: ['card'],
      metadata: { providerPaymentId: 'p1', userId: 'u1' },
    });
  });

  it('normalises a verify response', async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, {
        status: true,
        data: { id: 42, reference: 'ff_topup_1', status: 'success', amount: 16_000, currency: 'ZAR', channel: 'card', metadata: { userId: 'u1' } },
      }),
    );
    await expect(client(fetchImpl as never).verify('ff_topup_1')).resolves.toEqual({
      id: '42', reference: 'ff_topup_1', status: 'success', amountCents: 16_000, currency: 'ZAR', channel: 'card', metadata: { userId: 'u1' },
    });
  });

  it.each([
    [json(500, { status: false, message: 'Server down' }), 'PAYSTACK_UNAVAILABLE'],
    [json(429, { status: false, message: 'Slow down' }), 'PAYSTACK_UNAVAILABLE'],
    [json(404, { status: false, message: 'Transaction reference not found' }), 'PAYSTACK_NOT_FOUND'],
    [json(400, { status: false, message: 'Duplicate Transaction Reference' }), 'PAYSTACK_DUPLICATE_REFERENCE'],
    [json(400, { status: false, message: 'Invalid key' }), 'PAYSTACK_REJECTED'],
  ])('maps provider errors to stable codes (%#)', async (response, code) => {
    const error = await client((async () => response) as never).verify('ff_topup_1').catch((caught) => caught);
    expect(error).toBeInstanceOf(PaystackError);
    expect(error.code).toBe(code);
  });

  it('turns network failures and timeouts into PAYSTACK_UNAVAILABLE', async () => {
    const error = await client((async () => {
      throw new Error(`socket hang up while sending Bearer ${FAKE_SECRET}`);
    }) as never)
      .verify('ff_topup_1')
      .catch((caught) => caught);
    expect(error.code).toBe('PAYSTACK_UNAVAILABLE');
  });

  it('never puts the secret key in errors, even when the provider echoes it', async () => {
    const echo = json(401, { status: false, message: `Invalid key ${FAKE_SECRET}` });
    const error = await client((async () => echo) as never).verify('ff_topup_1').catch((caught) => caught);
    expect(`${error.message} ${error.stack}`).not.toContain(FAKE_SECRET);
    expect(error.message).toContain('[redacted]');
    const network = await client((async () => {
      throw new Error(FAKE_SECRET);
    }) as never)
      .verify('x')
      .catch((caught) => caught);
    expect(`${network.message} ${network.stack}`).not.toContain(FAKE_SECRET);
    expect(error.code).toBe('PAYSTACK_REJECTED');
  });

  it('refuses to call Paystack without a configured key', async () => {
    const fetchImpl = vi.fn();
    const error = await new PaystackClient({ baseUrl: 'https://api.paystack.test' }, fetchImpl as never)
      .verify('ff_topup_1')
      .catch((caught) => caught);
    expect(error.code).toBe('PAYSTACK_NOT_CONFIGURED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('only accepts Paystack hosted checkout addresses', () => {
    expect(isPaystackCheckoutUrl('https://checkout.paystack.com/abc')).toBe(true);
    expect(isPaystackCheckoutUrl('http://checkout.paystack.com/abc')).toBe(false);
    expect(isPaystackCheckoutUrl('https://checkout.paystack.com.evil.invalid/abc')).toBe(false);
    expect(isPaystackCheckoutUrl('javascript:alert(1)')).toBe(false);
  });
});
