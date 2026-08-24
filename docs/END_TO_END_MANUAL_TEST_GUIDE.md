# Footy Finder End-to-End Manual Test Guide

**Purpose:** Manual acceptance and regression testing of every user-facing capability currently implemented in Footy Finder.

**Source of truth:** `docs/SYSTEM_AUDIT.md`, the current application code, shared contracts, and repository scripts.

**Current post-audit baseline:** commit `e2ba24b` closes the browser/API-contract and atomic-notification findings described in the historical audit. Section 16 distinguishes closed findings from remaining known defects.

**Important:** This guide tests the product that exists now. It does not describe the future roadmap as if it were available. Known defects are labelled **KNOWN EXPECTED FAILURE** and include the behavior that should pass after remediation.

## 1. Test run record

Complete this table before testing.

| Item                            | Value                    |
| ------------------------------- | ------------------------ |
| Tester                          |                          |
| Date and time                   |                          |
| Branch                          |                          |
| Commit (`git rev-parse HEAD`)   |                          |
| Operating system                |                          |
| Browser and version             |                          |
| Secondary browser/profile       |                          |
| Desktop viewport                |                          |
| Mobile viewport                 |                          |
| Node version (`node --version`) |                          |
| npm version (`npm --version`)   |                          |
| PostgreSQL version              |                          |
| Database name                   | `footy_finder_manual_qa` |
| Overall result                  |                          |

Use these result values consistently:

- **PASS:** Actual behavior exactly matches the expected result.
- **FAIL:** The feature ran, but behavior differs from the expected result.
- **BLOCKED:** A prerequisite or earlier failure prevents execution.
- **NOT RUN:** The case was intentionally not executed; record why.
- **KNOWN EXPECTED FAILURE:** The result matches a defect already listed in `SYSTEM_AUDIT.md`. Capture evidence, but do not report it as a new regression.

For each failure, record the test ID, exact steps, expected result, actual result, environment, reproduction rate, screenshot or video, browser console messages, and the failed network request/response where applicable.

## 2. Scope and current product boundaries

This guide covers:

- registration, login, cookie session restoration, logout, and protected routes;
- player discovery, public player profiles, private profile editing, and direct messages;
- light/dark themes, responsive navigation, page motion, reduced motion, notifications, and animated toasts;
- the personal ZAR wallet and simulated R500 deposits;
- public and invitation-only Quick Games, discovery, paid joining, capacity, teams, formations, cancellation, replacement credit, lifecycle, results, and lobby chat;
- Teams, roles, invitations, profile images, saved formations, private Team fixtures, Match-Day availability, selection, lineups, open claims, finalization, and Team lobby chat;
- persistence, realtime behavior, privacy boundaries, common authorization failures, and recovery after reload.

The following are deliberately **not implemented** and are not failures unless a separate release specification says otherwise:

- real card/bank payments, withdrawals, external refunds, wallet statements, and receipts;
- Team Wallet, Team funding, venue reservations, venue pricing, and provider integrations;
- friends, blocks, recruitment, general social chat, and persistent Team Chat;
- Team-v-Team opponent matchmaking;
- Admin tools, platform audit log, verification, age/consent gates, moderation, reports, bans, reviews, and disputes;
- guest Match discovery, cities/waitlists, tournaments, leagues, and accumulated player/Team statistics.

Private Phase 1 Team fixtures are intentionally HOME-only, free, `DRAFT` planning workspaces. They do not enter the automatic Match lifecycle, debit wallets, or create historical `MatchParticipant` rows.

## 3. Machine setup

### 3.1 Requirements

Install:

- Git;
- Node.js 20 or newer;
- npm 10 or newer;
- PostgreSQL 14 or newer, either natively or through Docker;
- a current Chrome or Edge browser. Firefox is useful for an additional compatibility pass.

This repository uses standard npm workspaces. Do not run pnpm commands and do not create a `pnpm-lock.yaml` file.

Confirm the tools:

```bash
node --version
npm --version
git --version
psql --version
```

### 3.2 Obtain and install the project

If the repository has not already been supplied, clone it and enter the directory:

```bash
git clone <repository-url> FootyFinder
cd FootyFinder
npm install
```

If the repository is already present, open a terminal at its root and run `npm install`.

On Windows, if PowerShell blocks `npm.ps1` or `npx.ps1`, use `npm.cmd` and `npx.cmd` for the same command. This is a shell-policy issue, not an application failure.

### 3.3 Create an isolated test database

Never point this test run at a shared, staging, or production database. Use the exact disposable database name `footy_finder_manual_qa` so cleanup targets remain obvious.

With native PostgreSQL:

```sql
CREATE DATABASE footy_finder_manual_qa;
```

One way to execute that statement is:

```bash
psql -U postgres -d postgres -c "CREATE DATABASE footy_finder_manual_qa;"
```

Alternatively, if Docker is available and port 5432 is unused:

```bash
docker run --name footy-finder-manual-qa-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=footy_finder_manual_qa -p 5432:5432 -d postgres:16
```

If port 5432 is occupied, either use the existing local PostgreSQL installation or map a different host port and use that port in `DATABASE_URL`.

### 3.4 Configure the API and web application

Copy the example environment files.

Windows PowerShell:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env
```

macOS/Linux:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Set `apps/api/.env` to local test values. Use your real local PostgreSQL username/password if they differ:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/footy_finder_manual_qa?schema=public"
PORT=3000
JWT_SECRET=manual-qa-only-secret-change-me-1234567890
JWT_EXPIRES_IN_SECONDS=604800
CLIENT_URL=http://localhost:5173
PUBLIC_API_URL=http://localhost:3000
TEAM_UPLOAD_DIR=uploads/teams
MATCH_DURATION_FIVE_A_SIDE_MINUTES=90
MATCH_DURATION_SEVEN_A_SIDE_MINUTES=90
MATCH_DURATION_ELEVEN_A_SIDE_MINUTES=90
POST_MATCH_CHAT_DURATION_MINUTES=25
```

Set `apps/web/.env`:

```env
VITE_API_URL=http://localhost:3000
```

Do not reuse the example JWT secret outside local testing. The API requires a secret of at least 32 characters.

### 3.5 Prepare and verify the application

From the repository root:

```bash
npm run prisma:generate
npm run prisma:migrate
npm run lint
npm test
npm run build
```

Record every result. The baseline audited at commit `aa03e5bad7be6fa7f7c0fc4b6bf1c14d60aa38d5` had 129 passing tests, zero failures, and zero skipped tests. A later commit may legitimately have a different count, but it must still have no unexplained failures.

Start the development servers:

```bash
npm run dev
```

Expected endpoints:

- web: `http://localhost:5173`;
- API: `http://localhost:3000`;
- health: `http://localhost:3000/health`.

Opening the health endpoint should return HTTP 200. The terminal should show the API listening on port 3000 and Vite on port 5173.

### 3.6 Setup troubleshooting

| Symptom                                          | Check and resolution                                                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ECONNREFUSED` or Prisma cannot reach PostgreSQL | Confirm PostgreSQL/Docker is running, the port and credentials are correct, and `footy_finder_manual_qa` exists.                              |
| Port 3000 or 5173 is already in use              | Stop the older Footy Finder process. If changing ports, update both API and web environment URLs consistently.                                |
| Prisma reports unapplied migrations              | Run `npm run prisma:migrate` from the repository root. Do not edit an applied migration.                                                      |
| Generated Prisma types are stale                 | Run `npm run prisma:generate`, then restart the API.                                                                                          |
| Browser requests have no session                 | Use `http://localhost` consistently, allow cookies, and confirm requests use credentials. Do not mix `localhost` with `127.0.0.1`.            |
| CORS preflight fails only for `PUT`              | Treat this as a regression. Confirm the API is running at the configured URL, then run the complete method matrix in section 13.4.             |
| Old UI/data remains after code changes           | Restart both servers, hard refresh, and clear only this local site's storage/cookies if necessary.                                            |
| Team image URL fails                             | Confirm `PUBLIC_API_URL`, `TEAM_UPLOAD_DIR`, and API port, then inspect the upload request and API log.                                       |

## 4. Test data and session layout

Use a short unique run ID such as `qa0823a`. Replace `<run>` below with that value. Keep usernames short enough to satisfy the form.

Use one strong local-only password for all disposable personas, for example `FootyQa!2026Pass`.

