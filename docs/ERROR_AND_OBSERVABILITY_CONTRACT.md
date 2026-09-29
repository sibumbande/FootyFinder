# Error and observability contract

Status: **base contract defined; policy-dependent events reserved**  
Ticket: TKT-006  
Reviewed: 2026-09-24

This contract gives later tickets stable machine names. Existing names remain compatible. Challenge and result-confirmation semantics are reserved but cannot be finalized until TKT-005 and its decision dependencies are approved.

## Naming and compatibility rules

- HTTP errors use uppercase `SNAKE_CASE` codes. Clients branch on `code`, never English message text.
- The current HTTP envelope remains `{ error, code, details? }`. `error` is safe display text; `details` is optional structured validation data.
- Domain/realtime events use lowercase `domain:past-tense-action` names.
- Structured log events use lowercase `snake_case` names.
- Metrics use lowercase `snake_case` and end in `_total` for counters, `_seconds` for durations, or `_count` for gauges.
- Once released, a code or event name is not reused with a different meaning. A semantic change receives a new name or versioned payload.
- Logs, metrics, and events must not include passwords, tokens, full database URLs, payment secrets, message content, or raw provider payloads.
- Every HTTP response carries `X-Request-Id`; asynchronous work should retain `requestId`, entity ID, job ID, and idempotency key only where safe.

## Stable error codes

| Area | Code | HTTP | Meaning/status |
|---|---|---:|---|
| Authentication return | `AUTH_RETURN_TO_INVALID` | 400 | Reserved for an unsafe, external, or malformed post-auth destination. Client-side rejection should record the same code. |
| Authentication | `UNAUTHENTICATED` | 401 | Existing: missing, invalid, or expired session. |
| Authentication | `ACCOUNT_RESTRICTED` | 403 | Existing: suspended/banned account cannot use active-only routes. |
| Reservation | `FIELD_TIME_CONFLICT` | 409 | Existing: requested field interval overlaps a reservation. |
| Reservation | `BOOKING_FUNDING_WINDOW_INVALID` | 409 | Existing: booking starts before its funding window can complete. |
| Reservation | `BOOKING_FUNDING_CLOSED` | 409 | Existing: reservation no longer accepts contributions. |
| Position claim | `POSITION_NOT_OPEN` | 409 | Existing: slot is not open for self-claim. |
| Position claim | `POSITION_ALREADY_CLAIMED` | 409 | Existing: another committed claim won the race. Quick Match claims (Gate 5) include `details` = `FormationSnapshot` (`matchId`, `formationVersion`, `slots`) so the client can replace its board with the authoritative formation. |
| Position claim | `PLAYER_ALREADY_STARTER` | 409 | Existing: claimant already occupies a starting slot (Team Match lineups only; a Quick Match claimant who already holds a slot is moved, see `SELF_MOVE`). |
| Position claim | `POSITION_OUTSIDE_TEAM_HALF` | 400 | Existing: coordinates violate the side boundary. |
| Position claim | `MATCH_PARTICIPANT_REQUIRED` | 403 | Gate 5: caller is not a currently joined participant of the Quick Match. |
| Position claim | `POSITION_WRONG_SIDE` | 403 | Gate 5: the slot belongs to the other side from the claimant's joined team. |
| Position claim | `FORMATION_SLOT_NOT_FOUND` | 404 | Gate 5: the slot does not exist in this Match. |
| Go/no-go | `LINEUP_LOCKED` | 409 | DEC-018 (D1/D3): the lobby is frozen from kickoff − 30 minutes. Applies to join, leave, claim, team change, organiser formation edits, match updates and host cancellation. |
| Bookings | `PLAYER_FIELD_BOOKING_RETIRED` | 410 | DEC-018 (D5): player pooled field-booking create, contribute and field-catalogue routes are retired. |
| Durable job | `GO_NO_GO_NOT_DUE` | internal | DEC-018: a go/no-go job ran before its `goNoGoAt`; the durable queue retries it. Never exposed to clients. |
| Payment | `INSUFFICIENT_BALANCE` | 402 | Existing: available wallet funds do not cover the command. |
| Payment | `FINANCIAL_IDEMPOTENCY_CONFLICT` | 409 | Existing: key reuse conflicts with the original financial command. |
| Payment | `DEPOSIT_TERMINAL` | 409 | Existing: attempted transition after deposit terminal state. |
| Payment | `PAYMENT_DECLINED` | 402 | Reserved: provider definitively declined the payment. |
| Payment | `PAYMENT_PROVIDER_UNAVAILABLE` | 503 | Reserved: retryable provider/service failure before a terminal outcome. |
| Payment | `PAYMENT_CALLBACK_INVALID` | 400 | Reserved: callback signature, identity, amount, or replay validation failed. |
| Challenge | `CHALLENGE_NOT_FOUND` | 404 | Reserved: challenge absent or deliberately concealed from actor. |
| Challenge | `CHALLENGE_FORBIDDEN` | 403 | Reserved: actor/side lacks command permission. |
| Challenge | `CHALLENGE_STATE_CONFLICT` | 409 | Reserved: command is invalid from current lifecycle state. |
| Challenge | `CHALLENGE_EXPIRED` | 409 | Reserved: command arrived after persisted expiry. |
| Challenge | `CHALLENGE_FUNDING_REQUIRED` | 409 | Reserved: acceptance/activation lacks required funding. |
| Result confirmation | `RESULT_NOT_READY` | 409 | Existing: result submission is not yet allowed. |
| Result confirmation | `RESULT_CONFIRMATION_REQUIRED` | 409 | Reserved: submitted Team result awaits authorized counterparty confirmation. |
| Result confirmation | `RESULT_CONFIRMATION_FORBIDDEN` | 403 | Reserved: actor cannot confirm for required side. |
| Result confirmation | `RESULT_ALREADY_CONFIRMED` | 409 | Reserved: result is already terminally confirmed. |
| Result confirmation | `RESULT_DISPUTED` | 409 | Reserved: confirmation path is suspended by a dispute. |
| Durable job | `JOB_HANDLER_MISSING` | internal | Existing terminal worker error; never expose handler internals to clients. |
| Durable job | `JOB_PAYLOAD_INVALID` | internal | Existing terminal worker error for invalid persisted payload. |

