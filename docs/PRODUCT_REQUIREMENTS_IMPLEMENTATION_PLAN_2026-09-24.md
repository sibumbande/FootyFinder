# Footy Finder implementation plan

Plan date: 2026-09-24  
Source: `docs/PRODUCT_REQUIREMENTS_AUDIT_2026-09-24.md`  
Status: active delivery plan. Gate 1 application changes were implemented on 2026-09-25; database migration and focused Playwright runtime verification remain pending in a disposable environment.

## 1. Goal and delivery strategy

The goal is to turn the current collection of strong but partly disconnected systems into two coherent products:

1. A launch-safe public quick-match journey:

   `discover venue or match -> inspect slot/match -> share/open link -> register/login -> fund wallet -> join -> claim position -> play -> record result`

2. A team-vs-team journey built on explicit team finance and side-scoped permissions:

   `prepare squad -> fund team -> publish/challenge -> accept opponent -> load both lineups -> play -> propose/confirm result -> review opponent`

The quick-match journey should be completed first. The existing managed-field, wallet-ledger, match, formation, messaging, notification, and team-lineup foundations should be reused. Team wallets, challenges, result confirmation, and reviews must be treated as new domain/state-machine work rather than small additions to quick matches.

The roadmap is organized as release gates. Workstreams inside a gate may proceed in parallel, but a later gate must not be released before its dependencies and exit criteria are met.

## 2. Delivery principles

1. **Preserve historical records.** Keep the existing `Venue`/match snapshots and current transactions immutable. New managed-field links or policies apply prospectively unless a separately approved backfill is safe.
2. **Make business rules server-authoritative.** The R0-R500 whole-rand Quick Game fee range (R80 default), 60-minute duration, age restrictions, captain authority, payment status, and position claims must be enforced in the API/database path, not only by UI controls.
3. **Use additive migrations.** Do not rewrite committed migrations. Introduce nullable fields/tables, backfill where necessary, validate, then add constraints in a later migration.
4. **Keep money movements ledger-based and idempotent.** Reuse the financial repository, transaction references, holds, and reconciliation patterns. Never update balances without a corresponding ledger transaction.
5. **Separate personal and team money.** A booking contribution is not a team wallet. Team balances and authorization need their own aggregate and audit trail.
6. **Make match-side authority explicit.** Host/Home and Challenger/Away permissions must be operation-specific before team challenges or result confirmation are enabled.
7. **Publish realtime events after commit.** Persist state and notifications transactionally, then emit shared Socket.IO events. Clients must be able to recover by refetching.
8. **Avoid parallel sources of truth.** Retire hardcoded venue choices once managed venues are exposed to players; centralize fee/duration policies; share schemas through `packages/shared` and calls through `packages/api-client`.
9. **Ship vertical slices.** Each work package should include schema, migration, service, route, API client, UI, authorization, notifications where needed, tests, and operational notes.
10. **Use feature flags or access gates for high-risk domains.** Real payments, team challenges, reviews, and new onboarding enforcement should be independently deployable and reversible.

## 3. Approved decisions and remaining external inputs

DEC-001 through DEC-017 are approved in `docs/PRODUCT_REQUIREMENTS_TICKET_BREAKDOWN_2026-09-24.txt`; that register is authoritative when an older recommendation below differs. The remaining blockers in this table are externally supplied facts, content, credentials, and operating ownership rather than unresolved product design.

| Decision | Recommended default | Blocks |
| --- | --- | --- |
| Quick Game fee | Approved: whole-rand R0-R500 per player, R80 creation default, snapshotted per Match; Team fixtures use their separate funding policy and historical fees remain unchanged. | Implemented in Gate 1 |
| 60-minute transition | Approved: all new formats use 60 minutes; migrate future not-started 90-minute records with audit/notification and preserve active/history. | Implemented in Gate 1; runtime migration check pending |
| Team short-name cleanup | Approved: uppercase alphanumeric, one to four characters, unique when supplied; deterministic meaningful remediation with audit/owner notification. | Implemented in Gate 1; runtime migration check pending |
| Real venue facts | Confirm canonical names, addresses, coordinates, timezone, fields, supported formats, images, and effective prices for Queens Park, Cape Town City FC, and Italian Club. | Gate 3 |
| Venue price unit | Record whether each price is per game or per hour, tax treatment, overtime, cancellation, and effective dates. | Gates 3 and 6 |
| Slot policy | Define slot interval/granularity, booking lead time, horizon, buffers, and whether a field can expose overlapping format options. | Gate 3 |
| Public preview privacy | Recommended: anonymous viewers see venue, time, format, price, and aggregate capacity, but not participant contact details. Decide whether names/avatars are public. | Gate 4 |
| Share-link permanence | Recommended: stable non-secret public slug for public matches; hashed, rotatable tokens only for private matches. | Gate 4 |
| Selfie definition | Decide required profile photo vs identity/face verification, storage/retention, moderation, and whether legacy users must supply one. | Gate 2 |
| Legal facts/documents | Supply approved Terms, Privacy/POPIA, participation acknowledgement, company disclosures, code of conduct, and document version policy. | Gate 2 |
| Verification provider | Choose email first unless SMS is a launch requirement; define expiry, attempts, resend limits, and unverified-user permissions. | Gate 2 |
| Supported cities | Define normalized launch cities, unsupported-city behavior, and whether a waiting-list entry can exist without a full player account. | Gate 2 |
| Deposit/payment rules | Choose provider, methods, minimum/maximum amount, fees, webhook policy, chargebacks, and withdrawal/refund rules. | Gate 6 |
| Venue settlement | Define who approves manual payouts, cadence, evidence, beneficiary data, partial/refund treatment, and whether venues need accounts. | Gate 6 |
| Quick-position collision | Recommended: first committed claim wins; claimant receives a conflict and refreshed board; organiser may move/remove players with notification. | Gate 5 |
| Team-wallet governance | Decide ownership after captain departure, contributor refunds, authorized spenders, approval/quorum, negative balance, and audit visibility. | Gate 7 |
| Challenge lifecycle | Define who can challenge, multiple pending challenges, expiry, withdrawal, acceptance authority, and when funds are reserved/captured. | Gate 7 |
| Result confirmation | Define confirmer roles, timeout, disagreement/edit behavior, scorer approval, auto-escalation, and dispute integration. | Gate 8 |
| Review policy | Define eligible authors, one-per-match rules, anonymity, edits/deletion, public visibility, moderation, and aggregation. | Gate 8 |

