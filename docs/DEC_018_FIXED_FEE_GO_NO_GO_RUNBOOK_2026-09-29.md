# DEC-018 runbook: fixed R80 fee, hidden venue costs, no host guarantee, T-30 go/no-go

Date: 2026-09-29
Branch: `ceo/finish-gate-5`
Migration: `20260930100000_fixed_fee_go_no_go` (additive)
Tickets: TKT-311 to TKT-315. See DEC-018 and section 9A of the ticket breakdown.

## Rules now in force (Quick Matches created after this ships)

1. **Fixed fee.** Every player who joins pays exactly **R80** (`MATCH_FEE_CENTS = 8000`), subs included. Hosts cannot set a fee; a client-sent `feeCents` is stripped. Admin-loaded matches, previously free, also cost R80.
2. **No host guarantee.** A host places no wallet hold and owes nothing for the venue. They pay R80 only if they join a team.
3. **T-30 go/no-go.** At `goNoGoAt = kickoff − 30 minutes` the durable job `QUICK_MATCH_GO_NO_GO` decides the match. For a 14:00 kickoff on 30 Oct 2026, the check runs at 13:30.
   - **Every formation position claimed:** the match is confirmed (`confirmedAt`). Subs are optional.
   - **Otherwise:** the match is cancelled with `cancellationReason = POSITIONS_UNFILLED`, and every `SUCCEEDED` payment is refunded in full with a `MATCH_CANCELLATION_CREDIT` keyed `match-cancellation:<paymentId>`, so a fee can never be refunded twice.
   - The field reservation becomes `CANCELLED` and nothing is owed to the venue.
   - Every joined player and the host are notified once each: an in-app notification with a realtime toast, and a transactional email (TKT-316). The wording names the venue, date and kickoff time, for example: "Your match at Italian Club on Fri 30 Oct 2026 at 14:00 was cancelled because not every position was filled 30 minutes before kickoff. Your R80 has been refunded to your FootyFinder wallet."
4. **Freeze (D1).** From T-30 until kickoff, the API rejects joins, leaves, claims, team changes, organiser formation moves and host cancellation with `409 LINEUP_LOCKED`. A player who can't attend after T-30 is a no-show, with no refund.
5. **Leaving before T-30 (D2).** The existing rule is unchanged:
   - more than 12h before kickoff: full R80 credit;
   - 12h or less: no credit, unless a paid replacement joins their team.
   - If the match is then auto-cancelled at T-30, the unrefunded R80 is refunded.
6. **Host cancel (D3).** Allowed until T-30 only. Every player gets a full refund and nothing is owed to the venue. Every joined player and the host get the same alert and email as an auto-cancel, worded "…was cancelled by the host." (TKT-316).
7. **Legacy matches (D4).** Matches created before DEC-018 have `goNoGoAt = NULL`. They keep their stored fee and old rules, and are never auto-cancelled.
8. **Venue costs are admin-only.** No player- or host-facing UI or API returns `ManagedFieldPrice` amounts, reservation price snapshots or funding totals.
9. **Player pooled field bookings retired (D5).** `GET /bookings/fields`, `POST /bookings` and `POST /bookings/:id/contributions` return `410 PLAYER_FIELD_BOOKING_RETIRED`. Booking history stays readable, with no money fields. Team Matches never used this flow.

## Venue cost reference: ADMIN-ONLY, never shown to players or hosts

| Venue | 5-a-side | 7-a-side | 11-a-side |
|---|---|---|---|
| Italian Club | R500 | R600 | R800 |
| Queens Park | – | – | R1000 |
| Cape Town City FC | – | – | R1000 |

**How to enter these (admin app, Venues).** On each field, open "Effective price history" and add one price per supported format using **Format scope**.

For example, Italian Club has one field supporting 5/7/11-a-side with three scoped prices:
- 5-a-side: R500
- 7-a-side: R600
- 11-a-side: R800

These figures are never hard-coded in application logic.
- **Format scoping works.** The catalogue supports a different effective price per format on the same field; the exclusion constraint is per format (Gate 3, with the IMMUTABLE helper fix).
- **Snapshots pick the right price.** A reservation snapshots the format-specific price over an all-formats price. `smoke:go-no-go` proves this with R500/R600/R800 on one field.
- **Completeness still applies.** Every supported format on a field must have an active price before the venue can be submitted.

## Venue settlement (built in Gate 6, see `docs/GATE_6_PAYMENTS_SETTLEMENT_RUNBOOK_2026-09-29.md`)

