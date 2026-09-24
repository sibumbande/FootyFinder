# Match state and authorization contract

Status: **current implementation documented; planned policy blocked**  
Ticket: TKT-005  
Reviewed: 2026-09-24

This document records what the repository enforces today. It is not approval for the unresolved product rules listed at the end. A later change must update this document, shared contracts, server authorization, and negative tests together.

## Terms

- **Authenticated user**: an active account accepted by `requireAuth`.
- **Quick Match host**: `Match.createdById` for a `QUICK_GAME`.
- **Quick Match participant**: a user with participation in the match. Current access checks intentionally include historical participation in some read paths.
- **Attached Team member**: a current member of the Team attached to the requested `MatchTeam` side.
- **Side manager**: an OWNER or CAPTAIN of the Team attached to the requested side.
- **Fixture manager (current behavior)**: an OWNER or CAPTAIN of either Team attached to a Team Match. This broad permission is used by `MatchesService.assertManager`; it is not the future side-scoped rule.
- **Platform Admin**: an active user with `platformRole=ADMIN` and, for `/admin`, a verified Admin MFA session. Admin status does not currently bypass match-route authorization.

All `/matches` and `/teams` routes are authenticated. Public discovery is therefore public to signed-in users, not anonymous visitors.

## Current Quick Match state machine

Stored states are Prisma's `DRAFT`, `OPEN`, `READY`, `FULL`, `IN_PROGRESS`, `AWAITING_RESULT`, `COMPLETED`, and `CANCELLED`. The shared API type omits `FULL`; the mapper normalizes stored `FULL` to `OPEN`. This mismatch is intentionally only recorded here and is resolved by TKT-109.

```text
create
  |
  v
 OPEN -------- host marks ready --------> READY
  |                                      |
  | capacity may leave legacy FULL       |
  +-------------------+------------------+
                      | kickoff reached (scheduler)
                      v
                 IN_PROGRESS
                      | startsAt + durationMinutes (scheduler)
                      v
                AWAITING_RESULT
                      | host submits a valid result
                      v
                  COMPLETED

OPEN / READY / legacy FULL -- host cancellation before kickoff --> CANCELLED
```

Read-time lifecycle calculation can expose `IN_PROGRESS` or `AWAITING_RESULT` before the scheduler persists the corresponding state. `COMPLETED`, `CANCELLED`, and `DRAFT` are terminal/special in that calculation. Lobby mutations are allowed only while the effective state is `DRAFT`, `OPEN`, or `READY`; Quick Matches normally begin at `OPEN`.

## Current Team Match state machine

Team Match creation produces a private, free, HOME-only planning fixture in `DRAFT`. The Quick Match scheduler explicitly excludes Team Matches. `ready`, Quick Match join/leave/payment, and result completion paths reject or cannot advance a Team Match.

```text
OWNER/CAPTAIN creates fixture
             |
             v
           DRAFT -- fixture manager cancels --> CANCELLED
```

While in `DRAFT`, current Team members can use chat, availability, and lineup planning. Availability and lineup commands reject `CANCELLED` and `COMPLETED`. No implemented transition currently creates a challenger side, funds a fixture, starts it, requests result confirmation, or completes it.

## Current authorization matrix

“Manager” in a Team Match row means the current broad fixture-manager behavior unless “side manager” is stated.