Decision records should be stored as short ADRs or product-policy documents. Implementation tickets should reference the relevant decision rather than restating policy inconsistently.

## 4. Target architecture

### 4.1 Venue and match creation

Use `ManagedVenue`/`ManagedField` as the operational source of truth. Preserve `Venue` and reservation snapshots for historical display. A new match created from a managed field should be linked through its `FieldReservation`, while immutable name/address/city/price snapshots protect history from later catalogue edits.

Availability slots should initially be computed from:

`weekly availability - exceptions - active reservations - buffers`

There is no need to persist every future slot unless performance or external inventory synchronization later requires it.

### 4.2 Public links

Public matches should have a stable public identifier/slug and a deliberately limited preview DTO exposed outside `requireAuth`. Private matches must continue to use hashed, expiring/rotatable invite tokens. Both login and registration should use one validated internal `returnTo` mechanism.

### 4.3 Formation claims

Quick-match self-claim should be a dedicated command, not a relaxation of the organiser's generic formation-edit permission. The service should lock/check the target slot, participant membership, team side, match mutability, and duplicate assignment in one transaction. Organiser movement remains a separate privileged command.

### 4.4 Money

Retain personal `WalletAccount`, `WalletTransaction`, and `WalletHold`. Add team finance as a separate aggregate with its own ledger, contribution references, authorized spend commands, and reconciliation. Real payment-provider records should map external state to immutable internal transactions; provider callbacks must be idempotent.

Venue payouts should be represented as payables/settlements derived from confirmed reservations, not inferred from wallet balances.

### 4.5 Team competition

Use `MatchTeam` HOME/AWAY as the anchor, but add an explicit challenge/offer lifecycle. Do not encode challenge state only in generic `Match.status`. Authorization should answer both:

- Is this user an owner/captain of an attached team?
- Is that team HOME/host or AWAY/challenger for this operation?

### 4.6 Results and reviews

Separate a result proposal from a finalized `MatchResult`. Finalization should occur only after the required opposing-side confirmation or an approved administrative resolution. Reviews should reference a finalized match and target the opposing team, with database uniqueness preventing duplicates.

## 5. Roadmap overview

| Gate | Outcome | Main audit IDs | Relative size | Release dependency |
| --- | --- | --- | --- | --- |
| 0 | Reproducible baseline and approved policies | Cross-system/runtime | M | None |
| 1 | Existing behavior aligned with current rules | 3.1, 6.1-6.4, 10.1, 13, 16-A/D | M | Gate 0 decisions |
| 2 | Compliant onboarding, legal publication, profile completion | 2.1-2.8, 3.2, 15, 16-A | XL | Gate 0; legal/provider decisions |
| 3 | Real venues, calculated slots, venue-first home | 1.1-1.4, 5.1 foundation, 6.3 | XL | Gates 0-1; venue facts |
| 4 | Public match sharing and auth continuation | 9, 16-A/C | L | Gates 1 and public-preview decision |
| 5 | Player position claims and formation UX | 7.1-7.4 | L | Gate 1; claim policy |
| 6 | Production personal payments, history, venue settlement | 4.2-4.3, 5.1; payment part of 9 | XL | Gate 0; provider/settlement decisions |
| 7 | Team wallet, public team fixtures, challenges, team chat | 8.1-8.2, 10.3, 10.5, 16-B/C/D | XXL | Gates 3 and 6; team/challenge decisions |
| 8 | Result confirmation, ratings, and reviews | 12.1-12.3 | XL | Gate 7; result/review decisions |
| 9 | Social, waiting-list growth UX, QR, advanced escrow/stats | 1.3, 3.2 advanced, 5.2, 11-11.3, 14 | XL/ongoing | Stable prior domains |

Gate 2, Gate 3, and the non-provider portions of Gate 4 can be developed in parallel after Gate 1. For a real-money public launch, Gates 2-6 are release requirements even if development overlaps.

## 6. Gate 0 - Baseline, decisions, and delivery safety

### Objective

Create a reproducible development/CI baseline and lock the policies that affect schemas or state transitions.

### Work packages

#### FND-01: Build and test bootstrap

- Ensure Prisma client generation is an explicit install/build/CI prerequisite.
- Provide a documented disposable PostgreSQL test configuration without embedding credentials.
- Run migration deployment/status in that disposable environment.
- Make the committed API smoke scripts and Playwright critical path part of an appropriate CI tier.
- Keep unit/component checks fast; run database/E2E checks as a separate required pipeline stage.

#### FND-02: Dependency security review

- With explicit organizational approval, collect the actual npm advisory graph.
- Classify production vs development exposure and reachable vs non-reachable packages.
- Upgrade through normal pull requests; do not use an unreviewed force fix.
- Add a policy for severity thresholds and documented temporary exceptions.

#### FND-03: Architecture and product decisions

- Record the decisions in section 3.
- Define the canonical quick-match and team-match state diagrams.
- Define the role/permission matrix before adding challenger actions.
- Define data-retention rules for legal evidence, verification tokens, selfies, payment-provider data, and reviews.

#### FND-04: Observability baseline

- Define stable error codes and structured events for slot conflicts, failed returns, payment state, claim conflicts, challenge state, and result confirmation.
- Reuse existing request IDs, operational metrics, durable jobs, and notification dedupe patterns.
- Define alert ownership for payment reconciliation and failed durable jobs.

### Verification

- Clean checkout -> install -> Prisma generate -> build -> type-check -> unit/component tests passes from documented commands.
- Disposable database applies all migrations without reset.
- All smoke scripts declare setup/cleanup boundaries and do not target non-test databases.
- Permission/state diagrams and required product decisions are approved.

### Exit criteria

No feature gate starts a schema-changing slice without its policy decision, data owner, rollback approach, and acceptance tests identified.

## 7. Gate 1 - Align existing behavior and remove reachability defects

### Objective

Correct low-complexity discrepancies before larger features build on inconsistent contracts.

### Implementation status (2026-09-25)

The application, shared contracts, tests, preflight, and migration are implemented. Prisma generation, the complete automated test suite, lint, and all workspace builds pass. Release verification still requires applying `20260925090000_gate_1_alignment` and running database smoke plus the focused Playwright return flow in the disposable PostgreSQL environment. See `docs/GATE_1_MIGRATION_RUNBOOK_2026-09-25.md`.

### Work packages

#### RULE-01: Configurable bounded Quick Game fee

