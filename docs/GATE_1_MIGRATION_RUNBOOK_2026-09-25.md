# Gate 1 data-migration runbook

Date: 2026-09-25  
Migration: `20260925090000_gate_1_alignment`

This runbook covers the one-time data and schema transition for TKT-104, TKT-108, and TKT-109. Run it first against the disposable PostgreSQL environment from TKT-002, then against a backed-up production database during a controlled deployment.

## What the migration changes

- Finds future, not-started 90-minute matches in `DRAFT`, `OPEN`, `READY`, or legacy `FULL`, records an audit entry, notifies the organiser and current participants, and changes only `durationMinutes` to 60. Active, completed, cancelled, and historical matches are unchanged.
- Replaces each non-null invalid, mixed-case, or duplicate Team short name with a deterministic uppercase alphanumeric code of no more than four characters. Existing valid unique values are preserved. Each changed value is audited and the Team owner is notified.
- Adds database enforcement for non-null Team short names: uppercase alphanumeric, one to four characters, and unique.
- Audits legacy persisted `FULL` matches, changes them to `OPEN`, and removes `FULL` from the stored PostgreSQL enum. The API now derives `FULL` from confirmed participants and configured capacity while the lifecycle state is open.
- Uses eligibility predicates and notification deduplication so rerunning the preflight or a forward-fix does not repeat completed work.

## Before deployment

1. Take and verify a database backup using the normal operating procedure.
2. Stop or drain old application processes so nothing can write the old enum or validation rules while the migration is running.
3. Set `DATABASE_URL` to the intended non-production database and run:

   ```powershell
   npm run gate1:preflight --workspace=@footy-finder/api
   ```

4. Save the reported counts. Exit code `2` means rows need remediation; it is expected before the migration and should be zero afterwards. Any connection or query failure must stop the deployment.
5. Review the candidate matches and Teams with the data owner before applying the migration to production.

## Apply

```powershell
npm run prisma:deploy
```

The migration is transactional. A failure rolls back its schema and data changes together.

## Post-deployment verification

1. Rerun `gate1:preflight`; every count must be zero.
2. Confirm `MATCH_DURATION_POLICY_MIGRATED`, `TEAM_SHORT_NAME_REMEDIATED`, and `PERSISTED_FULL_STATUS_REMOVED` audit rows match the original candidate counts.
3. Confirm affected users received one persisted notification per affected match or Team.
4. Confirm the database rejects a lowercase, non-alphanumeric, over-four-character, or duplicate non-null Team short name.
5. Fill an open Quick Match to capacity and confirm the API exposes `FULL`; release a place and confirm it exposes the underlying `OPEN` or `READY` lifecycle state again.
6. Run the database smoke tier and focused Playwright authentication-return flow before promoting the release.

## Failure and forward-fix guidance

- Do not manually mark the migration as applied after a failed transaction.
- If a production-shaped dataset exposes an unhandled short-name collision, leave the migration rolled back, add a deterministic collision case in a new migration revision, and retest from a restored disposable copy.
- Do not edit this migration after it has been applied to any shared environment. Create a forward-fix migration instead.
- A rollback that restores the old `FULL` enum also requires deploying application code that understands the old persistence contract. Prefer a forward fix once the application and migration have been promoted together.

## Verification record

On 2026-09-25, Prisma generation, the complete unit/component test suite, lint, and all workspace builds passed. Runtime migration, database smoke, and Playwright verification remain pending because this workspace has no configured/reachable PostgreSQL instance and no Docker or `psql` executable.
