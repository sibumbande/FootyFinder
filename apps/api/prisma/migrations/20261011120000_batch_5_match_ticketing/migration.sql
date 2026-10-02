-- DEC-021 Match Ticketing (batch 5 brief, Part A; CEO D1-D19). Additive only: new tables, new nullable columns and
-- widened CHECKs. The wallet and team-wallet tables are untouched and stay as read-only history (D13).
--
--   * TicketCheckout: one purchase by one payer for one match (a Paystack payment, a match credit or a free place),
--     with the cancellation-policy acceptance record (time, Terms version, wording, IP, browser; D15).
--   * MatchTicket: one place for one named player. HELD while checkout runs (10 minutes, "Being booked"),
--     CONFIRMED once the payment is verified, RELEASED if checkout never completed, CHOICE_PENDING after a
--     cancellation (credit or refund, auto-refund after 7 days), CLOSED with an outcome.
--   * MatchCredit + MatchCreditEvent: credits counted in matches, valid at least 3 years (CPA s63), every change
--     an append-only ledger entry linked to the ticket it came from (A4).
--   * TicketEmail: the ticketing emails actually sent (dispute evidence, A8).
--   * ProviderPayment/ProviderRefund/ProviderDispute are reused for tickets (D14): purpose TICKETS, the wallet links
--     become optional, and CHECKs keep every legacy wallet row exactly as strict as before.
--   * User booking restriction (payment disputes, D9); Match cancellation reasons TEAM_UNPAID (T-2h, D1) and
--     DEV_TICKETING_CUTOVER (dev-only mock-world cutover, D12).
BEGIN;

CREATE TYPE "ProviderPaymentPurpose" AS ENUM ('TOP_UP', 'TICKETS');
CREATE TYPE "TicketCheckoutKind" AS ENUM ('QUICK', 'TEAM');
CREATE TYPE "TicketCheckoutMethod" AS ENUM ('PAYMENT', 'CREDIT', 'FREE');
CREATE TYPE "TicketCheckoutStatus" AS ENUM ('PENDING', 'COMPLETED', 'EXPIRED', 'FAILED');
CREATE TYPE "MatchTicketSeat" AS ENUM ('POSITION', 'SUBSTITUTE', 'TEAM');
CREATE TYPE "MatchTicketStatus" AS ENUM ('HELD', 'CONFIRMED', 'RELEASED', 'CHOICE_PENDING', 'CLOSED');
CREATE TYPE "MatchTicketOutcome" AS ENUM ('CREDIT_ISSUED', 'REFUNDED', 'CREDIT_RETURNED', 'FORFEITED', 'NOTHING_DUE', 'LATE_PAYMENT_REFUNDED', 'DUPLICATE_REFUNDED');
CREATE TYPE "MatchCreditStatus" AS ENUM ('AVAILABLE', 'USED', 'EXPIRED', 'FORFEITED', 'REFUNDED');
CREATE TYPE "MatchCreditReason" AS ENUM ('LEFT_MATCH', 'MATCH_CANCELLED', 'CREDIT_RETURNED', 'DEV_SEED', 'GOODWILL');
CREATE TYPE "MatchCreditEventType" AS ENUM ('ISSUED', 'USED', 'EXPIRED', 'FORFEITED', 'REFUNDED');

-- Users: booking restriction while a payment of theirs is disputed (D9).
ALTER TABLE "User" ADD COLUMN "bookingRestrictedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "bookingRestrictionReason" TEXT;

-- Matches: the T-2h team payment cutoff (D1) and the dev-only mock-world cutover (D12).
ALTER TABLE "Match" DROP CONSTRAINT "Match_cancellationReason_check";
ALTER TABLE "Match" ADD CONSTRAINT "Match_cancellationReason_check" CHECK (
  "cancellationReason" IS NULL
  OR "cancellationReason" IN ('ORGANISER_CANCELLED', 'POSITIONS_UNFILLED', 'TEAM_FEES_UNFUNDED', 'NO_OPPONENT', 'TEAM_CANCELLED', 'NO_REFEREE', 'FOOTYFINDER_CANCELLED', 'TEAM_UNPAID', 'DEV_TICKETING_CUTOVER')
);