- Enforce a server-authoritative whole-rand range of R0 through R500 for new Quick Games.
- Keep R80 as the creation default while allowing the organiser to select another valid amount.
- Reject fractional, negative, and above-range API payloads.
- Keep historical match fees unchanged.
- Update shared schemas, API client, tests, E2E fixtures, and copy.

#### RULE-02: Sixty-minute duration

- Change all three format defaults/policies to 60 minutes.
- Update README/environment examples and stale tests/smoke fixtures.
- Confirm effects on computed match end, result readiness, post-match chat, bookings, and overlap validation.
- Migrate already-scheduled, future, not-started 90-minute matches with audit and participant/organiser notifications; leave active and historical records unchanged.

#### RULE-03: Discovery simplification

- Remove maximum-price and Find Nearby controls from `MatchListPage`.
- Remove maximum-price, geolocation, radius, distance-sort, and distance-response contract surface after confirming repository consumers.

#### TEAM-01: Four-character short names

- Change shared/API/UI validation to maximum four characters.
- Provide a read-only preflight for existing violations.
- Deterministically replace invalid or duplicate non-null values with meaningful uppercase alphanumeric codes, audit each change, and notify the Team owner.
- Add uniqueness and format database constraints after remediation.

#### UX-01: Profile reachability

- Add a clear My Profile navigation entry using the authenticated user ID.
- Preserve public player-profile links and self-only mutation authorization.

#### AUTH-01: Canonical return destination

- Use one `returnTo` contract for protected routes, login, registration, and invite flows.
- Accept only safe internal paths; reject absolute/external URLs.
- Preserve query/hash where necessary.
- Add tests for direct match URL -> login/register -> original match.

#### MATCH-01: Status contract cleanup

- Treat `FULL` as an API-only capacity-derived state, never a separately writable lifecycle state.
- Audit and migrate legacy persisted `FULL` rows, remove it from the database enum, and align Prisma, shared types, mapper, repository queries, lifecycle code, UI, and tests.
- Keep historical migration files unchanged; use the additive Gate 1 migration.

### Verification

- API/schema tests prove callers can create a Quick Game only with a whole-rand R0-R500 fee and a 60-minute duration; omission uses the R80 fee default.
- Existing historical match records still display their stored fee/duration.
- No max-price/geolocation UI is rendered.
- Short-name boundary tests cover 4/5 characters and the DB constraint when enabled.
- Unauthenticated deep links return correctly after login and registration.
- Self-profile edit is reachable from primary navigation.

### Exit criteria

The application has one authoritative definition for fee, duration, short-name length, auth return, and match-full semantics.

## 8. Gate 2 - Legal, onboarding, verification, city, and profile completion

### Objective

Make account creation satisfy the required player and legal data while providing a safe path for existing users.

### Work packages

#### LEGAL-01: Legal publication model and pages

- Add public routes for About/Legal Disclosures, Terms, Privacy/POPIA, participation acknowledgement, and Code of Conduct.
- Publish only approved factual/legal content; do not synthesize company facts.
- Introduce versioned legal-document metadata if versions are managed in the application. At minimum record document type, version, effective timestamp, and content/checksum reference.
- Keep legal pages accessible without authentication and link them from registration and global footer/navigation.

#### ONB-01: Additive profile/onboarding schema

- Add DOB, years of experience, structured city relation/value, profile-completion status, and contact-verification state.
- Reuse `PlayerPreferredPosition` for primary/secondary selections; define whether ordering or a primary flag is required.
- Add immutable legal acceptance records referencing the exact versions accepted and timestamp/source.
- Keep new fields nullable initially for legacy accounts.

#### CITY-01: Supported cities and waiting list

- Add a normalized city catalogue/support status or a controlled equivalent.
- Model waiting-list/city-interest entries separately from active player profile data.
- Support dedupe, status, consent/source, timestamps, and optional unauthenticated interest if approved.
- Add "Cape Town available / other cities coming soon" presentation and waiting-list entry flow.

#### MEDIA-01: Player selfie/profile image

- Reuse the proven team-image validation pattern where appropriate, but create player-specific authorization and storage keys.
- Validate actual file signatures, MIME type, size, dimensions/orientation, and safe serving behavior.
- Store ownership/metadata and replacement/deletion lifecycle.
- If identity verification is required, design it separately from a normal avatar upload.

#### AUTH-02: Email/SMS verification

- Add hashed single-use verification tokens/OTPs, purpose, expiry, attempt/resend limits, used/revoked timestamps, and delivery status.
- Implement provider abstraction and a non-production test adapter.
- Decide which actions unverified users may perform.
- Do not expose whether an arbitrary contact exists through resend/recovery responses.

#### AUTH-03: Password reset

- Use the same secure token-delivery foundation with separate purpose and expiry.
- Revoke or rotate relevant sessions after successful reset according to policy.
- Add generic responses and rate limiting to prevent account enumeration/abuse.

#### ONB-02: Registration/profile-completion UI

- Extend the registration wizard for DOB/18+, experience, city, positions, selfie, legal acceptance, and verification.
- Validate 18+ on both client and server using date semantics, not a submitted age number.
- Persist account creation and onboarding steps with an explicit retry/resume model; do not leave untraceable partial consent/payment state.
- Require legacy users to complete only the approved missing fields at an appropriate gate rather than blocking every route immediately.

#### PROFILE-01: Supported statistics

- Add a read model/query for matches played, W/D/L, goals, and current teams using completed results and participant side.
- Define treatment of cancellations, disputed/revised results, forfeits, and deleted teams.
- Do not expose assists, POTM, attendance, or historical captaincy until those facts are captured.

### Data/migration sequence

1. Add city/legal/verification/media tables and nullable profile fields.
2. Deploy read-compatible code.
3. Populate supported cities and legal document versions.
4. Enable new registration writes.
5. Offer legacy profile completion and monitor completion.
6. Add required constraints only if/when legacy policy permits.

### Verification

- Server rejects under-18 DOB even if the client is bypassed.
- Registration cannot complete without required legal versions and stores immutable evidence.
- Token/OTP expiry, reuse, attempts, resend, provider failure, and rate limits are tested.
- Unsupported-city users can join the waiting list without being represented as active Cape Town players.
- Upload tests cover spoofed MIME, oversize, unauthorized replacement, and safe retrieval.
- Statistics reconcile against known match/result fixtures and revisions.

### Exit criteria

New users can complete a legally evidenced, verified, age-gated profile; legacy users have an approved transition path; public legal content is available.