Generic existing codes (`VALIDATION_ERROR`, `RESOURCE_NOT_FOUND`, `RESOURCE_CONFLICT`, `RATE_LIMITED`, `INTERNAL_ERROR`) remain fallbacks. New domain behavior should prefer a domain-specific code from this table.

## Domain and structured-log events

DEC-018 adds the structured log event `go_no_go_decided` (matchId, outcome, filled/total). A T-30 decision reuses `match:cancelled` (auto-cancel) and `match:updated` (confirmed), emitted after commit, with persisted `MATCH_CANCELLED` / `MATCH_CONFIRMED` notifications.

Gate 5 adds `match-formation:updated`. It is emitted after a formation transaction commits, with the versioned payload `FormationSnapshot` = `{ matchId, formationVersion, slots }`. `formationVersion` increases with every committed formation change, so clients must ignore a snapshot whose version is not newer than their cached one. The legacy `formation:updated` event (bare slot array) is still emitted unchanged for compatibility, but the web client no longer consumes it.

Existing emitted events retain their current payloads: `match:started`, `match:ended`, `match:ready`, `match:updated`, `match:cancelled`, `match:result-submitted`, `participant:joined`, `participant:left`, `participant:team-changed`, `match-availability:requested`, `match-availability:updated`, and `match-lineup:changed`.

Reserved names for later tickets:

| Domain action | Persisted/domain event | Failure log event |
|---|---|---|
| Unsafe auth return rejected | `auth:return-rejected` | `auth_return_rejected` |
| Reservation conflict | none (failed command) | `field_reservation_conflict` |
| Position successfully claimed | Team Match: `match-lineup:position-claimed`. Quick Match (Gate 5): committed formation is broadcast with the formation event; audit row in `MatchFormationEvent` (`SELF_CLAIM`/`SELF_MOVE`) | `position_claim_failed` (implemented for Quick Match conflicts) |
| Organiser moves/removes a Quick Match player | Audit row in `MatchFormationEvent` (`ORGANISER_ASSIGN`/`ORGANISER_SWAP`/`ORGANISER_REMOVE`); persisted `MATCH_POSITION_CHANGED` notification to each affected player other than the organiser | none |
| Payment initiated/succeeded/failed | `payment:initiated`, `payment:succeeded`, `payment:failed` | `payment_provider_failed`, `payment_callback_rejected` |
| Challenge lifecycle | `challenge:created`, `challenge:withdrawn`, `challenge:rejected`, `challenge:accepted`, `challenge:expired`, `challenge:cancelled` | `challenge_transition_failed` |
| Result confirmation | `result:submitted`, `result:confirmed`, `result:disputed`, `result:confirmation-expired` | `result_confirmation_failed` |
| Durable job execution | no new domain event required | Existing `durable_job_succeeded`, `durable_job_failed`, `durable_job_scheduler_failed` |

Financial, challenge, and confirmation events must be emitted only after the authoritative transaction commits. User-visible notifications must be persisted in that transaction before best-effort realtime publication.

Minimum event metadata is `requestId` (when initiated by HTTP), primary entity ID, actor ID or system actor, transition `from`/`to` where applicable, and a non-secret idempotency identifier. Payment metadata may include provider name and provider reference only if the reference is classified non-secret.

## Metrics and alert ownership

The current process-local counters are diagnostic only; a production metrics backend and cross-instance aggregation are still required.

| Metric | Type | Alert condition | Primary owner |
|---|---|---|---|
| `auth_return_rejected_total` | counter | Unexpected sustained increase after an auth release | Web/API identity owner |
| `field_reservation_conflicts_total` | counter | Sudden increase relative to booking attempts | Booking backend owner |
| `position_claims_total` | counter | Implemented (Gate 5): committed Quick Match self-claims; baseline for the conflict rate | Match backend owner |
| `position_claim_conflicts_total` | counter | Sudden increase relative to claim attempts. Implemented for Quick Match claims in Gate 5 | Match backend owner |
| `go_no_go_confirmed_total` | counter | DEC-018: matches confirmed at T-30 (every position claimed) | Match backend owner |
| `go_no_go_cancelled_total` | counter | DEC-018: matches auto-cancelled at T-30. A sustained rise relative to confirmations is a product signal. Alert on overdue or FAILED `QUICK_MATCH_GO_NO_GO` jobs | Match backend owner |
| `payment_provider_failures_total` | counter | Any sustained provider failure; page when deposits cannot complete | Payments on-call |
| `payment_callback_rejections_total` | counter | Any signature failures above known test traffic | Security + payments on-call |
| `challenge_transition_conflicts_total` | counter | Sustained increase after challenge release | Team competition owner |
| `result_confirmation_failures_total` | counter | Sustained increase or confirmations stuck past policy timeout | Results owner |
| `durable_jobs_retries_total` | counter | Retry rate sustained above normal baseline | API on-call |
| `durable_jobs_terminal_failures_total` | counter | Any production increment | API on-call |
| `durable_job_scheduler_failures_total` | counter | Any repeated increment in two poll intervals | API on-call |
| `durable_jobs_oldest_pending_seconds` | gauge | Exceeds the strictest job-type service objective | API on-call |

Numeric thresholds require production traffic baselines and the approved payment/challenge/result policies. Alert routing must ultimately name real rotations in deployment configuration; the functional owners above are the repository contract.

## Remaining blocker

TKT-006 cannot be marked fully verified until TKT-005 replaces its planned TBD permissions/states after DEC-001, DEC-002, DEC-013, DEC-015, and DEC-016. At that point, validate each reserved challenge/result code and event against the approved transition table and promote only the names actually used.
