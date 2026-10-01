-- CEO touch-up batch 3, item 5: free "On FootyFinder" Quick Matches.
-- * An admin marks a Quick Match free (fresh MFA, reason, audit) only while nobody has joined; players then
--   join for R0, so no money moves in any wallet and nothing can be refunded to a card.
-- * Optional "first-time players only": only players who have never played a match may join.
-- * PromotionalCost is FootyFinder's own promotions ledger, separate from every wallet: one ACTIVE R80 row per
--   player in a free match (the fee FootyFinder waives), reversed when that player leaves or the match is
--   cancelled. The venue payable, go/no-go and reconciliation are unchanged; finance reports both the fees
--   waived and FootyFinder's actual cost (the venue payable). Additive only.
BEGIN;

CREATE TYPE "PromotionalCostStatus" AS ENUM ('ACTIVE', 'REVERSED');

ALTER TABLE "Match"
  ADD COLUMN "freeOnFootyFinder" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "firstTimersOnly" BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT "Match_first_timers_needs_free_check" CHECK (NOT "firstTimersOnly" OR "freeOnFootyFinder"),
  ADD CONSTRAINT "Match_free_has_no_fee_check" CHECK (NOT "freeOnFootyFinder" OR "feeCents" = 0);

CREATE TABLE "PromotionalCost" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchId" UUID NOT NULL,
  "participantId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "status" "PromotionalCostStatus" NOT NULL DEFAULT 'ACTIVE',
  "description" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversedAt" TIMESTAMP(3),
  "reversalReason" TEXT,
  CONSTRAINT "PromotionalCost_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PromotionalCost_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PromotionalCost_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "MatchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PromotionalCost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PromotionalCost_amount_check" CHECK ("amountCents" > 0),
  CONSTRAINT "PromotionalCost_reversal_check" CHECK (("status" = 'REVERSED') = ("reversedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "PromotionalCost_participantId_key" ON "PromotionalCost"("participantId");
CREATE INDEX "PromotionalCost_matchId_status_idx" ON "PromotionalCost"("matchId", "status");

COMMIT;
