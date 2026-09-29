-- Gate 7 / TKT-701: Team Wallet ledger foundation (DEC-014, DEC-019).
-- A Team Wallet is its own aggregate, never a subaccount of a personal wallet:
--  * TeamWalletAccount      one per team; cached balance that can never go below zero.
--  * TeamWalletTransaction  signed, immutable ledger rows (the balance is their sum).
--  * TeamWalletHold         fill-meter money held for one side of one match: captured only if the
--                           match goes ahead, otherwise released.
--  * TeamWalletAllocation   which contribution each debit spent (oldest first), so every rand in a
--                           team wallet traces back to the member who put it in (D7/D8).
-- Team.archivedAt replaces hard deletion of teams (closure, D7).
-- WalletTransaction_sign_matches_type is widened with the two new personal ledger types.
-- Additive only. No index uses a function.
BEGIN;

CREATE TYPE "TeamWalletTransactionType" AS ENUM (
  'CONTRIBUTION_CREDIT', 'CONTRIBUTION_REFUND_DEBIT', 'CLOSURE_REFUND_DEBIT', 'TEAM_MATCH_FEE_DEBIT'
);
CREATE TYPE "TeamWalletHoldStatus" AS ENUM ('ACTIVE', 'CAPTURED', 'RELEASED');

ALTER TABLE "Team" ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "WalletTransaction" DROP CONSTRAINT "WalletTransaction_sign_matches_type";
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_sign_matches_type" CHECK (
  ("type" IN ('DEPOSIT', 'DEPOSIT_CREDIT', 'MATCH_CANCELLATION_CREDIT', 'PLAYER_CANCELLATION_FULL_CREDIT', 'PLAYER_CANCELLATION_PARTIAL_CREDIT', 'REPLACEMENT_CREDIT', 'TOP_UP_REFUND_RESTORE_CREDIT', 'CHARGEBACK_REVERSAL_CREDIT', 'TEAM_CONTRIBUTION_REFUND_CREDIT') AND "amountCents" >= 0)
  OR
  ("type" IN ('MATCH_CREATE', 'MATCH_JOIN', 'MATCH_ENTRY_DEBIT', 'FIELD_BOOKING_DEBIT', 'TOP_UP_REFUND_DEBIT', 'CHARGEBACK_DEBIT', 'TEAM_CONTRIBUTION_DEBIT') AND "amountCents" <= 0)
);

CREATE TABLE "TeamWalletAccount" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "teamId" UUID NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'ZAR',
  "balanceCents" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeamWalletAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeamWalletAccount_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeamWalletAccount_nonnegative_balance" CHECK ("balanceCents" >= 0),
  CONSTRAINT "TeamWalletAccount_currency_check" CHECK ("currency" = 'ZAR')
);
CREATE UNIQUE INDEX "TeamWalletAccount_teamId_key" ON "TeamWalletAccount"("teamId");