- **A cancelled match owes nothing.** An organiser cancel or T-30 auto-cancel leaves the reservation `CANCELLED`, with no hold, debit, obligation or payable. The smoke test asserts that no ledger row references the cancelled reservation.
- **Future payout marker (Gate 6, TKT-607/608, DEC-012).** The settlement worker creates exactly one payable per `FieldReservation`, keyed by reservation id, from the admin-only `priceCentsSnapshot`, and only when all of these hold:
  - the reservation is `CONFIRMED`;
  - the match has `confirmedAt` set;
  - the match reached kickoff or `COMPLETED`.

  The payable is marked due after kickoff and settled weekly under dual control.

## Money flows

| Flow | Before (Gate 3) | After (DEC-018) |
|---|---|---|
| Create Quick Match | Host-set fee ≤ fair share; host hold for the full venue price | Fee R80; no hold; host needs no balance |
| Admin-loaded match | Free | R80 |
| Join (subs included) | Debit the host-set fee | Debit R80 (`MATCH_ENTRY_DEBIT −8000`) |
| Leave before T-30 | 12h rule | Unchanged (D2) |
| Join, leave or claim after T-30 | Allowed until kickoff | `409 LINEUP_LOCKED` (D1) |
| Host cancel | Players refunded plus a venue charge to the host | Players refunded only; until T-30 (D3) |
| Kickoff guarantee settlement | Debit the host's shortfall | Removed; the legacy job only releases old holds |
| T-30, not full | n/a | Auto-cancel; every R80 refunded once |
| T-30, full | n/a | Confirmed; venue owed after the match (future Gate 6) |
| Player pooled booking | Players hold funds toward the venue price | Retired (410) |

## Player communication (TKT-316, TKT-317, TKT-319)

- **Cancellation alert (TKT-316).** `cancelInTx` writes one `MATCH_CANCELLED` notification per recipient (key `match:<matchId>:match-cancelled:<userId>`). Recipients are every joined player, every refunded payer and the host. It also enqueues one `MATCH_CANCELLED_EMAIL` durable job per recipient (key `match-cancelled-email:<matchId>:<userId>`) in the same transaction.
  - The email is sent after commit through the email provider abstraction (Postmark in production, test/console locally), with retries.
  - Delivery is at-least-once. A crash after Postmark accepts the email but before the job is marked SUCCEEDED can resend it. This is accepted.
  - The wallet refreshes live after the refund (`wallet:updated` on `MATCH_CANCELLED`).
  - The match page and public preview show the same explanation for both reasons.
- **Notices (TKT-317).** Create-match (Schedule and Review steps) shows: "Heads up: if every position isn't filled 30 minutes before kickoff (13:30), this match is cancelled automatically and every player gets their R80 refunded to their wallet." The join dialog shows the rule with the computed time before the player pays.
- **"Not full yet" reminder (TKT-319).**
  - Job: durable job `QUICK_MATCH_FILL_REMINDER`, key `quick-match-fill-reminder:<matchId>`.
  - Timing: runs at kickoff − 2h, and is only enqueued when the match is created more than 2h30m before kickoff.
  - When it's a no-op: the match is full, cancelled, confirmed or legacy.
  - Otherwise: one in-app notification and toast (no email) to the host and each joined player, for example "3 positions still open. Share the match link or it'll be cancelled at 13:30." Key `match:<matchId>:fill-reminder:<userId>`.
  - Migration: `20261001100000_match_fill_reminder` adds the `MATCH_FILL_REMINDER` notification type.

## Operations

- **Job:** `QUICK_MATCH_GO_NO_GO`, dedupe key `quick-match-go-no-go:<matchId>`, enqueued in the transaction that creates the match.
  - It runs through the durable queue: `FOR UPDATE SKIP LOCKED`, retry with backoff, and stale-lock reclaim after a crash or restart.
  - The decision is idempotent; repeat runs return `ALREADY_DECIDED`.
  - An early run fails with `GO_NO_GO_NOT_DUE` and is retried.
- **Scheduler:** the lifecycle scheduler never starts a go/no-go match that has not been confirmed.
- **Alert on:**
  - `QUICK_MATCH_GO_NO_GO` jobs overdue or `FAILED`;
  - any unconfirmed, uncancelled go/no-go match past kickoff.

  Both appear on the admin dashboard's **Go/no-go checks** panel (TKT-318), which refreshes every 30 seconds. It shows overdue (pending more than 60s past `runAt`), failed, and stuck (RUNNING past the lock timeout) checks, plus matches past kickoff that were never decided. There is no external alerting service yet.
- **Metrics:** `go_no_go_confirmed_total` and `go_no_go_cancelled_total`. Log event: `go_no_go_decided`, with outcome and filled/total.
- **Admin loads** must be more than 30 minutes before kickoff (`MATCH_START_TIME_INVALID`).

## Verification (2026-09-29)