-- Provider payments: reused for tickets (D14). A top-up keeps its wallet link; a ticket payment has none.
ALTER TABLE "ProviderPayment" ADD COLUMN "purpose" "ProviderPaymentPurpose" NOT NULL DEFAULT 'TOP_UP';
ALTER TABLE "ProviderPayment" ALTER COLUMN "walletTransactionId" DROP NOT NULL;
ALTER TABLE "ProviderPayment" ADD CONSTRAINT "ProviderPayment_purpose_wallet_check"
  CHECK (("purpose" = 'TOP_UP') = ("walletTransactionId" IS NOT NULL));

CREATE TABLE "TicketCheckout" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchId" UUID NOT NULL,
  "payerId" UUID NOT NULL,
  "kind" "TicketCheckoutKind" NOT NULL,
  "method" "TicketCheckoutMethod" NOT NULL,
  "status" "TicketCheckoutStatus" NOT NULL DEFAULT 'PENDING',
  "providerPaymentId" UUID,
  "amountCents" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "policyAcceptedAt" TIMESTAMP(3) NOT NULL,
  "termsVersion" TEXT NOT NULL,
  "policyText" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TicketCheckout_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TicketCheckout_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TicketCheckout_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TicketCheckout_providerPaymentId_fkey" FOREIGN KEY ("providerPaymentId") REFERENCES "ProviderPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TicketCheckout_amount_check" CHECK ("amountCents" >= 0 AND "amountCents" % 100 = 0),
  CONSTRAINT "TicketCheckout_method_check" CHECK (("method" = 'PAYMENT') = ("amountCents" > 0)),
  CONSTRAINT "TicketCheckout_completed_check" CHECK (("status" = 'COMPLETED') = ("completedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "TicketCheckout_providerPaymentId_key" ON "TicketCheckout"("providerPaymentId");
CREATE UNIQUE INDEX "TicketCheckout_payerId_idempotencyKey_key" ON "TicketCheckout"("payerId", "idempotencyKey");
CREATE INDEX "TicketCheckout_matchId_status_idx" ON "TicketCheckout"("matchId", "status");
CREATE INDEX "TicketCheckout_payerId_createdAt_idx" ON "TicketCheckout"("payerId", "createdAt");

CREATE TABLE "MatchTicket" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchId" UUID NOT NULL,
  "checkoutId" UUID NOT NULL,
  "playerId" UUID NOT NULL,
  "payerId" UUID NOT NULL,
  "side" "TeamSide" NOT NULL,
  "seat" "MatchTicketSeat" NOT NULL,
  "slotId" UUID,
  "matchTeamId" UUID,
  "participantId" UUID,
  "status" "MatchTicketStatus" NOT NULL DEFAULT 'HELD',
  "method" "TicketCheckoutMethod" NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "holdExpiresAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "choiceDeadlineAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "outcome" "MatchTicketOutcome",
  "closedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MatchTicket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MatchTicket_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MatchTicket_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "TicketCheckout"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MatchTicket_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MatchTicket_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MatchTicket_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "FormationSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MatchTicket_matchTeamId_fkey" FOREIGN KEY ("matchTeamId") REFERENCES "MatchTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MatchTicket_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "MatchParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MatchTicket_amount_check" CHECK ("amountCents" >= 0 AND (("method" = 'PAYMENT') = ("amountCents" > 0))),
  -- A position purchase names its position while it is being booked.
  CONSTRAINT "MatchTicket_position_hold_check" CHECK ("status" <> 'HELD' OR "seat" <> 'POSITION' OR "slotId" IS NOT NULL),
  CONSTRAINT "MatchTicket_team_seat_check" CHECK ("seat" <> 'TEAM' OR "matchTeamId" IS NOT NULL),
  CONSTRAINT "MatchTicket_held_check" CHECK ("status" <> 'HELD' OR "holdExpiresAt" IS NOT NULL),
  CONSTRAINT "MatchTicket_confirmed_check" CHECK ("status" NOT IN ('CONFIRMED', 'CHOICE_PENDING') OR "confirmedAt" IS NOT NULL),
  CONSTRAINT "MatchTicket_choice_check" CHECK ("status" <> 'CHOICE_PENDING' OR "choiceDeadlineAt" IS NOT NULL),
  CONSTRAINT "MatchTicket_closed_check" CHECK (("status" = 'CLOSED') = ("closedAt" IS NOT NULL AND "outcome" IS NOT NULL))
);
-- One live place per player per match, and one checkout at a time per position ("Being booked").
CREATE UNIQUE INDEX "MatchTicket_one_live_per_player" ON "MatchTicket"("matchId", "playerId") WHERE "status" IN ('HELD', 'CONFIRMED');
CREATE UNIQUE INDEX "MatchTicket_one_hold_per_slot" ON "MatchTicket"("slotId") WHERE "status" = 'HELD' AND "slotId" IS NOT NULL;
CREATE UNIQUE INDEX "MatchTicket_participantId_key" ON "MatchTicket"("participantId");
CREATE INDEX "MatchTicket_matchId_status_idx" ON "MatchTicket"("matchId", "status");
CREATE INDEX "MatchTicket_checkoutId_idx" ON "MatchTicket"("checkoutId");
CREATE INDEX "MatchTicket_playerId_status_idx" ON "MatchTicket"("playerId", "status");
CREATE INDEX "MatchTicket_payerId_status_idx" ON "MatchTicket"("payerId", "status");
CREATE INDEX "MatchTicket_matchTeamId_status_idx" ON "MatchTicket"("matchTeamId", "status");
CREATE INDEX "MatchTicket_status_choiceDeadlineAt_idx" ON "MatchTicket"("status", "choiceDeadlineAt");

CREATE TABLE "MatchCredit" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "status" "MatchCreditStatus" NOT NULL DEFAULT 'AVAILABLE',
  "reason" "MatchCreditReason" NOT NULL,
  "sourceTicketId" UUID,
  "originTicketId" UUID,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedTicketId" UUID,
  "usedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MatchCredit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MatchCredit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MatchCredit_sourceTicketId_fkey" FOREIGN KEY ("sourceTicketId") REFERENCES "MatchTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MatchCredit_originTicketId_fkey" FOREIGN KEY ("originTicketId") REFERENCES "MatchTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MatchCredit_usedTicketId_fkey" FOREIGN KEY ("usedTicketId") REFERENCES "MatchTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- CPA s63: a prepaid credit is valid for at least 3 years from issue (CEO D3).
  CONSTRAINT "MatchCredit_three_years_check" CHECK ("expiresAt" >= "issuedAt" + interval '3 years'),
  CONSTRAINT "MatchCredit_used_check" CHECK (("status" = 'USED') = ("usedTicketId" IS NOT NULL AND "usedAt" IS NOT NULL)),
  CONSTRAINT "MatchCredit_closed_check" CHECK (("status" = 'AVAILABLE') = ("closedAt" IS NULL)),
  CONSTRAINT "MatchCredit_source_check" CHECK ("reason" IN ('DEV_SEED', 'GOODWILL') OR "sourceTicketId" IS NOT NULL),
  CONSTRAINT "MatchCredit_cash_origin_check" CHECK ("reason" NOT IN ('DEV_SEED', 'GOODWILL') OR "originTicketId" IS NULL)
);
CREATE UNIQUE INDEX "MatchCredit_sourceTicketId_key" ON "MatchCredit"("sourceTicketId");
CREATE UNIQUE INDEX "MatchCredit_usedTicketId_key" ON "MatchCredit"("usedTicketId");
CREATE INDEX "MatchCredit_userId_status_expiresAt_idx" ON "MatchCredit"("userId", "status", "expiresAt");
CREATE INDEX "MatchCredit_status_expiresAt_idx" ON "MatchCredit"("status", "expiresAt");
CREATE INDEX "MatchCredit_originTicketId_idx" ON "MatchCredit"("originTicketId");