| Persona    | Suggested username | Suggested email            | Purpose                                               |
| ---------- | ------------------ | -------------------------- | ----------------------------------------------------- |
| Owner/Host | `owner_<run>`      | `owner_<run>@example.test` | Team OWNER and Quick Match host                       |
| Captain    | `capt_<run>`       | `capt_<run>@example.test`  | Promoted Team CAPTAIN and Quick player                |
| Member A   | `mema_<run>`       | `mema_<run>@example.test`  | Team MEMBER, availability, lineup, Quick player       |
| Member B   | `memb_<run>`       | `memb_<run>@example.test`  | Second MEMBER for simultaneous claim/realtime tests   |
| Outsider   | `out_<run>`        | `out_<run>@example.test`   | Authorization, privacy, and insufficient-funds checks |

Recommended session layout:

- Browser profile A: Owner/Host.
- Browser profile B: Captain.
- Browser profile C or Firefox: Member A.
- Browser profile D or another browser: Member B.
- Use Outsider after logging out of a spare profile, or create a fifth isolated profile.

Ordinary browser windows in the same profile share cookies. Separate tabs are not separate users. Do not use two windows from one profile for a multi-user test.

Record generated values:

| Value                              | Recorded value |
| ---------------------------------- | -------------- |
| Run ID                             |                |
| Owner user ID/profile URL          |                |
| Captain user ID/profile URL        |                |
| Member A user ID/profile URL       |                |
| Member B user ID/profile URL       |                |
| Outsider user ID/profile URL       |                |
| Team ID/URL                        |                |
| Active Team invitation URL         |                |
| Public Quick Match ID/URL          |                |
| Private Quick Match invitation URL |                |
| Team fixture ID/URL                |                |

Use future kickoff times. The UI offers 08:00, 10:00, 12:00, 14:00, 16:00, 18:00, and 20:00. For normal tests, choose a date at least two days ahead so the Match remains editable and qualifies for a full cancellation credit.

## 5. Quick smoke pass

Run this short sequence before the complete regression suite.

| ID      | Action                                           | Expected result                                                                                                   | Result |
| ------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------ |
| SMK-001 | Open `/health` and `/`                           | Health is HTTP 200; `/` redirects a logged-out user to login.                                                     |        |
| SMK-002 | Register Owner, reload, then log out and back in | Account is created, session survives reload, logout returns to login, and login succeeds.                         |        |
| SMK-003 | Click **Add funds** once                         | Balance increases by exactly R500.00 and a success notification appears then disappears after about four seconds. |        |
| SMK-004 | Create a public 5v5 Quick Match two days ahead   | The lobby opens; host is not charged or auto-joined.                                                              |        |
| SMK-005 | In another profile, add funds and join HOME      | Balance falls by the Match fee; participant appears in both sessions.                                             |        |
| SMK-006 | Send a lobby message from the player             | Message persists and appears in the host session in realtime.                                                     |        |
| SMK-007 | Create a Team and invite another user            | Team appears in My Teams; invite inspection and acceptance work.                                                  |        |
| SMK-008 | Organise a private Team Match                    | Fixture opens as a free, private, HOME-only `DRAFT` workspace and does not change wallet balances.                |        |

Stop and repair unexpected environment failures before continuing. Every configured player/Admin-origin CORS preflight, including `PUT`, must pass.

## 6. Identity, profiles, navigation, theme, and motion

### AUTH-001 — Protected and guest routes

**Session:** Logged out.

1. Open `/`, `/matches`, `/messages`, and `/teams` directly.
2. Open `/login` and `/register`.

**Expected:** Protected routes send the visitor to login. Login and registration render without an authenticated layout. A signed-in user who later opens `/login` or `/register` is redirected into the application.

### AUTH-002 — Registration validation and review

**Session:** Register each of the five personas, one at a time in its assigned profile.

1. Try an invalid email, invalid/duplicate username, short or weak password, and mismatched confirmation.
2. Complete the Account, Identity, Security, and Review steps with valid data.
3. Submit and record the resulting profile URL/user ID.
4. Repeat a registration with an existing email and then an existing username.

**Expected:** Invalid fields prevent progress and show useful messages. Password text is masked. Review displays the entered identity without exposing the password. A valid account signs in automatically and creates a visible R0.00 wallet. Duplicate email/username attempts are rejected without leaking password, database, or stack details.

### AUTH-003 — Login, return path, and session restoration

1. Log out Owner.
2. Log in once with Owner's email and once with Owner's username.
3. Try an incorrect password.
4. While logged out, open a protected URL copied from the run, log in, and observe navigation.
5. Reload a signed-in page and close/reopen the browser profile.

**Expected:** Both valid identifiers work. Incorrect credentials produce a safe generic error. The protected destination is restored after login where a return path is supported. The HTTP-only cookie restores the session across reload/browser restart until expiry or logout.

### AUTH-004 — Logout and user menu

1. Open the circular user menu beside the username.
2. Verify available links and select **Logout**.
3. Use Back and try a protected route.

**Expected:** The dropdown is positioned and dismissible, logout returns to login, and protected data does not reappear. Back cannot restore an authenticated page. The wallet balance remains in the header rather than inside the menu.

### AUTH-005 — Independent session revocation

1. Sign in to the same test account in two isolated browser profiles.
2. Keep an authenticated page and Socket.IO connection open in both profiles.
3. Log out in the first profile.
4. Try a protected route in both profiles without signing in again.

**Expected:** The first profile's persisted session and socket are revoked immediately. The second profile remains authenticated and functional because logout revokes only the current session.

### PROF-001 — Edit the current profile

**Session:** Owner.

1. Open Owner's profile.
2. Edit display name, valid avatar URL, home area, bio, dominant foot, and multiple preferred positions.
3. Save, reload, and revisit from another profile.
4. Attempt an invalid avatar URL and text beyond visible limits.

**Expected:** Valid changes persist and render identically to another user. Invalid values show validation errors and are not saved. The public profile exposes display name, avatar, bio, home area, dominant foot, positions, and safe Team summaries only.

### PROF-002 — User discovery and privacy

1. On Home, inspect the player list and open another user's profile.
2. Open DevTools Network, reload the list/profile, and inspect JSON responses.
3. Follow a Team summary link when present.

**Expected:** User cards link to the correct profile. Public responses do not contain email, password/password hash, wallet balance, payment records, JWT, or invitation tokens. A Team summary contains only safe Team information.

### UX-001 — Main navigation and page transitions

1. Navigate repeatedly between Home, Matches, Messages, and Teams.
2. Use in-page links, browser Back/Forward, and direct URLs.
3. Watch route transitions during both cached and first-load navigation.

**Expected:** Active navigation is clear. Each route displays the correct page without stale content. Page changes use a short smooth directional slide with restrained elasticity and do not flash, freeze, overlap, or shift the entire layout.

### UX-002 — Light/dark theme and persistence

1. Toggle light and dark mode from the header.
2. Visit forms, cards, pitch, dialogs, menus, notifications, and error states in each theme.
3. Reload and restart the browser profile.

**Expected:** The full palette changes consistently, content remains readable, HOME/AWAY and status colors remain distinguishable, and the selected theme persists. No component should use an obviously unrelated hard-coded color.

### UX-003 — Reduced motion

1. Enable **Reduce motion** in the operating system/browser accessibility settings.
2. Reload and navigate between pages.
3. Trigger a notification and interact with a formation marker.

**Expected:** Essential state changes remain visible, while route, toast, pickup, and spring effects are substantially reduced or removed. No operation depends on animation to finish.

### UX-004 — Generic toast lifecycle

1. Trigger a success toast with **Add funds**.
2. Trigger a safe error toast, such as an unauthorized or recoverable lineup action later in the run.
3. Time the visible duration and use the close control before timeout.

**Expected:** A new toast uses the explosive pop-in treatment, remains readable for about four seconds, then swirls into a point and is removed. Manual close removes it immediately. Multiple toasts remain bounded and do not permanently cover controls.

## 7. Wallet, deposits, and persisted notifications

### WAL-001 — Initial wallet and demo deposits

**Session:** Each persona as needed.

1. Confirm a newly registered account shows R0.00.
2. Click **Add funds** once.
3. Wait for the toast, then reload.
4. Click **Add funds** a second time.

**Expected:** Each successful action credits exactly R500.00, producing R500.00 then R1,000.00. The balance persists after reload. A deposit notification is stored in the bell menu. No real payment page/card request appears.

