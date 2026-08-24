CREATE OR REPLACE FUNCTION prevent_match_result_revision_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'MatchResultRevision is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MatchResultRevision_append_only"
BEFORE UPDATE OR DELETE ON "MatchResultRevision"
FOR EACH ROW EXECUTE FUNCTION prevent_match_result_revision_mutation();
