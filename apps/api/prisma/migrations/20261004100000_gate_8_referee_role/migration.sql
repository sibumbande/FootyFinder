-- Gate 8 / TKT-801 (DEC-020): the FootyFinder referee role.
-- Referee is a role an admin grants to, or revokes from, a normal user account. Each grant is a
-- permanent row: revoking stamps revokedAt/revokedById/revokeReason once and never deletes the
-- row, so the history of who was a referee, and when, is kept. At most one active grant per user.
-- Every grant and revoke is also written to AdminAuditLog by the service. Additive only.
BEGIN;

CREATE TABLE "RefereeGrant" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "grantedById" UUID,
  "grantReason" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedById" UUID,
  "revokeReason" TEXT,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "RefereeGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RefereeGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RefereeGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RefereeGrant_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RefereeGrant_grantReason_check" CHECK (char_length("grantReason") BETWEEN 3 AND 500),
  CONSTRAINT "RefereeGrant_revocation_check" CHECK (
    ("revokedAt" IS NULL AND "revokedById" IS NULL AND "revokeReason" IS NULL)
    OR ("revokedAt" IS NOT NULL AND "revokedAt" >= "grantedAt" AND char_length("revokeReason") BETWEEN 3 AND 500)
  )
);
CREATE UNIQUE INDEX "RefereeGrant_one_active_per_user" ON "RefereeGrant"("userId") WHERE "revokedAt" IS NULL;
CREATE INDEX "RefereeGrant_userId_grantedAt_idx" ON "RefereeGrant"("userId", "grantedAt");

-- A grant is permanent. The only change allowed is revoking an active grant, once.
CREATE FUNCTION protect_referee_grant() RETURNS trigger AS $$
BEGIN
  IF OLD."revokedAt" IS NOT NULL
     OR NEW."revokedAt" IS NULL
     OR NEW."userId" IS DISTINCT FROM OLD."userId"
     OR NEW."grantedById" IS DISTINCT FROM OLD."grantedById"
     OR NEW."grantReason" IS DISTINCT FROM OLD."grantReason"
     OR NEW."grantedAt" IS DISTINCT FROM OLD."grantedAt" THEN
    RAISE EXCEPTION 'referee grants are permanent; only an active grant can be revoked, once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "RefereeGrant_protect"
  BEFORE UPDATE ON "RefereeGrant"
  FOR EACH ROW EXECUTE FUNCTION protect_referee_grant();

COMMIT;
