# Footy Finder product-requirements audit

Audit date: 2026-09-24  
Repository: `footyfinder`  
Scope: read-only product, architecture, data-model, authorization, realtime, payment, and test audit. No product code, migration, environment file, or production data was changed.

> **Post-audit Gate 1 status (2026-09-25):** This document remains the historical audit snapshot. Gate 1 application remediation is now implemented: configurable whole-rand Quick Game fees from R0-R500 with an R80 default, a 60-minute duration invariant, removal of max-price/geolocation discovery, direct My Profile navigation, four-character uppercase alphanumeric unique Team short names, and capacity-derived `FULL`. Migration `20260925090000_gate_1_alignment` handles eligible 90-minute matches, existing Team short names, and legacy stored `FULL` values. Automated tests, lint, Prisma generation, and builds pass; disposable-PostgreSQL migration/smoke and focused Playwright verification remain pending. Current status is tracked in `docs/PRODUCT_REQUIREMENTS_TICKET_BREAKDOWN_2026-09-24.txt` and the deployment procedure is in `docs/GATE_1_MIGRATION_RUNBOOK_2026-09-25.md`.

> **Post-audit Gate 2 status (2026-09-25):** The registration/onboarding gaps recorded below now have an implemented application path: controlled DOB/city/experience/ordered-position data, 18+ enforcement, private normalized player-photo upload, versioned legal evidence, email verification, password reset and verified email change, a consented city waiting list, resumable new-user onboarding, legacy mutation gates, and supported player statistics. Migration `20260925120000_gate_2_onboarding` is additive. Production release is not yet approved: counsel must supply the five legal documents/company facts and retention matrix, Platform Operations must configure Postmark, and the migration/preflight plus focused Playwright flows must run against a disposable environment. See `docs/GATE_2_ONBOARDING_RUNBOOK_2026-09-25.md` and the current ticket breakdown rather than treating this historical matrix as live status.

## 1. Executive summary

Footy Finder is a substantial working application, but it is not yet the product described by the supplied requirements. Its strongest implemented areas are authenticated quick-match creation/joining, wallet-ledger-backed match charges and cancellation credits, team administration and saved formations, team match-day availability/lineup management, direct and match-lobby messaging, persisted realtime notifications, managed-field administration, field-booking funding holds, moderation/support/dispute tooling, session security, and automated unit/component coverage.

The largest product gaps are registration/onboarding (age, legal acceptance, selfie upload, experience, city, verification, waiting list), the home venue-discovery experience, public-match sharing and authentication return, team wallets, captain-vs-captain challenges, friendships/social shell, two-party result confirmation, ratings/reviews, QR codes, and legal disclosures.

The main architectural issue is not absence of all foundations; it is fragmentation:

- Home displays users, while venue discovery is buried in a separate booking screen.
- Ordinary match creation uses hardcoded placeholder venues, while a database-driven managed venue/field catalogue exists elsewhere.
- Quick matches support personal-wallet charging but organiser-only formation placement.
- Team fixtures support sophisticated team loading, availability, open-position claims, and chat, but are private/free planning fixtures with no opponent challenge or team payment.
- Wallet transactions, venue prices, holds, reversals, and booking obligations exist, but there is no user transaction-history experience, team wallet, venue settlement ledger, or real payment-provider integration.

The clearest broken user journey is link onboarding. Public match lobbies have no share action or short/public route. Private quick-match invites exist, but the route and API require authentication, and `ProtectedRoute` stores the destination in React Router state while login/register only read a `returnTo` query parameter. An unauthenticated recipient is therefore redirected to `/` after authentication instead of back to the match. Team invitation links implement the query-based return path correctly.

Current business rules conflict with code in four important places: match fees are creator-defined rather than fixed at R80; match duration defaults to 90 rather than 60 minutes; team short names allow 12 rather than 4 characters; and max-price plus geolocation discovery controls remain enabled. Required real venue names and costs are not committed as seed/configuration data.

Runtime health is good after one bootstrap step: `npm run prisma:generate`, `npm run build`, `npm run lint`, and `npm test` pass. The checkout does not generate Prisma during `npm ci`, so the first build fails until generation is run. The executed test suite covered 54 files and 206 tests. The database-backed smoke scripts, migration status, and one Playwright E2E spec were not run because no local `DATABASE_URL`/PostgreSQL test environment is supplied. `npm ci` reported 14 dependency advisories (8 moderate, 5 high, 1 critical); advisory details were not exported to npm's external audit service.

## 2. Requirements audit matrix

Each row has exactly one primary status.