## 9. Gate 3 - Real venues, dynamic availability, and venue-first home

### Objective

Replace placeholder venue choices with the managed catalogue and expose a discoverable, valid booking/match-creation path.

### Work packages

#### VEN-01: Public venue projection

- Add public metadata required by venue cards/detail pages: slug, description, media, amenities only if needed, and display ordering/status.
- Keep operational/admin-only data out of the public DTO.
- Add public read endpoints for active venues/fields and supported formats.

#### VEN-02: Verified venue data

- Create an idempotent, environment-appropriate seed/import for Queens Park, Cape Town City FC, and Italian Club after facts are approved.
- Represent Italian Club Court A/B and 11-a-side inventory as fields with the correct format/price units.
- Use effective-dated `ManagedFieldPrice`; do not bury venue prices in frontend constants or environment variables.
- Attach approved venue imagery through the chosen media path.

#### VEN-03: Slot calculation service

- Add a query such as active field + format + date range -> available slots.
- Calculate in the venue timezone from weekly availability, exceptions, duration, booking buffers, lead time, horizon, and active reservations.
- Bound date ranges and result sizes.
- Return stable reason/status information only where it helps the UI; do not expose internal reservations.
- Keep database exclusion constraints as the final concurrency protection when a displayed slot is booked.

#### VEN-04: Venue discovery/detail/calendar UI

- Replace the home player grid's primary role with Airbnb-style venue cards and a venue detail page.
- Show real name, location, imagery, supported formats, and effective price/price unit.
- Render an accessible date/slot calendar and clear unavailable/loading/empty states.
- On selection, carry field, format, time, and price snapshot into the creation/booking workflow.

#### VEN-05: Unify ordinary match creation

- Retire `features/matches/constants/fields.ts` from user-facing creation.
- Create normal matches through the managed field/reservation path so time, price, availability, and snapshots share one authority.
- Preserve existing historical `Venue` rows and existing match routes.
- Decide whether fully funded booking confirmation or organiser action publishes the public match.

#### HOME-01: Upcoming Matches section

- Reuse the existing public-match discovery service and `MatchCard`.
- Add a limited upcoming, kickoff-sorted, non-full list below venues.
- Use a dedicated homepage query shape/limit if necessary rather than downloading the entire discovery result.
- Link cards into the canonical public/lobby path designed in Gate 4.

### Verification

- Slot calculations cover DST/timezone boundaries, exceptions, format duration, buffers, and overlapping reservations.
- Two simultaneous attempts cannot reserve the same field/time; one receives a stable conflict response and refreshes.
- The three approved venues and prices are returned from database data, never frontend constants.
- A venue catalogue edit does not mutate historical match/reservation snapshots.
- Home shows active venues, coming-soon cities, and joinable upcoming matches only.

### Exit criteria

Players can discover a real venue, inspect calculated availability, and create/book a match without any placeholder field data.

## 10. Gate 4 - Public match sharing and acquisition funnel

### Objective

Make WhatsApp sharing a complete anonymous-to-joined-player journey.

### Work packages

#### SHARE-01: Canonical public match identity

- Add a stable public slug/identifier for public matches, with uniqueness and a clear lifecycle.
- Keep private invite tokens hashed, expiring, and rotatable; do not use the public slug as a private secret.
- Define redirects if a slug changes and canonical URL generation behind proxies/deployment domains.

#### SHARE-02: Anonymous preview endpoint/page

- Mount a deliberately public resolver outside global `/matches` authentication.
- Return the approved minimal DTO: venue, kickoff, format, fee, aggregate filled/total capacity, and joinability.
- Never return emails, wallet details, private chat, invite hashes, or disallowed player identity.
- Handle cancelled, completed, full, expired, and private matches without leaking private existence.

#### SHARE-03: Share actions

- Add a lobby share button for every public match.
- Use Web Share API when supported and a WhatsApp deep-link/copy fallback.
- Generate copy from live match data, not hardcoded strings.
- Share the canonical public URL and display current capacity as advisory; join remains server-validated.

#### SHARE-04: Authentication continuation

- Reuse Gate 1's safe `returnTo` implementation.
- Anonymous preview -> register/login -> same match -> join should work across refresh and direct navigation.
- Preserve attribution only if privacy/product analytics approve it.

#### SHARE-05: End-to-end coverage

- Add Playwright coverage for copied/public URL in a logged-out context, preview, registration/login, return, deposit/funding, join, and capacity conflict.
- Cover full/cancelled match behavior and unsafe `returnTo` rejection.

### Verification

- A recipient can open a WhatsApp/shared link without an account, see approved match facts, authenticate, return to the same match, and attempt to join.
- Private matches and participant-private data remain inaccessible.
- Shared content reflects the actual venue/time/capacity/fee.

### Exit criteria

The high-priority share acquisition funnel passes browser E2E and authorization tests.

## 11. Gate 5 - Quick-match position claims and formation quality

### Objective

Allow joined players to claim a position safely and make the tactical UI clear and responsive.

### Work packages

#### FORM-01: Self-claim command

- Add a dedicated claim endpoint/service for a participant to claim an empty slot on their own team.
- Validate match mode/status, participation, team side, target slot, existing assignment, and any claim deadline.
- Commit the claim atomically; first committed claimant wins.
- Return stable conflict codes for slot taken, already assigned, wrong team, not participant, and immutable match.
- Keep organiser assign/move/remove authority separate and notify affected players where policy requires.

#### FORM-02: Client claim flow

- Empty positions become actionable for eligible joined players.
- Optimistically mark the claim only if rollback/refetch is deterministic.
- On conflict, explain that another player claimed the position and refresh immediately.
- Keep reserves beside the pitch; joining need not auto-place a player.

#### FORM-03: Realtime consistency

- Emit the committed slot state using shared event constants.
- Update the precise formation query/cache rather than broadly invalidating unrelated match/user lists.
- Ignore stale updates using updated timestamps/versioning if race testing shows a need.

#### FORM-04: Formation presentation

- Strengthen HOME/AWAY or Team A/Team B separation; use two pitch components if the product decision requires it.
- Render a readable short name plus avatar inside/adjacent to each assigned marker.
- Keep substitute/reserve lists separate and accessible.

#### FORM-05: Drag-and-drop stabilization

- Instrument pointer-to-render and drop-to-confirm timing before changing behavior.
- Separate transient drag coordinates from server-backed slot data.
- Prevent incoming refetches from overwriting an active drag/confirmed optimistic update.
- Serialize or cancel conflicting mutations and narrow query invalidation.
- Test mouse, touch/pointer cancellation, slow network, rejected writes, socket echo, and rapid consecutive moves.

