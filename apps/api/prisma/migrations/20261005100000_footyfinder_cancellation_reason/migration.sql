-- CEO Q4 (2026-09-30): admin "Cancel match (weather/venue)" before kick-off.
-- Additive: widens the cancellation reason CHECK with FOOTYFINDER_CANCELLED. No data changes.
BEGIN;

ALTER TABLE "Match" DROP CONSTRAINT "Match_cancellationReason_check";
ALTER TABLE "Match" ADD CONSTRAINT "Match_cancellationReason_check" CHECK (
  "cancellationReason" IS NULL
  OR "cancellationReason" IN ('ORGANISER_CANCELLED', 'POSITIONS_UNFILLED', 'TEAM_FEES_UNFUNDED', 'NO_OPPONENT', 'TEAM_CANCELLED', 'NO_REFEREE', 'FOOTYFINDER_CANCELLED')
);

COMMIT;
