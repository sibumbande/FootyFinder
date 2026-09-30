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
- **FootyFinder referee** (Gate 8, DEC-020): an active account holding an active `RefereeGrant`; the match's referee is `Match.refereeUserId`. A referee may also play in a match they referee (D17 reversed).
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
                       | the FootyFinder referee (or an admin) records the final result (Gate 8);
                       | legacy matches without a go/no-go: the host submits a result
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
| Edit Quick formation (move/assign/remove) | Host | Generic path exists, but lineup API is canonical | Before kickoff; position remains in the side's half. Gate 5: every player change appends a `MatchFormationEvent` (`ORGANISER_*`) and persists a `MATCH_POSITION_CHANGED` notification for each affected player other than the host |
| Claim Quick position `POST /matches/:id/formation/slots/:slotId/claim` | Joined participant, self, own side (Gate 5) | Rejected (`TEAM_MATCH_PLANNING`) | Stored `OPEN`/`READY`, before kickoff; first commit wins; a player already in a slot is moved (`SELF_MOVE`); loser gets `POSITION_ALREADY_CLAIMED` with the authoritative formation |
| Submit result (legacy self-report) | Host, only for legacy matches without a go/no-go | Refused (`RESULT_BY_REFEREE`) | Refereed matches: the referee records the result (see Gate 8 below) |
| Read participants/chat | Host or authorized participant | Attached Team member | Chat write window and membership checks apply |
| Request/read side availability | Not applicable | Side OWNER/CAPTAIN requests; member sees self; side manager sees all | Not `CANCELLED`/`COMPLETED` |
| Update own availability | Not applicable | Attached side member, self only, after request | Not `CANCELLED`/`COMPLETED` |
| Read side lineup | Not applicable | Attached side member | Not `CANCELLED`/`COMPLETED` |
| Manage starters/substitutes/open slots | Not applicable | Side OWNER/CAPTAIN | Own side; repository invariants; not `CANCELLED`/`COMPLETED` |
| Claim/decline selection | Not applicable | Attached member, self only | Existing actionable/open selection; no duplicate starter |
| Finalize/save lineup | Not applicable | Side OWNER/CAPTAIN | Own side; eligibility/completeness rules apply |
| Direct action as Platform Admin | No implicit bypass | No implicit bypass | Separate moderation/dispute commands only where implemented |

## Approved target state machines

### Quick Match T-30 go/no-go (DEC-018)

Status: **implemented** (TKT-314). Applies to Quick Matches with `goNoGoAt` set (created under DEC-018); legacy matches keep the older rules.

```text
OPEN / READY (lobby open: join, leave, claim, host edits, host cancel)
      |
      | goNoGoAt = kickoff - 30 min  (lobby frozen from here: 409 LINEUP_LOCKED)
      v
QUICK_MATCH_GO_NO_GO durable job (idempotent, Match row lock)
      |-- every formation position claimed --> confirmedAt set (match goes ahead; subs optional)
      |                                         --> kickoff: IN_PROGRESS (scheduler starts only confirmed matches)
      '-- otherwise --> CANCELLED (cancellationReason POSITIONS_UNFILLED):
                        every SUCCEEDED R80 payment fully credited once, reservation CANCELLED,
                        nothing owed to the venue, joined players and host notified
```

- Every place costs the platform-fixed R80, subs included. Hosts cannot set a fee and place no venue guarantee.
- Leaving before T-30 keeps the 12-hour credit rule. A late leaver is refunded if the match is later auto-cancelled.
- Host cancellation is allowed until T-30 only (`cancellationReason ORGANISER_CANCELLED`). It uses the same refund core and idempotency keys, so a host cancel followed by the T-30 job never refunds twice.

### Quick Match position claims (Gate 5)

Status: **implemented in Gate 5** (claim command, organiser audit/notification, formation versioning). The rules below are now current behavior.

- A joined participant may claim an open position on their own selected side before kickoff. A participant who already holds a slot and claims another open slot on their side is moved atomically (`SELF_MOVE`); they never hold two positions.
- The first transaction to commit wins. A losing claimant receives a stable conflict response and must refetch.
- The organiser may move or remove a player before kickoff; the affected player receives a persisted notification and the action is audited.
- Claims never change payment, participation, or side membership implicitly.

### Team matches (Gate 7, implemented; DEC-019 replaces the DEC-015 challenge flow)

```text
HOME owner/captain publishes (always PUBLIC, OPEN, managed slot, go/no-go at T-30)
other side open -- another team's owner/captain "Load my team" -------------> taken by TEAM
other side open -- first individual joins ("Open to both" only) -----------> taken by INDIVIDUALS
INDIVIDUALS with nobody left joined -- a team loads (N1) -------------------> taken by TEAM
taken by TEAM -- that team's owner/captain withdraws before T-30 (N5) ------> other side open
"Teams only", no team 24h before kickoff (published earlier) ------------> CANCELLED (NO_OPPONENT)
T-30 go/no-go: GO (meters full; individuals side: every AWAY position claimed) -> READY (confirmed)
T-30 go/no-go: otherwise ------------------------------------------------> CANCELLED
HOME owner/captain cancels before T-30 (D6/N5) ---------------------------> CANCELLED (TEAM_CANCELLED)
READY -- kickoff --> IN_PROGRESS (venue payable created) -> AWAITING_RESULT
```

