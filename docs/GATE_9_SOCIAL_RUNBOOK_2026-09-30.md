# Gate 9 runbook: Social, friends, blocking, recruitment, the overlap rule and guest browsing

Date: 2026-09-30
Branch: `ceo/finish-gate-5`
Tickets: TKT-901 to TKT-904 and TKT-908 to TKT-910, one commit per ticket, plus one TKT-908 fix. The CEO decisions (D1 to D18, 2026-09-30) are recorded in ticket breakdown section 13.
- **TKT-905 (QR codes):** dropped by the CEO.
- **TKT-906 (advanced escrow):** superseded by DEC-019, not to be built.
- **TKT-907:** stays deferred. Assists were delivered in Gate 8.

## Rules now in force

1. **Social area.** "Social" replaces "Messages" in the main nav. The page is headed "SOCIAL NETWORK", with a search box and four tabs:
   - **DISCOVER:** search players.
   - **FRIENDS (n):** requests, friends, the incoming-requests switch and blocked players.
   - **TEAMS:** the recruitment board.
   - **DMS (unread):** the existing direct messages, unchanged. `/messages/:id` still works, and `/messages` opens the DMs tab.
2. **Friends (TKT-901, D2–D8).**
   - **One request per pair.** Only one request can be pending per pair, and it expires after 30 days.
   - **Limits.** At most 100 requests can be pending outgoing, and 20 new requests per rolling 24 hours. Requests to players who shared a match Lineup Record (either side) don't count towards the 20.
   - **Silent answers.** Declining and removing are silent, and the requester may ask again at any time (D6).
   - **Requests off.** A player can turn off incoming requests; the switch is on their profile and in the Friends tab.
   - **Crossing requests.** Two players asking each other at once become friends.
   - **Private list.** Friends lists are private (D4).
   - **The "Add friend" button** (or Requested / Accept / Friends) shows on:
     - profiles, Discover, DMs;
     - quick-match lobby lists and rosters;
     - team-match lineups, availability and other-side lists;
     - team squads and the Players looking list.

     It never shows for yourself, blocked players or players with requests off.
   - **After a match.** Finished matches show "Players you played with": the Lineup Record on both sides, excluding anyone who didn't play, visible only to those players and the referee. It has an "Add all" button.
3. **Blocking (TKT-903, D9, D10).**
   - **What a block ends.** It ends the friendship and pending requests, pending personal team invites, and pending join requests between the player and a team's Owner/Captains.
   - **What it refuses.** New requests, direct messages, team invites and join requests, both ways.
   - **What it hides.** Both players from search, suggestions, friends, requests, played-with, recruitment posts and looking cards.
   - **What stays.** DM history remains (`canMessage: false`). Shared teams, matches, lineups and results are untouched.
   - **Chat.** Lobby and team chat messages from a player you blocked are hidden until you tap "Show".
   - **Privacy of the block.** The blocked player is never told.
   - **Unblocking** restores nothing.
4. **Team invites to friends (TKT-904, D11).** The Owner or a Captain invites a friend in one tap. From TKT-909, they can also invite a player whose looking card is on.
   - **Where from:** the team page's Invites tab, or "Invite to team" on a friend card.
   - **Limits:** one pending invite per player per team; invites expire after 14 days.
   - **Answering:** the player joins or declines in one tap.
   - **Joining** uses the normal membership path (`joinTeamAsMember`, which link invites also use now). The Owner/Captains are told, the inviter is told the answer, and joining switches the looking card off.
   - **Link invites** are unchanged.
5. **One match at a time (TKT-908, D17).** A player can't join a match, be picked as starter, sub or claimed open slot, or be loaded with a team into a match that overlaps another match they're in, as a player or referee.
   - **The window:** kickoff to scheduled end plus 30 minutes, the same as the referee rule.
   - **Loading a team:** overlapping members of the saved squad are left out, and the acting captain gets a notice.
   - **Referees:** a referee can't be assigned to a match overlapping one they play in. Playing in your own match is fine (D17).
   - **Not covered:** existing overlaps (only new actions count) and retired team planning fixtures.
   - **Error code:** `PLAYER_MATCH_OVERLAP`.
