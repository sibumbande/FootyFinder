# Footy Finder

Footy Finder is an npm-workspaces TypeScript monorepo for discovering football matches, funding a ZAR wallet, joining a team, and coordinating a persistent match lobby from booking through final result.

## Requirements

- Node.js 20.19+, 22.12+, or 24+ (required by Prisma 7)
- npm 10 or newer
- PostgreSQL 14 or newer
- Docker with Compose (optional, for the disposable test database)

## Applications and packages

- `apps/web` - Vite, React, React Router, TanStack Query, React Hook Form, Tailwind CSS, and Socket.IO Client.
- `apps/admin` - separately deployable React operations console using the same typed API, session boundary, and PostgreSQL-backed domains.
- `apps/api` - Express, Prisma/PostgreSQL, Argon2id, JWT cookie authentication, and Socket.IO.
- `packages/shared` - environment-independent domain types, Zod schemas, match-format configuration, formations, and lifecycle helpers.
- `packages/api-client` - the typed HTTP client used by the web app and suitable for a future native client.

The repository uses standard npm workspaces. Do not use pnpm commands or create a pnpm lockfile.

## Visual system

The player app uses the original **Matchday '88** art direction: late-1980s sports-animation energy, printed match-programme textures, bold broadcast graphics, and daylight/floodlit themes. Central semantic colors live in `apps/web/src/app/theme.css`; reusable surface and typography treatments live in `apps/web/src/app/styles.css`. The Admin console uses a related night-stadium control-room treatment in `apps/admin/src/styles.css`.

The original hero artwork is stored at `apps/web/public/art/matchday-heroes.png`. Keep new UI colors semantic, preserve both themes and reduced-motion behavior, and do not add third-party team marks or copyrighted characters.

## Local setup

1. Install all workspace dependencies:

   ```bash
   npm install
   ```

   Installation generates Prisma Client automatically. The API also regenerates the client before
   its development, build, lint, and test scripts, so a clean checkout cannot type-check against the
   placeholder Prisma package.

2. Copy `apps/api/.env.example` to `apps/api/.env`, then set the database connection and a private JWT secret:

   ```env
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/footy_finder?schema=public"
   PORT=3000
   JWT_SECRET=replace-this-with-at-least-32-random-characters
   JWT_EXPIRES_IN_SECONDS=604800
   CLIENT_URL=http://localhost:5173
   ADMIN_CLIENT_URL=http://localhost:5174
   NODE_ENV=development
   TRUST_PROXY_HOPS=0
   RATE_LIMIT_AUTH_PER_15_MINUTES=20
   RATE_LIMIT_MESSAGES_PER_MINUTE=30
   RATE_LIMIT_COSTLY_MUTATIONS_PER_MINUTE=20
   ADMIN_MFA_ENCRYPTION_KEY=replace-this-with-an-independent-mfa-key
   ADMIN_MFA_MAX_AGE_MINUTES=720
   PUBLIC_API_URL=http://localhost:3000
   TEAM_UPLOAD_DIR=uploads/teams
   PLAYER_UPLOAD_DIR=uploads/players
   EMAIL_PROVIDER=console
   EMAIL_FROM=no-reply@footyfinder.test
   POST_MATCH_CHAT_DURATION_MINUTES=25
   ```

3. If the API does not run at `http://localhost:3000`, copy the `.env.example` files in `apps/web` and `apps/admin` to `.env` and set `VITE_API_URL`.

4. Apply the committed migrations:

   ```bash
   npm run prisma:migrate
   ```

   All newly created 5-, 7-, and 11-a-side matches use the server-authoritative 60-minute product duration; it is intentionally not environment-configurable.

   `npm run prisma:generate` remains available as an explicit recovery command after editing the
   Prisma schema or when diagnosing generated-client issues.

5. Start the web app and API:

   ```bash
   npm run dev
   ```

The player app runs at `http://localhost:5173`, the Admin app at `http://localhost:5174`, and the API at `http://localhost:3000`. Individual commands are `npm run dev:web`, `npm run dev:admin`, and `npm run dev:api`.

Database smoke tests and browser E2E tests must use a disposable database. See
[`docs/TEST_DATABASE.md`](docs/TEST_DATABASE.md) for the guarded Docker/native setup, migration
commands, test tiers, and cleanup procedure.