| Command/route | Quick Match | Team Match | Valid current states/constraints |
|---|---|---|---|
| List `GET /matches` | Any authenticated user; public Quick Matches only | Excluded from discovery | Discoverable stored `OPEN`, `READY`, or `FULL`; effective/capacity filtering also applies |
| Read `GET /matches/:id` | Public: any authenticated user. Private: host, current/included participant, or prior participant | Attached Team member | Any state |
| Inspect invite `GET /matches/invite/:token` | Any authenticated user holding a valid token | Not available | Valid token; any state currently |
| Create `POST /matches` | Any authenticated user becomes host | Not through this route | Creates Quick Match |
| Create `POST /teams/:teamId/matches` | Not applicable | OWNER/CAPTAIN of creating Team | Creates `DRAFT` HOME fixture |
| Rotate invite | Host | Not available | Private Quick Match; mutable before kickoff |
| Update match | Host | Fixture manager | Mutable before kickoff |
| Cancel match | Host | Fixture manager | Mutable before kickoff; repeated cancellation is idempotent |
| Mark ready | Host | Rejected | Mutable before kickoff |
| Join and pay | Any authenticated user with sufficient wallet funds and idempotency key | Rejected | Quick Match accepting players before kickoff; Team capacity applies |
| Cancellation quote/status | Participant/self | Rejected or not applicable | Quote only before kickoff; status is self-scoped |
| Leave | Participant/self | Rejected | Before kickoff |
| Change participant side | Host may move any participant; participant may move self | Rejected | Before kickoff; self must first be in reserves; target capacity applies |
| Edit Quick Match formation | Host | Fixture manager reaches the generic formation path, but Team Match lineup APIs are the intended planning path | Mutable before kickoff; position remains in Team half |
| Submit result | Host | No reachable valid state | Effective `AWAITING_RESULT`; scorer membership and totals validated |
| Read participant list | Same access as match read | Attached Team member | Any state |
| Read lobby chat | Host or participant | Attached Team member | Any state |
| Send lobby chat | Host or participant | Attached Team member | Quick Match until configured post-match close; Team `DRAFT` remains open |
| Request side availability | Not applicable | Side OWNER/CAPTAIN | Team Match not `CANCELLED`/`COMPLETED` |
| Read side availability | Not applicable | Side member sees self; side OWNER/CAPTAIN sees all | Team Match not `CANCELLED`/`COMPLETED` |
| Update own availability | Not applicable | Side member, self only, after request | Team Match not `CANCELLED`/`COMPLETED` |
| Read side lineup | Not applicable | Side member | Team Match not `CANCELLED`/`COMPLETED` |
| Invite/assign/remove starter; open/move slot; select/remove substitute | Not applicable | Side OWNER/CAPTAIN | Team Match not `CANCELLED`/`COMPLETED`; repository invariants apply |
| Claim open slot | Not applicable | Side member, self only | Open, unclaimed slot; member cannot already be a starter |
| Decline selection | Not applicable | Side member, self only | Existing actionable selection |
| Finalize lineup/save Team default | Not applicable | Side OWNER/CAPTAIN | Lineup complete/eligible; repository invariants apply |
| Direct match action as Platform Admin | No bypass | No bypass | Admin uses separate moderation/dispute surfaces where implemented |

## Planned commands awaiting policy decisions

These rows are deliberately not assigned permissions or source states. Implementing them before the named decision is approved would invent product policy.

| Planned command | Role/side | Source states | Blocking decision |
|---|---|---|---|
| Enforce R80 Quick Match fee and exceptions | TBD | New Quick Match creation | DEC-001 |
| Apply 60-minute duration transition to scheduled records | TBD operational authority | TBD | DEC-002 |
| Override, move, or remove a claimed Team position | TBD manager/side and notification rules | TBD | DEC-013 |
| Create, withdraw, expire, reject, or accept a challenge | TBD host/challenger roles and side scope | TBD | DEC-015 |
| Fund/cancel an accepted challenge | TBD wallet actors and cancellation authority | TBD | DEC-014 and DEC-015 |
| Submit, confirm, correct, dispute, or time out a Team result | TBD submitter/confirmer/admin roles | TBD | DEC-016 |

## Required decisions before TKT-005 can be verified

TKT-005 remains blocked until DEC-001, DEC-002, DEC-013, DEC-015, and DEC-016 are approved. Once approved, replace every TBD row with:

1. exact source and destination states;
2. actor role and attached side;
3. authorization failure code;
4. concurrency/idempotency behavior;
5. required persisted notification/audit record;
6. positive and negative service tests.

Primary implementation references reviewed: `apps/api/src/app.ts`, `matches.routes.ts`, `matches.service.ts`, `matches.repository.ts`, `match-lifecycle.scheduler.ts`, `match-availability.*`, `match-lineup.*`, `chat.service.ts`, `teams.service.ts`, Prisma match models/enums, and shared match lifecycle/types.