### Verification

- Concurrency integration test proves exactly one of two simultaneous claimants owns a slot.
- Non-participants and opposite-side players cannot claim.
- Organiser overrides follow policy and are audited/notified.
- Two clients converge after claim/move/remove events.
- Performance budget is defined and measured on representative mobile hardware/network.

### Exit criteria

The public quick-match journey supports reliable self-placement, visually distinct sides, named/avatar markers, and resilient realtime updates.

## 12. Gate 6 - Personal wallet completion, production payments, and venue settlement

### Objective

Move from fixed demo deposits to auditable real-money personal wallet flows and an operational manual venue-payout model.

### Work packages

#### WAL-01: Transaction history

- Add an authenticated, paginated wallet-transactions endpoint scoped to the current wallet owner.
- Expose normalized display type, amount/sign, status, description/reference, and timestamp without leaking internal secrets.
- Add a wallet page linked next to Teams or from Profile/header.
- Show deposits, match debits, cancellation credits, booking hold/capture/release, and future refund states consistently.

#### PAY-01: Flexible top-ups

- Replace the no-body demo route with a validated amount contract using approved min/max rules.
- Keep demo operator available only in explicit development/test environments.
- Build provider initiation and callback/webhook adapters around the existing `PaymentOperator` boundary where appropriate.
- Store provider references/state and verify webhook authenticity.
- Make initiation, retry, and callback processing idempotent.
- Credit wallet only after authoritative provider success.

#### PAY-02: Refund and chargeback lifecycle

- Distinguish internal wallet credit/reversal from an external refund.
- Add explicit external refund/provider state when money leaves Footy Finder.
- Define how chargebacks affect wallet integrity and whether negative/restricted accounts are possible.
- Extend reconciliation and admin operations.

#### PAY-03: Venue payable/manual settlement

- Add venue beneficiary details with strict admin access and audit logging.
- Create a payable when a reservation reaches the approved confirmation/completion state.
- Record amount, source reservation, adjustments/refunds, due status, approval, payout reference, paid timestamp, and actor.
- Build an admin queue/report for manual settlement and reconciliation.
- Do not automatically pay venues until the manual model is proven and separately approved.

### Verification

- Amount boundary, currency, idempotency-key reuse, duplicate webhook, out-of-order webhook, provider failure, refund, and reconciliation tests pass.
- No balance mutation exists without a ledger transaction.
- Users can reconcile visible history to their balance.
- Venue payables reconcile to eligible confirmed reservations and cannot be paid twice.
- Sensitive beneficiary/provider data is absent from player APIs/logs.

### Exit criteria

Real deposits and refunds are traceable end-to-end, users can view history, and operations can account for manual venue payouts.

## 13. Gate 7 - Team wallet, public team fixtures, challenges, and team chat

### Objective

Turn private/free team planning fixtures into a funded, authorized team-vs-team workflow.

### Work packages

#### TWAL-01: Team financial aggregate

- Add `TeamWalletAccount` and immutable `TeamWalletTransaction` (or a rigorously generalized wallet owner model after an ADR).
- Record member contributions as personal-wallet debit + team-wallet credit in one transaction with linked references.
- Enforce authorized captain/owner spending, team membership, amount/currency, and idempotency.
- Define refund destinations from original contribution provenance according to policy.
- Add team wallet balance/history UI and contribution flow.

#### TEAM-02: Public team fixture posting

- Extend existing team fixture creation to select managed venue/slot and approved payment terms.
- Copy host team's saved formation/squad into HOME while preserving current match-day selection behavior.
- Publish the fixture only after required host funding/reservation conditions are met.
- Preserve private/free planning mode only if it remains a distinct supported use case.

#### CHAL-01: Challenge model/state machine

- Add explicit challenge records/statuses such as pending, accepted, declined, withdrawn, expired, and cancelled.
- Link host team, challenger team/captains, target match, terms, expiry, and audit timestamps.
- Serialize acceptance so only one challenger can become AWAY where only one opponent is allowed.
- Reject challenges from ineligible/same/blocked teams according to policy.

#### CHAL-02: Away-team loading and payment

- On accepted challenge, attach the challenger as AWAY and copy the matching saved formation/eligible squad.
- Reserve/capture the approved team amount using the team wallet/hold policy.
- Roll back or compensate atomically if funding, slot, or attachment fails.
- Emit notifications to both captains and relevant squad members after commit.

#### AUTHZ-01: Side-scoped captain permissions

- Replace broad match-wide team manager assumptions with operation-specific checks.
- Host-side examples: publish, choose venue, withdraw before acceptance under policy.
- Challenger-side examples: challenge/withdraw, confirm result.
- Both-side examples: manage only their own lineup/availability and participate in chat.
- Admin remains an explicit audited override, not an implicit team manager.

#### CHAT-01: Persistent team chat

- Either generalize `Conversation` to a team-owned conversation or add a dedicated `TeamMessage` aggregate after an ADR.
- Authorize current team members; define behavior for removed members and message retention.
- Add team room join/leave, history pagination, realtime messages, read state/notifications as approved.
- Keep match lobby chat match-scoped.

### Verification

- Financial invariant/property tests cover contributions, spend, refund, captain departure, duplicate requests, and concurrent actions.
- Authorization matrix tests cover owner/captain/member/outsider on HOME and AWAY for every command.
- Challenge race tests prove one accepted opponent and correct expiration/release behavior.
- Both team lineups load the correct format without cross-side mutation.
- Removed team members cannot read/send new team messages.

### Exit criteria

Two independently managed teams can fund, challenge/accept, load squads, manage their own sides, and communicate without using personal per-player match fees.

## 14. Gate 8 - Result confirmation, ratings, and reviews

### Objective

Complete the competitive lifecycle with two-party result agreement and accountable team reputation.

### Work packages

#### RESULT-01: Result proposal and confirmation

- Add a proposal/pending-confirmation state rather than immediately completing a team match.
- Permit the authorized host captain to submit under the approved policy.
- Permit only an authorized opposing captain to confirm or reject/request correction.
- Store proposal actor/time, confirming actor/time, revisions, rejection reason, deadline, and finalization source.
- Finalize stats/notifications only once; preserve existing quick-match result behavior if product policy differs.
- Integrate disagreement and timeout with the existing dispute/admin revision process.