6. **Recruitment board (TKT-909, D12–D14).**
   - **Teams recruiting.** The Owner or a Captain can post, with no limit on posts.
     - A post has positions, players wanted (1–99), format, level, usual days and times, area, and a note of up to 300 characters.
     - A post lasts 30 days and can be renewed, edited or closed.
     - It shows "x of n joined through this post".
   - **Players looking.** This is the "Looking for a team" switch on your own profile, off by default. It holds positions, area, availability and a note, and is listed only while it's on.
   - **Ask to join.** The Owner and Captains get an in-app notice and accept (normal membership path) or decline. Limits: one pending request per player per team, 10 pending per player, 14-day expiry.
   - **Filters:** format, level, position, area.
   - **Reports.** Posts and cards can be reported. Admin → Recruitment removes them, with a reason and an audit entry. A removal resolves the open reports, removed posts can't be renewed, and removed cards stay off.
   - **No money** is involved in anything here.
7. **Guest browsing (TKT-910).** Anyone can browse without an account.
   - **Home and matches:** the home page and `/matches` show upcoming public matches: venue, time, format, the R80 fee and places left, but no names.
   - **Other public pages:**
     - `/m/:slug` for a public match, including the final result with scorers once played;
     - venue pages;
     - team pages (members, results record, review average);
     - player profiles (display name, username, photo, positions, city, bio, teams, stats);
     - the Social Teams tab (the recruitment board).
   - **Sign up to play.** Every action that needs a profile shows "Sign up to play". The link returns to the same page after sign-up, email verification and onboarding.
   - **Enforced by the server:** the `/public/*` routes build guest views from explicit field lists and are rate-limited per IP. Player photos are public; hidden photos still 404. Every signed-in route still answers 401.

## API

- **Social** (`/social`, signed in):
  - `summary`, `search`, `relationships?userIds=`
  - `friends`, `DELETE friends/:userId`
  - `friend-requests` (GET/POST), plus `/:requestId/accept|decline|cancel`
  - `settings` (GET/PUT)
  - `matches/:matchId/played-with`, `matches/:matchId/add-all`
  - `blocks` (GET/POST), `DELETE blocks/:userId`
  - `team-invites`, `team-invites/:inviteId/accept|decline`
  - `recruitment/posts`, `recruitment/looking`, `recruitment/posts/:postId/join-requests`
  - `looking-card` (GET/PUT)
  - `join-requests`, `join-requests/:requestId/cancel`
- **Teams** (Owner/Captains):
  - `member-invites` (GET/POST), `member-invites/:inviteId/cancel`, `invitable-friends`
  - `recruitment-posts` (GET/POST), `recruitment-posts/:postId` (PATCH), `/renew`, `/close`
  - `join-requests`, `join-requests/:requestId/accept|decline`
- **Admin:** `GET /admin/recruitment?queue=reported|all&kind=POST|CARD`, `POST /admin/recruitment/posts/:postId/remove`, `POST /admin/recruitment/cards/:cardId/remove`.
- **Guests** (no account): `GET /public/matches`, `/public/matches/:slug`, `/public/teams/:teamId`, `/public/players/:userId`, `/public/recruitment/posts`, `/public/recruitment/looking`, `/players/:userId/photo`.
- **Changed:**
  - `GET /conversations` and `/:id` now carry `canMessage`.
  - Starting or sending a DM across a block answers `403 MESSAGING_UNAVAILABLE`.
  - The report target types now include `RECRUITMENT_POST` and `LOOKING_CARD`.

## Migrations (additive, hand-written; enum values in their own migrations)

- **The migrations:**
  - `20261006100000_gate_9_friend_enums`
  - `20261006110000_gate_9_friendships` (FriendRequest, Friendship, `User.friendRequestsEnabled`)
  - `20261006120000_gate_9_user_blocks`
  - `20261006130000_gate_9_team_member_invite_enums`
  - `20261006140000_gate_9_team_member_invites`
  - `20261006150000_gate_9_recruitment_enums`
  - `20261006160000_gate_9_recruitment` (TeamRecruitmentPost, PlayerLookingCard, TeamJoinRequest)
