# Gate 5 position claims and formation UX runbook

Date: 2026-09-28
Branch: `ceo/finish-gate-5`
Migration: `20260929100000_gate_5_position_claims` (additive)

Status: implemented and verified against a local disposable PostgreSQL database. This covers the migration chain, the PostgreSQL race smoke test, and both Playwright journeys. It has not been verified on representative mobile hardware or in CI.

## Delivered behavior

- **Self-claim (TKT-501).** `POST /matches/:id/formation/slots/:slotId/claim` lets a joined Quick Match participant take an open position on their own side before kickoff.
  - Every check and the write run in one serializable transaction behind a `Match` row lock, so the first committed claim wins.
  - A player who already holds a slot is moved atomically (`SELF_MOVE`). They never hold two positions.
  - The losing claimant gets `409 POSITION_ALREADY_CLAIMED`, with the authoritative `FormationSnapshot` in `details`.
  - Other stable errors: `MATCH_PARTICIPANT_REQUIRED` (403), `POSITION_WRONG_SIDE` (403), `FORMATION_SLOT_NOT_FOUND` (404), `MATCH_STARTED` (409), `TEAM_MATCH_PLANNING` (409).
  - Claims never change payment, participation or side.
- **Organiser overrides (TKT-501).** The host's existing `PATCH …/formation/slots/:slotId` keeps its authority. Every player change also:
  - appends an audit row (`ORGANISER_ASSIGN`, `ORGANISER_SWAP` or `ORGANISER_REMOVE`) to the append-only `MatchFormationEvent` table;
  - persists a `MATCH_POSITION_CHANGED` notification for each affected player other than the host, published after commit.
  - "Remove" moves a player off the pitch into reserves. It never removes them from the match and has no wallet effect.
- **Formation versioning.** `Match.formationVersion` increases with every committed formation change, including leave or team-change operations that vacate a slot.
- **Claim UI (TKT-502).**
  - Open positions on the viewer's own side show "CLAIM".
  - A claim is optimistic, with a pending marker. On failure the board rolls back to the server formation.
  - A conflict shows "Position taken", and the board adopts the formation returned with the conflict.
- **Realtime (TKT-503).**
  - The new `match-formation:updated` event carries `{ matchId, formationVersion, slots }`. The web client writes it straight into that Match's cache and ignores duplicate, older and foreign-match snapshots.
  - Formation events no longer refetch every match list and the current user.
  - Events missed while disconnected are recovered by the existing reconnect rejoin and refetch.
  - The legacy `formation:updated` event is still emitted unchanged.
- **Presentation (TKT-504).**
  - Quick Matches label sides **Team A** (HOME) and **Team B** (AWAY) on the pitch, reserves, players panel, join dialog and result form.
  - Markers have an A/B letter badge, avatar plus short name, a "You" ring and label, and explicit open/occupied accessible names.
  - CEO decision: colours are unchanged. Away stays red and home stays blue.
- **Drag/drop stability (TKT-505).**
  - Server formations are adopted by content rather than array identity, and are buffered while a drag is active or a write is settling.
  - Writes run one after another. Queued moves of the same slot collapse to the newest.
  - A rejection restores the server formation. A stale full refetch can no longer roll the formation back to an older version.
  - Drops into open space land immediately.
  - `pointercancel` aborts a drag instead of saving it.
  - Timing samples are available on `window.__footyFormationTimings` outside production builds.

## Shared infrastructure fix: serialization retries under Prisma 7

`serializableTransaction` did not recognise serialization failures from raw queries under Prisma 7 driver adapters. The PostgreSQL `40001` code is nested under `meta.driverAdapterError.cause`, not `meta.code`.

Every path that locks with raw `SELECT … FOR UPDATE` surfaced contention as an error instead of retrying: wallet debit/credit, holds, match join, bookings and now claims. The fix is `isRetryableSerializationError` in `apps/api/src/database/transaction.ts`, with unit tests. The existing `smoke:financial-integrity` and `smoke:field-bookings` still pass.

## Migration

- `ALTER TYPE "NotificationType" ADD VALUE 'MATCH_POSITION_CHANGED'` runs outside the transaction block.
- `Match.formationVersion INTEGER NOT NULL DEFAULT 0`, with a non-negative check.
- `MatchFormationEvent` has a CHECK-constrained `action`, a `(matchId, createdAt)` index, and a trigger that blocks UPDATE.
  - DELETE is allowed only through the owning Match's cascade.
  - Slot, actor and participant IDs are snapshots, not foreign keys.
- No function is used in any index or exclusion constraint.
- `prisma migrate diff` shows no drift for the new objects beyond the database-side UUID default that every hand-written table has.

## Verification commands

These must run against an approved disposable database (`docs/TEST_DATABASE.md`). On 2026-09-28 they ran against a native local `footy_finder_test` on port 5432.

```powershell
$env:NODE_ENV = 'test'
$env:DATABASE_URL = 'postgresql://<user>:<password>@localhost:5432/footy_finder_test?schema=public'
cd apps/api
npx prisma migrate deploy
npm run smoke:position-claims      # 5 races x 4 simultaneous claimants: exactly one winner each
cd ../..
$env:ADMIN_TEST_DATA_ENABLED = 'true'  # disposable DB only; lets test-batch accounts skip legal acceptance
npx playwright test e2e/position-claim.spec.ts e2e/critical-path.spec.ts
```

Results recorded on 2026-09-28:
- `npx prisma migrate reset --force` on the local development database applied all 27 migrations.
- `smoke:position-claims` passed on 4 consecutive runs.
- `e2e/position-claim.spec.ts` passed 3 times. Measured in local desktop Chromium: tap-to-feedback p95 5–8 ms (budget 100 ms), claim-to-confirm p95 440–660 ms (budget 2 s).
- `e2e/critical-path.spec.ts` passed. It could never pass before: its activation helper violated `User_test_batch_consistency`, and that is fixed in TKT-506.

## Known gaps and follow-ups

- **Mobile budget.** The DEC-013 budget is measured on local desktop Chromium only. Measure again on representative mobile hardware and network before release.
- **Broken smoke test (pre-existing, not Gate 5).** `smoke:match-capacity` has not compiled since Gate 3 removed `MatchesRepository.create`. Because `smoke:all` chains with `&&`, it stops there. Run `smoke:position-claims` directly until this is fixed.
- **Venue costs shown to players (pre-existing Gate 3 behaviour; decision required).** Venue costs reach players in several places:
  - Public venue APIs: `fromPriceCents` on list and detail, and `priceCents` on slots.
  - Venue cards and slot buttons in the web app.
  - The create-match page, through a `price` query parameter.

  This conflicts with the CEO rule that venue costs never appear in player-facing UI or responses. Gate 5 adds no price exposure.
- **Undefined colour shade (pre-existing, cosmetic).** `CreateMatchPage` and `TeamPage` use `brand-300`, which is not a defined theme shade, so those borders don't render.
