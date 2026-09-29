import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import express, { type RequestHandler, type Router as ExpressRouter } from 'express';
import type { Prisma } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { enqueueDurableJob } from '../../jobs/durable-jobs.js';
import { createRateLimit } from '../../middleware/rate-limit.js';
import { logError, logInfo } from '../../observability/logger.js';
import { incrementOperationalMetric } from '../../observability/operational-metrics.js';

export const PAYSTACK_WEBHOOK_JOB_TYPE = 'PAYSTACK_WEBHOOK_PROCESS';
const MAX_BODY_BYTES = 64 * 1024;

/** Paystack signs the exact raw request body with HMAC-SHA512 keyed by the secret key. */
export const verifyPaystackSignature = (rawBody: Buffer, signature: string | undefined, secret: string) => {
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const expected = createHmac('sha512', secret).update(rawBody).digest();
  const actual = Buffer.from(signature, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** The transaction reference an event is about, wherever Paystack puts it for that event. */
export const webhookReference = (eventType: string, data: Record<string, unknown>) => {
  const transaction = record(data.transaction);
  const candidate =
    eventType === 'charge.success'
      ? data.reference
      : (data.transaction_reference ?? transaction.reference ?? data.reference);
  return typeof candidate === 'string' ? candidate.slice(0, 120) : null;
};

export interface PaystackWebhookConfig {
  secret: () => string | undefined;
  ipAllowlist: () => string[];
}

const defaultConfig: PaystackWebhookConfig = {
  secret: () => env.PAYSTACK_SECRET_KEY,
  ipAllowlist: () => env.PAYSTACK_WEBHOOK_IP_ALLOWLIST,
};

const recordRejected = async (rawBody: Buffer, ip: string | undefined, outcome: string) => {
  try {
    await prisma.paymentWebhookEvent.createMany({
      data: [
        {
          provider: 'paystack',
          dedupeKey: `rejected:${sha256(rawBody)}:${sha256(`${ip}:${Date.now()}:${Math.random()}`)}`,
          signatureValid: false,
          ipHash: ip ? sha256(ip) : null,
          outcome,
        },
      ],
    });
  } catch (error) {
    logError('paystack_webhook_audit_failed', error);
  }
  incrementOperationalMetric('paystack_webhook_rejected_total');
  logInfo('paystack_webhook_rejected', { outcome });
};

/**
 * TKT-605: receives Paystack webhooks. It authenticates the raw body, stores the event once
 * (deduplicated by body hash) and enqueues its processing in the same transaction, then answers
 * 200 quickly. Processing happens in a durable job, so a crash or timeout is retried and a replay
 * is a no-op. Nothing is credited here.
 */
export const paystackWebhookHandler =
  (config: PaystackWebhookConfig = defaultConfig): RequestHandler =>
  async (req, res, next) => {
    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
      if (!rawBody) return res.status(400).json({ error: 'Invalid webhook body.', code: 'WEBHOOK_BODY_INVALID' });
      const allowlist = config.ipAllowlist();
      if (allowlist.length && !allowlist.includes(req.ip ?? '')) {
        await recordRejected(rawBody, req.ip, 'ip_not_allowed');
        return res.status(403).json({ error: 'Forbidden.', code: 'WEBHOOK_SOURCE_REJECTED' });
      }
      const secret = config.secret();
      if (!secret) return res.status(503).json({ error: 'Webhooks are not configured.', code: 'WEBHOOK_NOT_CONFIGURED' });
      if (!verifyPaystackSignature(rawBody, req.get('x-paystack-signature'), secret)) {
        await recordRejected(rawBody, req.ip, 'invalid_signature');
        return res.status(401).json({ error: 'Invalid signature.', code: 'WEBHOOK_SIGNATURE_INVALID' });
      }
      let body: Record<string, unknown>;
      try {
        body = record(JSON.parse(rawBody.toString('utf8')));
      } catch {
        await recordRejected(rawBody, req.ip, 'malformed_json');
        return res.status(400).json({ error: 'Invalid webhook body.', code: 'WEBHOOK_BODY_INVALID' });
      }
      const eventType = typeof body.event === 'string' ? body.event.slice(0, 80) : 'unknown';
      const data = record(body.data);
      const dedupeKey = `paystack:${sha256(rawBody)}`;
      const created = await prisma.$transaction(async (tx) => {
        const inserted = await tx.paymentWebhookEvent.createMany({
          data: [
            {
              provider: 'paystack',
              dedupeKey,
              eventType,
              reference: webhookReference(eventType, data),
              signatureValid: true,
              payload: body as Prisma.InputJsonValue,
              ipHash: req.ip ? sha256(req.ip) : null,
            },
          ],
          skipDuplicates: true,
        });
        if (inserted.count !== 1) return false;
        const event = await tx.paymentWebhookEvent.findUniqueOrThrow({ where: { dedupeKey }, select: { id: true } });
        await enqueueDurableJob(tx, {
          type: PAYSTACK_WEBHOOK_JOB_TYPE,
          dedupeKey: `paystack-webhook:${event.id}`,
          payload: { webhookEventId: event.id },
          runAt: new Date(),
        });
        return true;
      });
      incrementOperationalMetric(created ? 'paystack_webhook_accepted_total' : 'paystack_webhook_duplicate_total');
      res.status(200).json({ received: true });
    } catch (error) {
      next(error);
    }
  };

const webhookRateLimit = createRateLimit({ scope: 'paystack-webhook', limit: 600, windowMs: 60_000 });

/** Mounted before express.json() so the signature is checked against the exact raw bytes. */
export const createPaystackWebhookRouter = (config: PaystackWebhookConfig = defaultConfig): ExpressRouter => {
  const router = express.Router();
  router.post(
    '/paystack/webhook',
    webhookRateLimit,
    express.raw({ type: () => true, limit: MAX_BODY_BYTES }),
    paystackWebhookHandler(config),
  );
  return router;
};