### WAL-002 — Notification menu

1. With unread notifications present, inspect the bell badge.
2. Open the menu, select one notification, and return.
3. Generate more notifications, then use **Mark all read**.

**Expected:** The badge equals the unread count, notification text/time/target are sensible, opening/marking an item updates its state, and Mark all read clears the unread badge. Stored notifications survive reload.

### WAL-003 — Insufficient funds and exact Quick Game debit

**Precondition:** A paid Quick Match exists. Outsider remains at R0.00; Member A has at least R500.00.

1. Try joining with Outsider.
2. Note Member A's balance and join with Member A.
3. Reload both the lobby and Member A's session.

**Expected:** Outsider receives a clear insufficient-funds/Payment Required error and is not added. Member A is debited exactly the configured fee once, is added once, and sees the persisted lower balance. Match creation itself did not charge the host.

### WAL-004 — Free Match and duplicate debit protection

1. Create a Quick Match with a R0 fee.
2. Join from an R0 account.
3. Double-click only if the UI permits, or repeat the same join after it completes.

**Expected:** The account can join without adding funds. Balance remains unchanged. A repeated join never creates a duplicate participant or debit and returns a stable already-joined result/error.

### WAL-005 — External-credit header refresh observation

1. Keep Member A's session open on a paid Match.
2. From another session, cause a Match cancellation or qualifying replacement credit to Member A.
3. Observe the notification and header without manually reloading, then reload.

**Expected:** The credit and notification persist, and the live header updates promptly from the wallet-credit invalidation event without a manual reload.

## 8. Quick Game creation and discovery

### QCK-001 — Create wizard formats and capacity

**Session:** Owner/Host.

Create or step through three Matches, covering 5v5, 7v7, and 11v11. Across them use substitute capacities 0, 5, and 10.

1. Verify the starter count and total capacity shown for each format.
2. Try `-1` and `11` substitutes.
3. Toggle rolling substitutions and select each informational rule at least once.
4. Confirm Previous/Continue preserves choices.

**Expected:** 5v5 shows 5 starters per side, 7v7 shows 7, and 11v11 shows 11. Total capacity equals two times starters plus two times configured substitutes: 10/20/30 for 5v5, 14/24/34 for 7v7, and 22/32/42 for 11v11 at 0/5/10 substitutes respectively. Only integer capacities 0–10 are accepted. Rules and rolling-subs choices survive review and creation.

### QCK-002 — Visibility, details, venues, kickoff, and fee

1. Create the main public Quick Match with a unique name, description, a future date at least two days away, and R80 fee.
2. Select one of the three dummy venues.
3. Confirm the Review page and submit.
4. Create a second invitation-only Match using another venue and R0 fee.

**Expected:** Names shorter than three characters and missing venue/date/time cannot proceed. Review accurately lists format, capacity, rules, visibility, venue, kickoff, and fee. The resulting lobby matches the review. Format and visibility cannot be edited after creation. The host remains host-only, consumes no player capacity, and keeps the same wallet balance.

### QCK-003 — Public discovery and filters

**Session:** A funded non-host user.

1. Open Matches and find the public Match.
2. Confirm the private Match is absent.
3. Exercise format, date, price, availability, distance, and sort controls with values that include and exclude the public Match.
4. Clear every filter.

**Expected:** Public Matches respond correctly to filters/sort and open the right lobby. Private Matches never appear. Clearing a filter restores otherwise eligible Matches.

**Expected:** When the Available-only control is unchecked, the web sends `availableOnly=false` and full Matches remain eligible for the results. Explicit false must disable the availability filter.

### QCK-004 — Private invitation access

1. From Owner's private lobby, copy the invitation link.
2. Open the ordinary `/matches/<id>` URL as Outsider without using the token.
3. Open the invitation URL while logged out, then log in/register through the prompt.
4. Reopen the invitation link as a signed-in user.
5. On the invitation page, choose HOME or AWAY and join the R0 private Match, then reload its ordinary lobby URL.
6. As Owner, generate/copy the link again after a lobby reload. Verify the previous link no longer resolves and the new link does.

**Expected:** The private Match stays out of discovery and direct unauthorized access is denied. The invitation URL displays safe Match information and preserves the return path through authentication. Merely inspecting the link does not charge or join the user. Selecting a side applies normal payment/capacity rules; after a successful join, the participant can use the ordinary lobby URL. Plaintext invitation tokens are returned only on creation/rotation, and rotating invalidates the previous link.

### QCK-005 — API-only Match edit and stale-client observation

There is currently no Match-details editor in the lobby. Set up Owner's authenticated PowerShell session as shown in section 13.1, then test the implemented PATCH API:

```powershell
$quickMatchId = '<quick-match-uuid>'
$updateBody = @{ description = 'Updated by manual QA' } | ConvertTo-Json -Compress
Invoke-RestMethod -Uri "$qaApi/matches/$quickMatchId" -Method Patch -WebSession $ownerSession -ContentType 'application/json' -Body $updateBody
```

1. As host, update an allowed Match field before kickoff and reload the browser lobby.
2. Keep another authorized lobby session open while making the edit.
3. Attempt the same request using a player session and try an invalid value.

**Expected:** Allowed changes persist; unauthorized users cannot edit. Other authorized clients receive targeted invalidation. Attempts to move kickoff into the past are rejected with `MATCH_START_TIME_INVALID`.

## 9. Quick Game lobby, teams, formations, chat, and lifecycle

### QLB-001 — Join HOME/AWAY and participant visibility

**Precondition:** Main public R80 Match exists; Captain and Members A/B each have funds.

1. Join Captain to HOME, Member A to AWAY, and Member B to HOME.
2. Watch all open lobby sessions during each join.
3. Reload and open the Players tab on mobile width.

**Expected:** Each join deducts exactly R80 once and creates one participant on the selected side. Counts, capacity, reserves, and player cards update and persist. Player names link to privacy-safe profiles. Host remains separate unless they explicitly join.

### QLB-002 — Team switching and role boundaries

1. As a reserve, switch your own side while the destination has room.
2. As host, move another eligible participant.
3. After a participant is assigned to a starter slot, try self-switching.
4. Try moving a player as an unrelated participant.

**Expected:** A reserve can move themselves while capacity permits. The host can move eligible participants. A fielded participant cannot self-switch; an unrelated participant cannot move anyone else. No move duplicates a participant or changes the wallet.

### QLB-003 — Capacity and full state

Use a low-capacity 5v5 Match with zero substitutes if enough disposable accounts are available, or validate the remaining-capacity labels with the existing roster.

1. Fill one side to its configured capacity.
2. Try another join or side move into it.
3. If practical, fill both sides.

**Expected:** The server rejects over-capacity operations even if attempted concurrently. The UI shows no negative spaces. The Match reaches the appropriate full state only when total configured capacity is occupied.

### QLB-004 — Formation pickup, drag, swap, and persistence

**Session:** Host, with at least two players on a side.

1. Drag a reserve onto an empty valid starter slot.
2. Observe the marker while picked up and moving, then on landing.
3. Drag one occupied starter onto another to swap.
4. Remove a player back to the reserves.
5. Try tap-select/tap-place and keyboard activation.
6. Reload after every persisted change.

**Expected:** Pickup visibly lifts/scales the marker; dragging is smooth and spring-based rather than frozen. Valid assignment and swap settle with landing feedback. Removing restores a reserve. Tap and keyboard actions achieve the same domain operation. Server-confirmed state survives reload.

### QLB-005 — Pitch geometry and optimistic rollback

1. Confirm the halfway line runs horizontally.
2. Drag HOME within the lower half (`positionY >= 50`) and AWAY within the upper half (`positionY <= 50`).
3. Try dragging HOME into AWAY's half and vice versa.
4. Temporarily stop the API only after loading the lobby, attempt a valid move, then restart it.

**Expected:** Marker centers stay within safe pitch bounds. A cross-half drag never sends a mutation, springs back to the last confirmed position, and shows no saved change after reload. A network/server failure also rolls the optimistic move back and gives recoverable feedback. Team formation pages are tested separately and remain full-pitch.

### QLB-006 — Lobby chat persistence and realtime

1. Send distinct messages from host and a joined player.
2. Watch the other session without refreshing.
3. Reload both sessions.
4. Try reading/sending as an outsider and as a player after leaving.
5. Try empty and overlong content.

