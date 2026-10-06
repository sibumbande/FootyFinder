# Gate 7 runbook: team wallets, team matches, fill meters, team chat

Date: 2026-09-29
Branch: `ceo/finish-gate-5`
Tickets: TKT-701 to TKT-712, one commit per ticket. Decisions: DEC-014, DEC-018 and DEC-019 (ticket breakdown section 3 and section 11). DEC-019 replaced the DEC-015 challenge flow and 50/50 venue split.

## Rules now in force

1. **Team wallet.** Every team has its own wallet ledger, separate from personal wallets and starting at zero.
   - Any current member adds money from their own wallet: R10 to R5,000 per contribution, and at most R5,000 and 10 contributions per member per team in any 24 hours.
   - It is closed-loop: no cash-out.
   - Spending uses the oldest contributions first. A contributor, including a former member, may take back their own unspent money. Money held for a match can't be taken back.
2. **Creating a team match.** Only a team's owner or a captain can create one. It is always public and listed in the lobby as a team match.
   - There are two entry points to the same wizard: "Create team match" on the team page, and "Play as" in the normal create-match flow.
   - The captain chooses:
     - **"Teams only"**, or
     - **"Open to both"**: another team or individual players, whichever comes first.
   - The captain also chooses the team's subs.
3. **Fee.** Each team pays R80 × (starting positions + that team's own subs). For example, 11-a-side with 3 subs is R880 + R240 = R1,120. FootyFinder sets the R80.
4. **Publishing** needs the home team wallet's **available** balance to be at least the home fee. This is a check, not a hold. A team can have at most 2 published matches whose other side isn't taken yet.
5. **Taking the other side** is instant: first come, first served, with no approval.
   - A team uses "Load my team" and picks its own subs, which sets its own fee.
   - In "Open to both", players join for R80 each under the DEC-018 rules.
   - Once a player has joined, only players can join that side. If every player leaves, the side reopens to teams.
   - A team and a player trying at the same moment: exactly one wins.
   - Nobody plays against their own team.
6. **Fill meter.** Once the other side is taken, each team sees its own meter, for example "R0 / R1,120".
   - Its owner/captains fill it from the team wallet. The money is **held**, not spent.
   - Before an opponent is found, only the fee breakdown shows.
7. **Changing subs.** A team can change its subs until T-30. The fee is recalculated, and any money held above the new fee is released at once.
   - A team can't go below the subs already in its lineup.
   - The individuals side follows the home team's subs, but never drops below the subs who have joined.
8. **T-30 go/no-go** (for a 14:00 kick-off, the check runs at 13:30).
   - **GO:** both meters are full; or, where players took the other side, the home meter is full and every away starting position is claimed. Each team's fee is then taken from its wallet once.
   - **Otherwise:** the match is cancelled.
     - Every hold is released.
     - Every player's R80 is refunded.
     - The reservation is released and nothing is owed to the venue.
     - Every member of both teams, and every player, is notified in the app and by email.
9. **"Teams only" with no opponent.** The home team is warned 48 hours before kick-off. The match is cancelled 24 hours before kick-off if no team has taken the other side. Both apply only when the match was published early enough.
10. **Withdrawing and cancelling.**
    - The team that took the other side may withdraw only itself, before T-30. Its held money is released, the side reopens, and the home team is notified in the app and by email.
    - Only the home team's owner/captains can cancel the whole match, before T-30. Everything is then released or refunded.
11. **Freeze.** From T-30, nobody can take, leave or withdraw from a side, fill a meter, change subs or cancel. Captains may still arrange their own lineup until kick-off.
12. **Venue.** A confirmed team match owes its venue at kick-off, created from the admin-only price snapshot. A cancelled one owes nothing. Venue costs never reach teams, captains or players.
13. **Closing a team** archives it and keeps its history. It is blocked while money is held or a public team match is upcoming. Every contributor's unspent money goes back to their own wallet. The same applies to the 60-day uncontactable rule.
14. **Team chat.** Each team has one permanent chat. Only current members can read or post, and removed members lose access at once. Each member gets one in-app "new messages" notice until they read the chat. It never sends email.

## Money flows

| Event | Team wallet | Personal wallet |
|---|---|---|
| Member contributes | `CONTRIBUTION_CREDIT` + | `TEAM_CONTRIBUTION_DEBIT` − (same transaction, linked) |
| Member takes back unspent money | `CONTRIBUTION_REFUND_DEBIT` − | `TEAM_CONTRIBUTION_REFUND_CREDIT` + |
| Team closed | `CLOSURE_REFUND_DEBIT` − per contributor | `TEAM_CONTRIBUTION_REFUND_CREDIT` + |
| Publish | none (available ≥ fee check) | none |
| Team loads the other side | none | none |
| Captain fills meter | hold (balance unchanged, available down) | none |
| Subs lowered | excess hold released (a partial hold is re-held for the rest) | none |
| Player joins the open side | none | `MATCH_ENTRY_DEBIT` −R80 |
| T-30 GO | every hold captured once as `TEAM_MATCH_FEE_DEBIT` (key `team-match-fee:<holdId>`) | players' R80 stay paid |
| T-30 no-go / home cancel / unmatched cancel | every hold released | every R80 refunded once (`match-cancellation:<paymentId>`) |
| Team withdraws | its holds released | none |
| Kick-off (confirmed) | none | none; `VenuePayable` from the admin-only snapshot |

Lock order: Match row, then Team row, then team wallets (sorted by id), then personal wallets.

## Operations

| Durable job | Dedupe key | Runs at |
|---|---|---|
| `TEAM_MATCH_GO_NO_GO` | `team-match-go-no-go:<matchId>` | T-30. An early run returns `GO_NO_GO_NOT_DUE` and is retried; a stale run is reclaimed |
| `TEAM_METER_REMINDER` | `team-meter-reminder:<matchId>` | Kick-off −2h, to the owner/captains of a side whose meter is short |
| `TEAM_MATCH_UNMATCHED_CANCEL` | `team-match-unmatched-cancel:<matchId>[:<withdrawalId>]` | T-24h ("Teams only") |
| `TEAM_MATCH_NO_OPPONENT_WARNING` | `team-match-no-opponent-warning:<matchId>` | T-48h ("Teams only") |
| `TEAM_MATCH_EMAIL` | per kind, match, event and user | Straight away (opponent found / no opponent yet / opponent withdrew) |
| `QUICK_MATCH_FILL_REMINDER` | reused for "Open to both" | Kick-off −2h |

- **Reconciliation** (`GET /admin/finance/reconciliation`, `wallet:reconcile`; since DEC-021 `tickets:reconcile`, which replaces these wallet checks) now also reports:
  - `TEAM_BALANCE_LEDGER_MISMATCH`
  - `TEAM_NEGATIVE_AVAILABLE_BALANCE`
  - `TEAM_CONTRIBUTION_LINK_MISMATCH`
  - `TEAM_PROVENANCE_MISMATCH`
  - `TEAM_ARCHIVED_WITH_FUNDS`
  - `TEAM_HOLD_ORPHANED`
  - `TEAM_METER_OVERFUNDED`
  - `TEAM_FEE_CAPTURE_MISMATCH`
  - `STARTED_MATCH_WITHOUT_PAYABLE`, which now covers team matches.
- **Audit:** every team-match command is written to the append-only `TeamMatchAuditEvent` with its actor. System jobs have no actor.

## API

- **Team wallet:**
  - `GET /teams/:id/wallet`
  - `GET /teams/:id/wallet/transactions`
  - `GET /teams/:id/wallet/holds`
  - `POST /teams/:id/wallet/contributions` (needs `Idempotency-Key`)
  - `POST /teams/:id/wallet/refunds`
  - `GET /wallet/team-contributions`
- **Team matches:**
  - `POST /matches` with `playAsTeamId`, `otherSideMode` and `teamSubstituteCount`
  - `POST /matches/:id/other-side/team`
  - `POST /matches/:id/other-side/team/withdraw`
  - `GET /matches/:id/team-sides/:side/meter`
  - `POST /matches/:id/team-sides/:side/meter/fill` (needs `Idempotency-Key`)
  - `PATCH /matches/:id/team-sides/:side/substitutes`
- **Team chat:**
  - `GET /teams/:id/chat/messages`
  - `POST /teams/:id/chat/messages`
  - `POST /teams/:id/chat/read`
  - socket event `team:chat-message` in the `team:<id>` room
- **Retired:** `POST /teams/:id/matches` (manual venue) now answers `410 TEAM_FIXTURE_MANUAL_VENUE_RETIRED`.

## Migrations (additive, hand-written)

`20261003100000_gate_7_team_wallet_enums`, `20261003110000_gate_7_team_wallet`, `20261003120000_gate_7_team_matches`, `20261003130000_gate_7_side_taking`, `20261003140000_gate_7_team_match_notifications`, `20261003150000_gate_7_team_match_payables`, `20261003160000_gate_7_team_chat_enums`, `20261003170000_gate_7_team_chat`.

- Two existing CHECKs are replaced by wider ones: the personal ledger sign check, and `Match_cancellationReason_check`.
- The venue-payable eligibility trigger function now also requires `goNoGoAt`.
- No index uses a function.

## Verification (2026-09-29)

```powershell
# disposable DB only (docs/TEST_DATABASE.md)
$env:NODE_ENV='test'; $env:DATABASE_URL='postgresql://…/footy_finder_test?schema=public'
cd apps/api; npx prisma migrate deploy
npm run smoke:team-wallet; npm run smoke:team-matches; npm run smoke:team-sides-race
npm run smoke:team-authz; npm run smoke:team-go-no-go; npm run smoke:team-chat
npm run smoke:financial-integrity; npm run smoke:go-no-go; npm run smoke:payments
npm run smoke:venue-settlement; npm run smoke:payment-to-settlement   # all passed
cd ../..; $env:ADMIN_TEST_DATA_ENABLED='true'; $env:PAYMENT_PROVIDER='demo'
npx playwright test   # team-match, critical-path, position-claim, wallet: 4 passed
```

- **Unit tests:** shared 109, api-client 30, api 381, web 136. Type-checks and the web/admin builds pass.
- **Local dev reset:** `npx prisma migrate reset --force` on local `footy_finder` applied all 43 migrations, and the dev legal placeholders were re-published with `legal:publish`.
- **Before running Playwright:** stop any local dev API or Vite server on ports 3000/5173 first. Playwright reuses running servers, and a dev server on the un-migrated dev DB fails at sign-up.
- **Privacy:**
  - `venue-cost-privacy.test.ts` covers the team-wallet and team-match DTOs.
  - `smoke:team-matches` and `smoke:team-go-no-go` scan the team-match and meter DTOs.
  - The browser journey asserts that no response carries the venue price.

## Before going live

- Publish Terms of Service **v2.3** with `legal:publish`. It is a material change: reacceptance is required, and the effective date must be at least 14 days after notice (clause 26.2).
- Everything still open from the Gate 6 runbook: live Paystack, approved venue bank details and the production encryption key.
