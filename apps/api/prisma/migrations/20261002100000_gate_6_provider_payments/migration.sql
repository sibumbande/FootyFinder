-- Gate 6 / TKT-604: Paystack hosted-checkout card top-ups (DEC-011). Additive only.
-- A ProviderPayment is the provider-side record of one top-up. Its WalletTransaction stays PENDING
-- until our server confirms the payment with Paystack (webhook, expiry job or status check, all
-- through one locked, idempotent path); only then is the wallet credited.
BEGIN;

CREATE TYPE "ProviderPaymentStatus" AS ENUM ('INITIALIZED', 'SUCCEEDED', 'FAILED', 'REVIEW');

CREATE TABLE "ProviderPayment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "walletTransactionId" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'ZAR',
  "status" "ProviderPaymentStatus" NOT NULL DEFAULT 'INITIALIZED',
  "authorizationUrl" TEXT,
  "initializeStartedAt" TIMESTAMP(3),
  "providerTransactionId" TEXT,
  "providerStatus" TEXT,
  "channel" TEXT,
  "lastVerifiedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "creditedBy" TEXT,
  "failureReason" TEXT,
  "reviewReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProviderPayment_walletTransactionId_fkey" FOREIGN KEY ("walletTransactionId") REFERENCES "WalletTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- DEC-011: whole-rand ZAR top-ups from R50 to R5,000.
  CONSTRAINT "ProviderPayment_amount_check" CHECK ("amountCents" BETWEEN 5000 AND 500000 AND "amountCents" % 100 = 0),
  CONSTRAINT "ProviderPayment_currency_check" CHECK ("currency" = 'ZAR'),
  CONSTRAINT "ProviderPayment_succeeded_verified_check" CHECK ("status" <> 'SUCCEEDED' OR ("verifiedAt" IS NOT NULL AND "creditedBy" IS NOT NULL)),
  CONSTRAINT "ProviderPayment_creditedBy_check" CHECK ("creditedBy" IS NULL OR "creditedBy" IN ('webhook', 'expiry_job', 'status_check'))
);

CREATE UNIQUE INDEX "ProviderPayment_walletTransactionId_key" ON "ProviderPayment"("walletTransactionId");
CREATE UNIQUE INDEX "ProviderPayment_reference_key" ON "ProviderPayment"("reference");
CREATE INDEX "ProviderPayment_userId_createdAt_idx" ON "ProviderPayment"("userId", "createdAt");
CREATE INDEX "ProviderPayment_status_createdAt_idx" ON "ProviderPayment"("status", "createdAt");

COMMIT;