**Expected:** Authorized messages persist before they broadcast, appear once in realtime, and retain sender/timestamp after reload. Empty/invalid content is rejected. Outsiders cannot read or send. A departed user cannot send. Record any duplicate caused by transport retry; messages currently have no client idempotency key (`AUDIT-CHAT-002`).

### QLB-007 — Ready action

1. As host, select the ready action before kickoff.
2. Try the same action as a player.
3. Reload and observe another lobby session.

**Expected:** Host can set the eligible Quick Match to `READY`; a player cannot. State persists and authorized open sessions refresh from the targeted Match-room event.

### QLB-008 — Withdrawal more than 12 hours before kickoff

**Precondition:** A paid participant joined a Match starting more than 12 hours from now.

1. Record their balance and open the cancellation quote.
2. Leave the Match and confirm.
3. Reload and inspect cancellation status and notifications.
4. Retry the leave action through UI history/direct request only if it remains available.

**Expected:** Quote shows a full internal credit. Leaving removes the active participant, credits exactly the original eligible fee once, records replacement as unnecessary, and survives retries without double credit.

### QLB-009 — At-or-under-12-hour withholding and replacement

**Precondition:** Use a disposable paid Match whose kickoff is no more than 12 hours away but still in the future. If no offered time fits, use the controlled timestamp method in section 13.3 on this disposable Match only.

1. Have Member A join HOME and record balance.
2. Confirm the cancellation quote shows no initial credit, then leave.
3. Verify cancellation status says it is waiting for a replacement.
4. Have another funded, previously unjoined user join HOME for the same fee.
5. Observe Member A's notification/balance and reload.

**Expected:** Member A receives no initial credit. The successful paid replacement releases the full withheld eligible amount exactly once, FIFO. The replacement pays normally and occupies one place. Member A's live header refreshes from the wallet invalidation event.

### QLB-010 — Kickoff withdrawal rejection

**Precondition:** Disposable Match at or after kickoff, prepared through section 13.3 if necessary.

1. Attempt to leave as an active participant.

**Expected:** Withdrawal is rejected at kickoff or later, no participant/payment state changes, and no credit is created.

### QLB-011 — Whole-Match cancellation

1. Record all paid participants' balances.
2. Cancel an unfinished Match as host and confirm the browser prompt.
3. Try cancelling as a player.
4. Reload every affected session and the discovery page.

**Expected:** Only the host can cancel. Every eligible paid participant receives one full internal credit, the Match becomes `CANCELLED`, it no longer accepts joins or ordinary lobby mutations, and it leaves active discovery. Notifications persist and affected live wallet headers refresh.

### QLB-012 — Automatic lifecycle

**Precondition:** Use a dedicated disposable Quick Match and the shortened-duration/timestamp instructions in section 13.3.

1. Observe the Match before kickoff.
2. Wait for the scheduler after kickoff.
3. Wait for the configured Match duration to end.

**Expected:** Only a Quick Match progresses automatically from `OPEN`, `READY`, or `FULL` to `IN_PROGRESS`, then `AWAITING_RESULT`. Team `DRAFT` fixtures never progress. Start/end notifications are persisted and sent to intended participants. Allow one scheduler interval before declaring a failure.

### QLB-013 — Result and scorers

**Precondition:** Quick Match is `AWAITING_RESULT` and has participants.

1. Open the host's result form.
2. Try negative scores, mismatched scorer goal totals, a nonparticipant, and an unauthorized submitter.
3. Submit a valid HOME/AWAY score with scorer totals matching each score.
4. Reload all sessions and try a repeated/concurrent submission if two host requests can be safely issued.

**Expected:** Invalid results are rejected without partial persistence. Only host can submit. A valid result atomically completes the Match and displays full-time score/scorers. A concurrent losing submission may currently expose an unmapped conflict (`AUDIT-MATCH-004`). Historical LEFT/REMOVED participants are currently accepted as scorers (`AUDIT-MATCH-002`); record this as a known policy gap, not a new regression.

### QLB-014 — Post-Match chat window

1. Send a message during the configured post-Match chat window.
2. After the window, try again.

**Expected:** Authorized chat stays available until the configured number of minutes after Match end, then rejects new messages. Existing messages remain readable by authorized users.

## 10. Direct messages

### MSG-001 — Start and reuse a one-to-one conversation

1. As Owner, open Captain's public profile and select **Message**.
2. Send a unique message.
3. Return to Captain's profile and select **Message** again.

**Expected:** A single direct conversation is created for the pair. Repeating the action reopens the same conversation rather than producing a duplicate thread.

### MSG-002 — Realtime messages, unread state, and persistence

1. Keep Owner and Captain on the conversation in separate sessions.
2. Send messages in both directions.
3. Navigate Captain away, send from Owner, and observe notification/unread state.
4. Reopen the conversation, mark/read it, and reload.

**Expected:** Messages persist and appear once in realtime with correct sender order. A message received away from the thread creates a persisted notification/unread state. Opening/marking read clears unread state and survives reload.

### MSG-003 — Conversation authorization and validation

1. Copy a conversation URL and open it as Outsider.
2. Try empty/invalid content and rapid double submission.

**Expected:** A nonparticipant cannot read, send, or mark the conversation read. Invalid content is rejected safely. Rapid/retried sends can currently duplicate because no client message id exists (`AUDIT-CHAT-002`); record exact behavior.

## 11. Teams, roles, invitations, images, and saved formations

### TEM-001 — Create a Team

**Session:** Owner. Record the wallet balance before starting.

1. Open Teams and select **Create Team**.
2. Enter a unique name, optional short name, description, and location.
3. Choose primary/secondary colors and a valid PNG, JPEG, or WEBP image no larger than 5 MB.
4. Choose a primary format and formation preset, review, and create.

**Expected:** Live preview reflects identity, image, and colors. The new Team opens with Owner as its sole `OWNER`. Defaults exist for 5v5, 7v7, and 11v11, not only the primary format. Team creation is free and leaves the personal balance unchanged.

### TEM-002 — Team image validation and replacement

1. Try a file over 5 MB, a renamed non-image file, and an unsupported format.
2. In Settings, replace the valid Team image with another valid image.
3. Reload and inspect `/uploads/...` in Network.

**Expected:** MIME type and file signature are validated; invalid/oversized files are rejected safely. A valid replacement receives a generated URL, persists, and is served by the API. Replaced/deleted generated files are safely removed on Windows and Linux.

### TEM-003 — Tabs and role-specific controls

1. As Owner, confirm Overview, Matches, Squad, Formation, Invites, and Settings tabs.
2. After adding/promoting members below, compare Captain and Member A.

**Expected:** Owner sees all tabs. Captain sees Overview, Matches, Squad, Formation, and Invites, plus **Organise Match**, but not Settings. MEMBER sees Overview, Matches, Squad, and read-only Formation, without Invites, Settings, or Organise Match.

### TEM-004 — Create and inspect a Team invitation

1. As Owner, open Invites and select **Invite Player**.
2. Record and copy the generated link.
3. Open it logged out and as an authenticated nonmember without accepting.

**Expected:** Inspection shows safe Team/invite metadata but does not mutate membership. The raw token appears only in the share URL; the database stores its hash. The link supports login/register return flow.

### TEM-005 — Accept, reuse, and revoke invitations

1. Accept the first link as Captain.
2. Reload both Team sessions and inspect notifications.
3. Try accepting the same single-use invite as Member A.
4. Generate a second invite, revoke it, and attempt acceptance.
5. Generate fresh invitations for Member A and Member B and accept them.

**Expected:** Captain is added exactly once. Team administrators receive a persisted join notification. A consumed or revoked link cannot create another membership. Fresh links add Members A/B once each. Repeated/concurrent acceptance cannot duplicate membership or usage.

### TEM-006 — Owner role management

1. Promote Captain from MEMBER to CAPTAIN.
2. In Captain's already-open Team page, observe whether permissions update immediately, then reload.
3. Demote and re-promote Captain.
4. Try changing roles as Captain, Member A, and Outsider.

**Expected:** Only Owner can promote/demote. Server authorization applies immediately, state persists, and targeted events refresh already-open authorized Team views.

### TEM-007 — Remove a member and protect Owner

1. As Owner, remove Member B and confirm.
2. Reload both sessions and revisit the Team URL as Member B.
3. Try removing or demoting Owner through all exposed controls.
4. Reinvite Member B for later Team-Match tests.

