-- CEO touch-up batch 3.5, item 5: a Quick Match an admin created for FootyFinder is shown as
-- "Hosted by FootyFinder". The admin stays recorded as createdById (for the audit trail) but has no
-- host role in the player app. Additive: existing matches keep false.
ALTER TABLE "Match" ADD COLUMN "hostedByFootyFinder" BOOLEAN NOT NULL DEFAULT false;