| ID | Area | Requirement | Status | Evidence | Missing / problem |
| -- | ---- | ----------- | ------ | -------- | ----------------- |
| 1.1 | Home | Airbnb-style venue discovery using Queens Park, Cape Town City FC, and Italian Club | 🟡 PARTIALLY IMPLEMENTED | Managed catalogue in `schema.prisma`; `/bookings/fields`; admin `VenuesPage`; home `HomePage` | Home shows users, not venues; no venue cards/images/detail navigation; ordinary creation uses three fake names; no committed real venue records. |
| 1.2 | Home | Venue availability calendar and available playing slots | 🟡 PARTIALLY IMPLEMENTED | `ManagedFieldAvailability`, `ManagedFieldException`, `FieldReservation`; booking availability validation | No venue-click flow, calendar, or generated slot query/UI. User enters an arbitrary datetime and learns validity on submit. |
| 1.3 | Home | Other cities coming soon and waiting-list affordance | 🟡 PARTIALLY IMPLEMENTED | Venue/match city fields and coordinate discovery exist | No homepage city section, supported-city policy, disabled city choices, user city, or waiting list. `homeArea` is unstructured. |
| 1.4 | Home | Upcoming public matches needing players below venues | 🟡 PARTIALLY IMPLEMENTED | `/matches`, `MatchesRepository.listPublic`, `MatchListPage`, `MatchCard` | Correct discovery exists on `/matches`, not home; home has no Upcoming Matches section. |
| 2.1 | Registration | Select preferred/secondary positions during profile creation | 🟡 PARTIALLY IMPLEMENTED | Position enum, profile join table, profile edit UI/API | Registration does not ask for positions; initial profile has none. |
| 2.2 | Registration | Mandatory selfie/face-photo upload | 🔵 DIFFERENT IMPLEMENTATION | `PlayerProfile.avatarUrl`; profile URL input; team-only multipart upload | Profile image is an optional URL, not an uploaded/validated selfie; no player image storage endpoint. |
| 2.3 | Registration | Mandatory versioned legal/participation/POPIA acceptance | 🔴 NOT IMPLEMENTED | No routes, fields, pages, or schemas found | No checkbox, legal documents, version, timestamp, or acceptance record. |
| 2.4 | Registration | Date of birth and server-enforced 18+ rule | 🔴 NOT IMPLEMENTED | Registration schema and `PlayerProfile` have no DOB | No frontend field, API validation, persistence, or age policy. |
| 2.5 | Registration | Years of soccer experience | 🔴 NOT IMPLEMENTED | No matching schema/model/UI | Field, validation, storage, and display are absent. |
| 2.6 | Registration | Email or SMS account verification | 🔴 NOT IMPLEMENTED | Auth routes are register/login/logout only | No verified status, verification token/OTP, expiry, resend, email, or SMS integration. Admin TOTP is unrelated. |
| 2.7 | Registration | User city | 🔵 DIFFERENT IMPLEMENTATION | Optional free-text `PlayerProfile.homeArea` is editable after signup | No structured/validated city and no registration field or supported-city relation. |
| 2.8 | Registration | Unsupported-city waiting list | 🔴 NOT IMPLEMENTED | No model, endpoint, UI, or notification | Requires a separate city-interest/wait-list concept; a user flag would lose multi-city interest/history. |
| 3.1 | Profile | Clear self-profile navigation and editing | 🟡 PARTIALLY IMPLEMENTED | `/players/:userId`, `PlayerProfilePage`, `PATCH /players/me/profile` | Edit/save works for self, but header/user menu contains no My Profile link; users must reach their own card or know the URL. |
| 3.2 | Profile | Display match statistics supported by current data | 🟡 PARTIALLY IMPLEMENTED | Participants, results, scorers, teams, memberships exist | No statistics query/DTO/UI. Matches, W/D/L and goals are derivable; assists, ratings, POTM, attendance, and captaincy history are not modeled. |
| 4.1 | Wallet | Accessible wallet balance | ✅ IMPLEMENTED | `WalletAccount`; authenticated-user mapper; header balance | Balance is database-backed and visible globally. There is no dedicated wallet page, but the stated accessibility requirement is met. |
| 4.2 | Wallet | User-visible transaction history | 🟡 PARTIALLY IMPLEMENTED | Individual `WalletTransaction` records and types exist | No list endpoint, hook, page, or navigation; team contributions and external refunds are not represented as requested. |
| 4.3 | Wallet | Flexible valid-amount top-ups | 🔵 DIFFERENT IMPLEMENTATION | `POST /wallet/deposits/demo`; `DEMO_DEPOSIT_CENTS=50000` | UI/API always add R500; no amount input/rules and only a demo auto-success operator. Service internals accept an amount but route does not. |
| 5.1 | Payments | Venue costs and eventual venue payout/settlement model | 🟡 PARTIALLY IMPLEMENTED | Effective-dated `ManagedFieldPrice`; booking price snapshots | Required venue names/prices are not seeded; no venue payee/account, payable, payout, settlement status, or reconciliation to manual venue payments. |
| 5.2 | Payments | Lower-priority escrow-like hold/refund flow | 🟡 PARTIALLY IMPLEMENTED | `WalletHold`, booking obligations/contributions, hold expiry/release/capture, match credits | Useful hold/reversal foundation exists only for field booking/personal wallets; no host-team/opponent challenge escrow or external refund flow. |
| 6.1 | Matchmaking | Remove maximum-price filtering | 🔵 DIFFERENT IMPLEMENTATION | `MatchListPage` maximum-price input; discovery `maxPriceCents` | The explicitly unwanted filter remains end-to-end. |
| 6.2 | Matchmaking | Remove Find Nearby for now | 🔵 DIFFERENT IMPLEMENTATION | `MatchListPage` geolocation button; lat/lng/radius query | The explicitly unwanted feature remains enabled. |
| 6.3 | Match creation | Use real venue names | 🔵 DIFFERENT IMPLEMENTATION | `features/matches/constants/fields.ts` | Quick/team match forms offer Green Point Arena, Riverside Football Park, and City Five Sports Ground; managed catalogue is not used. |
| 6.4 | Match creation | Fixed R80 normal player entry fee | 🔵 DIFFERENT IMPLEMENTATION | Editable fee in `CreateMatchPage`; schema allows 0-R10,000; `MATCH_FEE_CENTS=8000` unused for enforcement | Creators can set arbitrary/free fees; stored value drives display and debit. |
| 7.1 | Formation | Clearly separate Team A and Team B formations | 🟡 PARTIALLY IMPLEMENTED | HOME/AWAY slots, colors, separate roster panels | Both teams share one pitch surface; labels are Home/Away rather than independent pitch views. Distinction exists but is weaker than requested. |
| 7.2 | Formation | Joining player clicks and claims a tactical position | 🔵 DIFFERENT IMPLEMENTATION | Join creates reserve; `FormationBoard` editable only by host; backend `assertManager` | Quick-match players cannot claim a slot. Open self-claim exists only in the separate team-fixture lineup system. |
| 7.3 | Formation | Responsive, non-glitchy drag-and-drop | ⚪ NOT VERIFIABLE | Custom pointer handlers, optimistic local slots, per-drop API mutation, socket invalidation | Feature exists and tests basic interactions, but no profiling/latency test. Prop resync and broad invalidation are plausible jitter sources; reported delay cannot be proved statically. |
| 7.4 | Formation | Names/avatars in positions; reserves separate | 🟡 PARTIALLY IMPLEMENTED | Slots reference participants/users; pitch markers render avatars; reserve list renders avatar/name | Player association and reserves work, but names are not visibly rendered inside pitch markers (only avatar/accessible label). |
| 8.1 | Captain loading | Host captain loads existing squad before public posting, with carried positions/payment | 🟡 PARTIALLY IMPLEMENTED | Team page creates a fixture and copies matching saved formation into HOME slots | It creates a private free team fixture, not a public post; only assigned starters carry over; there is no team payment. |
| 8.2 | Captain loading | Challenging captain loads an away team | 🟡 PARTIALLY IMPLEMENTED | `MatchTeam` models HOME/AWAY and manager roles | No challenge/accept endpoint, challenger workflow, away-team attachment, or payment. Schema foundation alone is not an end-to-end feature. |
| 9 | Sharing | Public/WhatsApp link with unauthenticated preview, auth, return, and join | 🟡 PARTIALLY IMPLEMENTED | Private invite token/rotation/copy; normal lobby UUID; team invite preserves `returnTo` | No public-match share button, Web Share/WhatsApp URL, slug/short link, or anonymous preview. Quick-match auth return is broken by state/query mismatch. |
| 10.1 | Teams | Team short name max 4 characters | 🔵 DIFFERENT IMPLEMENTATION | Shared schema max 12; UI maxLength 12; DB unconstrained | All enforced application layers permit 12 and database has no length check. |
| 10.2 | Teams | Dynamic 5/7/11 formats and formations | ✅ IMPLEMENTED | Shared format config/presets; team create/edit; saved per-format formations | UI, schemas, API, persistence, and tests cover all three formats. |
| 10.3 | Teams | Shared team wallet, contributions, captain payment, refunds/audit | 🔴 NOT IMPLEMENTED | No team-wallet relation/model/routes/UI | Personal booking contributions are not a team wallet. |
| 10.4 | Teams | Team tactical formation with members and separate reserves | ✅ IMPLEMENTED | `TeamFormationEditor`; `TeamFormation`/slots; role-protected APIs | Members can be assigned to visible pitch slots; unassigned squad remains separate; formats adapt. |
| 10.5 | Teams | Persistent authorized team chat lobby | 🔵 DIFFERENT IMPLEMENTATION | Match-lobby chat works for attached team fixtures | Chat is scoped to each match, not the team; no `TeamMessage`, team room/history, or team-level chat UI. |
| 11 | Social | Replace Messages concept with broader Social area while retaining DMs | 🔴 NOT IMPLEMENTED | Navigation and page remain `Messages` | No Social shell/routes/navigation. |
| 11.1 | Social | Add/remove/view friends, requests, blocking | 🔴 NOT IMPLEMENTED | No friendship/block model/API/UI | Entire relationship lifecycle is absent. |
| 11.2 | Social | Use relationships to join/invite/find teams | 🟡 PARTIALLY IMPLEMENTED | Token team invites and membership acceptance exist | Invites are link-based, not friend/contact based; no connection discovery or friend picker. |
| 11.3 | Social | Keep direct messages functional | ✅ IMPLEMENTED | Conversation APIs, persisted messages/read state, Socket.IO events, `MessagesPage` | Function works under current Messages area; moving it under Social is not done. |
| 12.1 | Post-match | Host captain submits; opposing captain confirms | 🔵 DIFFERENT IMPLEMENTATION | Manager submits result after timer; repository immediately completes match and records revision | No pending confirmation/opponent approval. Admin dispute correction exists but is not confirmation. |
| 12.2 | Post-match | Opposing-team 1-5 rating | 🔴 NOT IMPLEMENTED | No rating/review model or UI | No author/target/match relation, constraints, API, or display. |
| 12.3 | Post-match | Conduct/sportsmanship reviews and team review section | 🔴 NOT IMPLEMENTED | No review model/API/UI | Moderation reports/disputes are operational tools, not public team reviews. |
| 13 | Match rules | All matches last 60 minutes | 🔵 DIFFERENT IMPLEMENTATION | Environment defaults and README are 90; duration persisted and shown | All three runtime defaults are 90. Historical migration default and several smoke fixtures also assume 90. |
| 14 | QR | Website/match/venue/referral QR codes | 🔴 NOT IMPLEMENTED | No QR library, generator, route, or UI found | No meaningful implementation. |
| 15 | Legal | About / Legal Disclosures and separate legal publication locations | 🔴 NOT IMPLEMENTED | No matching routes/pages/content | No company disclosure surface, code of conduct, service/pricing explanation, Terms, or Privacy/POPIA pages. |
| 16-A | Cross-system | Authentication capabilities | 🟡 PARTIALLY IMPLEMENTED | Argon2 login/register, JWT+DB sessions, secure cookie, logout, protected routes | No refresh-token endpoint, password reset, user verification; protected-match return path is broken. |
| 16-B | Cross-system | Server-side authorization for user/captain/owner/host/challenger/admin | 🟡 PARTIALLY IMPLEMENTED | `requireAuth`, team roles, host/manager assertions, platform admin+MFA | Existing roles are strongly protected, but challenger does not exist; team-fixture manager checks are match-wide rather than explicitly side-scoped. |
| 16-C | Cross-system | Notifications supporting relevant workflows | 🟡 PARTIALLY IMPLEMENTED | Persisted/read/realtime notification system with match, wallet, message, team-lineup, booking and support types | No friends, challenge, confirmation, reviews, reminders, external refund, or team-wallet events; some enum types have no clear producer. |
| 16-D | Cross-system | Required domain entity coverage and relationships | 🟡 PARTIALLY IMPLEMENTED | Rich user/profile/team/match/venue/booking/wallet/message/notification schema | Missing Friendship, concrete/generated VenueSlot, TeamWallet, generic provider Payment/Refund, Review, and a position catalogue/history model. |