To create the first platform administrator, register an ordinary account and run:

```bash
npm run admin:bootstrap --workspace=@footy-finder/api -- admin@example.com
```

Then sign in at the Admin app and configure the authenticator secret. Team OWNER/CAPTAIN roles do not grant platform Admin access.

## Product behavior

### Identity and profiles

Registration creates a private account, a `PlayerProfile`, and a ZAR `WalletAccount`, then resumes through email verification and onboarding. New players must be 18+, select the active Cape Town city, provide 0-60 whole years of experience, choose up to four ordered unique positions, upload a private normalized non-biometric profile photo, and accept every current required legal version before product access. Unsupported controlled cities use the consented waiting list instead of being represented as active Cape Town profiles. Existing users retain sign-in/read access but sensitive mutations are gated until their missing requirements are complete.

Verification, password reset, and email change use hashed single-use email-link tokens. Development may use the console/test provider; production fails closed unless Postmark and an approved sender are configured. Legal pages are public, but production activation requires counsel-approved document bodies and retention policy; placeholder consent text is never treated as accepted legal content.

Authenticated profile DTOs expose display name, normalized photo, bio, ordered positions, dominant foot, city, experience, current Teams, and supported W/D/L/goals statistics, while DOB remains self/Admin-only. They never expose email, password hashes, wallet balances, or payment data. Players can edit their own profile/photo and start a private one-to-one conversation from another player's profile.

Authentication is stored in an HTTP-only same-site JWT cookie bound to a persisted, independently revocable session. The browser never stores the credential in JavaScript. Logout revokes only the current session, restricted accounts are rejected, and Socket.IO validates the same session before joining a private per-user room. Cookie-authenticated mutations also verify the browser Origin.

### Matches and formations

The create wizard supports public or invitation-only 5-a-side, 7-a-side, and 11-a-side matches. Starter counts and default formation coordinates are centralized in `packages/shared/src/config`; each Match persists its own 0–10 substitute capacity per Team, rolling-substitution setting, and typed informational rules. Existing and unspecified Matches use five substitutes per Team.

Creating a lobby does not charge or auto-join the organiser. Players explicitly select Home or Away when joining. The persisted venue contains structured address data and optional coordinates. Public discovery supports format, date, and availability filters; private matches are excluded and require their secure invitation token. Quick Match invitation tokens are stored only as SHA-256 digests; a plaintext link is delivered once when the Match is created or the host rotates it.

The host can ready or cancel the match, move participants between teams, assign or swap formation slots, and reposition pitch markers. Players may switch teams only from the reserves while capacity remains. The responsive lobby provides a pitch, reserves, participant list, timer, persisted chat, and result form.

Lifecycle transitions are server-authoritative. A background scheduler moves due matches to `IN_PROGRESS`, then to `AWAITING_RESULT` using the duration stored on the match. The host submits the final score and participating scorers; scorer totals and membership are validated transactionally before completion. Lobby chat closes after the configured post-match window.

Matches are explicitly classified as `QUICK_GAME` or `TEAM_MATCH`. Existing Matches remain Quick Games. A Team OWNER or CAPTAIN can create a private, free, HOME-only Team fixture through the Team Match API. These fixtures remain `DRAFT` planning workspaces, retain Team name/image/color and formation snapshots, never enter personal-wallet or Quick Game join flows, and are excluded from automatic lifecycle progression. Current attached-Team members can view the fixture and enter its Match room; current OWNERs and CAPTAINs administer it.

### Wallet and cancellations

Money is stored as integer cents. The temporary **Add funds** action sends a provider-neutral demo deposit and credits R500.00 only after the server-side operator returns success. Every deposit, entry debit, cancellation credit, and replacement credit has an auditable `WalletTransaction` and idempotency key.

Joining revalidates team capacity and wallet balance inside a serializable transaction, debits the server-owned match fee, creates `MatchPayment`, and creates the participant atomically. A duplicate join request cannot debit the wallet twice. Zero-fee matches follow the same capacity checks without requiring funds.