```powershell
# disposable DB only (docs/TEST_DATABASE.md)
$env:NODE_ENV='test'; $env:DATABASE_URL='postgresql://…/footy_finder_test?schema=public'
cd apps/api; npx prisma migrate deploy
npm run smoke:go-no-go            # passed 3 consecutive runs
npm run smoke:position-claims; npm run smoke:field-bookings; npm run smoke:financial-integrity
cd ../..; $env:ADMIN_TEST_DATA_ENABLED='true'
npx playwright test e2e/position-claim.spec.ts e2e/critical-path.spec.ts   # both passed
```

- `npx prisma migrate reset --force` on local `footy_finder` applied all 28 migrations. It wiped local dev data; re-publish the dev legal placeholders afterwards with `legal:publish`.
- Privacy proof: `apps/api/src/modules/venues/venue-cost-privacy.test.ts`.
- Grep proof (player and host surfaces):
  - No `priceCents`, `fromPriceCents`, `fundedCents` or `remainingCents` in the web app, the player shared types (venue, match and player booking), or the player api-client modules.
  - The remaining API matches are admin-only: `adminBookingDto` (used by `/admin/matches` and retired internal paths) and the dispute evidence snapshot, which only the admin view returns.

## Terms of Service contradictions (resolved in ToS v2.1)

Resolved on 2026-09-29: `docs/legal/TERMS_OF_SERVICE.md` is now on this branch as version 2.1 and matches the rules above. The table below is kept as the record of what changed. The database copy must be re-published with `legal:publish` before launch.

Source: `docs/legal/TERMS_OF_SERVICE.md`, latest version on branch `ceo/tier2-real-venues` (commit `d39eec2`). This file is not on `ceo/finish-gate-5`. The legal documents stored in the local DB are development placeholders with no substantive text.

| Clause | ToS says | DEC-018 does |
|---|---|---|
| 11.1 | Starting places go to "the first twenty-two users who confirm and fund a position" | Players pay on joining and then claim positions; order of payment does not assign a position |
| 11.2 | Up to 32 users: 22 starters and up to 10 reserves | Capacity is per format (5/7/11-a-side), with 0–10 subs per team set per match |
| 11.3 | Reserves are auto-promoted in order of registration when a starter withdraws; notified by push and email | No auto-promotion. A vacated position is open for anyone on that side to claim until T-30. No push or email is sent for it (in-app notifications only) |
| 11.4 | An unused reserve's full Slot Fee is returned within 24 hours after kickoff | Subs pay R80 and are not refunded for not playing, unless the match is cancelled |
| 11.5 | A "minimum number of confirmed players" is published; if not reached by the deadline, the match is cancelled | The rule is that **every formation position** must be claimed by **T-30**. Subs don't count, and the deadline is fixed at kickoff − 30 minutes |
| 14.3 | The Slot Fee is **held** on joining, then allocated to the venue on confirmation | The R80 is **debited** immediately on joining, not held |
| 14.4 | "Our commission is included in the Slot Fee" | The fee is a fixed R80 regardless of venue cost; no commission split is defined |
| 14.5 / 15.1 / 15.7 | Cash withdrawals and refunds to bank or card | Refunds are wallet credits only; no withdrawal or card refund exists yet (DEC-011 says no withdrawals at launch) |
| 15.1 | A failure to reach the minimum gives a 100% refund, "credited automatically" | Consistent in spirit (T-30 auto-cancel refunds R80 automatically), but the trigger differs (see 11.5) |
| 15.3 | >24h: 100%. 24h to 2h: refund only if refilled. <2h: no refund | >12h: 100%. ≤12h to T-30: refund only if a paid replacement joins. After T-30 (the last 30 min): cannot leave, no refund. The 24h and 2h windows don't match the 12h and T-30 rules |
| 15.3 (no-show) | No refund for a no-show | Consistent. DEC-018 makes anyone who can't attend after T-30 a no-show |
| 15.4 | Late withdrawals aren't refunded because "the pitch fee is already committed to the venue" | Under DEC-018 FootyFinder owes the venue nothing for a cancelled match; the stated rationale no longer matches |
| 16.7 | A Match Host may reallocate the position of a player who has not arrived by kickoff | Formation moves are frozen from T-30 (D1); an on-the-day reallocation can't be recorded in the app |
| 1.x definitions / 6.2 | "Slot Fee" is presented as variable and payable to occupy a position | The fee is a fixed platform fee paid on joining, including by subs who may not occupy a position |
| Company facts table | Card and EFT are processed by Paystack and Ozow | Only a demo deposit exists (Gate 6 not built) |

Also for legal review: the T-30 auto-cancel happens inside most venues' 24-hour late-cancellation window, so venue agreements must reflect that FootyFinder owes nothing for a cancelled match.
