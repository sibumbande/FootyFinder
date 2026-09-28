ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MATCH_POSITION_CHANGED';

BEGIN;

-- Monotonic per-Match formation version. Every committed formation mutation increments it so
-- realtime clients can discard duplicate or out-of-order formation snapshots.
ALTER TABLE "Match" ADD COLUMN "formationVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Match" ADD CONSTRAINT "Match_formationVersion_check" CHECK ("formationVersion" >= 0);

-- Append-only audit of Quick Match position changes (player self-claims and organiser overrides).
-- slotId, actorUserId, participantId, and previousParticipantId are snapshots rather than foreign
-- keys so later participant/slot changes never rewrite history. Rows are removed only when the
-- owning Match is deleted.
CREATE TABLE "MatchFormationEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchId" UUID NOT NULL,
  "slotId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "participantId" UUID,
  "previousParticipantId" UUID,
  "formationVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchFormationEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MatchFormationEvent_action_check" CHECK (
    "action" IN ('SELF_CLAIM', 'SELF_MOVE', 'ORGANISER_ASSIGN', 'ORGANISER_SWAP', 'ORGANISER_REMOVE')
  ),
  CONSTRAINT "MatchFormationEvent_formationVersion_check" CHECK ("formationVersion" > 0),
  CONSTRAINT "MatchFormationEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MatchFormationEvent_matchId_createdAt_idx" ON "MatchFormationEvent"("matchId", "createdAt");

CREATE FUNCTION prevent_match_formation_event_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'MatchFormationEvent is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MatchFormationEvent_append_only"
BEFORE UPDATE ON "MatchFormationEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_match_formation_event_update();

COMMIT;