CREATE TABLE "MatchCreditEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "creditId" UUID NOT NULL,
  "type" "MatchCreditEventType" NOT NULL,
  "ticketId" UUID,
  "actorUserId" UUID,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchCreditEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MatchCreditEvent_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "MatchCredit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MatchCreditEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "MatchTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MatchCreditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
-- A credit is issued once and closed once (used, expired, forfeited or refunded).
CREATE UNIQUE INDEX "MatchCreditEvent_one_per_type" ON "MatchCreditEvent"("creditId", "type");
CREATE INDEX "MatchCreditEvent_ticketId_idx" ON "MatchCreditEvent"("ticketId");

CREATE FUNCTION prevent_match_credit_event_mutation() RETURNS trigger AS $fn$
BEGIN
  -- Only the actor link may be cleared (ON DELETE SET NULL for a deleted user); the entry itself never changes.
  IF TG_OP = 'UPDATE' AND NEW."actorUserId" IS NULL AND OLD."actorUserId" IS NOT NULL
     AND NEW."creditId" = OLD."creditId" AND NEW."type" = OLD."type" AND NEW."ticketId" IS NOT DISTINCT FROM OLD."ticketId"
     AND NEW."note" IS NOT DISTINCT FROM OLD."note" AND NEW."createdAt" = OLD."createdAt" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'MatchCreditEvent is append-only';
