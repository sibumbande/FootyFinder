# Match state and authorization contract

Status: **current behavior and approved target policy documented**

Ticket: TKT-005

Reviewed: 2026-09-25

This document separates behavior implemented today from approved policy for later gates. A target-policy row is not evidence that its command has been implemented. Changes to these contracts must update shared types, server authorization, negative tests, audit/notification behavior, and this document together.

## Terms

- **Authenticated user**: an active account accepted by `requireAuth`.
- **Quick Match host**: `Match.createdById` for a `QUICK_GAME`.
- **Quick Match participant**: a user with a participation in the Match.
- **Attached Team member**: a current member of the Team attached to the requested `MatchTeam` side.
- **Side manager**: an OWNER or CAPTAIN of the Team attached to the requested HOME or AWAY side.
- **Platform Admin**: an active user with `platformRole=ADMIN` and, for `/admin`, a verified Admin MFA session. Admin status does not implicitly bypass match-route authorization.

All current `/matches` and `/teams` routes require authentication. “Public” discovery currently means discoverable by signed-in users, not anonymous access.

## Current Quick Match state machine

The database stores `DRAFT`, `OPEN`, `READY`, `IN_PROGRESS`, `AWAITING_RESULT`, `COMPLETED`, and `CANCELLED` after the Gate 1 migration. `FULL` is an API-only availability state derived when an otherwise open Match has no paid capacity remaining. It is never written as lifecycle state and disappears immediately when a place is released.

```text
create
  |
  v
 OPEN -------- host marks ready --------> READY
  |                                        |
  +--------------------+-------------------+
                       | kickoff reached (scheduler)
                       v
                  IN_PROGRESS
                       | startsAt + 60 minutes (scheduler)
                       v
                 AWAITING_RESULT
                       | host submits a valid result
                       v
                   COMPLETED

OPEN / READY -- capacity reached --> API exposes derived FULL
derived FULL -- place released --> API exposes OPEN or READY again
OPEN / READY -- host cancellation before kickoff --> CANCELLED
```

Read-time lifecycle calculation can expose `IN_PROGRESS` or `AWAITING_RESULT` before the scheduler persists the transition. Lobby mutations remain bounded by the underlying mutable lifecycle and kickoff time. New Quick Games accept a whole-rand per-player fee from R0 through R500, default to R80, snapshot the chosen value, and run for 60 minutes.

## Current Team Match state machine

Team Match creation currently produces a private, free, HOME-only planning fixture in `DRAFT`. The Quick Match scheduler excludes Team Matches. Ready, Quick Match join/leave/payment, and result-completion paths do not advance a Team Match.

```text
OWNER/CAPTAIN creates fixture
             |
             v
           DRAFT -- authorized fixture cancellation --> CANCELLED
```

While in `DRAFT`, current Team members can use chat, availability, and lineup planning. Availability and lineup commands reject `CANCELLED` and `COMPLETED`. Challenger attachment, Team funding, competitive lifecycle transitions, and two-party result confirmation are approved target behavior for Gates 7 and 8, not current behavior.

## Current authorization matrix

The existing generic Team-fixture update/cancel permission accepts an OWNER or CAPTAIN of either attached Team. Later side-sensitive commands must use the target matrix below instead of inheriting that broad permission.

| Command/route | Quick Match | Team Match | Current state/constraint |
|---|---|---|---|
| List `GET /matches` | Any authenticated user; public Quick Matches only | Excluded | Stored `OPEN`/`READY`; effective lifecycle and requested capacity availability apply |
| Read `GET /matches/:id` | Public: authenticated user. Private: host, included/current/prior participant | Attached Team member | Any state |
| Inspect invitation | Authenticated holder of valid token | Not available | Token validity; inspection does not join or charge |
| Create Quick Match | Any authenticated user becomes host | Not applicable | Creates `OPEN`; fee R0-R500 whole rand; 60 minutes |
| Create Team fixture | Not applicable | Creating Team OWNER/CAPTAIN | Creates HOME-only `DRAFT`, free fixture |
| Rotate invite | Host | Not available | Private, mutable Quick Match before kickoff |
| Update/cancel | Host | Current broad fixture manager | Mutable before kickoff; repeat cancellation is idempotent |
| Mark ready | Host | Rejected | Mutable Quick Match before kickoff |
| Join and pay | Authenticated user with funds and idempotency key | Rejected | Under capacity, stored `OPEN`/`READY`, before kickoff |
| Cancellation quote/status | Participant, self only | Rejected | Before kickoff; self-scoped |
| Leave | Participant, self only | Rejected | Before kickoff |
| Change participant side | Host may move eligible participant; reserve participant may move self | Rejected | Destination capacity and formation constraints apply |
| Edit Quick formation | Host | Generic path exists, but lineup API is canonical | Before kickoff; position remains in the side's half |
| Submit result | Host | No reachable current Team state | Effective `AWAITING_RESULT`; scorer and totals validation apply |
| Read participants/chat | Host or authorized participant | Attached Team member | Chat write window and membership checks apply |
| Request/read side availability | Not applicable | Side OWNER/CAPTAIN requests; member sees self; side manager sees all | Not `CANCELLED`/`COMPLETED` |
| Update own availability | Not applicable | Attached side member, self only, after request | Not `CANCELLED`/`COMPLETED` |
| Read side lineup | Not applicable | Attached side member | Not `CANCELLED`/`COMPLETED` |
| Manage starters/substitutes/open slots | Not applicable | Side OWNER/CAPTAIN | Own side; repository invariants; not `CANCELLED`/`COMPLETED` |
| Claim/decline selection | Not applicable | Attached member, self only | Existing actionable/open selection; no duplicate starter |
| Finalize/save lineup | Not applicable | Side OWNER/CAPTAIN | Own side; eligibility/completeness rules apply |
| Direct action as Platform Admin | No implicit bypass | No implicit bypass | Separate moderation/dispute commands only where implemented |

