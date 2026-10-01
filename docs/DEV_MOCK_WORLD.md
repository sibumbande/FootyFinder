# Dev mock world: local end-to-end testing

Date: 2026-09-30
Branch: `ceo/finish-gate-5`

A dev-only seed that fills your **local** `footy_finder` database with 30 mock players, two teams and five ready-made match scenarios, with you as the FootyFinder referee. A time helper moves a scenario's kick-off so you don't have to wait for real time. **Never** use it on the smoke database or anywhere else: it refuses to run there, and it is not part of `smoke:all`.

## Before you start

- Your own admin account exists, and the Terms of Service are published (`legal:publish` with `docs/legal/legal-launch.json`).
- A published venue has a field that supports **5-a-side** and one that supports **7-a-side**. They can be the same field. Each needs a price for that format. The seed never creates or changes venues, fields, slots or prices. If one is missing, it stops and tells you which to create in Admin → Venues.
- The dev API (`npm run dev:api`) and the web app (`npm run dev:web`) are running. The API's job queue runs the T-30 check, and its match scheduler starts and ends matches.

## Commands (from `apps/api`; `.env` is loaded)

```powershell
npm run dev:seed-mock -- --me you@example.com        # create or complete the mock world
npm run dev:shift-match -- <matchId> <minutes>       # move a kick-off; negative = earlier
npm run dev:seed-mock -- --reset-mock --me you@example.com   # end the current round
```

The seed ends by printing a table with each scenario, its link (`http://localhost:5173/matches/<id>`), what to test and who to log in as.

## What the seed creates

- **30 mock players**, `player01@footyfinder.test` to `player30@footyfinder.test`, username `mock_player01` and so on. They all share the password printed at the end (`MockPlayer2026`). Each player:
  - has a verified email;
  - is 19 to 35 years old, in Cape Town, with 1 to 15 years' experience and varied positions (goalkeepers: 01, 15, 21 and 25);
  - has a generated placeholder photo;
  - has accepted the current Terms, recorded with source `DEV_SEED`.

  They are created through the normal onboarding, photo and legal-acceptance code, and are marked as test accounts in the batch "DEV SEED mock world".
- **Wallets.** Each player is topped up to R500 once per round, through the existing demo top-up path. These are `DEPOSIT_CREDIT` rows with provider `demo`, description "DEV SEED wallet top-up (demo, no real money)" and a `DEV-SEED:` idempotency key. No balance is ever edited directly.
- **Two teams**, created through the normal team, invite and contribution code:

  | Team | Players | Owner | Captain | Team wallet |
  |---|---|---|---|---|
  | Woodstock Wanderers | 01–14 | player01 | player02 | R1,500 (R300 each from 01–05) |
  | Observatory United | 15–28 | player15 | player16 | R1,500 (R300 each from 15–19) |

- **`--me <your email>`.** Your account becomes a referee and the default referee, through the normal services. Both changes are audited, and the reason (or an extra `DEV_SEED_DEFAULT_REFEREE_SET` audit row) says DEV SEED. Anything already in place is left as is. The account must be an active admin. Without `--me`, only players and teams are created.
- **Five scenarios.** Each is published through the normal create path, and you are assigned by the normal default-referee rule. Joins, payments and position claims use the normal join and claim code.

  | | Match | Kick-off | Set-up |
  |---|---|---|---|
  | A | Quick 5-a-side | about 40 min from now | 9 joined and positioned, one AWAY outfield place open for you |
  | B | Quick 5-a-side | A + 90 min | 6 joined (15–20): the T-30 check cancels it and refunds everyone |
  | C | Team Match, "Teams only", 2 subs each | A + 180 min | Observatory United took the other side; both fill meters full (R560 each); both lineups finalized |
  | D | Team Match, "Open to both", 2 subs | tomorrow 18:00 | Wanderers home, other side empty |
  | E | Quick 7-a-side | tomorrow 20:00 | 7 of 14 joined |

  **Why A, B and C are staggered.** A referee is busy from kick-off to the scheduled end plus 30 minutes' travel (D27), so the same referee's matches must start at least 90 minutes apart.

  **Why they are published further out first.** Players can only publish at least 2 hours ahead. So A, B and C are published at the first free slot more than 2 hours away, then moved to their targets with the time helper.

**Social (Gate 9).** Seeded through the normal services, with or without `--me`:
- **Friendships:** nine between mock players (01–02, 01–03, 02–03, 15–16, 16–17, 21–22, 22–23, 29–30 and 01–15).
- **With `--me`:** you're friends with player01 and player16, and player03 has sent you a friend request. Skipped if you've turned friend requests off.
- **Recruitment posts:**
  - Woodstock Wanderers: 7-a-side, competitive, needs a goalkeeper and a defender.
  - Observatory United: 11-a-side, casual, 5 players, any position.