Cancelling more than twelve hours before kickoff credits 100% internally. Cancelling exactly twelve hours or less before kickoff issues no initial credit; a successful paid replacement on the same Team releases the full withheld eligible amount to the original player, FIFO. A player cannot leave at or after kickoff. Retries remain idempotent, and cancelling the entire Match credits every eligible paid participant 100%. No flow sends an external card or bank refund.

### Messaging and notifications

Lobby chat is restricted to the host and joined participants. Direct conversations enforce membership on every read and write and use a stable participant key to prevent duplicate one-to-one threads. Messages persist before realtime broadcast.

The notification bell reads persisted notifications with unread state. Deposits, joins, cancellations, replacements, wallet credits, match starts, results, and direct messages use the same notification service. Realtime notifications also feed the existing four-second animated in-app toast system.

### Teams

Teams are a first-class, normalized domain. A user may own or belong to multiple Teams, with an independent `OWNER`, `CAPTAIN`, or `MEMBER` role in each. Creating a Team is free and transactionally creates its OWNER membership plus persisted defaults for 5v5, 7v7, and 11v11 formations; it never reads from or changes the wallet.

`/teams` lists the authenticated player's clubs, `/teams/create` provides the three-step creation wizard, and `/teams/:teamId` contains Overview, Squad, Formation, Invites, and role-gated Settings sections. Public player profiles include privacy-safe Team summaries. OWNERs manage details, images, roles, members, invites, formations, and deletion. CAPTAINs manage invites and formations. MEMBERs have read-only Team and formation access and can use the existing profile/direct-message flow.

Team invite links use a cryptographically random raw token in `/teams/invite/:token`; PostgreSQL stores only its SHA-256 hash. Public GET inspection renders safe Team metadata and never joins the visitor. An authenticated POST accepts the invite in a serializable transaction, consumes the single-use invitation, and creates the unique membership atomically. Logged-out visitors retain the invite URL through normal login or registration. Invites expire after seven days by default, can be revoked, and support future multi-use limits. A successful join persists a notification for Team administrators and broadcasts the existing user- and Team-room Socket.IO events.

Saved Team formations reuse the shared formation presets and the existing animated `FormationBoard`; they do not alter historical Match formations. Unassigned members remain in the squad bench. OWNER/CAPTAIN drag, swap, tap-select, and coordinate changes persist immediately with optimistic rollback, while MEMBERs receive a read-only view.

Team profile images use multipart upload through the small `TeamImageStorage` interface. The development provider validates PNG, JPEG, and WEBP signatures up to 5 MB, generates UUID filenames under `TEAM_UPLOAD_DIR`, and serves them from `/uploads`. Replacing or deleting a Team removes only its safely recognized local image. Uploaded development media is generated state and should not be committed. Production can replace this provider with S3, Cloudinary, or similar object storage without changing Team business logic.

Deleting a Team transactionally cancels its unfinished Team fixtures, nulls only the live Team relation, and retains the normalized `MatchTeam` snapshots and historical Matches. Completed and already-cancelled Match history is not rewritten.

## API overview

Public authentication and profile routes:

- `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`
- `POST /auth/email/verification/resend`, `POST /auth/email/verify`
- `POST /auth/password/reset/request`, `POST /auth/password/reset`
- `POST /auth/email/change/request`, `POST /auth/email/change/confirm`
- `GET /legal/documents/current` and `GET /legal/documents/:type` (public approved versions)
- `GET /cities` and city-interest join/status/unsubscribe/delete routes
- `GET /players/:userId` and `GET /players/:userId/photo` (authenticated)
- `PATCH /players/me/profile`, `POST /players/me/photo` (authenticated/onboarding session)
- `/onboarding` - status, profile details, legal acceptance, and completion
- `GET /users`, `GET /users/me` (authenticated)

Authenticated domain routes:

- `/matches` - discovery, create, invite access, lobby updates, ready/cancel, team join/change/leave, cancellation quote, formation, result, participants, and lobby messages.
- `/wallet/deposits/demo` - demo R500 deposit; requires `Idempotency-Key`.
- `/conversations` - list/start conversations, read/send messages, and mark read.
- `/notifications` - list, mark one read, and mark all read.
- `/teams` - create/list Teams and get, update, or delete a Team.
- `/admin/auth` - platform-Admin MFA status, setup, and verification using a persisted session.
- `/admin/audit-logs` - MFA-gated, privacy-safe append-only Admin history.
- `/admin/venues` and `/admin/fields/*` - MFA-gated managed venue/field catalogue, weekly hours, exceptions, supported formats, status, and immutable effective ZAR pricing.
- `/support/tickets` - authenticated player-owned support threads, isolated from direct messages.
- `/admin/support/tickets` - MFA-gated support inbox, status/priority management, public replies, and Admin-only internal notes.
- `/admin/test-data/*` - MFA-gated disposable account batches; unavailable unless explicitly enabled outside production.
- `/admin/finance/reconciliation` - MFA-gated read-only wallet/ledger/hold/Match-payment integrity report.
- `/bookings` and `/bookings/fields` - authenticated managed-field discovery, player booking funding pools, booking detail, and idempotent wallet-hold contributions.
- `/admin/matches` - MFA-gated Match loading from the managed field catalogue with immediate reservation and immutable price snapshots.
- `/moderation/reports` - authenticated private report submission/history with server-side evidence snapshots.
- `/admin/moderation/*` - MFA-gated report triage, player search, timed suspension, permanent bans, enforcement history, and reinstatement.
- `/disputes` - authenticated Match-result and field-booking dispute submission, personal history, and authorized result revisions.
- `/admin/disputes/*` - MFA-gated triage and authoritative resolution; result corrections append immutable revisions and booking decisions never mutate wallets implicitly.
- `/admin/operations/summary` - MFA-gated live work queues, account/Match/job state, 24-hour finance totals, and process lifecycle counters.
- `/teams/:teamId/members` - privacy-safe roster, role changes, and member removal.
- `/teams/:teamId/invites` - create, list metadata, and revoke Team invitations.
- `/teams/:teamId/formations/:format` - read or save the Team's normalized 5v5, 7v7, or 11v11 formation; slot updates use the nested `/slots/:slotId` route.
- `POST /teams/:teamId/matches` and `GET /teams/:teamId/matches` - create or list private Team Match planning fixtures.
- `POST /teams/:teamId/image` - validated multipart Team image replacement.

Public Team invitation routes:

- `GET /team-invites/:token` - inspect only; never mutates membership.
- `POST /team-invites/:token/accept` - authenticated, transactional acceptance.

API and Socket.IO errors use stable codes and safe messages without exposing tokens, hashes, Prisma errors, payment secrets, or stack traces. CORS allows only the exact player and Admin browser origins and explicitly supports the `Idempotency-Key` preflight header. Tiered authentication, message, and costly-mutation limits return `RATE_LIMITED`; the development in-memory limiter must be replaced by a shared store before horizontally scaling the API.

Deployment probes are split by intent: `GET /health` is process liveness and `GET /ready` verifies PostgreSQL readiness. Configure the load balancer to remove an instance when `/ready` returns `503`, while retaining liveness restarts for an unresponsive process.

## Theme and motion

All system colors live in `apps/web/src/app/theme.css`. Components consume semantic Tailwind tokens, including dedicated pitch and Home/Away team tokens, in both light and dark modes. Change the CSS variables there to update the palette centrally.

Page transitions are controlled in `apps/web/src/app/motion.css` and use a short directional slide with a restrained elastic settle. Transitions and notification animation respect reduced-motion preferences.

## Quality commands

```bash
npm run lint
npm test
npm run build
npm run test:e2e:install
npm run test:e2e
npm run smoke:match-capacity --workspace=@footy-finder/api
npm run smoke:team-match --workspace=@footy-finder/api
npm run smoke:security-sessions --workspace=@footy-finder/api
npm run smoke:admin-identity --workspace=@footy-finder/api
npm run smoke:admin-catalog --workspace=@footy-finder/api
npm run smoke:support-test-data --workspace=@footy-finder/api
npm run smoke:financial-integrity --workspace=@footy-finder/api
npm run smoke:field-bookings --workspace=@footy-finder/api
npm run smoke:moderation-enforcement --workspace=@footy-finder/api
npm run smoke:disputes-results --workspace=@footy-finder/api
npm run smoke:operations --workspace=@footy-finder/api
npm run wallet:reconcile --workspace=@footy-finder/api
```

