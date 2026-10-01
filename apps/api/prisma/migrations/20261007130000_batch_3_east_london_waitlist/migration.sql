-- CEO touch-up batch 3, item 4: East London (KuGompo) on the city waiting list. Additive; safe to re-run.
INSERT INTO "City" ("id", "code", "name", "timezone", "supportStatus", "updatedAt") VALUES
  ('10000000-0000-4000-8000-000000000007', 'EAST_LONDON', 'East London (KuGompo)', 'Africa/Johannesburg', 'WAITLIST', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