- There is no approval step and no challenge record: the other side is taken instantly, first come first served. Loading a team and an individual joining both take the Match row lock, so exactly one wins; database triggers refuse an AWAY team unless the side is taken by a team, and a JOINED individual unless it is taken by individuals (and never on HOME).
- Nobody plays against their own team (N2, `409 OWN_TEAM_CONFLICT`).
- Only authorized wallet actors (the side's owner/captains) fill that side's meter; money moves only through the team-wallet ledger (holds, captures, releases). Cancellation releases every hold and refunds every individual once.
- Every side change and team-match command is recorded in the append-only `TeamMatchAuditEvent` with its actor.

### Referees and final results (Gate 8, DEC-020, implemented)

The DEC-016 propose/confirm/dispute model was replaced by DEC-020 and is not built.

```text
publish -- default referee free (D28) ---------------------------------> referee assigned
publish -- no default / default busy ----------------------------------> unassigned (admins alerted now and at T-24h)
unassigned -- admin assigns (no overlapping match, D27) ---------------> referee assigned
referee assigned -- referee declines before T-30 / admin removes -----> unassigned (admins alerted)
T-30 go/no-go: players' conditions met but no active referee ----------> CANCELLED (NO_REFEREE, full refunds; D23 order)
kickoff (scheduler) -----------------------------------------------------> IN_PROGRESS + permanent lineup record
IN_PROGRESS / AWAITING_RESULT -- assigned referee records result -------> COMPLETED (finalSource REFEREE)
AWAITING_RESULT -- no result 2h after end ------------------------------> admins alerted (D4)
IN_PROGRESS / AWAITING_RESULT -- admin enters result (fresh MFA) -------> COMPLETED (finalSource ADMIN)
COMPLETED -- admin corrects a clear recording error (reason, fresh MFA) -> COMPLETED (new revision)
```

- The referee's result is final (D5): outcome PLAYED / FORFEIT / ABANDONED, goals with scorer and optional assister from the lineup record, own goals credited to the side only, players who did not play. The first result written wins (unique result per match, Match row lock).
- Captains (team side owner/captains; the host of a Quick Match) may send their own version from the scheduled end until 24h after (evidence for admins only) and report a problem within 24h of the final result. Results cannot be disputed.
- Every version is a permanent `MatchResultRevision` (referee submission, admin entry, admin correction with its reason); admin actions are also in `AdminAuditLog`. Statistics are read from the current result, so corrections flow through.
- Team lineups lock at kickoff. Reviews (DEC-017) open once the result is final.

## Approved target authorization matrix

| Planned command | Allowed actor/side | Valid source state | Concurrency, notification, and audit rule |
|---|---|---|---|
| Claim Quick position | Joined participant, self, own side | Underlying `OPEN`/`READY`, before kickoff | First commit wins; stable conflict and refetch |
| Override/move/remove Quick claim | Quick Match host | Underlying `OPEN`/`READY`, before kickoff | Notify affected player; audit organiser action |
| Publish team match (Gate 7) | OWNER/CAPTAIN of the team playing as HOME | Managed slot; team wallet available >= HOME fee; fewer than 2 matches awaiting an opponent | Team row lock; audited; no money moves |
| Load my team (Gate 7) | OWNER/CAPTAIN of another team | Other side open (or emptied individuals side), before T-30 | Match row lock, first come wins; own fee snapshot; notify both teams |
| Join the other side as an individual (Gate 7) | Any eligible player not on the home team | "Open to both", side open or taken by individuals, before T-30 | Match row lock; R80 debit (DEC-018) |
| Withdraw my team (Gate 7, N5) | OWNER/CAPTAIN of the AWAY team | Taken by that team, before T-30 | Holds released; side reopens; notify HOME |
| Unmatched cancel (Gate 7) | Durable system job | "Teams only", side open 24h before kickoff | Idempotent; nothing owed |
| Edit / cancel team match (Gate 7) | HOME OWNER/CAPTAIN only | Before T-30 | Cancel releases every hold and refunds individuals; audited |
| Fill meter / change subs (Gate 7, TKT-709) | OWNER/CAPTAIN of that side | Side taken by a team, before T-30 | Team-wallet hold/release, idempotent |
| Grant / remove referee role (Gate 8) | Platform Admin with fresh MFA | Active account (grant) | Written reason; permanent grant rows; audited; removal unassigns unfinished matches |
| Assign / change / remove referee (Gate 8) | Platform Admin | Refereed match not cancelled/completed, before its end | Referee's User row lock; D27 overlap refused (`REFEREE_BUSY`); permanent history; referee notified |
| Set default referee (Gate 8) | Platform Admin with fresh MFA | Any | Audited; used at publish when free |
| Decline assignment (Gate 8) | The assigned referee | Before T-30 | Match unassigned; admins alerted |
| Record final result (Gate 8) | The assigned active referee | `IN_PROGRESS`/`AWAITING_RESULT`, no result | Match row lock; first result wins; revision; notices to lineup and team members |
| Send own version (Gate 8) | Side OWNER/CAPTAIN; Quick Match host | End of match to end + 24h | Permanent, latest used; never changes the result |
| Report a problem (Gate 8) | Side OWNER/CAPTAIN; Quick Match host | Within 24h of the final result | One open report each; admin queue |
| Enter / correct result (Gate 8) | Platform Admin with fresh MFA | Entry: started, no result. Correction: referee/admin result | Written reason; new revision; audited; notices |
| Review opposing team (Gate 8, DEC-017) | Lineup player who played, not a member of the reviewed team | Final PLAYED/FORFEIT result | One per match; comment public after approval; author private |

Implementation must define the stable error/event names from TKT-006 before exposing these target commands. Primary references reviewed: `apps/api/src/app.ts`, Match routes/services/repositories/mapper/scheduler, availability and lineup modules, chat and Team services, Prisma Match models/enums, and shared Match lifecycle/types.