#### REVIEW-01: Team ratings/reviews

- Add match-bound author/target-team relations, integer rating 1-5, optional comment, visibility/moderation state, timestamps, and uniqueness constraints.
- Verify reviewer eligibility from finalized match participation/captaincy policy and enforce opposing-team targeting.
- Add review creation, team review list/summary, report/moderation, and notification paths.
- Prevent duplicate, self-team, unrelated-match, and pre-finalization reviews.

#### STATS-01: Finalized-result projections

- Ensure profile/team statistics consume only finalized, non-overturned results.
- Recompute or invalidate projections after approved result revision/dispute.
- Add ratings aggregates only after moderation visibility rules are applied.

### Verification

- Host cannot self-confirm as the opponent.
- Wrong-side captain/member/outsider cannot confirm or review.
- Concurrent confirm/reject requests resolve deterministically.
- One finalization event updates stats and sends notifications once.
- Review uniqueness, rating bounds, moderation, and result-revision interactions are tested.

### Exit criteria

Team results require the approved two-sided agreement, and eligible participants can leave moderated, non-duplicated opponent reviews.

## 15. Gate 9 - Social, QR, advanced escrow, and later enhancements

### Objective

Add growth/community features after core identity, sharing, team, and payment domains are stable.

### Work packages

#### SOC-01: Friendship and blocking

- Add directional friend requests and accepted/declined/cancelled states or an equivalent normalized model.
- Add blocking with server-side enforcement across user discovery, requests, DMs, team invites, and notifications.
- Add add/remove/list/accept/decline/block APIs and notification writers.
- Define privacy and rate/abuse limits.

#### SOC-02: Social shell

- Rename/restructure navigation around Social while retaining current DMs.
- Add Friends, Requests, Messages, and relevant team-invite affordances.
- Reuse existing conversation/message service rather than migrating messages unnecessarily.

#### SOC-03: Friend-assisted teams

- Add friend picker/invite targeting while retaining revocable link invites.
- Do not reveal team membership or contacts contrary to privacy/block rules.

#### QR-01: QR links

- Generate QR codes only for stable HTTPS canonical URLs established in Gate 4/venue routing.
- Start with site/public-match/venue codes; add referrals only after referral attribution policy exists.
- Provide accessible fallback text/link and test scan resolution, not only image generation.

#### ESCROW-01: Advanced challenge escrow

- Extend proven team holds to multi-party funding conditions only if business policy requires it.
- Model condition state, expiry, release/capture, cancellation, partial funding, and compensation explicitly.
- Reuse durable jobs for expiry and reconciliation.
- Keep this lower priority unless it becomes necessary for Gate 7's minimum funded acceptance.

#### STATS-02: Advanced player statistics

- Add capture models/workflows before showing assists, attendance, player-of-the-match, ratings, or historical captaincy.
- Define authoritative recorder, correction/dispute, and privacy semantics for each metric.

### Verification

- Blocking is enforced server-side in all connected domains.
- Existing DMs remain intact after Social navigation changes.
- QR scans resolve correctly across supported devices and never encode private invite secrets for public use.
- Escrow invariant tests cover every terminal and retry path.

### Exit criteria

Community and growth features operate on stable identity/share/team domains and do not bypass privacy, authorization, or financial invariants.

## 16. Migration and data-transition plan

### 16.1 General sequence

For every database change:

1. Inventory affected production-shaped data with a read-only preflight query.
2. Add new nullable columns/tables/indexes/enum values without removing current fields.
3. Deploy code that tolerates old and new rows.
4. Backfill through an idempotent, observable job where required.
5. Switch writes to the new representation.
6. Verify counts, referential integrity, financial reconciliation, and application metrics.
7. Add `NOT NULL`, unique, or check constraints only after data complies.
8. Remove old code/fields in a later release after rollback windows expire.

### 16.2 Specific transitions

- **Fee/duration:** apply new policy to new records. Handle scheduled future matches only through an explicit reviewed migration/job; keep history unchanged.
- **Short names:** detect >4-character rows, remediate, then constrain.
- **Onboarding:** add nullable fields and separate acceptance/token tables; do not fabricate consent or DOB for legacy users.
- **Venues:** seed managed catalogue idempotently; do not replace historical `Venue` snapshots. New reservations carry managed-field relation plus snapshots.
- **Public slugs:** generate unique slugs for eligible public matches; redirects/aliases preserve existing shared links if slugs change.
- **Team wallets:** start every team at a zero ledger-derived balance. Never copy personal wallet funds automatically.
- **Results:** existing final `MatchResult` rows remain final; only new team results use proposal/confirmation unless a separate conversion is approved.
- **Reviews/friendships:** no synthetic backfill.

### 16.3 Rollback expectations

- Feature flags disable new entry points without deleting data.
- Old readers remain compatible during additive transitions.
- Financial migrations require forward-fix/compensation, not destructive rollback.
- Enum additions are treated as effectively irreversible in PostgreSQL deployment planning.
- Seed/import jobs are idempotent and keyed by stable external/internal identifiers.

## 17. API, realtime, and authorization plan

### 17.1 Contract order for each vertical slice

1. Shared types/schema and error codes.
2. Database model/migration if needed.
3. Repository transaction and invariant tests.
4. Service authorization/business logic.
5. Controller/route with rate limits/origin protection.
6. API-client method and contract tests.
7. Frontend query/mutation and UI.
8. Persisted notification/domain event after commit.
9. Component, integration, and E2E coverage.

### 17.2 Planned endpoint capabilities

Names are provisional and should be finalized with the contract, but the capabilities should remain separate:

- Public venue list/detail and field-slot queries.
- Public match preview by slug.
- Authenticated quick-match position claim.
- Wallet transaction history and amount-bearing deposit initiation.
- Verification/resend and password-reset flows.
- Team wallet history/contribution/payment.
- Challenge create/list/accept/decline/withdraw.
- Result propose/confirm/reject.
- Team review create/list/report.
- Friendship request/accept/remove/block.
- Team chat history/send/read.

Avoid generic `PATCH /match` or `PATCH /team` commands for state-machine and financial actions; explicit command endpoints are easier to authorize, validate, audit, and make idempotent.

### 17.3 Authorization matrix requirement

Each new endpoint needs tests for:

- unauthenticated user;
- authenticated outsider;
- ordinary participant/member;
- captain of the wrong team/side;
- captain of the correct team/side;
- team owner;
- quick-match host;
- suspended/banned account;
- platform admin with and without recent MFA where applicable.