## 3. Detailed audit

### 3.1 Home, venues, cities, and upcoming matches

#### Current implementation

`HomePage` is an authenticated hero plus a database-driven "Meet the players" grid. It does not query or render venues or matches. Match discovery is a separate authenticated page with format/date/price/availability/geolocation filters. The backend query correctly limits discovery to quick games that are public, future, non-cancelled/non-completed, and operationally open; the service can remove full matches and sort by kickoff or distance/price.

There are two venue concepts:

1. `Venue` is a historical match snapshot-like record used by `Match`.
2. `ManagedVenue` -> `ManagedField` is the operational catalogue, including supported formats, recurring weekly availability, exceptions, effective-dated prices, and reservations.

The booking service validates a submitted datetime in the venue timezone, calculates end time, checks supported format, weekly availability/exceptions, resolves price, and relies on a PostgreSQL exclusion constraint to prevent overlapping active reservations. The player UI exposes catalogue fields but asks for a raw date/time. It does not calculate/render bookable slots.

#### Evidence

- Frontend: `apps/web/src/features/users/pages/HomePage.tsx:6-80`; `apps/web/src/features/matches/pages/MatchListPage.tsx:10-113`; `apps/web/src/features/matches/components/MatchCard.tsx`; `apps/web/src/features/bookings/pages/BookingsPage.tsx`; `apps/web/src/features/matches/constants/fields.ts:12-46`.
- API path: `useMatches` -> `packages/api-client/src/matches.ts` -> `GET /matches` -> `matches.controller.list` -> `MatchesService.list` -> `MatchesRepository.listPublic`.
- Booking path: `BookingsPage` -> `packages/api-client/src/bookings.ts` -> `GET /bookings/fields` / `POST /bookings` -> `BookingsService` -> managed-field/reservation records.
- Backend: `apps/api/src/modules/matches/matches.repository.ts:48-78`; `apps/api/src/modules/bookings/bookings.routes.ts`; `apps/api/src/modules/bookings/bookings.service.ts:21-146`; `apps/api/src/modules/admin/admin.routes.ts:27-47`.
- Data/migrations: `apps/api/prisma/schema.prisma:501-586`, `685-804`; migrations `20260824170000_managed_fields_pricing` and `20260825020000_field_reservations_funding`.
- Tests: `apps/api/src/modules/bookings/bookings.service.test.ts`; `apps/api/src/modules/admin/admin-catalog.service.test.ts`; `packages/api-client/src/bookings.test.ts`; smoke scripts `smoke-admin-catalog.ts` and `smoke-field-bookings.ts` (not executed in this audit).

#### Expected behaviour and gap

Home should lead with real venue listings, venue imagery, prices/formats, city messaging, and navigation into an availability calendar, followed by upcoming public matches needing players. None of those sections are on home. `ManagedVenue` has no image field, the player API has no generated availability-slot endpoint, and the repo has no committed seed containing Queens Park, Cape Town City FC, or Italian Club. Those names do not occur in application code/data; ordinary match forms instead hardcode Green Point Arena, Riverside Football Park, and City Five Sports Ground.

City exists on managed/historical venues and coordinates support nearby search. User profiles only have free-text `homeArea`; there is no supported-city catalogue, coming-soon presentation, or interest/wait-list record.

#### Dependencies

Venue content/seed policy -> optional venue media fields/storage -> slot-generation query -> venue detail/calendar route -> home venue and upcoming-match composition. Structured user city and supported-city policy should precede waiting-list UX.

#### Risk

Medium. The catalogue/reservation foundation is strong, but unifying the legacy match venue snapshots with managed fields without damaging historical matches requires deliberate mapping.

### 3.2 Registration and account onboarding

#### Current implementation

Registration collects email, username, optional first/last name, password, and password confirmation. Backend registration validates the shared schema, checks uniqueness, hashes with Argon2id, creates `User`, a minimal `PlayerProfile`, and a `WalletAccount`, then creates a revocable database-backed JWT session in an HTTP-only cookie.

Football positions already exist as a shared enum and `PlayerPreferredPosition` rows, but they are only editable later on the profile page. The profile image is an optional URL. Team images demonstrate a working multipart/local-storage pattern, but it is not available for player photos.

#### Evidence

- Frontend: `apps/web/src/features/auth/pages/RegisterPage.tsx:13-206`; `apps/web/src/features/users/pages/PlayerProfilePage.tsx:20-190`.
- Contracts: `packages/shared/src/schemas/auth.ts:37-63`; `packages/shared/src/schemas/profile.ts`; football positions in shared user types/config.
- API: `POST /auth/register`; `apps/api/src/modules/auth/auth.controller.ts`; `AuthService.register`; `UsersRepository.create`; `PATCH /players/me/profile`.
- Data: `User`, `PlayerProfile`, `PlayerPreferredPosition`, and `WalletAccount` in `apps/api/prisma/schema.prisma:292-670`.
- Upload comparison: `apps/api/src/modules/teams/teams.routes.ts` and `team-image.storage.ts` accept PNG/JPEG/WEBP with a byte limit, but only for teams.
- Tests: `packages/shared/src/schemas/auth.test.ts`; `apps/api/src/modules/auth/auth.service.test.ts`; `apps/api/src/modules/teams/team-image.storage.test.ts`. No tests cover DOB/age, consent, player image upload, experience, city, verification, or waiting list because those features do not exist.

#### Expected behaviour and gap

The required onboarding needs positions, a validated selfie upload, versioned mandatory legal consent, DOB with server-side 18+ enforcement, years of experience, verified email/SMS, structured city, and an unsupported-city waiting-list decision. None is in the register DTO or transaction. `homeArea` and `avatarUrl` are materially different substitutes, not compliant implementations.

A waiting list should be modeled separately (for example `CityInterest`/`WaitingListEntry`) rather than as a boolean on `User`: it needs requested city, contact/account identity, status, consent/source, timestamps, and potentially multiple interests without polluting active player profiles.

#### Dependencies

Legal document/version model and publication pages; supported-city model/policy; player media storage/security; verification provider choice and token lifecycle. These must be designed before making registration transactional because partial account creation and retry behavior matter.

#### Risk

High. Age/legal/POPIA evidence, identity media, and verification introduce sensitive personal data, retention/security rules, asynchronous provider delivery, and migration/backfill choices.

### 3.3 Profile and statistics

#### Current implementation

Public profiles can be read through `GET /players/:userId`; authenticated users can update only their own profile through `PATCH /players/me/profile`. `PlayerProfilePage` switches to an edit form when the route user is the authenticated user and persists display name, avatar URL, bio, dominant foot, home area, and preferred positions.

The profile is routed but not linked as "My Profile" in `Layout` or `UserMenu`. Users can reach other profiles from player/match cards; reaching their own profile depends on encountering their own card or manually navigating.

The data model can derive matches played from `MatchParticipant`, W/D/L from completed `MatchResult` plus participant side, and goals from `MatchScorer`. Current team membership is already returned on public users. It cannot faithfully derive assists, ratings, player of the match, attendance, or historical captaincy.

#### Evidence

- Frontend: `apps/web/src/features/users/pages/PlayerProfilePage.tsx`; `apps/web/src/components/Layout.tsx`; `apps/web/src/components/UserMenu.tsx`.
- API: `apps/api/src/modules/profiles/profiles.routes.ts`; `profiles.controller.ts`; `UsersService.updateMyProfile`; `UsersRepository.updateProfile`.
- Data: `PlayerProfile`, `PlayerPreferredPosition`, `MatchParticipant`, `MatchResult`, `MatchScorer`, `TeamMembership`.
- Tests: only `UserCard.test.tsx`; there is no profile-edit or statistics test.

#### Expected behaviour and gap

Add a clear self-profile entry point and a statistics read model/query. Any UI must label only supportable metrics; new metrics require their own capture semantics rather than inference.

#### Dependencies

Navigation is independent. Statistics depend on agreeing whether cancelled/no-show matches count and whether team role history must be retained.

#### Risk

Low for navigation/basic derived stats; medium if historical attendance/captaincy or ratings are added.

### 3.4 Wallet, payments, venue money, and escrow

#### Current implementation

Every registered user gets a ZAR `WalletAccount`. The header balance comes from `GET /users/me` through `toAuthenticatedUser`. `WalletTransaction` is an individual immutable-style ledger with reference types/IDs; `WalletHold` represents reserved personal funds. Quick-match join atomically debits the stored `match.feeCents`, creates an idempotent `MatchPayment`, and adds the participant. Cancellation/replacement flows can credit the user.

