-- Gate 6 / TKT-608: weekly dual-control manual venue settlement (DEC-012). Additive only.
-- One admin prepares a venue's weekly batch; a different MFA-verified admin approves it and marks
-- it paid with a payout reference. A paid batch is immutable and a payable can be paid only once.
BEGIN;

CREATE TYPE "VenueSettlementBatchStatus" AS ENUM ('PREPARED', 'APPROVED', 'PAID', 'CANCELLED');

CREATE TABLE "VenueSettlementBatch" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "venueId" UUID NOT NULL,
  "beneficiaryId" UUID NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "payablesCents" INTEGER NOT NULL,
  "adjustmentsCents" INTEGER NOT NULL,
  "totalCents" INTEGER NOT NULL,
  "status" "VenueSettlementBatchStatus" NOT NULL DEFAULT 'PREPARED',
  "preparedByUserId" UUID NOT NULL,
  "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedByUserId" UUID,
  "approvedAt" TIMESTAMP(3),
  "paidByUserId" UUID,
  "paidAt" TIMESTAMP(3),
  "payoutReference" TEXT,
  "evidenceNote" TEXT,
  "cancelledByUserId" UUID,
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VenueSettlementBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VenueSettlementBatch_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "ManagedVenue"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VenueSettlementBatch_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "VenueBeneficiary"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VenueSettlementBatch_preparedByUserId_fkey" FOREIGN KEY ("preparedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VenueSettlementBatch_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VenueSettlementBatch_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VenueSettlementBatch_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VenueSettlementBatch_period_check" CHECK ("periodStart" < "periodEnd"),
  CONSTRAINT "VenueSettlementBatch_total_check" CHECK ("totalCents" >= 0 AND "totalCents" = "payablesCents" + "adjustmentsCents"),
  -- Dual control: neither the approver nor the payer may be the preparer.
  CONSTRAINT "VenueSettlementBatch_dual_control_check" CHECK (
    ("approvedByUserId" IS NULL OR "approvedByUserId" <> "preparedByUserId")
    AND ("paidByUserId" IS NULL OR "paidByUserId" <> "preparedByUserId")
  ),
  CONSTRAINT "VenueSettlementBatch_state_check" CHECK (
    ("status" = 'PREPARED' AND "approvedByUserId" IS NULL AND "paidByUserId" IS NULL)
    OR ("status" = 'APPROVED' AND "approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL AND "paidByUserId" IS NULL)
    OR ("status" = 'PAID' AND "approvedByUserId" IS NOT NULL AND "paidByUserId" IS NOT NULL AND "paidAt" IS NOT NULL AND "payoutReference" IS NOT NULL)
    OR ("status" = 'CANCELLED' AND "cancelledByUserId" IS NOT NULL AND "cancelledAt" IS NOT NULL AND "cancelReason" IS NOT NULL AND "paidByUserId" IS NULL)
  )
);
CREATE UNIQUE INDEX "VenueSettlementBatch_payoutReference_key" ON "VenueSettlementBatch"("payoutReference");
CREATE INDEX "VenueSettlementBatch_status_periodStart_idx" ON "VenueSettlementBatch"("status", "periodStart");
-- One live batch per venue per week (plain partial index, no functions).
CREATE UNIQUE INDEX "VenueSettlementBatch_one_live_per_week" ON "VenueSettlementBatch"("venueId", "periodStart") WHERE "status" <> 'CANCELLED';

ALTER TABLE "VenuePayable" ADD COLUMN "batchId" UUID;
ALTER TABLE "VenuePayable" ADD CONSTRAINT "VenuePayable_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "VenueSettlementBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VenuePayable" ADD CONSTRAINT "VenuePayable_batch_state_check" CHECK (("status" IN ('IN_BATCH', 'PAID')) = ("batchId" IS NOT NULL));
CREATE INDEX "VenuePayable_batchId_idx" ON "VenuePayable"("batchId");

ALTER TABLE "VenuePayableAdjustment" ADD COLUMN "appliedBatchId" UUID;
ALTER TABLE "VenuePayableAdjustment" ADD CONSTRAINT "VenuePayableAdjustment_appliedBatchId_fkey" FOREIGN KEY ("appliedBatchId") REFERENCES "VenueSettlementBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "VenuePayableAdjustment_appliedBatchId_idx" ON "VenuePayableAdjustment"("appliedBatchId");

-- A paid batch is final, and a paid payable can never be paid again or re-opened.
CREATE FUNCTION prevent_paid_settlement_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'PAID' THEN RAISE EXCEPTION 'paid settlement records are immutable'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'PAID' THEN RAISE EXCEPTION 'paid settlement records are immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "VenueSettlementBatch_paid_immutable"
BEFORE UPDATE OR DELETE ON "VenueSettlementBatch"
FOR EACH ROW EXECUTE FUNCTION prevent_paid_settlement_change();

CREATE TRIGGER "VenuePayable_paid_immutable"
BEFORE UPDATE OR DELETE ON "VenuePayable"
FOR EACH ROW EXECUTE FUNCTION prevent_paid_settlement_change();

COMMIT;