- **Partial unique indexes:** one pending request per pair, one pending invite per player and team, one pending join request per player and team.
- **CHECKs:** no self-requests or self-blocks, friendship pair order, note length ≤ 300, players wanted 1–99, days 0–6.
- **Total:** 60 migrations.
- **Drift check:** `prisma migrate diff` against `footy_finder_test` shows no drift. The only noise is the pre-existing database-side id defaults.

## Verification (2026-09-30)

```powershell
# disposable DB only (docs/TEST_DATABASE.md)
$env:NODE_ENV='test'; $env:DATABASE_URL='postgresql://…/footy_finder_test?schema=public'
cd apps/api; npx prisma migrate deploy        # 60 migrations
npm run smoke:all                             # 37 smokes, including the six new ones:
                                              # friends, blocking, team-member-invites,
                                              # match-overlap, recruitment, guest-browsing
cd ../..; $env:ADMIN_TEST_DATA_ENABLED='true'; $env:PAYMENT_PROVIDER='demo'
npx playwright test                           # 6 passed in one clean run (3.7 min), including e2e/social.spec.ts
```

- **Playwright:** the final clean run (2026-10-01) passed all 6 journeys. Before it, two older journeys were updated for guest browsing:
  - **`position-claim`:** clicked "Sign in to join", which TKT-910 renamed to "Log in".
  - **`critical-path`:** expected `/matches` to send a guest to login, but guests can browse it now. The redirect check now uses `/wallet`.
- **Unit tests:** shared 123, api-client 39, api 407, web 162. Type-checks and the api, web and admin builds pass.
- **Venue-cost privacy test:** now also scans the guest match list, a played match's result, the public team page, and the guest recruitment board and looking cards.
- **Retained test records:** `smoke:recruitment` removes a post and a card as an admin. Those audit rows are append-only, so its admin account (`…-recruit-admin@retained.invalid`) stays in the disposable database, like the settlement smokes' admins.
- **Test database cleanup:** while building TKT-908, some failed smoke runs left due durable jobs in `footy_finder_test`. Those orphans, which pointed at deleted matches, were removed. If `smoke:financial-integrity` ever reports "Durable job did not complete authoritatively", look for due `PENDING` jobs left by an earlier failed smoke.

## Dev mock world

`npm run dev:seed-mock -- --me <email>` now also seeds, through the normal services:
- **Friendships:** nine between mock players.
- **You:** friends with player01 and player16, and player03 has sent you a request.
- **Recruitment posts:**
  - Wanderers: 7-a-side, competitive, needs a GK and a DEF.
  - Observatory United: 11-a-side, casual, 5 players, any position.
- **Looking players:** player29 and player30.
- **A join request:** player29 has asked to join Observatory United.

`--reset-mock` ends all of this through the normal paths: it closes posts, cancels join and friend requests, switches looking cards off and removes mock friendships. Your own friendships are kept. The time helper now also refuses a move that would put a player in two overlapping matches.

## Before going live

1. **Local dev database (manual, no reset needed).** In `apps/api` run `npx prisma migrate deploy` against `footy_finder` (additive; your mock world stays). Restart the dev API so it loads the new Prisma client. Then run `npm run dev:seed-mock -- --me <your email>` to add the social test data.
2. **Publish the Terms of Service v2.4 Launch version** (`legal:publish` with `docs/legal/legal-launch.json`). Gate 9 changed these clauses:
   - 8 (data, 8.3 public visibility, retention)
   - 11.1 and 11.12
   - 12.1
   - 16.2
   - 18 (18.1, 18.4, 18.7 friends, 18.8 blocking, 18.9 recruitment)
   - 19
   - Annexure A
3. **Searchability:** guest pages are public. Decide whether search engines should index them. Nothing currently asks them not to.
4. **Everything still open** from the Gate 6, 7 and 8 runbooks.