The only player deposit route is `POST /wallet/deposits/demo`. The controller always passes `DEMO_DEPOSIT_CENTS` (50,000 cents), and the UI has no amount form. `DepositsService` has useful idempotency and pending/succeeded/failed semantics behind a `PaymentOperator`, but the active `DemoPaymentOperator` returns success without a provider or webhook.

Field bookings use a more escrow-like model: each reservation has a price snapshot and funding deadline; obligations can receive personal-wallet contributions backed by holds; exact funding captures the holds and confirms the reservation; expiry releases them. This is not a shared team balance and does not settle money to a venue.

#### Evidence

- Frontend: header wallet in `apps/web/src/components/Layout.tsx:18-84`; `JoinTeamDialog.tsx`; `features/wallet/hooks/useWallet.ts`; booking contribution UI in `BookingsPage.tsx`.
- API: `POST /wallet/deposits/demo`; `wallet.controller.ts`; `DepositsService`; `DemoPaymentOperator`; match join/leave/cancellation methods; booking contribution methods.
- Data: `WalletAccount`, `WalletTransaction`, `WalletHold`, `MatchPayment`, `FieldReservation`, `FundingObligation`, `FundingContribution` in `schema.prisma:610-804,923-945`.
- Pricing: `ManagedFieldPrice` and `FieldReservation.priceCentsSnapshot`; admin catalogue endpoints and `VenuesPage`.
- Tests: `deposits.service.test.ts`, `matches.service.test.ts`, `bookings.service.test.ts`, `notification-writer.test.ts`; database smoke scripts for financial integrity/bookings were not executed.

#### Expected behaviour and gap

Users need arbitrary valid top-up amounts and transaction history. Neither endpoint/UI exists. A production payment provider, credentials/webhooks, limits, chargeback/refund mapping, and reconciliation are absent.

Venue prices are generic database configuration. The required amounts (Italian Club R800/R500/R600; Queens Park R1000; Cape Town City R1000) appear only coincidentally in test fixtures, not as production venue records. There is no venue beneficiary, bank/payout destination, payable, manual-settlement record, settlement status, or venue-facing ledger.

Team wallets do not exist. Booking contributions are tied to a reservation and individual holds, so they cannot be treated as a reusable team balance. Extending holds to challenge escrow is feasible but requires team ownership, authorized spend, acceptance state, allocation/refund rules, and accounting invariants.

#### Dependencies

Provider decision -> flexible deposit contract -> transaction-history read API/UI. Venue identity/prices -> payable/settlement model -> operational workflow. Team wallet -> contribution ledger -> captain spend authorization -> challenge funding -> cancellation/refund rules.

#### Risk

High. Financial changes affect atomicity, idempotency, immutable ledgers, concurrency, authorization, reconciliation, and external-provider state.

### 3.5 Match discovery, creation, fees, and duration

#### Current implementation

Public/private quick matches and private team fixtures exist. Public discovery supports date, format, maximum price, available capacity, and optional geospatial sorting/filtering. Match creation chooses a hardcoded field, visibility, format, team/substitute capacities, rules, kickoff, and an editable entry fee defaulted to R80. Backend validation allows 0 to 1,000,000 cents and stores exactly what the creator sends. The constant `MATCH_FEE_CENTS=8000` is not used to enforce creation.

Duration is selected server-side from three environment values. All defaults are 90 minutes, and the README tells operators to configure 90. The persisted duration drives lobby display, end-time/result readiness, chat lifetime, booking end times, and schedulers, so changing only display text would be incorrect.

#### Evidence

- Frontend: `MatchListPage.tsx:10-113`; `CreateMatchPage.tsx:20-302`; `CreateTeamMatchPage.tsx`; `constants/fields.ts`; `MatchLobbyPage.tsx:144-145`.
- Contracts/API: `packages/shared/src/schemas/match.ts:20-135`; `GET/POST /matches`; `MatchesService`; `MatchesRepository`; `TeamsService.createMatch`.
- Constants/config: `packages/shared/src/types/wallet.ts`; `apps/api/src/config/env.ts:31-33`; `README.md:53-55`.
- Data: `Match.venueId`, `format`, `visibility`, `startsAt`, `durationMinutes`, `feeCents`, `status`; historical `Venue`.
- Tests: shared match schemas/lifecycle; API match service; create-match and create-team-match components. Tests validate configurability, not the new fixed rules.

#### Expected behaviour and gap

Remove max-price/nearby controls, use the managed real venue catalogue, enforce R80 for normal player matches server-side, and set all three duration defaults/policies to 60. Decide whether historical/custom formats or admin exceptions are allowed before turning product rules into database constraints.

Relevant 90-minute assumptions:

- Runtime defaults: `apps/api/src/config/env.ts:31-33`.
- Operator documentation: `README.md:53-55`.
- Historical database default: `apps/api/prisma/migrations/20260811100000_master_domain_foundation/migration.sql:71`.
- Test fixtures: `packages/shared/src/utils/match-lifecycle.test.ts:8,20`; `apps/api/src/modules/teams/teams.service.test.ts:157`; `smoke-security-sessions.ts:78`; `smoke-team-match.ts:85,91,101`; `smoke-team-match-availability.ts:64,68,188`; `smoke-team-match-ui.ts:74`; `smoke-team-match-lineup.ts:117,140,330,358`. These last locations are test-only but will encode stale expectations.

#### Dependencies

Managed-field selection and available-slot flow should replace the hardcoded field constant before venue names are removed. Fee/duration policies should be centralized in shared/server configuration and covered by API tests.

#### Risk

Medium. Fee/duration changes are small in code but affect existing records, bookings, cancellation quotes, capacity/payment assumptions, and operator configuration.

### 3.6 Match formation and position selection

#### Current implementation

Quick matches create format-sized HOME/AWAY `FormationSlot` rows. A participant joins a chosen side and is intentionally left off-pitch: the join dialog says the organiser assigns slots. The lobby sends slot changes through `PATCH /matches/:id/formation/slots/:slotId`; `MatchesService.updateFormation` calls `assertManager`, which allows only the quick-match creator. Socket event `formation:updated` is shared between server/client and triggers cache refresh, so event names align.

The board uses custom pointer events. It keeps `localSlots` for optimistic assignment/movement, updates pointer coordinates during drag, and performs a mutation on drop. A prop-change effect replaces local slots whenever server/query data changes. The common lobby mutation invalidates several queries, causing refetches after each write. These are plausible contributors to visual snapping or delayed feedback, but no runtime performance evidence was captured.

HOME and AWAY are color-coded and rostered separately, but their slots are plotted on one pitch. Slot markers contain avatars; visible names are in reserve/roster lists rather than inside the markers.

The team-fixture subsystem is different: captains can open lineup slots, eligible team members can claim them, and the server persists/broadcasts the change. That capability is not reused by quick/public matches.

#### Evidence

- Frontend: `JoinTeamDialog.tsx:64`; `MatchLobbyPage.tsx:230-318`; `components/formation/FormationBoard.tsx:51-291`; `TeamMatchDayLobby.tsx:245-437`; `useMatches.ts`; `useTeamMatchDay.ts`.
- API: quick formation route in `matches.routes.ts`; `MatchesService.updateFormation:258-283`; repository update transaction; team lineup open/claim routes and `MatchLineupService`/repository.
- Realtime: shared `packages/shared/src/constants/socket-events.ts`; `apps/api/src/socket/create-socket-server.ts`; `apps/web/src/features/chat/hooks/useMatchSocket.ts`.
- Data: `MatchParticipant`, `FormationSlot`, `TeamMatchSelection`, `TeamMatchLineupSlot`.
- Tests: `FormationBoard.test.tsx` (two basic tests), `matches.service.test.ts`, `match-lineup.service.test.ts` (16 tests), `TeamMatchDayLobby.test.tsx`; unexecuted database lineup smokes.

#### Expected behaviour and gap

Quick/public match participants should claim available positions directly and see two clearly independent formations with names/avatars in markers. The server needs a self-claim authorization path distinct from organiser reassignment and concurrency handling for simultaneous claims. Reusing team-lineup concepts must account for quick-match participants not being team members.

#### Dependencies

Define quick-match claim rules and conflict response -> API transaction/authorization -> client claim affordance -> realtime optimistic reconciliation -> performance instrumentation.

#### Risk

High. Concurrent claims, displacement, role boundaries, optimistic state, and socket/query races can corrupt or confuse the visible lineup if changed piecemeal.

### 3.7 Captain team loading, teams, and team chat

#### Current implementation

Teams have owners/captains/members, token invites, profile images, 5/7/11 supported formats, and one saved formation per format. Owner/captain APIs assign memberships to saved slots. `TeamFormationEditor` visualizes assigned players on a pitch with unassigned squad members separately.

