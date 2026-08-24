ALTER TABLE "MatchResultRevision" DROP CONSTRAINT "MatchResultRevision_matchResultId_fkey";
ALTER TABLE "MatchResultRevision" ADD CONSTRAINT "MatchResultRevision_matchResultId_fkey"
  FOREIGN KEY ("matchResultId") REFERENCES "MatchResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_match_result_revision_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'MatchResultRevision is append-only';
END;
$$ LANGUAGE plpgsql;