Authorization must be checked against current database membership/ownership, not client-provided role labels.

### 17.4 Realtime rules

- Add event names only to the shared socket constants.
- Event payloads identify the aggregate/version and contain no private data beyond room authorization.
- Room join revalidates session and membership; removal/suspension terminates access.
- Events are emitted after database commit.
- The client can always recover from missed/duplicate events by fetching authoritative state.

## 18. Test and quality plan

### 18.1 Required layers

| Layer | Purpose | Required examples |
| --- | --- | --- |
| Shared schema/unit | Boundary and policy behavior | Quick Game fee range/default, 60 minutes, age calculation, short name, deposit ranges, ratings 1-5 |
| Service unit | Business decisions and authorization | verification expiry, claim eligibility, challenge transitions, result confirmation |
| Repository/PostgreSQL integration | Concurrency and constraints | overlapping reservations, simultaneous claims, one accepted challenger, ledger idempotency |
| API contract | Route/auth/error/DTO compatibility | public preview privacy, wallet history, unsafe returnTo, role matrix |
| Component | User states and accessibility | registration steps, slot calendar, share fallback, claim conflicts, wallet history |
| Socket integration | Room authorization and convergence | claims, lineup, team chat, result events, removed-member access |
| Browser E2E | Complete user outcomes | public share onboarding; venue booking; two-player claim race; team challenge/payment/result |
| Migration test | Existing-data safety | long short names, historical matches, nullable onboarding, ledger reconciliation |
| Security/abuse | Sensitive flows | token enumeration, upload spoofing, webhook replay, blocked-user enforcement, rate limits |

### 18.2 Release-critical E2E journeys

#### Quick-match E2E

1. Anonymous visitor opens shared public match.
2. Sees approved preview.
3. Registers with age/legal/city/positions/photo and verifies contact.
4. Returns to the same match.
5. Adds a valid flexible amount or uses seeded test funding.
6. Joins and is debited exactly the Match's snapshotted per-player fee once.
7. Claims an empty same-side position.
8. Second player cannot claim that occupied position.
9. Both clients see committed formation state.
10. Cancellation follows the approved credit/refund policy.

#### Venue E2E

1. Home lists the approved real venues from the database.
2. User opens a venue and sees calculated slots.
3. User selects a valid format/time and creates/books.
4. Concurrent booking of the same field/time fails safely.
5. Home Upcoming Matches exposes the resulting public match when eligible.

#### Team E2E

1. Captain loads saved HOME squad/formation.
2. Members contribute to team wallet.
3. Host posts a funded fixture.
4. Away captain challenges and pays from their team wallet.
5. One challenge is accepted; both lineups remain side-scoped.
6. Host proposes score; opposing captain confirms.
7. Eligible review is accepted once and displayed after moderation rules.

### 18.3 Non-functional gates

- Formation interaction meets the agreed mobile latency budget under simulated slow network.
- Public preview and home queries are paginated/bounded and indexed.
- File uploads enforce size/signature and cannot escape configured storage paths.
- Financial reconciliation returns no unexplained balance/hold/payable differences.
- Web bundle-size warning is reviewed; route-level code splitting should be considered as new pages are added.
- Accessibility checks cover keyboard calendar/formation actions, labels, focus, errors, and color-independent team distinction.

## 19. Rollout and operations plan

### 19.1 Environments

- Use a disposable local/CI PostgreSQL database for migrations, smokes, and E2E.
- Keep demo payment and test-data tooling impossible to enable in production.
- Validate production environment variables at startup, including provider/public URL/media settings.

### 19.2 Feature flags/access gates

Recommended independent gates:

- onboarding enforcement for legacy users;
- public match preview/share;
- managed-venue match creation;
- quick-position self-claim;
- real payment provider;
- team wallets/challenges;
- result confirmation/reviews;
- friendships/social.

### 19.3 Deployment sequence

1. Deploy additive schema.
2. Deploy dark/read-compatible backend.
3. Populate/reference data and verify.
4. Enable writes for staff/test cohort.
5. Run smoke/E2E and reconcile data.
6. Enable limited player cohort.
7. Monitor errors, conversion, conflicts, jobs, and financial reconciliation.
8. Expand gradually; remove legacy path only in a later release.

### 19.4 Operational dashboards/alerts

- Registration completion and verification delivery/failure.
- Public-link open -> auth -> return -> join funnel.
- Venue slot query failures and reservation conflicts.
- Position claim conflict/error rates and socket convergence failures.
- Deposit pending/failure/webhook retry and reconciliation issues.
- Team challenge expiry/funding failures.
- Result confirmation aging/disputes.
- Review reports/moderation queue.
- Durable job failures and notification publish failures.

## 20. Requirement traceability

Every discrepancy from the audit is assigned to at least one work package.

