-- Gate 7 / TKT-709: DEC-019 team matches owe their venue exactly like DEC-018 Quick Matches: only
-- when the match went ahead (confirmed at the T-30 go/no-go and kicked off), created at kickoff from
-- the admin-only price snapshot, at most once per reservation. The eligibility trigger now also
-- requires a go/no-go time, for both match kinds (a legacy match without one is never owed through
-- this path; reconciliation lists it for finance, as before). Replaces the trigger function only.
BEGIN;

CREATE OR REPLACE FUNCTION assert_venue_payable_eligible() RETURNS trigger AS $$
DECLARE
  reservation RECORD;
BEGIN
  SELECT r."status", r."priceCentsSnapshot", r."matchId", f."venueId", m."confirmedAt", m."goNoGoAt", m."status" AS "matchStatus"
    INTO reservation
    FROM "FieldReservation" r
    JOIN "ManagedField" f ON f."id" = r."fieldId"
    JOIN "Match" m ON m."id" = r."matchId"
    WHERE r."id" = NEW."reservationId";
  IF NOT FOUND
     OR reservation."status" <> 'CONFIRMED'
     OR reservation."goNoGoAt" IS NULL
     OR reservation."confirmedAt" IS NULL
     OR reservation."matchStatus" NOT IN ('IN_PROGRESS', 'AWAITING_RESULT', 'COMPLETED')
     OR reservation."matchId" <> NEW."matchId"
     OR reservation."venueId" <> NEW."venueId"
     OR reservation."priceCentsSnapshot" <> NEW."amountCents" THEN
    RAISE EXCEPTION 'venue payable not eligible: only a confirmed match that went ahead owes its venue';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
