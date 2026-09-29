import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  enqueued: [] as Array<Record<string, unknown>>,
}));
vi.mock('../../database/prisma.js', () => {
  const paymentWebhookEvent = {
    createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
      const fresh = data.filter((row) => !db.created.some((existing) => existing.dedupeKey === row.dedupeKey));
      db.created.push(...fresh.map((row) => ({ id: `event-${db.created.length + 1}`, ...row })));
      return { count: fresh.length };
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { dedupeKey: string } }) =>
      db.created.find((row) => row.dedupeKey === where.dedupeKey),
    ),
  };
  const durableJob = {
    upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
      db.enqueued.push(create);
      return create;
    }),
  };
  const client = { paymentWebhookEvent, durableJob };
  return { prisma: { ...client, $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(client)) } };
});

const { createPaystackWebhookRouter, verifyPaystackSignature, webhookReference } = await import('./paystack-webhook.js');
const { errorHandler } = await import('../../middleware/error-handler.js');

const SECRET = 'sk_test_unit-fake-webhook-secret';
const sign = (raw: string, secret = SECRET) => createHmac('sha512', secret).update(raw).digest('hex');
const event = JSON.stringify({ event: 'charge.success', data: { reference: 'ff_topup_1', amount: 16_000 } });

const appWith = (config: Partial<{ secret: string | undefined; allowlist: string[] }> = {}) =>
  express()
    .use('/payments', createPaystackWebhookRouter({
      secret: () => ('secret' in config ? config.secret : SECRET),
      ipAllowlist: () => config.allowlist ?? [],
    }))
    .use(express.json())
    .use(errorHandler);

const post = (app: express.Express, raw: string, signature?: string) => {
  const call = request(app).post('/payments/paystack/webhook').set('Content-Type', 'application/json');
  return (signature === undefined ? call : call.set('x-paystack-signature', signature)).send(raw);
};

beforeEach(() => {
  db.created = [];
  db.enqueued = [];
});

describe('verifyPaystackSignature (TKT-605)', () => {
  it('accepts only the HMAC-SHA512 of the exact raw body', () => {
    const raw = Buffer.from(event);
    expect(verifyPaystackSignature(raw, sign(event), SECRET)).toBe(true);
    expect(verifyPaystackSignature(Buffer.from(`${event} `), sign(event), SECRET)).toBe(false);
    expect(verifyPaystackSignature(raw, sign(event, 'sk_test_other'), SECRET)).toBe(false);
    expect(verifyPaystackSignature(raw, undefined, SECRET)).toBe(false);
    expect(verifyPaystackSignature(raw, 'not-hex', SECRET)).toBe(false);
    expect(verifyPaystackSignature(raw, sign(event).slice(0, 64), SECRET)).toBe(false);
  });

  it('finds the transaction reference for charge, refund and dispute events', () => {
    expect(webhookReference('charge.success', { reference: 'r1' })).toBe('r1');
    expect(webhookReference('refund.processed', { transaction_reference: 'r2' })).toBe('r2');
    expect(webhookReference('charge.dispute.create', { transaction: { reference: 'r3' } })).toBe('r3');
    expect(webhookReference('charge.success', {})).toBeNull();
  });
});

describe('Paystack webhook route (TKT-605)', () => {
  it('stores a valid event once and enqueues one processing job, answering 200 to replays', async () => {
    const app = appWith();
    for (let attempt = 0; attempt < 3; attempt += 1) expect((await post(app, event, sign(event))).status).toBe(200);
    expect(db.created).toHaveLength(1);
    expect(db.created[0]).toMatchObject({ signatureValid: true, eventType: 'charge.success', reference: 'ff_topup_1' });
    expect(db.enqueued).toHaveLength(1);
    expect(db.enqueued[0]).toMatchObject({ type: 'PAYSTACK_WEBHOOK_PROCESS' });
  });

  it('rejects and audits a bad or missing signature without storing the payload', async () => {
    const app = appWith();
    const bad = await post(app, event, sign(event, 'sk_test_attacker'));
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect((await post(app, event)).status).toBe(401);
    expect(db.created).toHaveLength(2);
    for (const row of db.created) {
      expect(row).toMatchObject({ signatureValid: false, outcome: 'invalid_signature' });
      expect(row.payload).toBeUndefined();
    }
    expect(db.enqueued).toHaveLength(0);
  });

  it('rejects sources outside a configured IP allowlist', async () => {
    const response = await post(appWith({ allowlist: ['203.0.113.10'] }), event, sign(event));
    expect(response.status).toBe(403);
    expect(db.created[0]).toMatchObject({ signatureValid: false, outcome: 'ip_not_allowed' });
    expect(db.enqueued).toHaveLength(0);
  });

  it('fails closed when no secret is configured', async () => {
    expect((await post(appWith({ secret: undefined }), event, sign(event))).status).toBe(503);
    expect(db.enqueued).toHaveLength(0);
  });

  it('rejects a signed but malformed body', async () => {
    const raw = '{not json';
    expect((await post(appWith(), raw, sign(raw))).status).toBe(400);
    expect(db.enqueued).toHaveLength(0);
  });
});