**Expected:** Member B loses membership and protected fixture access; Team formation assignments for that membership are safely cleared. Owner cannot be removed/demoted. Reinvititation creates one current membership without resurrecting old Match-Day response history.

### TEM-008 — Authenticated outsider Team visibility boundary

1. As Outsider, open the recorded Team URL directly.
2. Inspect Overview, roster, and Formation data.
3. Try Team Matches and all mutating actions by direct UI/API request.

**Current behavior:** Any authenticated user who knows the Team UUID can currently read the Team detail, privacy-safe roster, and default formation. Team fixture lists and mutations remain membership/role protected. The audit identifies this as a product-decision/IDOR boundary question rather than a confirmed response-data leak. Record observed access; do not treat the current read as a new failure unless Team visibility requirements have since been changed.

### TEM-009 — Saved formations across formats

1. As Owner, open Formation and switch among 5v5, 7v7, and 11v11.
2. Change the preset for one format.
3. Assign Members A/B/Captain, move markers throughout the full pitch, swap, and unassign.
4. Reload, switch formats, and return.
5. Repeat one edit as Captain and attempt one as Member A.

**Expected:** Each format has its exact starter-slot count and independent saved state. The single-Team pitch allows the full safe 4–96 visual area without HOME/AWAY half restrictions. Owner/Captain changes persist with animated optimistic behavior and rollback; MEMBER is read-only.

**Expected:** Changing the preset through `PUT /teams/:teamId/formations/:format` succeeds in the browser. Slot assignment and movement continue to work through their existing PATCH operations.

### TEM-010 — Team settings

1. As Owner, edit name, location, and description and save.
2. Reload all profiles and Team links.
3. Try clearing an optional string by submitting an empty value.
4. Attempt Settings operations as Captain/Member through direct requests.

**Expected:** Owner's nonempty changes persist everywhere. Non-owners are forbidden. Empty optional strings may currently fail to clear because they transform to undefined (`AUDIT-TEAM-003`); record as a known behavior gap.

### TEM-011 — Team deletion and history

Run this near the end using a secondary disposable Team, or after all main Team tests.

1. Create a private Team fixture and record its URL.
2. Delete the Team as Owner and confirm the destructive prompt.
3. Check My Teams, old invitation links, the old Team URL, and the fixture record where accessible.

**Expected:** Memberships, active invites, and saved formations are removed. Unfinished Team fixtures are cancelled and their live Team relation is detached, while Team-side name/image/color snapshots and Match history remain. User accounts and unrelated Matches remain. Safely recognized local generated images are removed cross-platform.

## 12. Private Team Match-Day workflow

### TMD-001 — Fixture role gating and wizard

**Session:** Owner, then Captain and Member A.

1. From Team Overview or Matches, select **Organise Match**.
2. Create the main fixture at least two days ahead, covering a format/preset not used by the main Quick Match, a capacity from 0–10, rolling-subs choice, rules, description, dummy venue, and kickoff.
3. Repeat access as Captain and Member A.

**Expected:** Owner and Captain can use the four-step wizard; MEMBER receives a role-gated message and cannot create. Review clearly states private/free behavior. Creation navigates to the Team Match lobby and invalidates the Team Matches list.

### TMD-002 — Fixture invariants and access

1. Record every current Team member's wallet balance.
2. Inspect the lobby header, Team Matches list, and public Match discovery.
3. Open the fixture as Owner, Captain, Members A/B, and Outsider.

**Expected:** Status is `DRAFT`; side is HOME; fee is zero; header shows format, starter/substitute count, rules, substitution mode, venue, and manager badge where appropriate. No wallet changes and no Quick Game participants are created. The fixture is absent from discovery. Current attached-Team members can read/chat; Outsider receives a stable forbidden/not-found response.

### TMD-003 — Initial availability request and privacy

1. As Owner, open Availability and select **Request availability**.
2. Keep members' sessions open to observe notifications/realtime invalidation.
3. Compare Owner's list with Member A's list.
4. Repeat **Refresh Squad Pool** without membership changes.

**Expected:** The request snapshots every current member once as `NO_RESPONSE`, updates `requestedAt`, and notifies newly snapshotted members except the actor. Counts show Squad Pool and No response correctly. Owner/Captain sees the full privacy-safe snapshot; a MEMBER sees the same unfiltered totals but only their own row. Repeating is idempotent and does not duplicate rows/notifications.

### TMD-004 — Availability responses and filters

1. As each user, set a different own status: `AVAILABLE`, `MAYBE`, `UNAVAILABLE`, and then reset one to `NO_RESPONSE`.
2. Observe manager and other-member sessions without refresh, then reload.
3. As manager, use every availability filter and Selected/Not selected filter.
4. Try updating another member's row.

**Intended behavior:** Users update only their own snapshotted response. Available/Maybe/Unavailable set `respondedAt`; No response clears it. Manager filters return correct rows while summary totals remain unfiltered. Members never receive another user's private response through socket payloads.

**Expected:** Each availability `PUT` succeeds in the browser, persists the chosen status, updates totals and filters, and survives reload.

### TMD-005 — Membership changes between availability requests

1. Request availability, then remove Member B.
2. Confirm historical snapshot/count behavior and that Member B loses GET/PUT access.
3. Reinvite Member B or add a new disposable member.
4. Before refresh, confirm the new membership has no row; refresh as manager.

**Expected:** Removed member's historical response remains in the manager snapshot and summary but they lose access. A new/current member is included only after another request, receives at most one notification, and starts as No response. Existing responses are preserved.

### TMD-006 — Lineup initialization and privacy

1. Open Lineup as manager and Member A.
2. Compare starter count, positions, formation, Squad Pool, viewer selection, substitutes, rules, and management controls.

**Expected:** The fixture has exactly 5, 7, or 11 independent Match-Day starter slots initialized from the chosen preset. Applicable saved Team-default assignments were copied by slot index at creation. Manager sees the full selection pool and controls; MEMBER sees the active lineup, own selection, decline/claim controls only. No Match-Day edit has yet changed the Team default.

### TMD-007 — Invitations, substitutes, and capacity

1. As manager, invite Member A.
2. Select Captain and Member B as substitutes.
3. Repeat an invitation/selection, remove a substitute, and reselect a declined/removed user.
4. Fill substitutes to configured capacity, then exceed it.

**Intended behavior:** Invitation records `INVITED`; substitute selection records `SELECTED_SUBSTITUTE`; repeated no-op retries do not duplicate notifications; remove/reselect is supported; capacity rejects the excess with `SUBSTITUTE_CAPACITY_REACHED`.

**Expected:** Invite, select-substitute, and remove-substitute all succeed in the browser through their documented PUT and DELETE operations.

### TMD-008 — Starter assignment and occupied-slot decisions

1. Assign a nonstarter to an empty slot.
2. Move a starter to an empty slot and verify the old slot becomes closed/empty.
3. Drop a starter onto another starter and choose swap.
4. Drop a nonstarter onto an occupied slot and exercise BENCH and REMOVE confirmations separately.
5. Try assigning the same user twice.

**Intended behavior:** Assignments are side-serialized and unique. SWAP requires the incoming user already to be a starter. BENCH observes substitute capacity. REMOVE changes displaced selection state. Duplicate starter occupancy is rejected. Manager edits clear finalization.

**Expected:** Player assignment, coordinate movement, bench/remove, and open-position actions all succeed through the browser and persist authoritatively.

### TMD-009 — Open, reopen, decline, and manager override

1. As manager, open an empty closed position.
2. Open an occupied position, choosing BENCH and then REMOVE in separate trials.
3. As selected Member A, decline invitation/substitute/starter states in separate trials.
4. Reassign or override the declined/claimed member as manager.

**Expected:** Newly opened positions notify current Team members except actor and become claimable. Occupied open requires an explicit action. Starter/claimed decline opens the vacated slot; invited/substitute decline only changes selection. Decline notifies OWNER/CAPTAIN users. Managers can later re-invite, select, move, bench, remove, or override.

### TMD-010 — Simultaneous open-position claim

**Precondition:** One slot is open; Members A and B are current members and neither is already a starter.

1. Put both sessions on Lineup with the same open slot visible.
2. Count down and select **Claim position** simultaneously.
3. Capture both responses and reload both lineups.