- **Looking for a team:** player29 (winger, Salt River) and player30 (goalkeeper, Rondebosch).
- **A join request:** player29 has asked to join Observatory United.

**Running it again** creates only what is missing for the current round, and never duplicates anything. Players are found by email, teams by name and owner, scenarios by their round tag, and payments by idempotency key. A played or cancelled scenario is replaced only in the next round, after `--reset-mock`.

## The time helper (`dev:shift-match`)

It only moves a DEV SEED scenario match that has not kicked off. In one transaction it moves:
- the kick-off and the T-30 time;
- the field booking;
- the run time of every waiting kick-off-relative job: go/no-go, fill and meter reminders, the "Teams only" no-opponent warning and cancel, and the referee's 24-hour alert. It uses the app's own timing functions.

It never changes a status, money or a result. When the new time arrives, the running dev API's normal job queue and match scheduler do the work. If the new T-30 time is already past, the check runs on the queue's next tick, like a late run.

It refuses if:
- the match isn't a DEV SEED scenario, or has already kicked off;
- the new kick-off is in the past;
- the move would double-book the referee (D27; shift the other match first);
- the move would put one of its players in two overlapping matches (Gate 9 / TKT-908);
- it would overlap another booking on the field.

It ignores the field's opening hours (it's a time machine). Each shift is audited as `DEV_SEED_MATCH_SHIFTED`.

## Resetting (`--reset-mock`)

- **Mock accounts are kept.** Terms acceptances are append-only legal records and block deleting an account, so the 30 accounts stay, with their wallets and full ledger history. The next round reuses them.
- **Scenario matches that have not kicked off** are cancelled through the normal cancel path: the host's (or home team's) cancel, or, with `--me`, the admin "Cancel match (weather/venue)" if the host can no longer cancel. Every R80 is refunded and team money is released through the ledger.
- **Started, finished and already-cancelled scenario matches are kept as history**, with their venue payables, lineups, results and reviews. Their ledger entries depend on them. They are marked "Kept as history by --reset-mock" in the description; their names already start with `[DEV SEED]`. A Team Match past its T-30 check that has not kicked off can't be cancelled by anyone; it is reported and left to play out.
- **Mock teams** are closed through the normal team-closure path. Unspent team money goes back to each contributor's wallet, and the team is archived (never deleted). Their team chats and the mock players' notifications are cleared.
- **Social:** recruitment posts are closed, join requests and friend requests from mock players are cancelled, looking cards are switched off, and friendships between mock players are removed. Your own friendships stay.
- **Never touched:** your accounts, venues, fields, slots, prices, your own teams and matches, and the audit log.
- The reset is audited (`DEV_SEED_MOCK_RESET`). The next seed run starts a new round with fresh teams and scenarios.

## Safety locks

- Both commands refuse to run unless `DATABASE_URL` is on `localhost` / `127.0.0.1` / `::1` and the database name is exactly `footy_finder`. That rules out `footy_finder_test`, so the smokes are never affected.
- They also refuse if `NODE_ENV=production` or `EMAIL_PROVIDER=postmark`. The lock runs before anything that can reach the database is loaded.
- **Email.** Every mock address uses the reserved `.test` domain. The dev mailer only prints to the API console. The Postmark sender also skips any `.test`, `.invalid`, `.example`, `.localhost` or `example.com/.net/.org` address, so these can never be emailed even by mistake.
- **Money.** Seed money only enters through the demo top-up path, which is never reachable in production:
  - the environment check refuses `PAYMENT_PROVIDER=demo` when `NODE_ENV=production`;
  - `POST /wallet/deposits/demo` answers 404 unless the provider is `demo` outside production;
  - the web app shows the demo top-up only when the API reports provider `demo`.
- **Reconciliation.** Seed deposits have no `ProviderPayment`, so they never appear in Paystack reconciliation or on the admin Finance top-up list. Paystack checks only look at `provider = 'paystack'`. The wallet balance checks still cover them, so seeded wallets stay balanced (`npm run wallet:reconcile`). There is no revenue report in the platform today, and a demo credit is not FootyFinder income in any case.
- **Out of the smokes.** Neither command is part of `smoke:all`.

## Tests

- `scripts/dev-mock/guard.test.ts`: the safety lock.
- `scripts/dev-mock/shift.test.ts`: the job times the helper uses.
- `src/modules/auth/email.provider.test.ts`: the reserved-address guard.