An owner/captain can create a team fixture from a team page. Creation attaches that team as HOME, creates a private/free `TEAM_MATCH`, and copies saved formation assignments for the selected format into match-day lineup selections/slots. The match-day lobby includes availability, lineup, and match chat tabs; captains can select/open/finalize positions and members can claim open positions.

The model anticipates HOME/AWAY `MatchTeam` rows, but creation adds only HOME. No challenge, acceptance, or attach-away-team route/service exists. The UI explicitly describes the fixture as private, free, and not charging a personal or team wallet.

Team chat does not exist independently. `LobbyMessage` belongs to a `Match`; access is granted to participants/attached team memberships and is available for the fixture. A team with no fixture has no chat room/history.

#### Evidence

- Frontend: `MyTeamsPage`, `CreateTeamPage`, `TeamPage`, `TeamInvitePage`, `TeamFormationEditor`, `CreateTeamMatchPage`, `TeamMatchDayLobby`.
- API: `apps/api/src/modules/teams/teams.routes.ts`; `TeamsService`; `TeamsRepository`; team match-day routes in `matches.routes.ts`; `MatchAvailabilityService`; `MatchLineupService`; `ChatService`/gateway.
- Data: `Team`, `TeamMembership`, `TeamInvite`, `TeamFormation`, `TeamFormationSlot`, `MatchTeam`, `TeamMatchAvailability`, `TeamMatchSelection`, `TeamMatchLineupSlot`, `LobbyMessage`.
- Validation: `packages/shared/src/schemas/team.ts:19` permits 12-character short names; team form also uses 12; DB is unconstrained.
- Tests: strong service/component coverage including `teams.service.test.ts`, `TeamFormationEditor.test.tsx`, team-page/invite/create tests, availability/lineup service tests, match-day component test, chat tests, and several unexecuted DB smoke scripts.

#### Expected behaviour and gap

The host flow needs to transition from private planning into a public team-vs-team post with payment. The challenger needs discovery/challenge/acceptance, away-side attachment, squad/formation copy, and side-scoped management. A reusable team wallet must precede one-payment team participation. Team chat needs a team-owned message model/room independent of match lobbies. Short-name validation must be 4 at shared, UI, server, and preferably database levels.

#### Dependencies

Team wallet and challenge state machine are independent foundations, then converge at funded acceptance. Side-scoped authorization should be defined before away-team mutations. Team chat can be built separately using existing messaging/socket patterns.

#### Risk

High for challenges/payment/permissions; medium for persistent team chat; low for short-name validation.

### 3.8 Match sharing and onboarding

#### Current implementation

Quick-match hosts can rotate/copy a private invitation URL. `GET /matches/invite/:token` resolves the hashed token, but all `/matches` routes are mounted behind `requireAuth`. The corresponding web invite page is inside `ProtectedRoute`. Public matches have ordinary authenticated UUID lobby routes but no share control, share copy, short slug, redirect route, Web Share API, or WhatsApp deep link.

`ProtectedRoute` redirects to `/login` with `{ state: { from: pathname } }`. `LoginPage` and `RegisterPage` ignore that state and read only `?returnTo=`. Consequently a logged-out match recipient authenticates and lands at `/`. By contrast, public team invite pages explicitly create the `returnTo` query and are tested.

#### Evidence

- Frontend: `apps/web/src/app/router/AppRouter.tsx:29-65`; `ProtectedRoute.tsx:5-11`; `LoginPage.tsx:16-26`; `RegisterPage.tsx:25-44`; `MatchLobbyPage.tsx:105-116`; `InviteMatchPage.tsx`; `TeamInvitePage.tsx`.
- API: `apps/api/src/app.ts` mounts `/matches` after `requireAuth`; `matches.routes.ts` invite routes; invite-token hashing service; `/team-invites/:token` is public for inspection.
- Data: quick match invitation hash/expiry fields; no slug/short-link table.
- Tests: `invite-token.test.ts`; `TeamInvitePage.test.tsx` verifies return preservation; `ProtectedRoute.test.tsx` does not cover successful return; no public-match sharing E2E.

#### Expected behaviour and gap

Every public match needs a stable share target, preview policy, WhatsApp/Web Share payload, authentication continuation, and post-auth join path. The current private-copy feature is useful groundwork but does not satisfy the public onboarding requirement and its unauthenticated continuation is broken.

#### Dependencies

Choose public preview data/privacy -> stable slug/token scheme -> public resolver/API -> canonical `returnTo` handling -> share UI/copy -> E2E coverage.

#### Risk

Medium. The implementation is bounded, but open redirects, token leakage, private-match disclosure, capacity races, and attribution/analytics need care.

### 3.9 Social and direct messages

#### Current implementation

Authenticated users can start one-to-one conversations, list them, fetch messages, send, mark read, receive persisted notifications, and refresh on shared Socket.IO `direct-message:created` events. Repository authorization checks conversation membership. Navigation calls this area Messages.

There is no Friendship/FriendRequest/Block entity or API. Team invitations are revocable token links; they do not target or depend on a social relationship.

#### Evidence

- Frontend: `apps/web/src/features/messaging/pages/MessagesPage.tsx`; messaging hooks; `Layout.tsx`; `UserMenu.tsx`.
- API: `/conversations` routes; `MessagingService`/repository; socket server handlers.
- Data: `Conversation`, `ConversationParticipant`, `DirectMessage`, `Notification`.
- Tests: `messaging.service.test.ts`, `packages/api-client/src/client.test.ts`, notification tests, and the unexecuted E2E DM path.

#### Expected behaviour and gap

A Social shell must contain DMs plus friend discovery/request/accept/remove/block and connection-assisted team invites. DMs are the reusable implemented module; friendship is entirely new.

#### Dependencies

Friendship semantics/privacy/blocking -> model and atomic transitions -> notifications -> Social navigation/UI -> team friend picker.

#### Risk

Medium. Blocking must be enforced in messaging, invitations, discovery, and notifications, not only hidden in UI.

### 3.10 Post-match results, ratings, and reviews

#### Current implementation

Once the computed match end passes, the effective status becomes `AWAITING_RESULT`. A quick host or any owner/captain attached to a team fixture can submit score/scorers. The server validates scorer participation/totals, creates `MatchResult` plus an initial `MatchResultRevision`, immediately marks the match `COMPLETED`, emits `match:result-submitted`, and notifies participants. Disputes can lead to admin-reviewed result corrections and revision history.

No opposing-captain confirmation state, rating, or review exists. Moderation reports and disputes should not be conflated with public sportsmanship reviews.

#### Evidence

- Frontend: `MatchLobbyPage.tsx:317-337`; `ResultForm.tsx`; disputes pages.
- API: `POST /matches/:id/result`; `MatchesService.submitResult:317-346`; `MatchesRepository.submitResult:659-720`; dispute services/admin UI.
- Data: `MatchResult`, `MatchResultRevision`, `MatchScorer`, `Dispute`; no review/rating entities.
- Tests: result assertions in `matches.service.test.ts`; dispute schema/service smoke coverage; no confirmation/rating/review tests.

#### Expected behaviour and gap

Team-vs-team matches need a pending result submitted by the host side, confirmation/rejection by an authorized opposing captain, finalization rules, timeout/escalation, and dispute interaction. Ratings/reviews require author, target team, match, stars/comment, visibility/moderation, and one-review-per-author/match/target constraints.

#### Dependencies

Away-team/challenge and side-scoped captain identity must exist first. Then add result proposal/confirmation states; reviews should unlock only after a finalized eligible match.

#### Risk

High. This changes the match state machine, authorization, notifications, revision/dispute semantics, and historical-result compatibility.

### 3.11 QR and legal publication

#### Current implementation

No QR generator/library, QR endpoint, rendered code, download, or scan-target route exists. No About, Terms, Privacy/POPIA, Code of Conduct, or Legal Disclosures route/page exists in the web application.

#### Evidence

- Router: `apps/web/src/app/router/AppRouter.tsx` contains no legal/about/QR route.
- Repository search found no application QR implementation or required company disclosure content.
- Tests: none.

#### Expected behaviour and gap

The app needs publication locations for factual company/service/pricing/venue disclosures and versioned legal documents; legal wording and company facts must come from the business/legal owner. QR support should follow stable canonical URLs, particularly the public match-share URL.

#### Dependencies

Legal content ownership and version policy. Canonical production URL and share routing before match/venue QR generation.

#### Risk

Low technically for static publication; high compliance impact if content is inaccurate. QR generation itself is low risk after URLs stabilize.

### 3.12 Cross-system authentication and authorization

#### Current implementation