**Expected:** Exactly one request succeeds. The winner has `OPEN_SLOT_CLAIMED` and uniquely occupies the slot. The loser receives `POSITION_ALREADY_CLAIMED`, gets a recoverable notification, and refetches authoritative state. Managers receive a claim notification excluding the actor. No user occupies two starter slots.

### TMD-011 — Match-Day marker movement and half constraint

1. As manager, drag occupied HOME slots within the lower half and reload.
2. Try crossing above the halfway line.
3. Try moving as MEMBER.

**Expected:** Valid coordinates persist through PATCH and clear finalization when changed. Invalid cross-half movement stays local, springs back, and never calls the API; a forced server request returns `POSITION_OUTSIDE_TEAM_HALF`. MEMBER cannot move lineup markers. Existing historical coordinates are not rewritten by merely opening the page.

### TMD-012 — Finalization

1. Attempt finalization with a starter slot neither occupied nor open.
2. Occupy or explicitly open every slot and keep substitutes within capacity.
3. Finalize, repeat finalization, then perform a manager edit.
4. Finalize again, then have a member claim a slot that was explicitly opened before finalization.

**Expected:** Incomplete state returns `LINEUP_INCOMPLETE`. A complete/open lineup finalizes and first-time recipients—active starters, claimed users, and substitutes—receive one notification excluding actor as applicable. Retry is idempotent. Manager selection/edit invalidates finalization. A successful claim of a pre-finalization open slot preserves finalization.

### TMD-013 — Save explicitly as Team default

1. Record the current Team default for this format.
2. Make ordinary Match-Day changes and confirm the Team Formation page is unchanged.
3. Select **Save as Team default**, read the warning, cancel once, then confirm.
4. Reload both Team formation and Team Match lineup.

**Expected:** Cancel makes no change. Confirm copies formation key, coordinates, and current starter membership assignments to the Team default. Open/empty positions become unassigned and substitutes are ignored. The independent Match lineup itself does not change. This POST action should work even though changing a Team preset directly is affected by the PUT CORS defect.

### TMD-014 — Team Match availability/selection realtime privacy

1. Keep manager and member sessions open on Availability/Lineup.
2. Request availability, open a position, claim/decline, move a slot, and finalize.
3. Inspect Socket.IO payloads in DevTools.

**Expected:** Affected query families refresh after events. Match-room payloads contain invalidation metadata only—`matchId` and `side`—and never another member's availability response or private user data. Persistent notifications are created only for the specified recipient groups, exclude the acting user, and are broadcast only after commit.

### TMD-015 — Team fixture chat and cancellation

1. Send messages as Owner, Captain, and Member A; observe/reload.
2. Try as Outsider.
3. Cancel the fixture as Captain or Owner and try as MEMBER.

**Expected:** Current attached-Team members can chat in the persistent `DRAFT` lobby; Outsider cannot. OWNER/CAPTAIN can cancel; MEMBER cannot. Cancellation leaves wallets and Quick participants unchanged and returns navigation to the Team.

## 13. Controlled technical checks and fallbacks

Run this section only against the dedicated `footy_finder_manual_qa` database and local API. Do not paste production credentials, tokens, cookies, or raw user data into a defect report.

### 13.1 Record stable IDs

Most IDs are visible in browser URLs. For Match-Day slots and response payloads, use DevTools Network or an authenticated API GET. UUID-looking values in examples must be replaced with values from this run.

In Windows PowerShell, create authenticated API sessions. The identifier may be the test email or username:

```powershell
$qaApi = 'http://localhost:3000'
$qaPassword = 'FootyQa!2026Pass'
$ownerIdentifier = 'owner_<run>'
$memberAIdentifier = 'mema_<run>'
$memberBIdentifier = 'memb_<run>'

$ownerLoginBody = @{ identifier = $ownerIdentifier; password = $qaPassword } | ConvertTo-Json -Compress
Invoke-RestMethod -Uri "$qaApi/auth/login" -Method Post -ContentType 'application/json' -Body $ownerLoginBody -SessionVariable ownerSession

$memberALoginBody = @{ identifier = $memberAIdentifier; password = $qaPassword } | ConvertTo-Json -Compress
Invoke-RestMethod -Uri "$qaApi/auth/login" -Method Post -ContentType 'application/json' -Body $memberALoginBody -SessionVariable memberASession

$memberBLoginBody = @{ identifier = $memberBIdentifier; password = $qaPassword } | ConvertTo-Json -Compress
Invoke-RestMethod -Uri "$qaApi/auth/login" -Method Post -ContentType 'application/json' -Body $memberBLoginBody -SessionVariable memberBSession
```

The successful login body contains the private current-user response and each `WebRequestSession` holds that persona's cookie only in the PowerShell process.

On macOS/Linux, use `curl -c <temporary-cookie-file>` for login and `curl -b <same-file>` for later requests. Store cookie files in the operating system temporary directory, delete them after the run, and use the same methods/paths/bodies shown below.

### 13.2 Direct API verification for `PUT` actions

Use these direct calls only to diagnose an unexpected browser failure or to prepare controlled test state. The corresponding browser actions are expected to pass. Set these values from the test worksheet:

```powershell
$teamId = '<team-uuid>'
$teamMatchId = '<team-match-uuid>'
$memberAUserId = '<member-a-user-uuid>'
$memberBUserId = '<member-b-user-uuid>'
$side = 'HOME'
```

Read the authoritative lineup and obtain an empty slot:

```powershell
$lineupUri = "$qaApi/matches/$teamMatchId/team-sides/$side/lineup"
$ownerLineup = (Invoke-RestMethod -Uri $lineupUri -Method Get -WebSession $ownerSession).data
$slotId = ($ownerLineup.slots | Where-Object { -not $_.selection } | Select-Object -First 1).id
$ownerLineup | ConvertTo-Json -Depth 8
```

Update Member A's own availability:

```powershell
$availabilityBody = @{ status = 'AVAILABLE' } | ConvertTo-Json -Compress
Invoke-RestMethod -Uri "$qaApi/matches/$teamMatchId/team-sides/$side/availability/me" -Method Put -WebSession $memberASession -ContentType 'application/json' -Body $availabilityBody
```

Invite Member A, select Member B as a substitute, and assign Member A to the empty starter slot:

```powershell
Invoke-RestMethod -Uri "$qaApi/matches/$teamMatchId/team-sides/$side/lineup/selections/$memberAUserId/invite" -Method Put -WebSession $ownerSession

Invoke-RestMethod -Uri "$qaApi/matches/$teamMatchId/team-sides/$side/lineup/substitutes/$memberBUserId" -Method Put -WebSession $ownerSession

$assignBody = @{ userId = $memberAUserId } | ConvertTo-Json -Compress
Invoke-RestMethod -Uri "$qaApi/matches/$teamMatchId/team-sides/$side/lineup/slots/$slotId/player" -Method Put -WebSession $ownerSession -ContentType 'application/json' -Body $assignBody
```

If the target slot is occupied, the body must explicitly add `displacedPlayerAction` with `SWAP`, `BENCH`, or `REMOVE`, consistent with the intended action. Do not guess; read the lineup first.

Change a Team formation preset directly if that browser control is required for a later test:

```powershell
$format = 'FIVE_A_SIDE'
$formationKey = '<valid-key-shown-in-the-formation-dropdown>'
$presetBody = @{ formationKey = $formationKey } | ConvertTo-Json -Compress
Invoke-RestMethod -Uri "$qaApi/teams/$teamId/formations/$format" -Method Put -WebSession $ownerSession -ContentType 'application/json' -Body $presetBody
```

After each direct request, reload the relevant browser page and confirm that the persisted state is visible. A successful direct request proves the domain endpoint works; a browser-only failure remains a CORS or client regression and must be reported.

### 13.3 Controlled Match timing

The scheduler polls about every 15 seconds. To exercise lifecycle states without waiting for the next normal booking slot, change only the exact disposable Quick Match row. Stop and verify if the ID or mode is unexpected.

First inspect the target:

```sql
SELECT id, name, mode, status, "startsAt", "durationMinutes"
FROM "Match"
WHERE id = '<quick-match-uuid>';
```

To test a cancellation within 12 hours while still before kickoff:

```sql
UPDATE "Match"
SET "startsAt" = NOW() + INTERVAL '11 hours'
WHERE id = '<quick-match-uuid>'
  AND mode = 'QUICK_GAME'
  AND status IN ('OPEN', 'READY', 'FULL');
```

