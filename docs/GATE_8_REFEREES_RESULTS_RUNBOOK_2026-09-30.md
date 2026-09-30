# Gate 8 runbook: FootyFinder referees, final results, statistics and team reviews

Date: 2026-09-30
Branch: `ceo/finish-gate-5`
Tickets: TKT-801 to TKT-811, one commit per ticket. Decisions: DEC-020 (D1 to D28) and DEC-017 (team reviews). DEC-020 replaced the DEC-016 propose/confirm model (ticket breakdown section 3 and section 12).

## Rules now in force

1. **Referee role.** An admin grants or removes the referee role on a normal account. Each change needs a written reason and a fresh authenticator check (15 minutes), and is kept permanently and audited. An admin may also be a referee. Referees see a **Referee** tab in the app.
2. **A referee on every match.** Every match with a 30-minute go/no-go (Quick Matches, admin-loaded matches and team matches) needs an active FootyFinder referee.
   - **On publish:** the **default referee** (Admin, Referees page) is assigned automatically if they are free. Otherwise the match is **unassigned** and every admin is alerted in the app and by email.
   - **At kickoff −24h:** admins are alerted again while it is still unassigned.
   - **Double booking (D27):** a referee can't take two matches whose busy windows overlap. A window runs from kickoff to the scheduled end, plus 30 minutes of travel.
   - **A referee may also play** in the match they referee (D17 reversed). The admin results queue shows "Referee also played" for the record.
   - **Declining (D16):** the referee may decline until T-30. The match becomes unassigned and admins are alerted.
   - **Removing the referee role** takes the person off every unfinished match and clears them as the default.
3. **T-30.** The go/no-go also needs an active referee.
   - **No referee:** the match is cancelled with reason `NO_REFEREE` and everyone gets the same full refunds as any no-go.
   - **Several problems:** when the players' own conditions also failed, that reason is given instead (D23).
4. **Kickoff.** The lifecycle scheduler writes a permanent **lineup record**: who was on each side, starter or sub. Team lineups lock at kickoff.
5. **The referee's result is final.** From kickoff, the referee records one of three outcomes (D13):
   - **Played:** each goal with its scorer and optional assister, picked from that side's lineup. An own goal counts for the team only (D7). The referee can untick players who did not play (D14).
   - **Forfeit:** a winner, 0-0, no goals.
   - **Abandoned:** no result counts.

   No money changes for any outcome. The first result wins. Players and the teams' members are told in the app.
6. **Late or missing result.** Admins are alerted two hours after the scheduled end if there is still no result (D4). An admin can then enter the result (D3), with a reason and a fresh authenticator check.
7. **Captains.** Captains cannot dispute a result (D6, D21).
   - **Own version (D10, D11):** a team side's owner/captains, or a Quick Match host, may send their own version from the scheduled end until 24 hours after. It is evidence for admins only.
   - **Report a problem (D6):** they may report a problem within 24 hours of the final result.
   - **Old disputes:** new result disputes are refused, and existing ones stay in the admin queue.
8. **Corrections.** Only an admin corrects a clear recording error (D5), with a written reason and a fresh authenticator check. Every version is a permanent revision and the change is audited. Players are told again.
9. **Statistics.** Profiles show matches played, W/D/L, goals and assists. They count only referee-final or admin-final results, plus pre-Gate-8 results as before (D20). Stats are recalculated on every read, so corrections flow through.
10. **Team reviews (DEC-017, D24).** Players who played may rate the opposing team 1 to 5, with an optional comment, once the result is final.
    - **Anonymous:** the author is never shown publicly.
    - **Comments:** public only after an admin approves them.
    - **Window:** a review can be left for 14 days after the final result (CEO, 2026-09-30); after that the context answers `REVIEW_WINDOW_CLOSED`.
    - **Editing:** allowed for 7 days after the final result. Authors can delete a review at any time.
    - **Public average:** shown only with three or more reviews that count.
    - **Reports:** team members may report a review; admins approve, reject, hide or restore.
11. **Referee pay** is not in the platform (D8). Admin → Results → Referee report gives, per referee, the count and list of matches whose result they recorded, for a date range. It shows no money.