`npm run test:e2e:install` is a one-time Chromium download on each machine or CI image. The E2E command starts player-web and API development servers, exercises real browser CORS/cookie behavior, and removes only its uniquely tagged PostgreSQL fixtures.

The committed `20260811100000_master_domain_foundation` migration normalizes profiles, wallets, venues, formats, formations, payments, cancellations, results, conversations, messages, and notifications while migrating legacy rows. `20260820100000_create_teams` adds Teams, memberships, hashed invitations, saved formations, slots, role constraints, and Team notification types without resetting existing data. `20260823100000_match_capacity_and_rules` backfills every existing Match to five substitutes per Team and adds the database-enforced capacity, rolling-substitution, and informational-rule fields. `20260823150000_private_team_match_foundation` backfills existing Matches as Quick Games and adds Team Match drafts plus normalized nullable Team sides and historical snapshots without rewriting older migrations.

## Production notes

The additive `20260824090000_auth_sessions_security` migration creates revocable authentication sessions and account status, hashes every existing Quick Match invitation without invalidating its active link, and adds digest storage for future invitation rotation.

`20260824130000_admin_identity_audit` adds platform roles, encrypted Admin MFA credentials, per-session Admin verification, and a PostgreSQL-trigger-protected append-only audit log. It does not grant Admin access to existing accounts.

`20260824170000_managed_fields_pricing` adds the Admin-managed venue and field catalogue without changing historical Match venues. It includes supported formats, weekly operating periods, availability exceptions, immutable effective-dated ZAR prices, database checks, and PostgreSQL-enforced non-overlapping price history.

`20260824200000_support_test_data` adds private support tickets/messages, support reply notifications, and explicitly tagged disposable test-account batches. Test tooling is disabled by default; set `ADMIN_TEST_DATA_ENABLED=true` only against an approved local disposable development/test database. Configuration validation rejects production, remote, shared, and ordinarily named development databases when that setting is enabled.

`20260824230000_financial_integrity_jobs` adds wallet holds, durable jobs, balance/sign checks, and immutable terminal financial transitions. Existing deposits and Quick Game debit/credit flows use the shared locked financial repository. The reconciliation command is read-only and returns a nonzero exit code when it finds an integrity issue.

`20260925120000_gate_2_onboarding` adds the controlled city catalogue/interests, nullable legacy-compatible onboarding fields, ordered positions, protected photo metadata, immutable legal versions/acceptances, hashed verification tokens, and explicit result outcome semantics. Follow `docs/GATE_2_ONBOARDING_RUNBOOK_2026-09-25.md`; do not activate the production consent gate until counsel content, retention policy, Postmark configuration, migration preflight, and focused browser verification are complete.

`20260825010000_booking_enum_values` and `20260825020000_field_reservations_funding` add the booking financial types, atomic managed-field reservations, immutable price/location snapshots, funding obligations, and personal-wallet contributions. PostgreSQL prevents active time overlaps. Underfunded reservations expire through the durable worker and release holds; confirmed contribution ledgers are included in reconciliation.

- Replace the demo payment operator with a trusted gateway implementation and server-verified callback flow before accepting real money.
- Replace local Team image storage with a durable object-storage provider before multi-instance deployment.
- Place `PLAYER_UPLOAD_DIR` on durable private storage; do not expose originals or mount that directory as a public static path.
- Configure a verified Postmark domain/token and publish counsel-approved legal versions before enabling Gate 2 in production.
- Serve the web and API over HTTPS in a compatible same-site deployment so secure authentication cookies work correctly.
- Set `NODE_ENV=production`, explicit HTTPS player/Admin/API URLs, and the correct `TRUST_PROXY_HOPS`; production configuration fails closed when these are missing.
- Use a shared rate-limit store before running more than one API instance.
- Run migrations during deployment. Durable jobs already use distributed database claims; operate the older Match lifecycle poller as a single logical worker until it is migrated to the durable queue.
- Monitor readiness failures, overdue/failed durable jobs, open operational queues, 24-hour failed financial transitions, and non-zero reconciliation findings. The Admin dashboard refreshes its database-backed summary every 30 seconds.
- External refunds, withdrawals, Team-vs-Team Match creation/payments, leagues, tournaments, Team chat, social features, and accumulated Team/player statistics are intentionally outside the current scope.
