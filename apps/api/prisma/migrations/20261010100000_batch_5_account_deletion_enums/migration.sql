-- CEO batch 5, item 1: self-service account deletion. Enum values only, in their own migration so they are
-- committed before any statement uses them. PENDING_DELETION = deactivated during the 14-day grace period;
-- DELETED = anonymised after the final step (the row is kept so ledger, Terms acceptance, audit and lineup
-- records stay linked to an anonymous ID). Additive only.
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'PENDING_DELETION';
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'DELETED';