| Audit ID | Planned work package(s) | Completion evidence |
| --- | --- | --- |
| 1.1 | VEN-01, VEN-02, VEN-04 | Home/detail show database venues, images, formats, locations, prices. |
| 1.2 | VEN-03, VEN-04, VEN-05 | Calendar shows computed bookable slots; reservation conflict test passes. |
| 1.3 | CITY-01, VEN-04 | Coming-soon cities and waiting-list path are visible. |
| 1.4 | HOME-01 | Home shows kickoff-sorted joinable public matches. |
| 2.1 | ONB-01, ONB-02 | Positions required and persisted during onboarding. |
| 2.2 | MEDIA-01, ONB-02 | Validated owned player image upload is required per policy. |
| 2.3 | LEGAL-01, ONB-01, ONB-02 | Versioned mandatory acceptance is stored. |
| 2.4 | ONB-01, ONB-02 | DOB stored; server rejects under-18 registration. |
| 2.5 | ONB-01, ONB-02 | Experience validated, stored, and displayed as approved. |
| 2.6 | AUTH-02 | Email/SMS verification lifecycle passes tests. |
| 2.7 | CITY-01, ONB-01, ONB-02 | Structured city selected and persisted. |
| 2.8 | CITY-01 | Unsupported-city interest can be recorded and managed. |
| 3.1 | UX-01 | My Profile is directly reachable and saves self-only updates. |
| 3.2 | PROFILE-01, STATS-01/02 | Supported stats display from finalized facts only. |
| 4.1 | Preserve existing behavior | Header/wallet page balance reconciles to ledger. |
| 4.2 | WAL-01 | Paginated transaction history is user-visible. |
| 4.3 | PAY-01 | Valid arbitrary amount within policy can be deposited. |
| 5.1 | VEN-02, PAY-03 | Required prices are configured; venue payable/settlement is auditable. |
| 5.2 | ESCROW-01; minimum holds in TWAL-01/CHAL-02 | Required holds release/capture/refund correctly. |
| 6.1 | RULE-03 | Maximum-price UI/contract is removed or deliberately deprecated. |
| 6.2 | RULE-03 | Find Nearby is removed from current product UI/contract. |
| 6.3 | VEN-02, VEN-05 | Match creation uses approved real managed venues. |
| 6.4 | RULE-01 | New Quick Matches enforce a whole-rand R0-R500 fee server-side and default creation to R80. |
| 7.1 | FORM-04 | Team sides are independently and accessibly distinguished. |
| 7.2 | FORM-01, FORM-02 | Joined participant can atomically claim an eligible position. |
| 7.3 | FORM-03, FORM-05 | Measured drag/realtime performance meets budget. |
| 7.4 | FORM-04 | Assigned names/avatars are visible; reserves remain separate. |
| 8.1 | TEAM-02, TWAL-01 | Host loads squad/positions and funds public fixture. |
| 8.2 | CHAL-01, CHAL-02, AUTHZ-01 | Challenger loads AWAY team through accepted challenge. |
| 9 | AUTH-01, SHARE-01 through SHARE-05 | Anonymous share -> auth -> return -> join E2E passes. |
| 10.1 | TEAM-01 | 4-character rule enforced in UI/API/DB. |
| 10.2 | Preserve and regression-test | 5/7/11 formation tests remain green. |
| 10.3 | TWAL-01, CHAL-02 | Team balance/contribution/payment/refund is auditable. |
| 10.4 | Preserve and reuse in TEAM-02/CHAL-02 | Existing team formation remains functional. |
| 10.5 | CHAT-01 | Team-owned authorized persistent chat works. |
| 11 | SOC-02 | Social shell contains Friends/Requests/Messages. |
| 11.1 | SOC-01 | Friend/request/remove/block lifecycle is enforced. |
| 11.2 | SOC-03 | Friends can be selected for team invitation/discovery. |
| 11.3 | Preserve existing DM service in SOC-02 | Existing conversation history/realtime remains intact. |
| 12.1 | RESULT-01, AUTHZ-01 | Host proposal requires opposing-side confirmation. |
| 12.2 | REVIEW-01 | Eligible 1-5 rating is accepted once. |
| 12.3 | REVIEW-01 | Conduct review and team review section work with moderation. |
| 13 | RULE-02 | New matches and all runtime defaults are 60 minutes. |
| 14 | QR-01 | QR resolves to canonical site/match/venue URL. |
| 15 | LEGAL-01 | Public disclosure/legal pages contain approved content. |
| 16-A | FND-01, AUTH-01 through AUTH-03 | Auth, recovery, verification, sessions, and deep links pass. |
| 16-B | AUTHZ-01 plus per-package authorization tests | Server role/side matrix is enforced. |
| 16-C | Cross-cutting notification tasks | Required committed domain actions persist/publish notifications once. |
| 16-D | ONB/VEN/PAY/TWAL/CHAL/REVIEW/SOC migrations | Required entities exist without damaging current relationships. |

## 21. Risk register and mitigations

| Risk | Likelihood/impact | Mitigation |
| --- | --- | --- |
| Dual venue models diverge | Medium/High | Managed catalogue for operations; immutable snapshots for history; one creation service. |
| Financial double-credit/debit | Medium/Critical | Idempotency keys, serializable transactions, immutable ledger, webhook replay tests, reconciliation. |
| Team captain acts for wrong side | Medium/High | Side-scoped authorization helper and exhaustive role matrix tests. |
| Simultaneous slot claims corrupt lineup | High/Medium | Transactional lock/unique constraints, stable conflicts, authoritative refetch. |
| Legal acceptance cannot be evidenced | Medium/High | Versioned documents and immutable acceptance records; never fabricate legacy consent. |
| Verification/upload data leaks | Medium/High | Hash tokens, limit logs, secure media keys, least-privilege DTOs, retention policy. |
| Existing data violates new rules | High/Medium | Read-only preflight, staged nullable/backfill/constraint migrations, legacy compatibility. |
| Public preview leaks identities/private matches | Medium/High | Separate minimal DTO, explicit public route, privacy tests, indistinguishable private/not-found behavior. |
| Realtime UI diverges from database | Medium/Medium | Emit after commit, version/refetch strategy, narrow cache updates, multi-client tests. |
| Scope expands before core journey closes | High/High | Treat Gates 0-6 as quick-match release train; keep Social/QR/advanced escrow behind Gate 9. |
| Dependency vulnerability is production-reachable | Unknown/High | Authorized advisory review, production/development classification, controlled upgrades. |
| Bundle growth degrades mobile experience | Medium/Medium | Route-level lazy loading, bundle budgets, real-device measurements as pages are added. |

## 22. Definition of done for every work package

A work package is complete only when:

- approved product rules and acceptance criteria are linked;
- shared types and API contract are stable;
- authorization is enforced server-side and negative cases are tested;
- migrations are additive, reviewed, and tested against production-shaped data;
- frontend has loading, empty, error, retry, and accessibility states;
- financial/realtime actions are idempotent or safely conflict-resolved;
- persisted notifications and socket events occur only after commit where applicable;
- unit, integration, API, component, and required E2E tests pass;
- logging/metrics expose failures without leaking secrets or personal data;
- deployment, feature-flag, rollback/forward-fix, and data-reconciliation notes exist;
- documentation and operator configuration are updated;
- no old source of truth remains active unless a dated compatibility plan explicitly retains it.

## 23. Recommended first planning increment

The first implementation increment should contain only Gate 0 plus the low-risk portions of Gate 1:

1. Record the approved configurable-fee, 60-minute, short-name transition, and public-preview policies.
2. Make clean install/build/test/DB smoke execution reproducible.
3. Fix the `returnTo` contract and add browser coverage.
4. Add My Profile navigation.
5. Centralize/enforce the R0-R500 whole-rand Quick Game fee policy (R80 default) and 60-minute duration.
6. Remove max-price and Find Nearby from the current experience.
7. Enforce four-character short names after a data preflight.
8. Resolve `FULL` status semantics.

Only after that increment is green should the team split into parallel onboarding/legal, venue/home, sharing, and formation-claim workstreams. This keeps new development from depending on contracts already known to be inconsistent.