Auth supports register, login by email/username, Argon2id password hashing, JWTs containing user/session IDs, persisted `AuthSession` records, HTTP-only SameSite=Lax cookies, last-seen updates, expiry/revocation, logout, account suspension/ban enforcement, mutation origin protection, rate limits, and authenticated sockets. There is no refresh-token route; the session token defaults to seven days. Password reset and user verification are absent.

All sensitive player modules are protected server-side at mount level. Quick-match mutations use host/participant checks. Team mutations use OWNER/CAPTAIN/MEMBER roles, with owner-only settings/member administration where appropriate. Platform admins are a distinct `platformRole` and `/admin` additionally requires recent MFA. "Player" is not a separate platform role; it is the normal user/profile capability. "Challenger" has no representation.

For a future two-sided team match, `MatchesService.assertManager` accepts an owner/captain membership from any attached side for match-global manager actions. That is adequate for collaborative fixture planning today but would need explicit host-side/opponent-side permissions before confirmation, cancellation, result, or payment actions are added.

#### Evidence

- Auth: `auth.routes.ts`, `AuthService`, `TokenService`, `SessionsService`, `require-auth.ts`, `origin-guard.ts`, `rate-limit.ts`, socket setup.
- Authorization: `apps/api/src/app.ts`; `MatchesService.assertManager`; team services/repository assertions; match-lineup `assertManager`; `require-admin.ts`.
- Tests: auth/session/app/rate-limit tests; security and admin smoke scripts are committed but were not run against a database.

#### Expected behaviour and gap

Complete onboarding requires verification and password reset. Share onboarding requires canonical destination preservation. Team-vs-team workflows require a challenger role expressed through side/team relations and operation-specific permissions.

#### Dependencies

Verification/provider design, reset-token security, share route design, and challenge state/roles.

#### Risk

High for account recovery/verification and new captain authority; low for fixing return-path wiring.

### 3.13 Notifications and realtime

#### Current implementation

Notifications are persisted, deduplicated, listed, marked individually/all read, pushed over Socket.IO, and shown globally. Current producers cover deposits, joins, cancellations/replacements, wallet credits, match cancellation/start/result, direct messages, team membership, team-match availability/selection/open/claim/finalization, support replies, bookings, and disputes. Match chat, DMs, formation, participant, result, availability, and lineup events use shared event-name constants between client and server.

#### Evidence

- API: `/notifications`, `/notifications/read-all`, `/notifications/:id/read`; `NotificationsService`; `notification-writer.ts`; socket server.
- Frontend: `NotificationProvider`, `NotificationsMenu`, match/team socket hooks.
- Data/contracts: `Notification` and `NotificationType`; `packages/shared/src/types/notification.ts`; `socket-events.ts`.
- Tests: notification writer/service/provider, messaging/chat, match/lineup/availability tests, atomic-notification smoke script (not executed).

#### Expected behaviour and gap

No producer can exist yet for friend requests, challenges/acceptance, result-awaiting-confirmation, reviews, team-wallet activity, or reminders because those domains are missing. External payment/refund notification semantics are also absent. `MATCH_INVITATION` and `TEAM_UPDATED` are defined but no complete producer path was identified during tracing.

#### Dependencies

Each domain event and transaction boundary should be defined before adding its notification; notifications should publish only after commit.

#### Risk

Medium. Infrastructure is good, but adding notifications outside the same atomic transaction risks false or duplicate user state.

### 3.14 Current data-model relationship overview

```text
User
├─ 1:1 PlayerProfile ── * PlayerPreferredPosition (enum value; no Position table)
├─ 1:1 WalletAccount ── * WalletTransaction
│                    └─ * WalletHold ── 0..1 FundingContribution
├─ * MatchParticipant ── 0..1 FormationSlot / 0..1 MatchPayment
├─ * TeamMembership ── 1 Team
├─ * ConversationParticipant ── 1 Conversation ── * DirectMessage
└─ * Notification

ManagedVenue ── * ManagedField
                 ├─ * ManagedFieldSupportedFormat
                 ├─ * ManagedFieldAvailability (recurring weekly windows)
                 ├─ * ManagedFieldException
                 ├─ * ManagedFieldPrice
                 └─ * FieldReservation ── 1 Match
                                        └─ * FundingObligation ── * FundingContribution

Venue (historical match venue) ── * Match
Match
├─ * MatchParticipant
├─ * FormationSlot
├─ * MatchTeam (HOME/AWAY, Team nullable)
├─ 0..1 MatchResult ── * MatchResultRevision / * MatchScorer
├─ * MatchPayment
├─ * LobbyMessage
└─ 0..1 FieldReservation

Team
├─ * TeamMembership
├─ * TeamInvite
├─ * TeamFormation ── * TeamFormationSlot ── 0..1 TeamMembership
└─ * MatchTeam
```

Concept mapping:

| Required concept | Current representation | Gap |
| --- | --- | --- |
| User | `User` | Exists. |
| Profile | `PlayerProfile` | Exists, but lacks onboarding fields. |
| Team | `Team` | Exists. |
| TeamMember | `TeamMembership` | Exists with OWNER/CAPTAIN/MEMBER. |
| Friendship | None | New model required. |
| Match | `Match` | Exists with QUICK_GAME/TEAM_MATCH. |
| MatchParticipant | `MatchParticipant` | Exists. |
| Formation | `FormationSlot`; `TeamFormation`; match-day lineup slots | Exists in three related contexts; semantics are fragmented. |
| Position | Enum + coordinate slots | No named/catalogued tactical position entity or assignment history. |
| Venue | `Venue` and `ManagedVenue` | Dual model; integration/mapping required. |
| VenueSlot | No concrete/generated slot entity | Availability rules and reservations exist, but no slot read model. |
| Booking | `FieldReservation` | Exists under different name with funding. |
| Wallet | `WalletAccount` | Personal wallet exists. |
| WalletTransaction | `WalletTransaction` | Exists. |
| TeamWallet | None | New financial aggregate required. |
| Payment | `MatchPayment` plus deposit references/contributions | No generic external/provider payment aggregate. |
| Refund | Wallet credit/release transaction states | No explicit external refund entity/lifecycle. |
| Review | None | New model required. |
| Message | `LobbyMessage`, `DirectMessage`, support messages | Exists in scoped variants; no team message. |
| Notification | `Notification` | Exists with persistence/read/dedupe/realtime. |

## 4. Broken / unreachable features

1. **Quick-match invite authentication return is broken.** `ProtectedRoute` writes `location.pathname` to router state; login/register read only a query parameter. A recipient loses the intended match destination after auth.
2. **Self-profile editing is functionally present but poorly reachable.** The profile route and self-edit API work, but no profile link exists in the header/user menu.
3. **Managed venue capability is disconnected from ordinary match creation.** Admin can manage real fields, schedules, exceptions, formats, and prices; players can use them only through the secondary booking screen. Quick/team match forms still import placeholder constants.
4. **Wallet ledger has no user read surface.** Transactions are written and reconciled, but no player transaction-history endpoint or UI calls them.
5. **The fixed R80 constant is dead as a policy.** It exists in shared types, while create schema/UI/repository accept arbitrary fees.
6. **Player photo support is incomplete.** `avatarUrl` is editable, but no upload path exists even though team media upload infrastructure does.
7. **First clean build has undocumented bootstrap coupling.** `npm ci` leaves the default ungenerated Prisma client; API type-check fails broadly until `npm run prisma:generate` is run.
8. **Prisma/Vite commands are sensitive to local execution boundaries.** In the managed sandbox, Vite/Vitest could not load config until run with repository access. This was environmental, not an app failure.
9. **`MatchStatus.FULL` is inconsistent across layers.** Prisma includes `FULL`, shared client status does not, and mapper/service logic converts it to `OPEN` while capacity is calculated separately. This is reachable technical debt and can produce confusing internal queries.
10. **Team-match capabilities stop at private planning.** Rich availability/lineup/open-claim/chat code is reachable, but no path promotes the fixture to public opponent discovery/acceptance/payment.

No client/server Socket.IO event-name mismatch was found: shared constants are used on both sides.

## 5. Frontend <-> backend mismatches