To observe `IN_PROGRESS` followed by `AWAITING_RESULT`, set kickoff ten seconds in the past and duration to one minute:

```sql
UPDATE "Match"
SET "startsAt" = NOW() - INTERVAL '10 seconds',
    "durationMinutes" = 1,
    status = 'OPEN'
WHERE id = '<quick-match-uuid>'
  AND mode = 'QUICK_GAME';
```

Run the inspection SELECT again and confirm exactly one intended row changed. Keep the API running. Within one poll it should become `IN_PROGRESS`; roughly a minute after the adjusted kickoff it should become `AWAITING_RESULT`. Allow an extra 15-second poll interval. Never perform this operation on the main Team fixture or a nondisposable Match.

### 13.4 CORS method matrix

From a terminal, issue a preflight for each active method by changing the requested method:

```bash
curl -i -X OPTIONS http://localhost:3000/health -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: PUT" -H "Access-Control-Request-Headers: content-type,idempotency-key"
```

Repeat with `GET`, `POST`, `PATCH`, and `DELETE`.

**Expected:** The configured origin and credential policy are returned. GET, POST, PUT, PATCH, DELETE, and OPTIONS are allowed; `Content-Type`, `Authorization`, and `Idempotency-Key` are accepted. Browser PUT actions must pass.

Try one unapproved origin such as `http://localhost:9999`. It must not receive permission to make credentialed cross-origin requests.

### 13.5 Cookie and safe-response inspection

1. In DevTools Application/Storage, inspect the authentication cookie.
2. Inspect login, `/users/me`, public player, Team, Match, and error responses.
3. Attempt a malformed UUID route and a random valid UUID.

**Expected:** The cookie is HTTP-only and SameSite Lax. It is not Secure in local development; production must explicitly set `NODE_ENV=production` and use HTTPS. Responses must not expose JWTs, password hashes, raw Team invite hashes, payment secrets, Prisma query detail, or stack traces. Malformed UUIDs return a stable validation response and missing valid UUIDs return a safe not-found response rather than a generic 500.

## 14. Realtime, authorization revocation, abuse, and resilience

### RT-001 — Socket authentication

1. Open the application logged out and inspect Socket.IO connection attempts.
2. Sign in and inspect connection/room activity while opening a Match and Team.

**Expected:** An unauthenticated socket is rejected with a safe authentication error. An authenticated socket automatically receives user-level notifications/messages and can join only authorized Match/Team rooms.

### RT-002 — Reconnect recovery

1. Keep Member A on Team Match Lineup.
2. In DevTools Network, switch the session offline long enough for Socket.IO to disconnect, then return online.
3. Without reloading/navigating Member A, have Owner open a position or move a slot.
4. Compare Member A's page to the authoritative state after manual reload.

**Expected:** The client rejoins the authorized Match/Team room on every connection, immediately refetches authoritative state, and receives the subsequent change without a page reload.

### RT-003 — Room authorization after revocation

1. Keep Member B connected inside a Team fixture/chat.
2. Remove Member B from the Team as Owner without closing Member B's page.
3. Trigger a private Team room event/message from another current member.
4. Try sending from removed Member B, then reload.

**Expected:** New HTTP/socket sends fail, the affected user's active sockets are immediately evicted from the private Team room, and no later private room broadcast is received. Do not include private message text in shared evidence.

### RT-004 — Match-room revocation after leaving

1. Keep a Quick participant connected in a Match room.
2. Have them leave before kickoff.
3. Send a lobby message or trigger a room event from an authorized user.
4. Attempt a new send from the departed player and then reload.

**Expected:** The departed user cannot send and all active sockets for that user are immediately evicted from the Match room, preventing passive receipt of later broadcasts.

### SEC-001 — Controlled local rate-limit observation

Only on the local test instance, make about 20 invalid login attempts over a short interval, then about 20 rapid but valid low-impact requests such as conversation creation attempts. Stop if the server becomes unstable.

**Expected:** The configured threshold returns HTTP 429 with stable `RATE_LIMITED` code and retry metadata without locking out unrelated users or corrupting data.

Do not load-test, brute-force, fuzz, or direct this test at any shared environment.

### SEC-002 — Negative authorization matrix

For one object in each domain, attempt read and mutation using Owner, Captain, Member, Outsider, and logged-out sessions.

| Object/action                               | Intended authorization                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| Public player profile                       | Public safe DTO                                                             |
| Edit player profile                         | Authenticated self only                                                     |
| Public Quick Match read                     | Authenticated users                                                         |
| Private Quick Match read                    | Host/current or historical participant/valid invite access                  |
| Quick host management/result                | Host only                                                                   |
| Match lobby chat                            | Host or currently joined participant; attached Team member for Team fixture |
| Team profile/roster/default formation read  | Currently any authenticated user who knows UUID; product decision pending   |
| Team fixture list/read                      | Current Team member                                                         |
| Team update/delete/image/role management    | OWNER, with narrower actions noted below                                    |
| Team invites and saved formation management | OWNER or CAPTAIN                                                            |
| Availability request/full roster            | OWNER or CAPTAIN                                                            |
| Own availability response                   | Current snapshotted member only                                             |
| Team Match lineup management                | OWNER or CAPTAIN                                                            |
| Open-slot claim/own decline                 | Current Team member only                                                    |
| Direct conversation                         | Its two participants only                                                   |
| Notifications                               | Recipient only                                                              |

**Expected:** Unauthorized actions return safe 401/403/404-style responses with stable application codes where defined, do not mutate state, and do not reveal another user's private data.

### RES-001 — API interruption and recovery

1. With the web open, stop the API.
2. Navigate to data-dependent pages and submit a harmless mutation.
3. Restart the API and retry/reload.

**Expected:** The web shows bounded loading/error feedback rather than hanging or losing the entire shell. Optimistic formation state rolls back. After restart, cookie/session restoration and authoritative data recover. A retry must not duplicate a completed financial or message operation; note that some older notification flows have the post-commit consistency risk `AUDIT-CON-001` and message writes lack idempotency.

### RES-002 — Refresh, Back/Forward, and direct links

Reload every major route at least once: Match list/create/lobby/invite, player profile, Messages/conversation, Team list/create/detail, Team fixture wizard, and Team invitation.

**Expected:** Browser history is sensible, route parameters restore the correct record, protected routes enforce auth, and no page depends exclusively on in-memory navigation state.

## 15. Responsive and accessibility pass

Run the following in light and dark mode at approximately 390×844, 768×1024, and a desktop width of at least 1280 pixels.

### A11Y-001 — Responsive layout

1. Inspect login/register, Home/header, Match wizard/list/lobby, Team create/detail, Team Match tabs, Messages, dialogs, and notifications.
2. Rotate between narrow portrait and wider landscape/tablet sizes.

**Expected:** There is no horizontal page overflow, clipped balance/user menu, unreachable button, overlapped toast, or unreadable pitch. Mobile Match lobby shows one focused Formation/Players/Chat tab; Team Match shows one Availability/Lineup/Chat tab. Desktop may show multiple useful panels.

**Known risk:** The audit identified likely narrow-header overflow. Capture viewport and screenshot if reproduced.

### A11Y-002 — Keyboard-only operation

1. Complete login, navigation, theme, menus, notification menu, one wizard, one dialog, chat, availability, and lineup actions without a mouse.
2. Verify visible focus and logical tab order.
3. Press Escape around open dropdowns/dialogs where expected.

**Expected:** Interactive elements are reachable and have clear focus. Buttons activate with Enter/Space. Formation supports documented keyboard activation. Focus does not disappear behind overlays.

**Known risk:** Dialog/menu focus trapping and restoration are incomplete. Record the exact component and focus destination when it fails.

### A11Y-003 — Labels, errors, and announcements

1. Inspect forms using browser accessibility tools or a screen reader.
2. Trigger validation and API errors.
3. Inspect notification/toast announcements.

**Expected:** Visible labels have useful accessible names, required/invalid state is understandable, errors are associated with fields, and toast status is perceivable. The audit notes that the shared Input can generate an `undefined-error` association when no `id`/`name` is supplied; record affected fields.

### A11Y-004 — Contrast, zoom, and text resizing

1. At both themes, zoom to 200% and increase default text size.
2. Check semantic status colors, pitch markers, buttons, links, muted text, and focus rings.

