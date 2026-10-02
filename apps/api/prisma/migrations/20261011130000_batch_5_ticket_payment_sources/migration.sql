-- DEC-021 (batch 5 brief, Part A): how a ticket payment was confirmed. Besides the three server-side verify paths
-- (webhook, the hold-expiry job, the status check), the development/test demo operator confirms instantly ('demo',
-- never available in production: PAYMENT_PROVIDER must be paystack there). Additive: widens one CHECK.
BEGIN;
ALTER TABLE "ProviderPayment" DROP CONSTRAINT "ProviderPayment_creditedBy_check";
ALTER TABLE "ProviderPayment" ADD CONSTRAINT "ProviderPayment_creditedBy_check"
  CHECK ("creditedBy" IS NULL OR "creditedBy" IN ('webhook', 'expiry_job', 'status_check', 'demo'));
COMMIT;
