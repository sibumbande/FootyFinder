BEGIN;

-- TKT-104: audit, notify, and normalize future not-started 90-minute matches.
CREATE TEMP TABLE "_Gate1DurationCandidates" ON COMMIT DROP AS
SELECT "id", "name", "createdById"
FROM "Match"
WHERE "durationMinutes" = 90
  AND "startsAt" > CURRENT_TIMESTAMP
  AND "status" IN ('DRAFT', 'OPEN', 'READY', 'FULL');

INSERT INTO "AdminAuditLog" (
  "id", "action", "entityType", "entityId", "metadata", "createdAt"
)
SELECT
  gen_random_uuid(),
  'MATCH_DURATION_POLICY_MIGRATED',
  'MATCH',
  candidate."id"::text,
  jsonb_build_object('beforeMinutes', 90, 'afterMinutes', 60),
  CURRENT_TIMESTAMP
FROM "_Gate1DurationCandidates" candidate;

INSERT INTO "Notification" (
  "id", "userId", "dedupeKey", "type", "title", "message", "targetPath", "createdAt"
)
SELECT
  gen_random_uuid(),
  recipient."userId",
  'gate1:duration:' || candidate."id"::text || ':' || recipient."userId"::text,
  'INFO',
  'Match duration updated',
  candidate."name" || ' now uses the standard 60-minute duration.',
  '/matches/' || candidate."id"::text,
  CURRENT_TIMESTAMP
FROM "_Gate1DurationCandidates" candidate
CROSS JOIN LATERAL (
  SELECT candidate."createdById" AS "userId"
  UNION
  SELECT participant."userId"
  FROM "MatchParticipant" participant
  WHERE participant."matchId" = candidate."id"
    AND participant."status" = 'JOINED'
) recipient
ON CONFLICT ("dedupeKey") DO NOTHING;

UPDATE "Match" match
SET "durationMinutes" = 60,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_Gate1DurationCandidates" candidate
WHERE match."id" = candidate."id";

-- TKT-108: preserve valid unique codes and deterministically remediate every
-- invalid, mixed-case, or duplicate value before constraints are installed.
CREATE TEMP TABLE "_Gate1UsedTeamCodes" (
  "code" TEXT PRIMARY KEY
) ON COMMIT DROP;

DO $$
DECLARE
  team_record RECORD;
  base_code TEXT;
  candidate_code TEXT;
  suffix TEXT;
  collision_index INTEGER;
BEGIN
  FOR team_record IN
    SELECT "id", "name", "shortName", "ownerUserId"
    FROM "Team"
    WHERE "shortName" IS NOT NULL
    ORDER BY "createdAt", "id"
  LOOP
    candidate_code := UPPER(team_record."shortName");

    IF candidate_code !~ '^[A-Z0-9]{1,4}$'
       OR EXISTS (
         SELECT 1 FROM "_Gate1UsedTeamCodes" used WHERE used."code" = candidate_code
       )
    THEN
      base_code := UPPER(regexp_replace(team_record."name", '[^A-Za-z0-9]', '', 'g'));
      IF base_code = '' THEN
        base_code := 'TEAM';
      END IF;
      base_code := LEFT(base_code, 4);
      candidate_code := base_code;
      collision_index := 1;

      WHILE EXISTS (
        SELECT 1 FROM "_Gate1UsedTeamCodes" used WHERE used."code" = candidate_code
      ) LOOP
        suffix := collision_index::text;
        IF LENGTH(suffix) > 3 THEN
          RAISE EXCEPTION 'Unable to derive a unique four-character Team code for Team %', team_record."id";
        END IF;
        candidate_code := LEFT(base_code, 4 - LENGTH(suffix)) || suffix;
        collision_index := collision_index + 1;
      END LOOP;
    END IF;

    IF team_record."shortName" IS DISTINCT FROM candidate_code THEN
      INSERT INTO "AdminAuditLog" (
        "id", "action", "entityType", "entityId", "metadata", "createdAt"
      ) VALUES (
        gen_random_uuid(),
        'TEAM_SHORT_NAME_REMEDIATED',
        'TEAM',
        team_record."id"::text,
        jsonb_build_object('before', team_record."shortName", 'after', candidate_code),
        CURRENT_TIMESTAMP
      );

      INSERT INTO "Notification" (
        "id", "userId", "dedupeKey", "type", "title", "message", "targetPath", "createdAt"
      ) VALUES (
        gen_random_uuid(),
        team_record."ownerUserId",
        'gate1:team-short-name:' || team_record."id"::text,
        'TEAM_UPDATED',
        'Team short name updated',
        'Your Team short name is now ' || candidate_code || '. You can choose another available four-character code in Team settings.',
        '/teams/' || team_record."id"::text,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("dedupeKey") DO NOTHING;

      UPDATE "Team"
      SET "shortName" = candidate_code,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = team_record."id";
    END IF;

    INSERT INTO "_Gate1UsedTeamCodes" ("code") VALUES (candidate_code);
  END LOOP;
END $$;

ALTER TABLE "Team"
ADD CONSTRAINT "Team_shortName_format_check"
CHECK ("shortName" IS NULL OR "shortName" ~ '^[A-Z0-9]{1,4}$');

CREATE UNIQUE INDEX "Team_shortName_key" ON "Team"("shortName");

-- TKT-109: FULL is an API-derived capacity state, never persisted lifecycle.
INSERT INTO "AdminAuditLog" (
  "id", "action", "entityType", "entityId", "metadata", "createdAt"
)
SELECT
  gen_random_uuid(),
  'PERSISTED_FULL_STATUS_REMOVED',
  'MATCH',
  "id"::text,
  jsonb_build_object('beforeStatus', 'FULL', 'afterStatus', 'OPEN'),
  CURRENT_TIMESTAMP
FROM "Match"
WHERE "status" = 'FULL';

UPDATE "Match" SET "status" = 'OPEN' WHERE "status" = 'FULL';

ALTER TABLE "Match" ALTER COLUMN "status" DROP DEFAULT;
CREATE TYPE "MatchStatus_new" AS ENUM (
  'DRAFT',
  'OPEN',
  'READY',
  'IN_PROGRESS',
  'AWAITING_RESULT',
  'COMPLETED',
  'CANCELLED'
);
ALTER TABLE "Match"
ALTER COLUMN "status" TYPE "MatchStatus_new"
USING ("status"::text::"MatchStatus_new");
DROP TYPE "MatchStatus";
ALTER TYPE "MatchStatus_new" RENAME TO "MatchStatus";
ALTER TABLE "Match" ALTER COLUMN "status" SET DEFAULT 'OPEN';

COMMIT;
