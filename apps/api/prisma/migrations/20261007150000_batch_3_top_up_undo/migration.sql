-- CEO touch-up batch 3, item 6b: self-service "Undo top-up". Within 24 hours of a credited top-up the player may
-- refund the unspent part back to the same card through Paystack, once per top-up. It reuses the Gate 6 card
-- refund path (wallet debited first; a failed Paystack refund stays FAILED for finance, never silently
-- re-credited). `source` tells admin-initiated refunds from player undos; the partial unique index allows at most
-- one player undo per top-up even under concurrent requests. Additive only.
BEGIN;

CREATE TYPE "RefundSource" AS ENUM ('ADMIN', 'PLAYER_UNDO');

ALTER TABLE "ProviderRefund" ADD COLUMN "source" "RefundSource" NOT NULL DEFAULT 'ADMIN';

CREATE UNIQUE INDEX "ProviderRefund_one_player_undo_per_top_up" ON "ProviderRefund"("providerPaymentId") WHERE "source" = 'PLAYER_UNDO';

COMMIT;