**Expected:** Content remains usable without clipping or lost controls, text stays legible, and status/team meaning is not conveyed by color alone where context requires a label.

## 16. Known-defect register for this manual run

Do not silently pass these cases and do not file duplicates without checking whether the referenced finding has been closed.

The current baseline has closed and retested the browser/API, notification consistency, realtime authorization/recovery, session, abuse-control, request-security, wallet-refresh, invitation-token, and upload-containment findings. This includes `AUDIT-RT-001`, `AUDIT-RT-002`, `AUDIT-RT-003`, `AUDIT-NOTIF-002`, `AUDIT-FIN-004`, `AUDIT-TEAM-001`, `AUDIT-SEC-001`, `AUDIT-AUTH-001`, `AUDIT-AUTH-002`, `AUDIT-CFG-001`, `AUDIT-SEC-002`, `AUDIT-SEC-003`, `AUDIT-SEC-004`, and `AUDIT-UPLOAD-001`. A recurrence is a new regression, not a known expected failure.

| Finding                             | Severity | Manual case(s)                              | Current expected result                                                                                                   | Intended retest result                                                                     |
| ----------------------------------- | -------: | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `AUDIT-MATCH-002`                   |       P2 | QLB-013                                     | Historical LEFT/REMOVED participant may be accepted as scorer                                                             | Product attendance policy is explicit and enforced                                         |
| `AUDIT-MATCH-004`                   |       P2 | QLB-013                                     | Concurrent losing result request can expose an unmapped conflict                                                          | Idempotent authoritative result/conflict response                                          |
| `AUDIT-CHAT-002`                    |       P2 | QLB-006, MSG-003                            | A transport retry can duplicate a message                                                                                 | Client message ID/idempotency prevents duplicates                                          |
| `AUDIT-TEAM-003`                    |       P3 | TEM-010                                     | Empty optional Team strings may not clear                                                                                 | Explicit null/clear semantics work                                                         |

Notification transaction failure is covered by automated tests and `smoke:atomic-notifications`; corrupting a database or application module is not an acceptable manual-test procedure.

## 17. Optional engineering smoke suite

These scripts are not substitutes for the browser cases, but they validate database invariants and concurrency using isolated fixtures. Ensure `DATABASE_URL` points to the dedicated manual-QA database and the repository worktree is suitable for generated `dist` output.

```bash
npm run smoke:api-contract --workspace=@footy-finder/api
npm run smoke:atomic-notifications --workspace=@footy-finder/api
npm run smoke:security-sessions --workspace=@footy-finder/api
npm run smoke:match-capacity --workspace=@footy-finder/api
npm run smoke:team-match --workspace=@footy-finder/api
npm run smoke:team-match-availability --workspace=@footy-finder/api
npm run smoke:team-match-lineup --workspace=@footy-finder/api
npm run smoke:team-match-ui --workspace=@footy-finder/api
```

Expected: every script reports success and removes its own temporary users, Teams, Matches, notifications, and related rows. Record any cleanup mismatch as a failure even if the functional assertions passed.

## 18. Coverage traceability

| Audited capability                          | Manual coverage                                  |
| ------------------------------------------- | ------------------------------------------------ |
| npm workspaces/tooling and environment      | Sections 3, 5, 17                                |
| Registration/login/session/logout           | AUTH-001–AUTH-005                                |
| Public/private player DTO separation        | PROF-001–PROF-002, 13.5, SEC-002                 |
| Personal wallet/demo deposits               | WAL-001–WAL-005                                  |
| Persisted notifications/toasts              | UX-004, WAL-001–WAL-002, TMD-014                 |
| Quick Game wizard/capacity/rules            | QCK-001–QCK-002                                  |
| Discovery/public-private invitations        | QCK-003–QCK-004                                  |
| Quick lobby/join/sides/formations           | QLB-001–QLB-005                                  |
| Quick cancellation/replacement              | QLB-008–QLB-011                                  |
| Match lifecycle/results/scorers             | QLB-007, QLB-012–QLB-014, 13.3                   |
| Match lobby chat                            | QLB-006, QLB-014                                 |
| Direct messages/unread                      | MSG-001–MSG-003                                  |
| Teams/memberships/roles                     | TEM-001, TEM-003, TEM-006–TEM-008                |
| Team invitations                            | TEM-004–TEM-005                                  |
| Team profile images                         | TEM-001–TEM-002, TEM-011                         |
| Team default formations                     | TEM-009, TMD-006, TMD-013                        |
| Private Team fixtures                       | TMD-001–TMD-002, TMD-015                         |
| Match-Day availability                      | TMD-003–TMD-005                                  |
| Match-Day selection/lineup/claims           | TMD-006–TMD-013                                  |
| Match-Day notifications/realtime            | TMD-014, RT-001–RT-004                           |
| Theme/motion/responsive/accessibility       | UX-001–UX-004, A11Y-001–A11Y-004                 |
| Authorization/privacy/security observations | PROF-002, TEM-008, 13.4–13.5, SEC-001–SEC-002    |
| Persistence/recovery                        | RES-001–RES-002 and reload assertions throughout |

## 19. Defect report template

Copy this block for each new defect:

```text
Title: [Area] Concise behavior difference
Manual test ID:
Build branch/commit:
Environment/browser/viewport:
Persona/role:
Preconditions and test-data IDs (no credentials/tokens):

Steps:
1.
2.
3.

Expected result:
Actual result:
Reproduction rate:
Severity suggestion and user impact:
Known audit finding checked: Yes/No; finding ID if applicable
Console evidence:
Network method/path/status/stable error code:
Screenshot/video/log attachment:
Workaround or recovery:
Cleanup completed: Yes/No
```

Do not attach `.env` files, cookies, passwords, raw invitation tokens, database exports containing private users, or unredacted financial data.

## 20. Safe cleanup

1. Cancel/delete disposable unfinished Quick Matches from the host lobby.
2. Revoke unused Team invitation links.
3. Delete disposable Teams from Owner Settings after the Team history test.
4. Log every browser profile out and clear Footy Finder cookies/site data.
5. Stop `npm run dev` with Ctrl+C.
6. Stop the Docker container if one was used:

   ```bash
   docker stop footy-finder-manual-qa-postgres
   ```

7. Keep the database if developers need to investigate a defect. Otherwise, only after confirming it is the explicitly disposable database, remove it from the administrative `postgres` database:

   ```bash
   psql -U postgres -d postgres -c "DROP DATABASE footy_finder_manual_qa WITH (FORCE);"
   ```

8. If Docker created the database and no investigation is needed, remove only the explicitly named stopped container:

   ```bash
   docker rm footy-finder-manual-qa-postgres
   ```

Do not run a broad recursive delete, drop another database, remove the PostgreSQL data directory, or delete the repository to clean up a test run. Local uploaded Team images live under the configured `TEAM_UPLOAD_DIR`; preserve them with the database when attaching a reproducible image defect.

## 21. Final sign-off

| Area                           | Pass | Fail | Blocked | Known expected failure | Not run |
| ------------------------------ | ---: | ---: | ------: | ---------------------: | ------: |
| Setup/smoke                    |      |      |         |                        |         |
| Identity/profile               |      |      |         |                        |         |
| Theme/navigation/accessibility |      |      |         |                        |         |
| Wallet/notifications           |      |      |         |                        |         |
| Quick Games                    |      |      |         |                        |         |
| Lobby chat/lifecycle/results   |      |      |         |                        |         |
| Direct messages                |      |      |         |                        |         |
| Teams/roles/invites/images     |      |      |         |                        |         |
| Team formations                |      |      |         |                        |         |
| Team Match availability/lineup |      |      |         |                        |         |
| Realtime/security/resilience   |      |      |         |                        |         |
| **Total**                      |      |      |         |                        |         |

Before approving the build, confirm:

- every in-scope capability in section 18 has a recorded result;
- every unexpected failure has a defect report and reproducible evidence;
- every known expected failure matches its existing audit finding rather than a new symptom;
- wallet balances reconcile with the actions performed and no user was debited twice;
- private profile, invitation, payment, and chat information did not appear in unauthorized responses;
- all test-only state is either retained intentionally for a defect or cleaned up safely;
- P1 findings remain release blockers until formally remediated and retested.

**Tester recommendation:** `APPROVE`, `APPROVE WITH KNOWN LIMITATIONS`, or `REJECT`.

**Reason and blocking test IDs:**
