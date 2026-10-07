import { createHash } from 'node:crypto';
import express, { type RequestHandler, type Router as ExpressRouter } from 'express';
import type { Prisma } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { enqueueDurableJob, registerDurableJobHandler } from '../../jobs/durable-jobs.js';
import { createRateLimit } from '../../middleware/rate-limit.js';
import { logError, logInfo } from '../../observability/logger.js';
import { incrementOperationalMetric } from '../../observability/operational-metrics.js';
import { TicketSettlementService } from '../tickets/ticket-settlement.service.js';
import { PayfastClient, verifyPayfastItnSignature } from './payfast.client.js';

export const PAYFAST_ITN_JOB_TYPE = 'PAYFAST_ITN_PROCESS';
const MAX_BODY_BYTES = 16 * 1024;

const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** The posted fields in the order PayFast sent them (the order its signature covers). */
export const itnPairs = (raw: string): Array<[string, string]> => [...new URLSearchParams(raw).entries()];

export interface PayfastItnConfig {
  merchantId: () => string | undefined;
  passphrase: () => string | undefined;
}

const defaultConfig: PayfastItnConfig = {
  merchantId: () => env.PAYFAST_MERCHANT_ID,
  passphrase: () => env.PAYFAST_PASSPHRASE,
};

const recordRejected = async (rawBody: Buffer, ip: string | undefined, outcome: string) => {
  try {
    await prisma.paymentWebhookEvent.createMany({
      data: [
        {
          provider: 'payfast',
          dedupeKey: `rejected:${sha256(rawBody)}:${sha256(`${ip}:${Date.now()}:${Math.random()}`)}`,
          signatureValid: false,
          ipHash: ip ? sha256(ip) : null,
          outcome,
        },
      ],
    });
  } catch (error) {
    logError('payfast_itn_audit_failed', error);
  }
  incrementOperationalMetric('payfast_itn_rejected_total');
  logInfo('payfast_itn_rejected', { outcome });
};

/**
 * PayFast's ITN (Instant Transaction Notification). The handler checks the signature (with the passphrase) and our
 * merchant id on the exact posted fields, stores the notice once (deduplicated by body hash) with a durable job to
 * process it, and answers 200 straight away so PayFast stops retrying. Nothing is confirmed here: the job first asks
 * PayFast to validate the notice server to server, and only then does ticket settlement place the player.
 */
export const payfastItnHandler =
  (config: PayfastItnConfig = defaultConfig): RequestHandler =>
  async (req, res, next) => {
    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
      if (!rawBody) return res.status(400).json({ error: 'Invalid notification body.', code: 'WEBHOOK_BODY_INVALID' });
      const merchantId = config.merchantId();
      const passphrase = config.passphrase();
      if (!merchantId || !passphrase) return res.status(503).json({ error: 'PayFast is not configured.', code: 'WEBHOOK_NOT_CONFIGURED' });
      const raw = rawBody.toString('utf8');
      const pairs = itnPairs(raw);
      const fields = Object.fromEntries(pairs);
      // Every notice that reaches us is logged on arrival, so "did PayFast call us at all?" is always answerable.
      logInfo('payfast_itn_received', { reference: fields.m_payment_id?.slice(0, 120), paymentStatus: fields.payment_status?.slice(0, 20) });
      if (!verifyPayfastItnSignature(pairs, fields.signature, passphrase)) {
        await recordRejected(rawBody, req.ip, 'invalid_signature');
        return res.status(400).json({ error: 'Invalid signature.', code: 'WEBHOOK_SIGNATURE_INVALID' });
      }
      if (fields.merchant_id !== merchantId) {
        await recordRejected(rawBody, req.ip, 'merchant_mismatch');
        return res.status(400).json({ error: 'Unknown merchant.', code: 'WEBHOOK_MERCHANT_MISMATCH' });
      }
      const dedupeKey = `payfast:${sha256(rawBody)}`;
      const created = await prisma.$transaction(async (tx) => {
        const inserted = await tx.paymentWebhookEvent.createMany({
          data: [
            {
              provider: 'payfast',
              dedupeKey,
              eventType: `itn.${(fields.payment_status ?? 'unknown').toLowerCase().slice(0, 40)}`,
              reference: fields.m_payment_id?.slice(0, 120) ?? null,
              signatureValid: true,
              // The raw body keeps PayFast's field order for the validation post-back (JSON objects do not).
              payload: { raw, fields, validated: false } as Prisma.InputJsonValue,
              ipHash: req.ip ? sha256(req.ip) : null,
            },
          ],
          skipDuplicates: true,
        });
        if (inserted.count !== 1) return false;
        const event = await tx.paymentWebhookEvent.findUniqueOrThrow({ where: { dedupeKey }, select: { id: true } });
        await enqueueDurableJob(tx, {
          type: PAYFAST_ITN_JOB_TYPE,
          dedupeKey: `payfast-itn:${event.id}`,
          payload: { webhookEventId: event.id },
          runAt: new Date(),
        });
        return true;
      });
      incrementOperationalMetric(created ? 'payfast_itn_accepted_total' : 'payfast_itn_duplicate_total');
      res.status(200).end();
    } catch (error) {
      next(error);
    }
  };

const itnRateLimit = createRateLimit({ scope: 'payfast-itn', limit: 600, windowMs: 60_000 });

