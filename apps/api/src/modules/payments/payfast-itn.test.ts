import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  enqueued: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  payment: null as { purpose: string; provider: string } | null,
}));
vi.mock('../../database/prisma.js', () => {
  const paymentWebhookEvent = {
    createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
      const fresh = data.filter((row) => !row.dedupeKey || !db.created.some((existing) => existing.dedupeKey === row.dedupeKey));
      db.created.push(...fresh.map((row) => ({ id: `event-${db.created.length + 1}`, processedAt: null, ...row })));
      return { count: fresh.length };
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { dedupeKey: string } }) => db.created.find((row) => row.dedupeKey === where.dedupeKey)),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.created.find((row) => row.id === where.id) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      db.updates.push({ id: where.id, ...data });
      Object.assign(db.created.find((row) => row.id === where.id)!, data);
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      Object.assign(db.created.find((row) => row.id === where.id)!, data);
      return { count: 1 };
    }),
  };
  const durableJob = {
    upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
      db.enqueued.push(create);
      return create;
    }),
  };
  const providerPayment = { findUnique: vi.fn(async () => db.payment) };
  const client = { paymentWebhookEvent, durableJob, providerPayment };
  return { prisma: { ...client, $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(client)) } };
});

const { checkPayfastItnReachable, createPayfastItnRouter, PayfastItnProcessor } = await import('./payfast-itn.js');
const { payfastEncode, payfastItnSignature } = await import('./payfast.client.js');
const { errorHandler } = await import('../../middleware/error-handler.js');

const MERCHANT = '10000100';
const PASSPHRASE = 'unit-fake passphrase';
const itnBody = (overrides: Record<string, string> = {}, passphrase = PASSPHRASE) => {
  const pairs: Array<[string, string]> = Object.entries({
    m_payment_id: 'ff_ticket_1', pf_payment_id: '1089250', payment_status: 'COMPLETE', item_name: 'FootyFinder match ticket: Green Point',
    item_description: '', amount_gross: '80.00', amount_fee: '-2.30', amount_net: '77.70', custom_str1: 'p1', email_address: 'player@example.invalid',
    merchant_id: MERCHANT, ...overrides,
  });
  const signed = [...pairs, ['signature', payfastItnSignature(pairs, passphrase)] as [string, string]];
  return signed.map(([key, value]) => `${key}=${payfastEncode(value)}`).join('&');
};
const appWith = (config: Partial<{ merchantId: string | undefined; passphrase: string | undefined }> = {}) =>
  express()
    .use('/payments', createPayfastItnRouter({ merchantId: () => ('merchantId' in config ? config.merchantId : MERCHANT), passphrase: () => ('passphrase' in config ? config.passphrase : PASSPHRASE) }))
    .use(errorHandler);
const post = (body: string, app = appWith()) =>
  request(app).post('/payments/payfast/itn').set('Content-Type', 'application/x-www-form-urlencoded').send(body);

beforeEach(() => {
  db.created = [];
  db.enqueued = [];
  db.updates = [];
  db.payment = null;
});

describe('PayFast ITN endpoint', () => {
  it('answers 200, stores a signed notice once (unvalidated, in PayFast\'s field order) and queues its processing', async () => {
    const body = itnBody();
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    expect(db.created).toHaveLength(1);
    expect(db.created[0]).toMatchObject({ provider: 'payfast', eventType: 'itn.complete', reference: 'ff_ticket_1', signatureValid: true, payload: { raw: body, validated: false } });
    expect(db.enqueued).toEqual([expect.objectContaining({ type: 'PAYFAST_ITN_PROCESS', payload: { webhookEventId: 'event-1' } })]);
  });

  it('refuses a notice with a wrong signature or for another merchant, and records it without its body', async () => {
    expect((await post(itnBody({}, 'wrong passphrase'))).status).toBe(400);
    expect((await post(itnBody().replace('amount_gross=80.00', 'amount_gross=0.80'))).status).toBe(400);
    expect((await post(itnBody({ merchant_id: '10000999' }))).status).toBe(400);
    expect(db.created.map(({ outcome, signatureValid, payload }) => ({ outcome, signatureValid, payload }))).toEqual([
      { outcome: 'invalid_signature', signatureValid: false, payload: undefined },
      { outcome: 'invalid_signature', signatureValid: false, payload: undefined },
      { outcome: 'merchant_mismatch', signatureValid: false, payload: undefined },
    ]);
    expect(db.enqueued).toHaveLength(0);
  });

  it('is unavailable until PayFast is configured', async () => {
    expect((await post(itnBody(), appWith({ passphrase: undefined }))).status).toBe(503);
  });
});