| Mismatch | Frontend | Backend/data | Consequence |
| --- | --- | --- | --- |
| Auth return contract | Login/register read `?returnTo=` | Protected route sends router state | Match link destination is lost. |
| Venue source | Match forms use `BOOKABLE_FIELDS` placeholders | Managed catalogue has real persisted venue/field APIs | Two sources of truth; pricing/availability bypassed. |
| Availability UX | Raw `datetime-local` input | Server has weekly periods/exceptions/reservations | Users cannot browse valid slots and receive validation only after submit. |
| Wallet transactions | Only balance/add-funds shown | Detailed transaction rows exist | Stored financial history is invisible. |
| Deposit amount | No input; R500 labels | Deposit service accepts amount, controller hardcodes R500 | Service capability is unreachable through contract/UI. |
| Match fee policy | Editable R80 default | Shared schema accepts broad range; repository stores input | R80 is a suggestion, not a rule. |
| Quick position claim | Board read-only for joiner | Formation update is manager-only | Joiner is always reserve until organiser acts. |
| Team open claim | Claim button and APIs exist in team fixture | Separate lineup aggregate | Similar capability is not shared with public quick matches. |
| Profile image | URL text box | No player multipart endpoint/storage | Cannot satisfy required selfie upload. |
| Profile statistics | No stats DTO/UI | Some stats derivable from persisted results/scorers | Backend data is unused. |
| Match status | Shared UI omits `FULL` | Prisma enum includes `FULL`; mapper normalizes | Internal status is hidden and relies on computed capacity. |
| Notifications | Enum includes invitation/update cases | No clear writer for every enum case | Contract advertises cases with incomplete lifecycle. |

No stale API-client route mismatch was detected for the currently rendered match, team, booking, messaging, notification, support, moderation, or dispute flows. Shared schemas/types reduce drift substantially.

## 6. Database gaps

| Affected entity | Currently available | Missing concept | Migration required? |
| --- | --- | --- | --- |
| `PlayerProfile` / `User` | display name, avatar URL, bio, dominant foot, home area, preferred positions | DOB, experience years, structured city relation, verification status | Yes. |
| Player media | URL string; team-image storage only | Owned player image metadata/object key, moderation/validation state | Yes if metadata is persisted. |
| Legal acceptance | None | Legal document/version and immutable user acceptance timestamp/source | Yes. |
| Verification/recovery | `AuthSession` only | Verification/reset token digests, expiry/attempt state, verified contact fields | Yes. |
| Supported city/wait list | Venue city strings | City catalogue/support status and city-interest/wait-list entries | Yes. |
| `ManagedVenue` | identity/address/city/timezone/coordinates | Venue images/media and optional public description/slug | Yes. |
| Availability | recurring rules/exceptions/reservations | Optional materialized/generated slot read model | Maybe; slots can initially be computed without persistence. |
| Venue settlement | managed price/reservation snapshots | beneficiary/payee, payable, settlement/payment status and references | Yes. |
| Team wallet | None | account, authorized owners, contribution/spend/refund ledger | Yes. |
| Challenge | HOME/AWAY `MatchTeam` foundation | challenge/offer/acceptance actor, status, expiry, terms, audit timestamps | Yes. |
| Result confirmation | final result/revisions | proposal, required confirmer/side, confirmation/rejection timestamps/status | Yes. |
| Friendship/blocking | None | request and accepted/block relations with uniqueness/state | Yes. |
| Team chat | match-scoped lobby messages | team-scoped conversation/message relation | Yes unless generalized conversations are reused. |
| Reviews | None | author, target team, match, stars, comment, visibility/moderation, uniqueness | Yes. |
| Share links | invite hash only | Public canonical slug/short-link mapping and optional analytics/expiry | Maybe; deterministic slugs could avoid a table but rotation/analytics need one. |
| Refund/provider payment | wallet transaction references | external payment/refund IDs, state, failure reason, webhook/idempotency audit | Yes for real money. |
| Team short name | unconstrained text | maximum length 4 DB guarantee | Recommended yes (constraint) after data cleanup. |

Existing migrations should not be rewritten. All future changes should be additive and account for current records.

## 7. Business-rule conflicts

| Rule | Current code | Conflict |
| --- | --- | --- |
| R80 normal player fee | UI defaults to R80 but is editable; API accepts 0-R10,000 | Creator controls price; `MATCH_FEE_CENTS` is not enforced. |
| Venue costs | Generic effective-dated prices; no production seed | Required venue/rate matrix cannot be verified or selected in normal match creation. |
| 60-minute matches | All three environment defaults and README use 90 | Scheduling, result readiness, chat end, and booking overlap follow 90 by default. |
| Formats 5/7/11 | Fully dynamic format config and formations | No conflict; preserve this implementation. |
| Player vs team payment | Quick match charges each player; team fixture is free | Required captain-paid team participation/team wallet is absent. |
| Captain/host/challenger permissions | Quick host and attached team owners/captains are managers | Challenger role/acceptance absent; future side-specific permissions are undefined. |
| Reserve/position behaviour | Quick join explicitly starts reserve; organiser assigns | Direct player position claim is not allowed. |
| Max price | Search/UI/API support it | Requirement explicitly says remove it. |
| Nearby search | Browser geolocation and radius query exist | Requirement explicitly says remove it for now. |
| Team short name | 12 characters | Requirement is 4. |
| Public sharing | Only private invite copy exists | High-priority public WhatsApp onboarding path is absent/broken after auth. |

### Business-critical hardcoded-value search

Only product-relevant hits are listed; CSS colors, coordinate percentages, time-unit arithmetic, text-length limits, HTTP codes, and unrelated test values are excluded.

| Value | Relevant occurrence | Finding |
| --- | --- | --- |
| `80` / `8_000` | `CreateMatchPage.tsx:44`; `packages/shared/src/types/wallet.ts:3`; match schema/E2E/smoke fixtures | R80 is the UI default and a shared constant, but not a server policy. Tests frequently use it as fixture data. |
| `500` / `50_000` | `DEMO_DEPOSIT_CENTS`; layout/join copy; wallet controller/tests | R500 is hardcoded as the only deposit amount. Other `500` hits are validation/UI timing and not business prices. |
| `600` / `60_000` | `smoke-admin-catalog.ts` uses 60,000 cents as test catalogue data | No committed Italian Club Court A production record maps R600 to 7-a-side. Most `60_000` hits are minute-to-millisecond conversion. |
| `800` / `80_000` | Admin venue form initial value `800`; field-booking/dispute smoke fixtures use 80,000 cents | These are UI/test conveniences, not an Italian Club 11-a-side production configuration. |
| `1000` / `100_000` | Smoke users commonly receive 100,000-cent test balances; `1000` is also millisecond conversion/text limits | No Queens Park or Cape Town City R1000 production venue price was found. |
| `90` | Three API environment defaults, README, old migration default, and team/security smoke fixtures | This is the active default-duration conflict. Latitude bounds, pitch coordinates, and CSS opacity hits are unrelated. |
| `60` | Duration appears in a few tests; runtime uses `60_000` for time arithmetic | There is no 60-minute runtime default. |
| `22` | `MATCH_FORMAT_CONFIG.ELEVEN_A_SIDE.onFieldCapacity`; capacity tests | Correct total starter capacity for 11v11; other `22` hits are formation coordinates/operating time. |
| `5v5`, `7v7`, `11v11` | Shared format configuration, team/match selectors, tests, README | Correct centralized presentation labels backed by typed formats; not problematic hardcoding. |

## 8. Test coverage

Executed on 2026-09-24 after `npm run prisma:generate`:

- `npm run build`: passed; web bundle warns that the main JS chunk is 514.25 kB (>500 kB).
- `npm run lint`: passed (the script is TypeScript type-checking; no ESLint configuration is used).
- `npm test`: passed, 54 test files / 206 tests. Admin has no test files and uses `--passWithNoTests`.
- `npm ci`: succeeded and reported 14 advisories: 8 moderate, 5 high, 1 critical. Details were not queried because that would transmit dependency metadata externally.
- Not run: `e2e/critical-path.spec.ts`, API smoke scripts, migration status, or a live browser/API/database journey. No configured local test database/environment was present.

| Subsystem | Coverage | Evidence and limitation |
| --- | --- | --- |
| Auth/session/security | Good coverage | Auth service, sessions, app middleware, rate-limit tests. No reset/verification/age/legal tests because absent. |
| Shared match schema/lifecycle/formats | Good coverage | 26 schema tests plus lifecycle and formation presets. Current configurability tests do not enforce R80/60 minutes. |
| Quick match service | Partial coverage | 12 service tests and one create-page test; no complete UI join/pay/claim/share flow. |
| Formation drag/drop | Minimal coverage | Two component tests; no latency, socket race, touch-device, or optimistic rollback coverage. |
| Teams and saved formations | Good coverage | Service plus create/page/invite/editor tests. |
| Team match availability/lineup | Good coverage at service level | 12 availability + 16 lineup tests and one lobby navigation test; DB smokes not run. |
| Wallet/deposits | Partial coverage | Deposit state/idempotency tests; no flexible amount UI/API, history, real provider/webhook, or team wallet. |
| Managed venues/bookings | Partial coverage | Availability/catalog service tests and API client test; no calendar UI or live exclusion-constraint run in this audit. |
| Messaging/chat | Partial coverage | Messaging/chat service and event behavior; no comprehensive UI/E2E authorization run. |
| Notifications | Good infrastructure coverage | Writer/service/provider tests; missing product-domain cases naturally untested. |
| Results/disputes | Partial coverage | Result service assertions and dispute schemas/smoke; no two-captain confirmation or reviews. |
| Moderation/support/admin | Partial coverage | Service/config tests and smoke scripts; admin UI has no component tests. |
| Home/venue discovery | No coverage | No required feature implementation. |
| Registration product fields | No coverage | No positions-on-signup, selfie, age, legal, experience, city, verification, waiting-list implementation. |
| Public share/WhatsApp/auth return | No coverage | Team invite return is tested, but public match flow is not. |
| Friends/Social | No coverage | Not implemented. |
| QR/legal pages | No coverage | Not implemented. |
| Browser critical path | Partial coverage (committed, not executed) | `e2e/critical-path.spec.ts` covers API-heavy register/deposit/paid match/team invite/team fixture/open claim/DM/notification flow, but not most requested journeys. |