END;
$fn$ LANGUAGE plpgsql;
CREATE TRIGGER "MatchCreditEvent_append_only"
BEFORE UPDATE OR DELETE ON "MatchCreditEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_match_credit_event_mutation();

CREATE TABLE "TicketEmail" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "matchId" UUID,
  "checkoutId" UUID,
  "ticketId" UUID,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketEmail_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TicketEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TicketEmail_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "TicketCheckout"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TicketEmail_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "MatchTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "TicketEmail_userId_sentAt_idx" ON "TicketEmail"("userId", "sentAt");
CREATE INDEX "TicketEmail_checkoutId_idx" ON "TicketEmail"("checkoutId");
CREATE INDEX "TicketEmail_ticketId_idx" ON "TicketEmail"("ticketId");

-- Provider refunds: reused for tickets (D14). A legacy refund has its wallet debit; a ticket refund names the
-- ticket (and the credit, when a credit that came from it is refunded on account closure, D11), never both.
ALTER TABLE "ProviderRefund" ALTER COLUMN "debitTransactionId" DROP NOT NULL;
ALTER TABLE "ProviderRefund" ADD COLUMN "ticketId" UUID;
ALTER TABLE "ProviderRefund" ADD COLUMN "creditId" UUID;
ALTER TABLE "ProviderRefund" ADD CONSTRAINT "ProviderRefund_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "MatchTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderRefund" ADD CONSTRAINT "ProviderRefund_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "MatchCredit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderRefund" ADD CONSTRAINT "ProviderRefund_link_check" CHECK (
  ("debitTransactionId" IS NOT NULL) <> ("ticketId" IS NOT NULL) AND ("creditId" IS NULL OR "ticketId" IS NOT NULL)
);
-- A ticket refund never "returns to the wallet" (there is none).
ALTER TABLE "ProviderRefund" ADD CONSTRAINT "ProviderRefund_ticket_no_restore_check" CHECK ("ticketId" IS NULL OR "status" <> 'RESTORED_TO_WALLET');
-- A ticket is refunded at most once, and so is a credit.
CREATE UNIQUE INDEX "ProviderRefund_one_per_ticket" ON "ProviderRefund"("ticketId") WHERE "ticketId" IS NOT NULL AND "creditId" IS NULL;
CREATE UNIQUE INDEX "ProviderRefund_one_per_credit" ON "ProviderRefund"("creditId") WHERE "creditId" IS NOT NULL;

-- Provider disputes: a ticket payment's dispute has no wallet reversal (D9). Legacy rows keep their rule.
ALTER TABLE "ProviderDispute" ALTER COLUMN "debitTransactionId" DROP NOT NULL;
ALTER TABLE "ProviderDispute" ADD COLUMN "dueAt" TIMESTAMP(3);
ALTER TABLE "ProviderDispute" DROP CONSTRAINT "ProviderDispute_won_reversal_check";
ALTER TABLE "ProviderDispute" ADD CONSTRAINT "ProviderDispute_won_reversal_check" CHECK (
  "debitTransactionId" IS NULL OR (("status" = 'WON') = ("reversalTransactionId" IS NOT NULL))
);
ALTER TABLE "ProviderDispute" ADD CONSTRAINT "ProviderDispute_ticket_no_reversal_check" CHECK ("debitTransactionId" IS NOT NULL OR "reversalTransactionId" IS NULL);

COMMIT;