## Operations

**Durable jobs**

| Durable job | Dedupe key | Runs at |
|---|---|---|
| `REFEREE_UNASSIGNED_ALERT` | `referee-unassigned-alert:<matchId>:<published\|t-24h\|assignmentId>` | Straight away (publish, decline, removal) and kickoff −24h. It does nothing if an active referee is assigned by then |
| `REFEREE_NOTICE` | `referee-notice:<assignmentId>` | Straight away. Tells the referee in the app about an assignment or removal |
| `REFEREE_EMAIL` | per kind, match, event and user | Straight away. Covers the referee assigned/removed emails and the admin no-referee and result-overdue emails |
| `REFEREE_RESULT_OVERDUE` | `referee-result-overdue:<matchId>` | Scheduled end + 2h. Enqueued at kickoff |

**Admin app pages**
- **Referees:** role, default referee.
- **Match referees:** unassigned and upcoming matches, with assign/change/remove; busy referees are marked.
- **Results:** awaiting (with the overdue flag), recent, problem reports and the referee report.
- **Team reviews.**
- **Dashboard:** counts of unassigned matches, overdue results and open reports.

**Audit actions:** `REFEREE_GRANTED`, `REFEREE_REVOKED`, `REFEREE_ASSIGNED`, `REFEREE_REMOVED`, `DEFAULT_REFEREE_SET`, `RESULT_ENTERED`, `RESULT_CORRECTED`, `RESULT_PROBLEM_RESOLVED`, `TEAM_REVIEW_*`.

**Permanent records:** `RefereeGrant`, `MatchRefereeAssignment`, `MatchLineupEntry` (except `didNotPlay`), `MatchResultRevision` and `CaptainResultSubmission`.

**Privacy**
- The referee view and referee data on match pages carry display names only: no contact, payment or venue-cost data.
- This is checked in `venue-cost-privacy.test.ts`, `smoke:referee-results` and the browser journey.

## API

- **Admin, referees:**
  - `GET /admin/referees`
  - `POST /admin/referees/:userId` and `/revoke` (fresh MFA)
  - `GET /admin/referee-matches?view=unassigned|upcoming`
  - `GET /admin/matches/:id/referee-options`
  - `PUT /admin/matches/:id/referee`
  - `POST /admin/matches/:id/referee/remove`
  - `GET` and `PUT /admin/referee-settings` (the PUT needs fresh MFA)
- **Admin, results:**
  - `GET /admin/results?view=awaiting|recent`
  - `GET /admin/results/:id`
  - `POST /admin/results/:id/entry` and `/correction` (fresh MFA)
  - `GET /admin/result-problems`
  - `POST /admin/result-problems/:id/resolve`
  - `GET /admin/referee-report?from&to`
- **Admin, reviews:**
  - `GET /admin/team-reviews`
  - `POST /admin/team-reviews/:id/moderate`
- **Referee:**
  - `GET /referee/matches`
  - `GET /referee/matches/:id`
  - `POST /referee/matches/:id/decline`
  - `POST /referee/matches/:id/result`
- **Players and captains:**
  - `GET /matches/:id/result-context`
  - `POST /matches/:id/result-version`
  - `POST /matches/:id/result-problems`
  - `GET`, `POST`, `PATCH` and `DELETE /matches/:id/review`
  - `GET /teams/:id/reviews`
  - `POST /teams/:id/reviews/:reviewId/report`
- **Changed:**
  - `POST /matches/:id/result` (host self-report) now answers `409 RESULT_BY_REFEREE` on refereed matches.
  - `POST /disputes` for `MATCH_RESULT` answers `409 RESULT_DISPUTES_RETIRED`.
  - `/users/me` has `isReferee`, and match data has `referee`.

## Migrations (additive, hand-written)

- `20261004100000_gate_8_referee_role`
- `20261004110000_gate_8_referee_enums`
- `20261004120000_gate_8_referee_assignment`
- `20261004130000_gate_8_lineup_record`
- `20261004140000_gate_8_result_enums`
- `20261004150000_gate_8_referee_results`
- `20261004160000_gate_8_submission_enums`
- `20261004170000_gate_8_captain_submissions`
- `20261004180000_gate_8_team_reviews`