describe('PayFast ITN processing', () => {
  const stored = async () => {
    await post(itnBody());
    return db.created[0]!.id as string;
  };

  it('applies a notice only after PayFast validates it, through ticket settlement', async () => {
    const id = await stored();
    db.payment = { purpose: 'TICKETS', provider: 'payfast' };
    const validateItn = vi.fn(async () => true);
    const settleFromVerify = vi.fn(async () => ({ status: 'SUCCEEDED', outcome: 'PLACED' as const }));
    await new PayfastItnProcessor({ validateItn }, { settleFromVerify } as never).process(id);
    expect(validateItn).toHaveBeenCalledWith(expect.arrayContaining([['m_payment_id', 'ff_ticket_1'], ['amount_gross', '80.00']]));
    expect(db.updates[0]).toMatchObject({ payload: { validated: true } });
    expect(settleFromVerify).toHaveBeenCalledWith('ff_ticket_1', 'webhook');
    expect(db.created[0]).toMatchObject({ outcome: 'ticket_placed' });
    // Processed once: a replayed job does nothing.
    await new PayfastItnProcessor({ validateItn }, { settleFromVerify } as never).process(id);
    expect(settleFromVerify).toHaveBeenCalledTimes(1);
  });

  it('never applies a notice PayFast does not recognise, or one for a payment made elsewhere', async () => {
    const id = await stored();
    const settleFromVerify = vi.fn();
    await new PayfastItnProcessor({ validateItn: vi.fn(async () => false) }, { settleFromVerify } as never).process(id);
    expect(db.created[0]).toMatchObject({ outcome: 'itn_not_valid', payload: { validated: false } });
    db.created = [];
    const second = await stored();
    db.payment = { purpose: 'TICKETS', provider: 'paystack' };
    await new PayfastItnProcessor({ validateItn: vi.fn(async () => true) }, { settleFromVerify } as never).process(second);
    expect(db.created[0]).toMatchObject({ outcome: 'provider_mismatch' });
    expect(settleFromVerify).not.toHaveBeenCalled();
  });

  it('retries later when PayFast cannot be reached to validate', async () => {
    const id = await stored();
    const down = vi.fn(async () => {
      throw new Error('PayFast unavailable');
    });
    await expect(new PayfastItnProcessor({ validateItn: down }, { settleFromVerify: vi.fn() } as never).process(id)).rejects.toThrow('PayFast unavailable');
    expect(db.created[0]).toMatchObject({ processedAt: null });
  });
});

describe('PayFast ITN reachability', () => {
  it('answers GET with a fixed marker, so the address can be checked through a tunnel', async () => {
    const response = await request(appWith()).get('/payments/payfast/itn');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { service: 'footyfinder-payfast-itn', ok: true } });
  });

  it('passes only when PUBLIC_API_URL really reaches this API, and says why not otherwise', async () => {
    const answer = (body: string, status = 200, headers: Record<string, string> = {}) => vi.fn(async () => new Response(body, { status, headers })) as unknown as typeof fetch;
    const ours = JSON.stringify({ data: { service: 'footyfinder-payfast-itn', ok: true } });
    expect(await checkPayfastItnReachable('https://dev.trycloudflare.com/', answer(ours))).toEqual({ ok: true, url: 'https://dev.trycloudflare.com/payments/payfast/itn', detail: 'reaches this API' });
    const localtunnel = await checkPayfastItnReachable('https://pretty-actors-love.loca.lt', answer('<html><title>localtunnel</title>Tunnel Password: enter the password</html>', 511));
    expect(localtunnel.ok).toBe(false);
    expect(localtunnel.detail).toContain('localtunnel answered with its own reminder/password page');
    // A refusal that merely names the host is not mistaken for localtunnel's page.
    expect((await checkPayfastItnReachable('https://pretty-actors-love.loca.lt', answer('Host not in allowlist: pretty-actors-love.loca.lt', 403))).detail).toMatch(/^it answered 403/);
    expect((await checkPayfastItnReachable('https://x.example', answer('<!doctype html><div id="root"></div>'))).detail).toContain('not this API. Is the tunnel pointing at the API port');
    expect((await checkPayfastItnReachable('https://x.example', answer('', 302, { location: 'https://elsewhere.example' }))).detail).toContain('PayFast does not follow redirects');
    const down = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect((await checkPayfastItnReachable('https://x.example', down)).detail).toContain('could not connect (ECONNREFUSED)');
  });
});