/** What GET on the ITN address answers: a fixed marker, so a tunnel or proxy in front of it can be checked. */
export const PAYFAST_ITN_HEALTH = { service: 'footyfinder-payfast-itn', ok: true } as const;

/** Mounted before express.json() so the signature is checked against the exact posted fields. */
export const createPayfastItnRouter = (config: PayfastItnConfig = defaultConfig): ExpressRouter => {
  const router = express.Router();
  // PayFast only POSTs here; GET lets anyone check that PUBLIC_API_URL really reaches this API (open it in a browser,
  // or see the startup check below). It says nothing about payments.
  router.get('/payfast/itn', (_req, res) => res.json({ data: PAYFAST_ITN_HEALTH }));
  router.post('/payfast/itn', itnRateLimit, express.raw({ type: () => true, limit: MAX_BODY_BYTES }), payfastItnHandler(config));
  return router;
};

/**
 * PayFast confirms a payment only by posting its ITN to PUBLIC_API_URL/payments/payfast/itn. This asks that address,
 * from outside the app as PayFast would, whether it reaches this API, and explains what came back when it does not
 * (a tunnel's warning or password page, the web app instead of the API, a tunnel that is down). It sends no browser
 * headers, like PayFast's server.
 */
export async function checkPayfastItnReachable(publicApiUrl: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; url: string; detail: string }> {
  const url = `${publicApiUrl.replace(/\/$/, '')}/payments/payfast/itn`;
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    return { ok: false, url, detail: `could not connect (${error instanceof Error ? error.message : 'unknown error'}). Is the tunnel running?` };
  }
  const body = await response.text().catch(() => '');
  try {
    const data = (JSON.parse(body) as { data?: { service?: string } }).data;
    if (response.ok && data?.service === PAYFAST_ITN_HEALTH.service) return { ok: true, url, detail: 'reaches this API' };
  } catch {
    // Not our JSON: explained below.
  }
  const snippet = body.replace(/\s+/g, ' ').slice(0, 160);
  const reason = /localtunnel|tunnel password|bypass-tunnel-reminder/i.test(body)
    ? 'localtunnel answered with its own reminder/password page instead of forwarding the request. PayFast cannot get past it; use cloudflared (no interstitial) instead'
    : /ngrok/i.test(body)
      ? 'ngrok answered with its own page instead of forwarding the request'
      : response.status >= 300 && response.status < 400
        ? `it redirects (${response.status} to ${response.headers.get('location') ?? '?'}); PayFast does not follow redirects`
        : /<!doctype html|<html/i.test(body)
          ? 'it returned a web page, not this API. Is the tunnel pointing at the API port (not the web app)?'
          : `it answered ${response.status}`;
  return { ok: false, url, detail: `${reason}. Response: ${response.status} ${snippet}` };
}

/**
 * Processes one stored ITN: PayFast's validate endpoint must answer VALID for the exact fields, then the notice is
 * marked validated (the only thing PayfastClient.verify reads) and the shared ticket settlement applies it. If PayFast
 * cannot be reached the job is retried; a notice PayFast does not recognise is recorded and never applied.
 */
export class PayfastItnProcessor {
  constructor(
    private readonly client: Pick<PayfastClient, 'validateItn'> = new PayfastClient(),
    private readonly tickets = new TicketSettlementService(),
  ) {}

  async process(webhookEventId: string) {
    const event = await prisma.paymentWebhookEvent.findUnique({ where: { id: webhookEventId } });
    if (!event || event.provider !== 'payfast' || !event.signatureValid || event.processedAt) return;
    const payload = record(event.payload);
    const raw = typeof payload.raw === 'string' ? payload.raw : '';
    const outcome = await this.apply(event.id, event.reference, raw, payload);
    await prisma.paymentWebhookEvent.updateMany({ where: { id: event.id, processedAt: null }, data: { processedAt: new Date(), outcome: outcome.slice(0, 80) } });
    logInfo('payfast_itn_processed', { outcome, webhookEventId: event.id });
  }

  private async apply(eventId: string, reference: string | null, raw: string, payload: Record<string, unknown>) {
    if (!raw) return 'missing_body';
    if (!(await this.client.validateItn(itnPairs(raw)))) {
      incrementOperationalMetric('payfast_itn_not_valid_total');
      return 'itn_not_valid';
    }
    await prisma.paymentWebhookEvent.update({ where: { id: eventId }, data: { payload: { ...payload, validated: true } as Prisma.InputJsonValue } });
    if (!reference) return 'missing_reference';
    const known = await prisma.providerPayment.findUnique({ where: { reference }, select: { purpose: true, provider: true } });
    if (!known) return 'unknown_reference';
    if (known.provider !== 'payfast') return 'provider_mismatch';
    if (known.purpose !== 'TICKETS') return 'not_a_ticket_payment';
    return `ticket_${(await this.tickets.settleFromVerify(reference, 'webhook')).outcome.toLowerCase()}`;
  }
}

export const registerPayfastItnJobHandlers = (processor = new PayfastItnProcessor()) => {
  registerDurableJobHandler(PAYFAST_ITN_JOB_TYPE, async (payload) => {
    const id = record(payload).webhookEventId;
    if (typeof id !== 'string') throw Object.assign(new Error('Invalid ITN job payload.'), { code: 'JOB_PAYLOAD_INVALID' });
    await processor.process(id);
  });
  return processor;
};