CREATE TABLE "TeamWalletTransaction" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "teamWalletAccountId" UUID NOT NULL,
  "type" "TeamWalletTransactionType" NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "actorUserId" UUID,
  "contributorUserId" UUID,
  "linkedWalletTransactionId" UUID,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamWalletTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeamWalletTransaction_teamWalletAccountId_fkey" FOREIGN KEY ("teamWalletAccountId") REFERENCES "TeamWalletAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeamWalletTransaction_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeamWalletTransaction_contributorUserId_fkey" FOREIGN KEY ("contributorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeamWalletTransaction_linkedWalletTransactionId_fkey" FOREIGN KEY ("linkedWalletTransactionId") REFERENCES "WalletTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeamWalletTransaction_sign_matches_type" CHECK (
    ("type" = 'CONTRIBUTION_CREDIT' AND "amountCents" > 0)
    OR ("type" IN ('CONTRIBUTION_REFUND_DEBIT', 'CLOSURE_REFUND_DEBIT', 'TEAM_MATCH_FEE_DEBIT') AND "amountCents" < 0)
  ),
  -- Money moving to or from a personal wallet always names the member and the linked personal row.
  CONSTRAINT "TeamWalletTransaction_personal_link_check" CHECK (
    ("type" IN ('CONTRIBUTION_CREDIT', 'CONTRIBUTION_REFUND_DEBIT', 'CLOSURE_REFUND_DEBIT'))
    = ("contributorUserId" IS NOT NULL AND "linkedWalletTransactionId" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "TeamWalletTransaction_idempotencyKey_key" ON "TeamWalletTransaction"("idempotencyKey");
CREATE UNIQUE INDEX "TeamWalletTransaction_linkedWalletTransactionId_key" ON "TeamWalletTransaction"("linkedWalletTransactionId");
CREATE INDEX "TeamWalletTransaction_teamWalletAccountId_createdAt_idx" ON "TeamWalletTransaction"("teamWalletAccountId", "createdAt");
CREATE INDEX "TeamWalletTransaction_contributorUserId_idx" ON "TeamWalletTransaction"("contributorUserId");

-- Ledger rows are never edited. (Deleting is left to disposable test fixtures, as for WalletTransaction.)
CREATE FUNCTION prevent_team_wallet_ledger_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'team wallet ledger rows are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "TeamWalletTransaction_immutable"
  BEFORE UPDATE ON "TeamWalletTransaction"
  FOR EACH ROW EXECUTE FUNCTION prevent_team_wallet_ledger_update();

CREATE TABLE "TeamWalletHold" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "teamWalletAccountId" UUID NOT NULL,
  "matchId" UUID NOT NULL,
  "side" "TeamSide" NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "status" "TeamWalletHoldStatus" NOT NULL DEFAULT 'ACTIVE',
  "idempotencyKey" TEXT NOT NULL,
  "createdByUserId" UUID,
  "captureTransactionId" UUID,
  "releaseReason" TEXT,
  "capturedAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeamWalletHold_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeamWalletHold_teamWalletAccountId_fkey" FOREIGN KEY ("teamWalletAccountId") REFERENCES "TeamWalletAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeamWalletHold_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeamWalletHold_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeamWalletHold_captureTransactionId_fkey" FOREIGN KEY ("captureTransactionId") REFERENCES "TeamWalletTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeamWalletHold_positive_amount" CHECK ("amountCents" > 0),
  CONSTRAINT "TeamWalletHold_state_check" CHECK (
    ("status" = 'ACTIVE' AND "capturedAt" IS NULL AND "releasedAt" IS NULL AND "captureTransactionId" IS NULL AND "releaseReason" IS NULL)
    OR ("status" = 'CAPTURED' AND "capturedAt" IS NOT NULL AND "releasedAt" IS NULL AND "captureTransactionId" IS NOT NULL)
    OR ("status" = 'RELEASED' AND "capturedAt" IS NULL AND "releasedAt" IS NOT NULL AND "captureTransactionId" IS NULL AND "releaseReason" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "TeamWalletHold_idempotencyKey_key" ON "TeamWalletHold"("idempotencyKey");
CREATE UNIQUE INDEX "TeamWalletHold_captureTransactionId_key" ON "TeamWalletHold"("captureTransactionId");
CREATE INDEX "TeamWalletHold_teamWalletAccountId_status_idx" ON "TeamWalletHold"("teamWalletAccountId", "status");
CREATE INDEX "TeamWalletHold_matchId_side_status_idx" ON "TeamWalletHold"("matchId", "side", "status");

-- A hold leaves ACTIVE at most once, and its money facts never change.
CREATE FUNCTION prevent_team_wallet_hold_reversal() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'ACTIVE' THEN
    RAISE EXCEPTION 'team wallet hold terminal state is immutable';
  END IF;
  IF NEW."teamWalletAccountId" <> OLD."teamWalletAccountId" OR NEW."amountCents" <> OLD."amountCents"
     OR NEW."matchId" <> OLD."matchId" OR NEW."side" <> OLD."side" OR NEW."idempotencyKey" <> OLD."idempotencyKey" THEN
    RAISE EXCEPTION 'team wallet hold financial identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "TeamWalletHold_immutable_transition"
  BEFORE UPDATE ON "TeamWalletHold"
  FOR EACH ROW EXECUTE FUNCTION prevent_team_wallet_hold_reversal();

CREATE TABLE "TeamWalletAllocation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contributionTransactionId" UUID NOT NULL,
  "debitTransactionId" UUID NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamWalletAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeamWalletAllocation_contributionTransactionId_fkey" FOREIGN KEY ("contributionTransactionId") REFERENCES "TeamWalletTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeamWalletAllocation_debitTransactionId_fkey" FOREIGN KEY ("debitTransactionId") REFERENCES "TeamWalletTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeamWalletAllocation_positive_amount" CHECK ("amountCents" > 0)
);
CREATE UNIQUE INDEX "TeamWalletAllocation_contributionTransactionId_debitTransaction" ON "TeamWalletAllocation"("contributionTransactionId", "debitTransactionId");
CREATE INDEX "TeamWalletAllocation_debitTransactionId_idx" ON "TeamWalletAllocation"("debitTransactionId");

-- An allocation spends part of one contribution for one debit of the same team wallet, and a
-- contribution can never be spent beyond its amount (the contribution row is locked while checking).
CREATE FUNCTION check_team_wallet_allocation() RETURNS trigger AS $$
DECLARE
  contribution RECORD;
  debit RECORD;
  spent INTEGER;
BEGIN
  SELECT "teamWalletAccountId", "type", "amountCents" INTO contribution
    FROM "TeamWalletTransaction" WHERE "id" = NEW."contributionTransactionId" FOR UPDATE;
  SELECT "teamWalletAccountId", "type", "amountCents" INTO debit
    FROM "TeamWalletTransaction" WHERE "id" = NEW."debitTransactionId";
  IF contribution."type" <> 'CONTRIBUTION_CREDIT' OR debit."amountCents" >= 0
     OR contribution."teamWalletAccountId" <> debit."teamWalletAccountId" THEN
    RAISE EXCEPTION 'team wallet allocation is not valid';
  END IF;
  SELECT COALESCE(SUM("amountCents"), 0) INTO spent
    FROM "TeamWalletAllocation" WHERE "contributionTransactionId" = NEW."contributionTransactionId";
  IF spent + NEW."amountCents" > contribution."amountCents" THEN
    RAISE EXCEPTION 'team wallet contribution over-allocated';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "TeamWalletAllocation_check"
  BEFORE INSERT ON "TeamWalletAllocation"
  FOR EACH ROW EXECUTE FUNCTION check_team_wallet_allocation();
CREATE TRIGGER "TeamWalletAllocation_immutable"
  BEFORE UPDATE ON "TeamWalletAllocation"
  FOR EACH ROW EXECUTE FUNCTION prevent_team_wallet_ledger_update();

COMMIT;
