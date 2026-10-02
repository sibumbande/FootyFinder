-- Batch 5 brief, item B4 (CEO D18): audit and security records are kept for 5 years after the event, or longer only
-- while needed for an open dispute, investigation or legal claim, then deleted (ToS clause 8, retention table).
--
-- AdminAuditLog stays append-only. UPDATE is always refused, exactly as before. DELETE is allowed only when BOTH:
--   * the row is more than 5 years old (createdAt is stored in UTC), and
--   * the nightly retention job has set the transaction-local flag footy.audit_purge = 'on'
--     (set_config(..., true) lasts only until the end of that transaction).
-- Nothing newer than 5 years can be deleted by anyone. The job itself also skips entries linked to an open case.
-- Additive: replaces the trigger function body only; the trigger and table are unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION prevent_admin_audit_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('footy.audit_purge', true) = 'on'
     AND OLD."createdAt" < (now() AT TIME ZONE 'UTC') - interval '5 years' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AdminAuditLog is append-only';
END;
$$ LANGUAGE plpgsql;

COMMIT;