## Approved target state machines

### Quick Match position claims (Gate 5)

- A joined participant may claim an open position on their own selected side before kickoff.
- The first transaction to commit wins. A losing claimant receives a stable conflict response and must refetch.
- The organiser may move or remove a player before kickoff; the affected player receives a persisted notification and the action is audited.
- Claims never change payment, participation, or side membership implicitly.

### Team challenge and funding (Gate 7)

```text
HOME draft -> published/open for challenge -> one or more pending challenges
pending challenge -- challenger withdraws / host declines / expiry --> closed challenge
pending challenge -- HOME side accepts first valid offer --> accepted AWAY side
accepted fixture -- both funding obligations satisfied --> READY
READY -- kickoff --> IN_PROGRESS -> AWAITING_RESULT
```

- A Team OWNER or active CAPTAIN may publish, create, withdraw, accept, or decline on behalf of their own side only.
- Multiple pending challenges are allowed. The first accepted challenge atomically assigns AWAY and closes the remaining pending challenges.
- A challenge expires at the earlier of 48 hours after creation or 24 hours before kickoff.
- The funding policy in DEC-014 applies after acceptance. Only authorized wallet actors may reserve/capture funds. Cancellation uses the approved actor, timing, release, and audit rules; no role may directly mutate balances.
- Every challenge transition is idempotent or conflict-safe and produces the approved persisted notification/audit record after transaction commit.

### Team result confirmation (Gate 8)

```text
AWAITING_RESULT -- HOME owner/captain proposes --> RESULT_PROPOSED
RESULT_PROPOSED -- AWAY owner/captain confirms --> COMPLETED
RESULT_PROPOSED -- AWAY rejects / 48h timeout --> DISPUTED
RESULT_PROPOSED -- HOME revises before confirmation --> RESULT_PROPOSED (timer resets)
DISPUTED -- authorized admin append-only resolution --> COMPLETED
```

- Only a current HOME OWNER/CAPTAIN proposes or revises; only a current AWAY OWNER/CAPTAIN confirms or rejects.
- Confirmation/rejection is scoped to the opposing side and uses first-commit-wins concurrency.
- A rejection or 48-hour timeout opens a dispute; it must not silently finalize the proposal.
- Administrative correction is append-only, reasoned, audited, and does not rewrite prior proposals or confirmations.

## Approved target authorization matrix

| Planned command | Allowed actor/side | Valid source state | Concurrency, notification, and audit rule |
|---|---|---|---|
| Claim Quick position | Joined participant, self, own side | Underlying `OPEN`/`READY`, before kickoff | First commit wins; stable conflict and refetch |
| Override/move/remove Quick claim | Quick Match host | Underlying `OPEN`/`READY`, before kickoff | Notify affected player; audit organiser action |
| Publish Team fixture | HOME OWNER/CAPTAIN | HOME `DRAFT`, required venue/time facts present | Idempotent; notify eligible Team audience |
| Create/withdraw challenge | Challenger OWNER/CAPTAIN, own Team | Published fixture / own pending challenge | Idempotent close; notify HOME managers |
| Accept/decline challenge | HOME OWNER/CAPTAIN | Pending, unexpired challenge | First acceptance wins and closes competitors atomically |
| Expire challenge | Durable system job | Pending at expiry | Idempotent; notify both side managers |
| Fund accepted fixture | Actor authorized by Team-wallet governance | Accepted, funding open | Ledger/hold idempotency; audit every money transition |
| Cancel funded fixture | Actor permitted by approved cancellation policy | Pre-kickoff eligible state | Transactional releases/charges; notify both sides |
| Propose/revise Team result | HOME OWNER/CAPTAIN | `AWAITING_RESULT` / unconfirmed proposal | Revision appends and resets 48-hour timer |
| Confirm/reject Team result | AWAY OWNER/CAPTAIN | Active proposal | First terminal response wins; persisted notifications |
| Time out result | Durable system job | Proposal older than 48 hours | Idempotently creates/links dispute |
| Resolve disputed result | MFA-verified Platform Admin through moderation surface | `DISPUTED` | Append-only correction, mandatory reason, audit |

Implementation must define the stable error/event names from TKT-006 before exposing these target commands. Primary references reviewed: `apps/api/src/app.ts`, Match routes/services/repositories/mapper/scheduler, availability and lineup modules, chat and Team services, Prisma Match models/enums, and shared Match lifecycle/types.
