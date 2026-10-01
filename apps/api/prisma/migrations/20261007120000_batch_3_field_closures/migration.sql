-- CEO touch-up batch 3, item 3: field closures. An admin closes a field for a one-off time range, or weekly
-- (e.g. Italian Club training, Mondays 18:00-20:00 in the venue's timezone) from a start date with an optional
-- end date, with an internal reason. Closed times are never offered as slots and cannot be booked. Existing
-- matches that clash are listed for the admin, never cancelled automatically.
-- D1: closures go live immediately (one MFA-verified admin with fresh MFA, a reason and an audit entry); the venue
-- stays published. Removing a closure keeps the row (removedAt/removedBy) for the audit trail. Admin-only:
-- closures and reasons never reach players. Additive only.
BEGIN;

CREATE TYPE "FieldClosureKind" AS ENUM ('ONE_OFF', 'WEEKLY');

CREATE TABLE "ManagedFieldClosure" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "fieldId" UUID NOT NULL,
  "kind" "FieldClosureKind" NOT NULL,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "dayOfWeek" INTEGER,
  "startMinute" INTEGER,
  "endMinute" INTEGER,
  "startsOn" DATE,
  "endsOn" DATE,
  "reason" TEXT NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removedAt" TIMESTAMP(3),
  "removedByUserId" UUID,
  CONSTRAINT "ManagedFieldClosure_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManagedFieldClosure_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ManagedField"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ManagedFieldClosure_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ManagedFieldClosure_removedByUserId_fkey" FOREIGN KEY ("removedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ManagedFieldClosure_reason_check" CHECK (char_length("reason") BETWEEN 3 AND 240),
  CONSTRAINT "ManagedFieldClosure_shape_check" CHECK (
    ("kind" = 'ONE_OFF' AND "startsAt" IS NOT NULL AND "endsAt" IS NOT NULL AND "startsAt" < "endsAt"
      AND "dayOfWeek" IS NULL AND "startMinute" IS NULL AND "endMinute" IS NULL AND "startsOn" IS NULL AND "endsOn" IS NULL)
    OR
    ("kind" = 'WEEKLY' AND "startsAt" IS NULL AND "endsAt" IS NULL
      AND "dayOfWeek" BETWEEN 0 AND 6 AND "startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute"
      AND "startsOn" IS NOT NULL AND ("endsOn" IS NULL OR "endsOn" >= "startsOn"))
  )
);
CREATE INDEX "ManagedFieldClosure_fieldId_idx" ON "ManagedFieldClosure"("fieldId") WHERE "removedAt" IS NULL;

COMMIT;