Existing CHECKs replaced by wider ones:
- `Match_cancellationReason_check` (+ `NO_REFEREE`)
- `MatchResult_forfeit_consistency_check` (+ `ABANDONED`)
- `MatchResultRevision_creator_check` (+ `REFEREE_SUBMISSION`, `ADMIN_ENTRY`)

Enum values are added in their own migrations. No index uses a function.

## Verification (2026-09-30)

```powershell
# disposable DB only (docs/TEST_DATABASE.md)
$env:NODE_ENV='test'; $env:DATABASE_URL='postgresql://…/footy_finder_test?schema=public'
cd apps/api; npx prisma migrate deploy        # 52 migrations
npm run smoke:all                             # 30 of 30 passed, including the new smoke:referees,
                                              # smoke:referee-results and smoke:team-reviews
cd ../..; $env:ADMIN_TEST_DATA_ENABLED='true'; $env:PAYMENT_PROVIDER='demo'
npx playwright test                           # 5 passed: referee-results (new), team-match,
                                              # critical-path, position-claim, wallet
```

- **Unit tests:** shared 123, api-client 36, api 388, web 149 (admin has none). Type-checks and the api/web/admin builds pass.
- **Smokes changed for Gate 8:**
  - **go-no-go, venue-settlement, payment-to-settlement and team-go-no-go** now assign a fixture referee (`scripts/referee-fixture.ts`). Otherwise their matches would be cancelled with `NO_REFEREE`.
  - **team-go-no-go** also covers a team `NO_REFEREE` no-go, the team lineup record and lock, and team captains' versions.
  - **The two settlement smokes** remove the lineup entries of the players they delete from their retained paid match.
- **Playwright:** the first full run had one cold-start timeout, in `critical-path`, the first test (30 s budget). It passed on its own and in the next two full runs. The new journey needed one fix to its own wait (the page moves straight to the final-result card).
- **Local dev database (`footy_finder`): NOT reset.** The reset command (`prisma migrate reset --force`, approved by the CEO for mock data) was blocked by this environment's permission guard. It is a manual step below.

## Before going live

1. **Local dev reset (manual).** Run in `apps/api`:
   ```powershell
   npx prisma migrate reset --force
   $env:DATABASE_URL='<footy_finder url>'
   npm run legal:publish -- --file C:/footy-local/legal-dev.json
   ```
   The legal publish needs `DATABASE_URL` set explicitly.
2. **Publish Terms of Service v2.4** with `legal:publish`. It is a material change: reacceptance is required, and the effective date must be at least 14 days after notice (clause 26.2). v2.3 (Gate 7) must be published first or together.
3. **Grant the first referees and set a default referee** in production (Admin → Referees). Until then, every new match is unassigned and would be cancelled at T-30.
4. **Matches already published** before release have no referee (D20: no grandfathering). Assign referees from Admin → Match referees before their T-30.
5. **Everything still open** from the Gate 6 and Gate 7 runbooks.

## Terms of Service v2.4 (material)

- **Changed:** header (version 2.4, supersedes 2.3, last updated 30 September 2026), 8.1, 8.3, 11.5, 12.18, 15.1, 17.4, the Annexure A summary table and the contents (clause 17 renamed "Match Hosts, Referees and Results").
- **Added:**
  - a new "Summary of changes in version 2.4";
  - clause 2 definitions: Final Result, Lineup Record and Referee;
  - new 17.5 to 17.10;
  - new 19.6 (Team reviews).
- **Wording to check with counsel:**
  - "A Final Result cannot be disputed" (17.7, 17.10) is now followed by "This does not affect your right to complain under clause 27." (Gate 8 follow-up, 2026-09-30).
- **Abandoned matches (CEO change, 2026-09-30, DEC-020):** the 50% credit for a match abandoned before half time is removed from 15.2 and 10.7. Once a match has kicked off, fees are not refunded if the referee records it as abandoned, for any reason. This matches the code: recording "abandoned" moves no money (D13), and there was never a partial-credit path.