## 9. Priority grouping

### P0 - Blocks core user journey

- Public match share/WhatsApp URL, anonymous preview policy, authentication return, and join continuation.
- Quick/public player position self-claim with safe concurrency and realtime reconciliation.
- Replace placeholder match venues with managed real venues and expose valid available slots.
- Enforce current R80 fee and 60-minute duration consistently server-side and in UI/config/docs.
- Put upcoming joinable public matches on home and make venue discovery the home experience.
- Fix first-install bootstrap so generated Prisma client is reliably available in build/CI.

### P1 - Important product functionality

- Complete registration requirements: positions, DOB/18+, experience, city, legal consent, selfie upload, verification.
- Clear self-profile navigation and supported match stats.
- Flexible deposits, transaction history, and production payment provider design.
- Host-team public posting, challenger acceptance/away-team load, and side-scoped captain permissions.
- Team wallet/contributions/captain payment.
- Two-captain score confirmation followed by ratings/reviews.
- About/legal pages and document publication/version infrastructure.
- Dependency advisory review and remediation planning.

### P2 - Useful but not launch-blocking

- Social shell, friends, blocking, and relationship-based team invites.
- Persistent team chat independent of fixtures.
- Unsupported-city waiting list and coming-soon UX.
- Visible names in formation markers and stronger separate-team layout.
- QR codes after canonical URLs exist.
- Remove max-price and nearby UI/API options if product decision remains current (low engineering effort, but does not itself block join).

### Later / explicitly lower priority

- Full challenge escrow beyond the minimum team-wallet/payment requirements.
- Automated venue payouts; begin with auditable manual settlement if product/legal/accounting approve it.
- Advanced stats that need new capture data (assists, POTM, attendance, historical captaincy).
- QR referral analytics and sophisticated short-link analytics.

## 10. Dependency graph / recommended build order

```text
Current business policies (R80, 60 min, city/venue ownership)
  -> central server/shared policy
  -> API validation and tests
  -> UI defaults/display
  -> existing-record/backfill decision

Managed venue catalogue + real venue data
  -> venue media/public metadata
  -> availability-slot calculation endpoint
  -> venue detail/calendar
  -> home venue cards
  -> ordinary match creation from a real slot
  -> home Upcoming Matches

Public match privacy/preview decision
  -> canonical public slug/token resolver
  -> unified returnTo handling
  -> public preview
  -> Web Share/WhatsApp copy
  -> register/login return
  -> join/pay/position E2E

Quick-match position rules
  -> server self-claim transaction and authorization
  -> socket/domain event contract
  -> optimistic client claim/rollback
  -> drag performance instrumentation
  -> separate-team/name presentation improvements

Legal document/version records + published legal pages
  -> consent API contract
  -> DOB/experience/positions/city registration model
  -> selfie storage
  -> verification provider/token lifecycle
  -> transactional onboarding
  -> unsupported-city waiting list

Flexible personal deposits + provider state/webhooks
  -> wallet transaction-history API/UI
  -> refund/reconciliation model
  -> venue payable/manual settlement

Team wallet
  -> team contribution ledger and authorization
  -> captain spend/refund
  -> challenge offer/accept state machine
  -> away-team squad/formation loading
  -> funded team-vs-team participation
  -> optional escrow automation

Away-team/challenger identity + side-scoped permissions
  -> result proposal
  -> opposing captain confirmation/rejection
  -> final result/dispute integration
  -> team ratings/reviews

Friendship/block policy
  -> relationship model/API
  -> notifications
  -> Social shell retaining DMs
  -> friend-assisted team invitations

Canonical site/match/venue URLs
  -> QR generation/download
```

## 11. Quick wins

1. Add a My Profile link to `UserMenu`/header; edit functionality already works.
2. Unify the protected-route and login/register `returnTo` contract; team invites already demonstrate the correct pattern.
3. Change team short-name validation/UI from 12 to 4, then add a DB constraint after checking existing data.
4. Remove maximum-price and Find Nearby controls/query parameters if the stated product decision is final.
5. Centralize/enforce R80 using the existing constant instead of accepting creator input.
6. Change all three duration defaults/docs/tests to 60 after deciding treatment of existing scheduled matches.
7. Add a read-only wallet-transactions endpoint/page using existing ledger rows.
8. Add basic derived profile statistics for matches/goals/W-D-L with explicit counting rules.
9. Render player names in formation markers; player-slot association already exists.
10. Add Prisma generation to the install/build bootstrap or CI sequence.

These are estimates from architecture, not implementation commitments.

## 12. High-risk changes

1. **Team wallet and real payments.** Requires a financial aggregate, atomic contribution/spend/refund rules, provider/webhook idempotency, auditability, reconciliation, and strict captain authorization.
2. **Venue settlement/payouts.** Money movement needs payee identity, manual/automatic settlement states, accounting ownership, refund/chargeback allocation, and operational controls.
3. **Challenge/acceptance workflow.** Introduces a new match state machine, home/away authority, expiry/concurrency, squad loading, funding gates, and notification fan-out.
4. **Two-party result confirmation.** Changes completion semantics and affects existing result revisions, disputes, stats, notifications, and historical records.
5. **Registration legal/age/identity data.** Adds sensitive personal data and evidence obligations, provider delivery, upload security, retention, and backfill/legacy-user policy.
6. **Quick-match self-claim plus optimistic realtime.** Simultaneous position claims must be serialized, while clients need deterministic rejection/rollback and protection from refetch/socket races.
7. **Dual venue-model integration.** Managed operational fields must feed new matches while historical `Venue` snapshots remain stable; naïve replacement can break history or foreign keys.
8. **Friend blocking.** Must be enforced across reads, DMs, team invites, discovery, and notifications, not merely stored.

## 13. Unknowns requiring product decisions

- Exact legal entity name, registration number, Pty Ltd styling, registered/physical address, directors, official email, regulatory memberships, and approved legal wording.
- Exact R80 breakdown and whether R80 applies to every quick match, team match, promotional/free match, and every format.
- Whether venue cost is per game or per hour for each field, tax inclusion, overtime, cancellation/no-show, and effective dates.
- Whether Queens Park/Cape Town City values refer to venues or specific fields, and the canonical public names/addresses/images.
- Supported launch city list, city normalization, and whether unverified wait-list visitors can join without creating a full player account.
- Whether selfie means a strict face/identity check or simply a required profile photo; moderation/retention policy is unspecified.
- Verification channel priority, provider, retry limits, and whether unverified users may browse or reserve usernames.
- Minimum/maximum top-up amounts, fees, payment methods, chargeback handling, and withdrawal policy.
- Manual venue settlement owner, evidence/approval process, payout cadence, and whether venues need accounts.
- Team-wallet ownership if a captain leaves, contributor refund entitlement, spend quorum, negative balance policy, and dispute authority.
- Challenge lifecycle: who can challenge, multiple pending challenges, expiry, cancellation, rematch, and when money is held/captured.
- Quick-match position collision/displacement rules and whether organisers can override player claims.
- Whether Team A/Team B must be two separate pitch components or whether one clearly split pitch is acceptable.
- Result confirmation timeout, disagreement behavior, scorer confirmation, edit window, and admin escalation.
- Who may author one review (captain only vs every player), anonymity/visibility, edit/delete window, moderation, and aggregation.
- Whether public match previews expose participant identities/avatars before login.
- Desired public URL/slug permanence and whether short links/QRs require analytics, expiry, or revocation.
- Treatment of existing 90-minute, arbitrary-fee, and >4-character-short-name records when rules change.

## Audit conclusion

The repository is technically healthy enough to build on, and several hard foundations already exist. The shortest route to the stated core product is to connect the managed venue/booking, public match, wallet, and formation systems into one coherent journey, then fix share/auth continuation. Team-vs-team payments and post-match confirmation should be treated as a second state-machine/financial workstream, not as small extensions to the current private team fixture.
