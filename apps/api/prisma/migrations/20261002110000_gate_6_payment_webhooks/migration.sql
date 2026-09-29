-- Gate 6 / TKT-605: authenticated, idempotent Paystack webhooks. Additive only.
-- Every delivery is recorded. A delivery with a bad signature keeps only a body hash and a hashed
-- source address (no payload). A valid delivery is deduplicated by the hash of its raw body and
-- processed by a durable job, so replays and retries can never apply twice.
BEGIN;

CREATE TABLE "PaymentWebhookEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "eventType" TEXT,
  "reference" TEXT,
  "signatureValid" BOOLEAN NOT NULL,
  "payload" JSONB,
  "ipHash" TEXT,
  "outcome" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentWebhookEvent_invalid_has_no_payload_check" CHECK ("signatureValid" OR "payload" IS NULL)
);

CREATE UNIQUE INDEX "PaymentWebhookEvent_dedupeKey_key" ON "PaymentWebhookEvent"("dedupeKey");
CREATE INDEX "PaymentWebhookEvent_reference_receivedAt_idx" ON "PaymentWebhookEvent"("reference", "receivedAt");
CREATE INDEX "PaymentWebhookEvent_signatureValid_receivedAt_idx" ON "PaymentWebhookEvent"("signatureValid", "receivedAt");

COMMIT;
