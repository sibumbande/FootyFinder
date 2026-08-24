# Footy Finder System Audit

**Audit date:** 2026-08-23

**Branch:** `implementing-more-features`

**Commit:** `aa03e5bad7be6fa7f7c0fc4b6bf1c14d60aa38d5` (`Phase 1E complete`)

**Initial worktree:** clean

**Audit type:** source/runtime application review, not a formal penetration test
**Permitted repository change:** this report only

The evidence order used was runtime behavior, live PostgreSQL/Prisma state, source, tests, shared contracts, then documentation. Secret values were not read into or copied into this report.

> **Post-audit remediation status (2026-08-24):** This document remains the historical audit of commit `aa03e5b`. Browser/API contracts, atomic notifications, realtime/session security, Admin identity, managed venues/pricing, support/test data, financial integrity, and managed-field reservations have since been implemented and independently retested. The new baseline includes revocable MFA-verified Admin sessions, append-only audit history, internal-note privacy, production-failing test-data gates, a lock-aware wallet boundary, PostgreSQL balance/ledger/terminal-state constraints, idempotent holds, reconciliation, distributed durable jobs, non-overlapping field reservations, immutable booking snapshots, Admin Match loading, and player funding pools. The original Match-local `Venue` remains a historical snapshot boundary populated from the immutable reservation snapshot. `AUDIT-FIN-001`, `AUDIT-FIN-002`, the objective wallet portion of `AUDIT-DB-002`, and the reservation prerequisite formerly blocking future field booking are now closed. `AUDIT-CFG-002` remains improved but open pending readiness checks and operational metrics. Team Wallet/opponent funding, scalability, accessibility, and policy findings remain open unless a later status note explicitly closes them.

## A. EXECUTIVE SUMMARY

Footy Finder is a coherent, working npm-workspaces TypeScript monorepo. Its strongest areas are shared format/formation/lifecycle contracts, privacy-safe response mapping, serializable Match and Team-Match mutations, integer-cent money storage, hashed Team invitations, isolated Team-Match availability/selection/lineup persistence, and a well-integrated React/TanStack Query/Socket.IO frontend. All supported static gates passed, all 129 automated tests passed, all five PostgreSQL phase smokes passed, and an authenticated HTTP plus Socket.IO smoke passed with exact fixture cleanup.

No P0 issue was proven. Five P1 issues should be addressed before the next feature phase:

1. `AUDIT-API-001`: CORS omits `PUT`, blocking browser access to implemented Team availability, lineup, and formation mutations.
2. `AUDIT-CON-001`: several actions commit domain or financial state and then await notification creation; a notification failure can return an error after the action succeeded.
3. `AUDIT-RT-001`: authorization is checked only when a socket joins a Match/Team room; revoked members can remain subscribed.
4. `AUDIT-RT-002`: Match/Team rooms are not rejoined after Socket.IO reconnect, leaving non-polled Team-Match state stale.
5. `AUDIT-SEC-001`: authentication and messaging/resource-creation endpoints have no rate limiting.

The server-side money mutations inspected are transactionally safe against obvious double-debit, overspend, duplicate cancellation credit, and duplicate position claim races. The live development database had no negative wallet, ledger/balance mismatch, capacity violation, cross-Team formation assignment, cross-Match scorer, or unauthorized message-author anomaly. However, the wallet is not ready for real external funds: provider reconciliation, durable pending-payment recovery, a non-negative database constraint, immutable-history retention, and a centralized financial boundary are still needed.

Team Match Phase 1A-1E is materially implemented end to end, but the CORS defect makes multiple `PUT`-based controls fail in a real browser. Realtime and notification consistency also need hardening before building more features on top of those mechanisms.

**Final decision: READY AFTER P0/P1 REMEDIATION.** There are no P0 findings; remediate `AUDIT-API-001`, `AUDIT-CON-001`, `AUDIT-RT-001`, `AUDIT-RT-002`, and `AUDIT-SEC-001` first.

## B. REPOSITORY / SYSTEM MAP

### Repository and workspace map

| Workspace/path | Purpose | Entry point | Build/test/lint |
|---|---|---|---|
| root | npm workspace orchestration | `package.json` | builds shared/client first; runs workspace lint/tests/build |
| `apps/api` | Express API, Socket.IO, Prisma/PostgreSQL, scheduler | `src/server.ts`, `src/app.ts` | `tsc`; Vitest; five DB smoke scripts; Prisma CLI |
| `apps/web` | React 18/Vite SPA | `src/main.tsx`, `app/router/AppRouter.tsx` | `tsc -b` + Vite; Vitest; TypeScript lint |
| `packages/shared` | Zod schemas, DTOs, enums, socket names, formats, formations, lifecycle | `src/index.ts` | `tsc`; Vitest; TypeScript lint |
| `packages/api-client` | framework-light typed HTTP client | `src/index.ts` | `tsc`; Vitest; TypeScript lint |
| `apps/api/prisma` | schema and 10 committed migrations | `schema.prisma` | format, validate, generate, migrate status |
| `apps/api/scripts` | isolated Phase 1A-1E PostgreSQL smokes | five `smoke-*.ts` files | per-script typecheck, bundle, execute, cleanup |
| `docs` | persistent technical documentation | this file | no separate tooling |

There is no seed module, public asset directory, OpenAPI specification, end-to-end browser suite, or machine-readable architecture document. Generated `dist`, dependencies, `.env`, TypeScript build metadata, and coverage are ignored. Generated uploads are not ignored; see `AUDIT-CFG-003`.

### Dependency/system map

```text
Browser
  -> React 18 / Vite / React Router
  -> TanStack Query + local component state + Theme/Notification contexts
  -> @footy-finder/api-client
  -> Express routes -> controllers -> services -> repositories
  -> Prisma Client -> PostgreSQL

Realtime
  React/socket.io-client <-> Socket.IO server <-> in-process domain EventEmitter
  Persisted state is normally recovered through TanStack Query invalidation/polling.

Shared
  apps/web ---------> @footy-finder/shared
  apps/api ---------> @footy-finder/shared
  api-client -------> @footy-finder/shared
```

The normal backend dependency direction is route -> controller -> service -> repository -> Prisma. The lifecycle scheduler is the main justified exception: it is a background process that calls Prisma directly. Transaction-created Team-Match notifications are correctly persisted in repositories and published after commit. Other domains do not consistently use that pattern.

### Domain map

```text
User
|-- PlayerProfile -- PlayerPreferredPosition
|-- WalletAccount -- WalletTransaction
|-- MatchParticipant -- MatchPayment -- ParticipantCancellation
|-- TeamMembership -- Team -- TeamInvite / TeamFormation
|-- ConversationParticipant -- Conversation -- DirectMessage
`-- Notification

Match
|-- Venue
|-- MatchParticipant -- FormationSlot
|-- LobbyMessage
|-- MatchResult -- MatchScorer
|-- MatchPayment -- ParticipantCancellation
`-- MatchTeam (HOME/AWAY snapshot)
    |-- TeamMatchAvailability
    |-- TeamMatchSelection
    `-- TeamMatchLineupSlot
```

Permanent Team membership, Team default formation, Match-Day availability, Match-Day selection/lineup, Quick Game participants/formations, and historical results are separate persisted concepts. This is a major architectural strength.

### Complete API inventory

Legend: `C/S/R` names the controller, service, and repository/module path. `Tx` means the core mutation is transactional. All response bodies use `{ data }`; application errors normally use `{ error, code, details? }`.

| Method and route | Auth / server role | C/S/R, validation, transaction/events, current tests |
|---|---|---|
| `GET /health` | Public | direct app handler; runtime/app test |
| `POST /auth/register` | Guest/public | Auth controller/service/UsersRepository; Zod; Argon2id; auth unit + HTTP smoke |
| `POST /auth/login` | Guest/public | Auth controller/service/UsersRepository; Zod; auth unit |
| `POST /auth/logout` | Public | Auth controller; clears cookie only; no direct success test |
| `GET /players/:userId` | Public | ProfilesController/UsersService/UsersRepository; safe DTO; no route-param schema; no direct test |
| `PATCH /players/me/profile` | Auth, self | ProfilesController/UsersService/UsersRepository; shared Zod; HTTP smoke |
| `GET /users` | Auth | UsersController/UsersService/UsersRepository; capped 100, no pagination; no direct test |
| `GET /users/me` | Auth, self | UsersController/UsersService/UsersRepository; auth middleware/app test + HTTP smoke |
| `GET /matches` | Auth | Matches controller/service/repository; discovery Zod; service/schema tests |
| `POST /matches` | Auth | Matches controller/service/repository; create Zod; serializable Tx; service/web/shared + HTTP smoke |
| `GET /matches/invite/:token` | Auth + token | Matches controller/service/repository; raw token lookup; no direct test |
| `GET /matches/:id` | Auth; public Match or private host/current/historical participant/attached member | Matches controller/service/repository; no UUID schema; service + smokes |
| `PATCH /matches/:id` | Quick host or Team OWNER/CAPTAIN | Matches controller/service/repository; update Zod; no realtime event; weak direct coverage |
| `DELETE /matches/:id` | Quick host or Team OWNER/CAPTAIN | Matches controller/service/repository; serializable refund/cancel Tx; service + capacity smoke |
| `POST /matches/:id/ready` | Quick host | Matches controller/service/repository; no body; service coverage |
| `POST /matches/:id/join` | Auth; Quick Game only | Matches controller/service/repository; Zod + `Idempotency-Key`; serializable Tx; service + 1A smoke |
| `GET /matches/:id/cancellation-quote` | Joined Quick player | Matches controller/service/repository; 12-hour helper; lifecycle tests + 1A smoke |
| `GET /matches/:id/cancellation-status` | Auth; own row | Matches controller/service/repository; no direct authorization leak; 1A smoke |
| `POST /matches/:id/leave` | Joined Quick player | Matches controller/service/repository; serializable Tx; participant-left event; service + 1A smoke |
| `PATCH /matches/:id/formation/slots/:slotId` | Quick host; currently also Team manager | Matches controller/service/repository; shared Zod; serializable Tx; formation event; unit/UI tests |
| `PATCH /matches/:id/participants/:participantId/team` | Self reserve or Quick host | Matches controller/service/repository; Zod; serializable Tx; event; service/smoke |
| `POST /matches/:id/result` | Quick host (Team draft cannot reach result state) | Matches controller/service/repository; result Zod; serializable Tx; result event; service tests |
| `GET /matches/:id/participants` | Same access as Match read | Matches controller/service/repository; service test indirectly |
| `POST /matches/:id/team-sides/:side/availability/request` | Attached Team OWNER/CAPTAIN | MatchesController/MatchAvailabilityService/Repository; side Zod; locked serializable Tx; persisted notifications then event; unit + 1C/1E smoke |
| `GET /matches/:id/team-sides/:side/availability` | Current attached member; managers see all, member own row + totals | availability service/repository; strict availability/selected query Zod; unit + 1C smoke |
| `PUT /matches/:id/team-sides/:side/availability/me` | Current attached member, self | availability service/repository; body Zod; serializable Tx; event; unit/smoke; **blocked by current browser CORS** |
| `GET /matches/:id/team-sides/:side/lineup` | Current attached member | MatchLineupService/Repository; locked reads not required; unit + 1D/1E smoke |
| `PUT /matches/:id/team-sides/:side/lineup/selections/:userId/invite` | OWNER/CAPTAIN | lineup service/repository; locked serializable Tx + persisted notification/event; unit/smoke; **CORS blocked** |
| `PUT /matches/:id/team-sides/:side/lineup/slots/:slotId/player` | OWNER/CAPTAIN | lineup service/repository; body Zod; locked serializable Tx; notification/event; unit/smoke; **CORS blocked** |
| `POST /matches/:id/team-sides/:side/lineup/slots/:slotId/remove` | OWNER/CAPTAIN | lineup service/repository; body Zod; locked serializable Tx; notification/event; unit/smoke |
| `POST /matches/:id/team-sides/:side/lineup/slots/:slotId/open` | OWNER/CAPTAIN | lineup service/repository; body Zod; locked serializable Tx; member notifications/event; unit/smoke |
| `POST /matches/:id/team-sides/:side/lineup/slots/:slotId/claim` | Current member | lineup service/repository; locked serializable Tx; manager notifications/event; concurrent DB smoke |
| `PATCH /matches/:id/team-sides/:side/lineup/slots/:slotId/position` | OWNER/CAPTAIN | lineup service/repository; coordinate Zod + half check; locked serializable Tx; event; 1E smoke |
| `PUT /matches/:id/team-sides/:side/lineup/substitutes/:userId` | OWNER/CAPTAIN | lineup service/repository; locked serializable Tx; notification/event; unit/smoke; **CORS blocked** |
| `DELETE /matches/:id/team-sides/:side/lineup/substitutes/:userId` | OWNER/CAPTAIN | lineup service/repository; locked serializable Tx; notification/event; unit/smoke |
| `POST /matches/:id/team-sides/:side/lineup/selections/me/decline` | Current member, self | lineup service/repository; locked serializable Tx; manager notification/event; unit/smoke |
| `POST /matches/:id/team-sides/:side/lineup/finalize` | OWNER/CAPTAIN | lineup service/repository; locked serializable Tx; first-finalization notifications/event; unit/smoke |
| `POST /matches/:id/team-sides/:side/lineup/save-as-team-default` | OWNER/CAPTAIN | lineup service/repository; locked serializable Tx; Team + Match invalidation events; unit/smoke |
| `GET /matches/:id/messages` | Host, JOINED participant, or current attached Team member | MatchesController/ChatService/ChatRepository; unbounded history; chat unit + HTTP smoke |
| `POST /matches/:id/messages` | Same, within Quick chat window; Team draft stays open | Chat service/repository; message Zod; persist then event; chat unit + HTTP smoke |
| `POST /wallet/deposits/demo` | Auth, self wallet | WalletController/DepositsService/WalletRepository; fixed R500 + idempotency header; Tx settlement; unit + HTTP smoke |
| `GET /conversations` | Auth, participant-owned list | MessagingController/Service/Repository; unbounded conversations; no dedicated tests |
| `POST /conversations` | Auth | Messaging controller/service/repository; recipient UUID Zod; atomic upsert by direct key; no dedicated tests |
| `GET /conversations/:id` | Conversation participant | Messaging controller/service/repository; unbounded history; no route-param schema/tests |
| `POST /conversations/:id/messages` | Conversation participant | Messaging service/repository; content Zod; Tx persist/update then notification/event; no dedicated tests |
| `POST /conversations/:id/read` | Conversation participant | Messaging service/repository; updateMany ownership check; no dedicated tests |
| `GET /notifications` | Auth, own rows | Notifications controller/service/repository; latest 100; provider UI tests only |
| `POST /notifications/read-all` | Auth, own rows | Notifications service/repository; updateMany; no API test |
| `POST /notifications/:id/read` | Auth, own row | Notifications service/repository; ownership-scoped updateMany; no API test |
| `GET /teams` | Auth | TeamsController/Service/Repository; current user's Teams; team unit/web tests |
| `POST /teams` | Auth | Teams controller/service/repository; create Zod; serializable owner/default-formation Tx; unit/web/HTTP smoke |
| `GET /teams/:teamId` | Auth; currently no membership requirement | Teams controller/service/repository; privacy-safe but full roster; unit/web/HTTP smoke |
| `PATCH /teams/:teamId` | Team OWNER | Teams controller/service/repository; update Zod; Team event; unit/web |
| `DELETE /teams/:teamId` | Team OWNER | Teams service/repository; serializable cancellation + Team delete; unit/smokes |
| `POST /teams/:teamId/matches` | OWNER/CAPTAIN | TeamsController/Service + MatchesRepository; Team-Match Zod; serializable Tx; unit/web/1B-1E smokes |
| `GET /teams/:teamId/matches` | Current Team member | Teams service + MatchesRepository; unit/web/1B smoke |
| `POST /teams/:teamId/image` | Team OWNER | Multer + Teams service/repository/storage; 5 MB/MIME/signature; storage/unit tests |
| `GET /teams/:teamId/members` | Auth; currently inherits unrestricted Team read | Teams service/repository; unit/web |
| `PATCH /teams/:teamId/members/:userId` | Team OWNER | Teams service/repository; role Zod; no realtime role event; unit/web |
| `DELETE /teams/:teamId/members/:userId` | Team OWNER | Teams service/repository; serializable formation cleanup; Team event; unit/web |
| `POST /teams/:teamId/invites` | OWNER/CAPTAIN | Teams service/repository; SHA-256 token hash; no body; unit/web |
| `GET /teams/:teamId/invites` | OWNER/CAPTAIN | Teams service/repository; unit/web |
| `DELETE /teams/:teamId/invites/:inviteId` | OWNER/CAPTAIN | Teams service/repository; scoped updateMany; unit/web |
| `GET /teams/:teamId/formations/:format` | Auth; currently inherits unrestricted Team read | Teams service/repository; format Zod; unit/web |
| `PUT /teams/:teamId/formations/:format` | OWNER/CAPTAIN | Teams service/repository; formation Zod; serializable replace Tx + event; unit/web; **CORS blocked** |
| `PATCH /teams/:teamId/formations/:format/slots/:slotId` | OWNER/CAPTAIN | Teams service/repository; slot Zod; serializable Tx + event; unit/web |
| `GET /team-invites/:token` | Public | Teams controller/service/repository; strict token regex + hashed lookup; app/team/web tests |
| `POST /team-invites/:token/accept` | Auth | Teams service/repository; locked by serializable isolation + atomic usage update + unique membership; unit/smoke/web |

Total HTTP surface: **68 routes**, including health.

## C. BUILD & VERIFICATION RESULTS

### Commands and exact outcomes

| Check | Result | Evidence/classification |
|---|---|---|
| Git state | PASS | clean at audit start; branch/commit recorded above |
| `npx prisma format` | PASS after shell-specific retry | `npx.ps1` was blocked by local PowerShell execution policy; `npx.cmd prisma format` completed with no Git diff (`ENVIRONMENT`, not code failure) |
| `npx prisma validate` | PASS | schema valid; environment loaded |
| `npx prisma migrate status` | PASS | PostgreSQL `footy_finder`, schema `public`; 10 migrations found; schema up to date |
| `npm run prisma:generate` | PASS | Prisma Client 6.19.3 generated |
| `npm run lint` | PASS | shared/client build plus TypeScript checks in all four workspaces |
| `npm test` | PASS | 30 files, 129 tests, 0 failed, 0 skipped |
| `npm run build` | PASS | API/shared/client TypeScript and Vite production build; web JS 484.95 kB (141.10 kB gzip) |
| `npm ls --all --depth=0` | PASS | workspace tree valid; no invalid/extraneous top-level dependency reported |
| `npm audit --omit=dev` | NOT COMPLETED | registry audit endpoint/network request failed and npm could not write its user-cache log; `ENVIRONMENT FAILURE`; no vulnerability conclusion drawn |
| API startup | PASS | built API listened on port 3000; `/health` returned 200; protected `/users/me` returned structured 401 |
| Web startup | PASS | Vite listened on 5173 and returned the application shell |
| unauthenticated Socket.IO | PASS | connection rejected with `Authentication required.` |
| CORS GET/headers | PASS | configured `http://localhost:5173` origin and credentials returned |
| CORS `PUT` preflight | **FAIL** | server returned 204 but `Access-Control-Allow-Methods` omitted `PUT`; browser will reject the request (`PRE-EXISTING CODE FAILURE`) |

No long-running audit processes were left listening on 3000 or 5173.

### Automated test totals

| Package | Files | Tests | Classification |
|---|---:|---:|---|
| shared | 4 | 33 | unit: auth/match schemas, formations, lifecycle boundaries |
| API client | 2 | 5 | unit: request/error behavior and Match client paths |
| API | 9 | 71 | service units, storage test, limited Supertest middleware/CORS checks |
| web | 15 | 20 | component/provider/route tests |
| **Total** | **30** | **129 passing** | **0 failing, 0 skipped** |

The five database smoke programs are additional executable acceptance suites rather than Vitest-counted tests.

### PostgreSQL smoke results

| Smoke | Result | Coverage |
|---|---|---|
| Phase 1A `smoke:match-capacity` | PASS | capacities, DB check, joining, 12-hour boundary, replacement credit, cleanup |
| Phase 1B `smoke:team-match` | PASS | roles, private/free fixture, access, wallet isolation, lifecycle exclusion, deletion behavior |
| Phase 1C `smoke:team-match-availability` | PASS | request/response/filter/privacy/membership changes/concurrency/cleanup |
| Phase 1D `smoke:team-match-lineup` | PASS | formats/capacities, selection actions, finalization, concurrent claim, defaults, cleanup |
| Phase 1E `smoke:team-match-ui` | PASS | movement constraints, notifications/events, wallet isolation, cleanup |

An additional audit-only HTTP/Socket.IO fixture passed registration, cookie restoration, `/users/me`, profile editing, R500 demo deposit, Team creation/read, private Match creation, persisted HTTP lobby chat, authenticated Match-room Socket.IO send/broadcast, notification persistence, API cancellation/Team deletion, and exact database cleanup. The first attempt intentionally surfaced a stale diagnostic formation key as `TEAM_FORMATION_INVALID`; its fixture cleaned to zero. The corrected shared preset key completed successfully and also cleaned users, Teams, Matches, and Venues to zero.

### Live database invariant sample

At the time checked, the development database contained 4 wallets, 3 Matches, 2 Match payments, and no Teams. Aggregate diagnostics found:

- 0 negative wallets;
- 0 wallet balance versus succeeded-ledger-sum mismatches;
- 0 invalid Match substitute capacities;
- 0 cross-Team default-formation assignments;
- 0 cross-Match/side Quick formation assignments;
- 0 cross-side Team-Match lineup assignments;
- 0 cross-Match scorers;
- 0 direct messages whose sender was not a conversation participant;
- 0 malformed current Team-fixture shapes.

One payment Team differed from the participant's current Team because participants may switch sides after paying; the payment Team is the original purchase snapshot, not a proven integrity error.

## D. FEATURE MATRIX

| Domain | Status | Backend | Frontend | DB | Tests | Current risk |
|---|---|---|---|---|---|---|
| npm workspace/tooling | COMPLETE | Yes | Yes | N/A | gates pass | Low |
| Registration/login/session/profile | COMPLETE | Yes | Yes | Yes | Good unit, thin HTTP | Medium hardening |
| Public/private user DTO separation | COMPLETE | Yes | Yes | N/A | Indirect | Low; over-fetch debt |
| User wallet balance/demo deposit | PARTIAL | Yes | Yes | Yes | Unit + HTTP smoke | Medium; demo/reconciliation only |
| Wallet ledger/history UI | PARTIAL | ledger exists, no read API | No history UI | Yes | money flows tested | Medium |
| Quick Game create/discovery/lobby | PARTIAL | Yes | Yes | Yes | Good core coverage | Medium discovery/realtime gaps |
| Format capacity/rules/rolling subs | COMPLETE | Yes | Yes | Yes/check | Strong | Low |
| Quick Game join/sides/formations | COMPLETE | Yes | Yes | Yes | Unit/smoke/component | Low-medium concurrency UX |
| 12-hour cancellation/replacement | COMPLETE | Yes | Yes | Yes | Strong boundary/smoke | Low |
| Match lifecycle/result/scorers | PARTIAL | Yes | Yes | Yes | Unit, scheduler weak | Medium; host-only/no dispute |
| Lobby chat | PARTIAL | persisted/realtime | Yes | Yes | Small unit + HTTP/socket smoke | High room-revocation gap |
| Direct messages/unread | PARTIAL | Yes | Yes | Yes | No dedicated domain tests | High abuse/revocation/pagination debt |
| Notifications/toasts | PARTIAL | persisted/realtime | Yes | Yes | UI only + indirect | High post-commit consistency gap |
| Teams/memberships/roles | PARTIAL | Yes | Yes | Yes | Good unit/web/smoke | Medium read-boundary ambiguity |
| Team invitations | COMPLETE | Yes | Yes/copy-link | Yes | Good | Low-medium sharing UX |
| Team images | PARTIAL | local provider | Yes | URL | Storage tests | Medium Linux cleanup/durability |
| Team default formations | PARTIAL | Yes | Yes | Yes | Unit/component/smoke | High browser `PUT` CORS defect |
| Private Team fixtures | PARTIAL | Yes | Yes | Yes | Strong 1B-1E | High browser/realtime defects |
| Match-Day availability | PARTIAL | Yes | Yes | Yes | Strong | High `PUT` CORS defect |
| Match-Day selection/lineup/claims | PARTIAL | Yes | Yes | Yes | Strong + concurrent claim | High `PUT`/reconnect defects |
| Theme/motion/toasts | COMPLETE | N/A | Yes | local preference | Component tests | Low |
| Friends/blocking/recruitment | DEFERRED | No | No | No | No | Planned, not a current bug |
| Persistent Team Chat | DEFERRED | No | No | No | No | Planned |
| Team-v-Team matchmaking | DEFERRED | No | No | only one-side foundation | No | Planned |
| Platform Admin/audit log | MISSING/DEFERRED | No | No | No role/log | No | Required before admin operations |
| Venue fields/availability/pricing | DEFERRED | Match-local Venue only | dummy fields | partial Venue | No | Requires domain expansion |
| Team Wallet/funding/reservations | DEFERRED | No | No | No | No | Requires financial rework |
| Verification/18+/consents | DEFERRED | No | No | No | No | Required before paid production |
| Moderation/reports/bans | DEFERRED | No | No | No | No | Required before public chat scale |
| Result disputes/reviews | DEFERRED | host result only | host form | one final result | No | Requires workflow expansion |
| Guest public/cities/waitlist | DEFERRED | mostly auth-gated | auth-gated | free-text city only | No | Major extension |
| Tournament interest/admin matching | DEFERRED | No | No | No | No | Planned |

## E. ARCHITECTURE FINDINGS

### Observed architecture

The route/controller/service/repository split is consistent for authentication, users/profiles, Teams, Match availability, Match lineup, messages, notifications, wallets, and most Match behavior. Controllers parse shared Zod schemas and translate Express inputs; services enforce authorization/business rules and map DTOs; repositories own Prisma queries and transaction boundaries.

Exceptions:

| Exception | Classification | Evidence and consequence |
|---|---|---|
| lifecycle scheduler calls Prisma directly | JUSTIFIED with debt | background orchestration in `match-lifecycle.scheduler.ts`; small today, but should not become the model for funding/reservation jobs |
| Multer validation/storage selection in Team routes | JUSTIFIED | transport-level size/MIME filtering; signature and authorization remain in storage/service |
| static upload serving in `app.ts` | JUSTIFIED infrastructure | development provider only |
| money movement inside `MatchesRepository` | TECHNICAL DEBT / RISK | debit, four credit paths, ledger creation, and Match persistence share a very large repository |
| notification persistence after domain commit in older modules | RISK | Match, DM, Team invite, deposit, and scheduler flows can report failure after success; `AUDIT-CON-001` |
| `any`-typed mappers | TECHNICAL DEBT | chat, messaging, Team mappers bypass strict source-shape checking at privacy boundaries |

### Architectural hotspots / god modules

| File | Approx. lines | Responsibilities | Risk / eventual boundary |
|---|---:|---|---|
| `match-lineup.repository.ts` | 716 | locking, authorization helpers, selection state machine, slot actions, notifications, default formation copy | High change surface; separate context/lock loader, selection operations, notification policy, default copier |
| `matches.repository.ts` | 595 | discovery, Team fixtures, Quick creation, payments, joins, refunds, teams, formation, results | Financial and Match coupling; extract a transactionally composable wallet/payment domain |
| `FormationBoard.tsx` | 497 | board model, optimistic state, pointer drag, tap, dialog, bench, animations | Accessibility and interaction regressions are hard to isolate; split board engine/view/dialog/bench |
| `TeamMatchDayLobby.tsx` | 495 | tabs, availability, roster, lineup, board adaptation, every mutation | Split Availability and Lineup feature panels |
| `matches.service.ts` | 462 | discovery, access, lifecycle, payments, notifications, formations, results | Separate access/lifecycle/payment notification policies |
| `CreateMatchPage.tsx` | 403 | seven-step wizard and validation | Extract reusable steps/form state before adding pricing/venues |
| `matches.controller.ts` | 397 | 32 route handlers | Mechanically large; separate Quick Game, availability, lineup, chat controllers |
| `MatchLobbyPage.tsx` | 337 | Quick lobby and Team branch | Current branch is clear but will grow with Team-v-Team funding/results |
| `TeamPage.tsx` | 328 | six tabs and all Team settings | Split tab components; current file is still understandable |
| `CreateTeamMatchPage.tsx` | 308 | Team fixture wizard | Future venue/funding steps should not be added in place |

### Shared contracts and hidden coupling

Strengths:

- Match format starter counts and derived total capacity come from one shared config.
- Formation presets and coordinate transforms are shared.
- The 12-hour cancellation function is shared and boundary-tested.
- Zod schemas are reused by API and forms/API client types.
- Socket event names and payload types are shared; no duplicated event-name literals were found in client subscriptions.
- API client endpoint coverage is broad, and no web feature bypasses it with direct `fetch`.

Gaps:

- Team-half validity is repeated in `FormationBoard`, `MatchesService`, and `MatchLineupRepository`; coordinate transforms are shared but the invariant is not.
- OWNER/CAPTAIN and closed-status checks are repeated across Team/availability/lineup services.
- Match durations are mapped once in `MatchesService` and again in `TeamsService`.
- `availableOnly` uses `z.coerce.boolean()`: the query string `"false"` becomes truthy. The web sends the unchecked value explicitly, so discovery continues filtering for available spaces (`AUDIT-CONTRACT-001`).
- Route UUIDs are cast with `String(...)` rather than parsed. Malformed/nonexistent IDs can reach Prisma and become generic 500s (`AUDIT-API-002`).
- `updateMatchSchema.startsAt` accepts any datetime, while create requires the future. A pre-kickoff host can update a Match to the past and force immediate effective progression (`AUDIT-MATCH-003`).
- `safeUserInclude` fetches email and wallet data for public DTO mapping, including every participant in discovery. The mapper drops it, so no leak was observed, but the query shape is unnecessarily sensitive and expensive (`AUDIT-PRIV-002`).
- The API client is described as framework-independent but Team image upload accepts browser `File` and constructs DOM `FormData`; bearer-token support is mobile-friendly, cookie/session assumptions are not.

### Active, legacy, and possibly dead concepts

| Concept | Classification | Evidence |
|---|---|---|
| `MatchStatus.FULL` | HIGH-CONFIDENCE LEGACY | accepted/aliased to OPEN but never written by current code; capacity is derived transactionally |
| `ParticipantStatus.REMOVED` | POSSIBLY DEAD | enum/model support, no current removal mutation |
| wallet types `DEPOSIT`, `MATCH_CREATE`, `MATCH_JOIN` | LEGACY | preserved by migration; current code uses suffixed credit/debit types |
| partial-cancellation ledger/status values | LEGACY under current policy | 12-hour policy emits full or zero initial credit; partial enums remain for history |
| notification `MATCH_INVITATION`, `TEAM_UPDATED` | POSSIBLY DEAD | no current producer found |
| message `editedAt`/`deletedAt` | DEFERRED | persisted columns/DTO fields exist; no edit/delete/moderation endpoints |
| Socket.IO client-send handlers | ACTIVE SERVER CAPABILITY, UNUSED BY WEB | web sends chat/DM through HTTP but a socket client can use the validated handlers |
| feature API re-export files | ACTIVE | thin boundary aliases used by feature hooks |

## F. DATABASE FINDINGS

### Prisma inventory

Enums: `MatchFormat`, `MatchVisibility`, `MatchRule`, `MatchMode`, `MatchStatus`, `ParticipantStatus`, `TeamSide`, `TeamMatchAvailabilityStatus`, `TeamMatchSelectionStatus`, `FootballPosition`, `DominantFoot`, `WalletTransactionType`, `WalletTransactionStatus`, `MatchPaymentStatus`, `TeamRole`, and `NotificationType`.

| Model(s) | Purpose and strongest constraints | Historical/delete behavior |
|---|---|---|
| `User`, `PlayerProfile`, `PlayerPreferredPosition` | unique email/username/profile; composite preferred-position key | profile cascades; many historical relations restrict or cascade inconsistently |
| `WalletAccount`, `WalletTransaction` | one wallet per user; transaction idempotency unique; provider/reference unique; account/date index | both cascade on User deletion, which would erase ledger history |
| `Venue`, `Match` | structured venue; unique private invite token; visibility/date and format/date indexes | Match points to a live Venue with restrict; API cancellation retains both |
| `MatchTeam` | unique Match/side and Match/Team; nullable current Team plus snapshots | Match cascade; Team set-null preserves fixture snapshots |
| `TeamMatchAvailability` | unique side/user; side/status and user indexes | user restrict preserves historical responses |
| `TeamMatchSelection` | unique side/user; status/user/selector indexes | selected user restrict; selecting user set-null |
| `TeamMatchLineupSlot` | unique side/index and globally unique selection assignment; coordinate/open-slot checks | side cascade; selection set-null |
| `MatchParticipant` | unique Match/user; side/status index | cascades on User and Match, risking participation/payment history if hard deletion is introduced |
| `FormationSlot` | unique Match/side/index and participant assignment | Match cascade; participant set-null; cross-Match/side relation is service-only |
| `MatchPayment` | unique participant, ledger transaction, idempotency key; Match/side/status index | cascades with Match/participant; transaction relation restricts some deletion paths; scalar `userId` has no User FK |
| `ParticipantCancellation` | one per payment and one replacement per cancellation; FIFO-supporting index | Match cascade; payment restrict; replacement set-null; scalar `userId` has no User FK |
| `MatchResult`, `MatchScorer` | one result per Match; one scorer row per result/participant | Match/result cascade; scorer participant restrict; same-Match invariant is service-only |
| `LobbyMessage` | Match/date index | Match cascade, sender restrict; deletion metadata but no feature |
| `Conversation`, `ConversationParticipant`, `DirectMessage` | stable unique direct key; membership composite key; conversation/date message index | conversation/user membership cascades; sender restrict; empty conversations can remain after user deletion |
| `Notification` | user/read/date index | User cascade |
| `Team`, `TeamMembership` | owner/name indexes; unique Team/user membership and role index | Team memberships cascade; owner relation restrict; owner-membership-role consistency is service-only |
| `TeamInvite` | hashed token unique, Team/date index | Team cascade, creator restrict |
| `TeamFormation`, `TeamFormationSlot` | unique Team/format; unique slot index and membership per formation | Team cascade; membership set-null; same-Team assignment is service-only |

All monetary values are integer cents. No floating-point money was found.

### Enforced versus service-only invariants

| Invariant | DB | Service | Assessment |
|---|---|---|---|
| one user per Match | unique `(matchId,userId)` | join checks | Strong |
| final side capacity | no count constraint possible | serializable transaction + count | Strong for current writes |
| wallet cannot overspend | no non-negative check | conditional `balance >= fee` update in serializable Tx | Safe for current Match debit, incomplete globally |
| wallet never negative | **no DB check** | current debit path only | Add before more financial writers |
| ledger amount sign matches type | no | current writers | Service-only |
| balance equals succeeded ledger | no | atomic writers; no reconciliation job | Current live sample matched; architecture permits drift |
| one Team membership | unique | invite/create logic | Strong |
| Team owner has OWNER membership | no | create/update/remove policies | Service-only; direct/admin repair could violate |
| Team formation member belongs to same Team | no | update service | Service-only |
| Quick formation participant belongs to same Match/side | no | update service | Service-only |
| lineup selection belongs to same MatchTeam | no composite FK | lineup repository | Service-only; global unique prevents double slot |
| availability/selection current membership | intentionally not a DB FK | authorization/finalization | Correct for history |
| scorer belongs to result Match and stored Team | no | result submission | Service-only |
| Match payment user/Match/side agrees with participant | partial FKs only | join | User is a historical scalar; Team intentionally snapshots purchase side |
| Match substitute capacity 0-10 | check | Zod | Strong |
| lineup coordinate 0-100/open has no selection | checks | Zod/service | Strong |
| half-pitch constraint | no | frontend + two backend paths | Service-only, duplicated |
| fee/duration/score non-negative | no relevant checks | Zod/current code | Service-only |

`AUDIT-DB-001`: financial and historical rows are vulnerable to future hard User/Match deletion because wallets, ledger rows, participants, Match payments, cancellations, notifications, and some messages cascade. There is no account-deletion endpoint today, so this is not an active destructive path, but it must be designed before account deletion, moderation erasure, real funds, reliability history, or reviews.

`AUDIT-DB-002`: important cross-aggregate relations and financial sign/balance rules are service-only. Current writers were safe in tests/live diagnostics, but planned Admin repair/import/jobs would bypass assumptions unless constraints or invariant-check tooling are added.

### Index assessment

Good indexes exist for login identifiers, Team membership and roles, invite hashes, Match participants, chat/DM chronological reads, notification unread reads, wallet history, availability, selection, and lineup claims.

Likely scale-sensitive gaps:

- public discovery filters `mode + visibility + status + startsAt` but has only visibility/date and format/date indexes;
- scheduler filters `mode + status + startsAt` with no matching composite index;
- conversation list orders by `Conversation.updatedAt` after membership lookup without a supporting conversation ordering index;
- future Venue/city lookup has no city or external-place uniqueness/index;
- users ordered by `createdAt` and Team lists ordered by `updatedAt` rely on small current result sets.

These are `AUDIT-PERF-002`, not reasons for premature indexing before query plans/data volume are measured.

### Migration audit

| Migration | Assessment |
|---|---|
| `20260809000000_init` | initial users/Matches/participants/chat |
| `20260810000000_add_match_team_slots` | legacy side/squad fields; later normalized away |
| `20260810140000_add_wallet_balance` | legacy User balance/transaction design; later migrated |
| `20260811100000_master_domain_foundation` | intentionally destructive normalization after explicit backfills; drops legacy User/Match/participant columns and legacy enums; inspect carefully on real production backup |
| `20260820100000_create_teams` | additive Team domain |
| `20260823100000_match_capacity_and_rules` | additive defaults + DB 0-10 check; preserves five substitutes |
| `20260823150000_private_team_match_foundation` | additive mode/DRAFT/MatchTeam snapshots; existing Matches default Quick |
| `20260823180000_team_match_availability` | additive; no invented historical rows |
| `20260823210000_team_match_lineups` | additive tables/checks plus existing-fixture coordinate backfill; no invented selections |
| `20260823220000_team_match_lineup_notifications` | additive notification enum values |

The live database reports all 10 migrations applied and schema up to date. No evidence of an edited/applied migration or schema-history mismatch was found. The master normalization correctly copies legacy profiles, balances, wallets, Venues, and references before dropping columns. It does not create MatchPayment rows for pre-normalization participations; legacy paid-participant refund behavior therefore depends on what historical data existed at migration time and is `UNKNOWN` without a production snapshot (`AUDIT-DB-003`, potential legacy migration risk).

## G. AUTH / SECURITY / PRIVACY FINDINGS

### Authentication trace

```text
register Zod -> lowercase email/username -> Argon2id hash
  -> User + PlayerProfile + WalletAccount
  -> signed JWT subject in HTTP-only cookie

request -> Bearer token if present, otherwise cookie
  -> JWT verify -> res.locals.authUserId
  -> service/repository ownership checks

web start -> GET /users/me -> protected/guest route decision
logout -> clear browser cookie and clear Query cache
```

Observed controls:

- Argon2id passwords; password hashes never enter DTOs.
- JWT expiry is configurable and positive; secret is required at 32+ characters.
- cookie is HTTP-only, path `/`, SameSite Lax, and Secure when `NODE_ENV=production`.
- bearer-token compatibility exists for non-browser clients.
- private DTO adds email/balance; public DTO excludes email, password, wallet, and payments.
- exact one-origin credentialed CORS allowlist; no wildcard.
- React escapes user/message text; no `dangerouslySetInnerHTML` was found.
- SQL injection risk is low: Prisma parameterization is used, including the two `Prisma.sql` row locks.
- Team image filenames are generated UUIDs; declared MIME, 5 MB size, and file signatures are validated.

### Meaningful mutation authorization

| Operation | Server enforcement |
|---|---|
| profile edit | authenticated user ID always comes from session; self only |
| Team create | any authenticated user; owner membership created transactionally |
| Team settings/delete/image/role/remove | `ownerUserId`/OWNER checks in `TeamsService` |
| Team invite/default formation | current OWNER/CAPTAIN in `TeamsService` |
| Team fixture create | OWNER/CAPTAIN checked inside serializable repository transaction |
| Quick Match update/delete/ready/formation/result | creator check in `MatchesService` |
| Team Match update/delete/lineup/availability request | current attached Team OWNER/CAPTAIN |
| Match join/leave/side change | authenticated self, Quick-only, transaction/state/capacity rules; host override only where documented |
| open position claim/decline/availability response | current attached Team member, self/claim target only |
| wallet deposit | session user wallet; fixed server amount/operator; idempotency key |
| conversation/message/read | participant lookup/update in repository |
| lobby chat | host, active participant, or current attached Team member on every send/history read |
| notifications | every query/update scoped to session `userId` |

No mutation was found that relies only on a hidden frontend button.

### Security/privacy gaps

`AUDIT-SEC-001` (P1): there is no rate limiting or abuse control on register/login, chat/DM sends, conversation creation, Team/Match/invite creation, upload attempts, or unique-key demo deposits. Password hashing increases brute-force cost but does not bound attempts. Add IP/account-aware authentication throttling and per-user/resource write limits before public exposure.

`AUDIT-RT-001` (P1): Match and Team socket authorization is checked only at room join. Removing a Team member or leaving a Match does not evict that socket. A malicious or simply stale client can continue receiving private room broadcasts (including lobby message contents) until disconnect. Reauthorize subscriptions on membership-changing events or explicitly remove all affected user sockets from rooms.

`AUDIT-PRIV-001` (P2, product decision required): `TeamsService.get`, `members`, and `formation` load and return a full privacy-safe Team roster/default formation to any authenticated caller who knows the Team UUID. Team Match listing correctly requires membership. Current navigation lists only a user's Teams and current copy calls MEMBER read-only, suggesting private Teams, but future public Team profiles are planned. Decide the boundary; if private, this is an IDOR and must use `assertMember`; if public, define a smaller public Team DTO and keep private formation/membership metadata gated.

`AUDIT-PRIV-002` (P2): public mapping queries use `safeUserInclude`, which includes email and wallet rows internally. Explicit mappers currently discard them, so no response leak was found, but sensitive over-fetch expands blast radius and cost. Introduce separate Prisma selects for public versus authenticated users.

`AUDIT-AUTH-001` (P2): logout clears the client cookie but cannot revoke a stolen JWT; sessions remain valid until expiry (default seven days). Add token version/session records or a denylist when password reset, security-sensitive logout, suspension, and Admin enforcement arrive.

`AUDIT-AUTH-002` (P2): cookie auth relies on SameSite Lax without a CSRF token. This is reasonable for the documented same-site deployment, but a cross-site web/API deployment will not send the cookie, while same-site sibling-origin compromise remains a CSRF consideration. Document topology and add an origin/CSRF strategy before broad deployment.

`AUDIT-CFG-001` (P2): `.env.example` omits `NODE_ENV`. Because it defaults to development, a production operator who follows the example but forgets `NODE_ENV=production` receives a non-Secure session cookie. Make production-mode validation explicit.

`AUDIT-SEC-002` (P2): Socket.IO send handlers return raw `Error.message` to the client. Unexpected Prisma/internal errors can expose implementation details, unlike the safe HTTP error handler. Map socket failures to stable public codes/messages and log correlated internal detail server-side.

`AUDIT-SEC-003` (P2): no security-header middleware is configured and Express advertises `X-Powered-By`. Add an explicit Helmet/CSP/header policy when deployment origins and image providers are known.

`AUDIT-SEC-004` (P2): Quick Game private invitation tokens are stored raw in `Match.inviteToken`; Team invite tokens are correctly hashed. A database read leak reveals every active Quick invitation. Store a hash and return the raw token only at creation/rotation.

`AUDIT-UPLOAD-001` (P2): Team image validation/naming/path traversal defenses are good, but deletion uses a Windows-only `directory + "\\"` prefix. On Linux, valid generated images will not be deleted on replacement/Team deletion, leaking files. Use `path.relative`/`path.sep` containment.

No phone, DOB, identity, verification, or private contact fields exist. No committed production secrets were found; tracked URLs/credentials are examples or test-only.

## H. FINANCIAL FINDINGS

### Current wallet and ledger architecture

```text
Deposit
  fixed R500 demo request + idempotency key
  -> PENDING WalletTransaction
  -> provider result
  -> atomic status transition + WalletAccount increment

Quick Match join
  Match fee snapshot chosen at Match creation
  -> serializable capacity check
  -> conditional WalletAccount decrement (balance >= fee)
  -> participant + negative ledger transaction + MatchPayment

Player cancellation
  >12h: full internal wallet/ledger credit
  <=12h and before kickoff: no initial credit
  at/after kickoff: reject
  -> cancellation row; later same-side replacement releases withheld amount FIFO

Whole-Match cancellation
  -> serializable full credit for every still-SUCCEEDED MatchPayment
  -> ledger rows + payment REFUNDED + Match CANCELLED
```

Balances and all amounts are integer cents. The current debit uses an atomic conditional update, and every inspected balance mutation occurs with a corresponding ledger insert in the same database transaction. The live aggregate balance equaled succeeded ledger sums for all four wallets.

### Authoritative current Match price

**Observed:** the Quick Game creation UI defaults to R80 but lets the organiser choose any fee from R0 through R10,000. The backend validates and persists that `feeCents`; it cannot be edited later. Each player pays exactly that amount when joining. Creating a lobby neither charges nor auto-joins the host. Team fixtures are forced to R0 and bypass personal wallets. Dummy fields have no price.

**Expected future:** Admin-managed effective-dated field prices, immutable reservation/obligation snapshots, Team Wallet funding, and a fixed 50/50 Team split.

**Gap:** current `Match.feeCents` is a player entry fee supplied by the host, not a field price or booking cost. The legacy enum `MATCH_CREATE` suggests an older host-charge design but has no current producer. Future pricing should not reinterpret historical `feeCents`; add explicit field-price, reservation, obligation, and contribution snapshots.

### Idempotency and concurrency assessment

| Operation | Assessment | Why |
|---|---|---|
| Match final-slot join | SAFE | serializable transaction, recount, unique participant/payment, conditional debit |
| simultaneous wallet spends | SAFE for current Match debit | conditional `balanceCents >= fee` update; serialization retry |
| join retry with same key | SAFE financially | MatchPayment key replay returns participant; no second debit |
| browser retry after lost join response | PARTIAL | hook generates a new key per mutation invocation; second manual attempt returns `ALREADY_JOINED` rather than replaying original success |
| player cancellation retry | SAFE | one cancellation per MatchPayment; deterministic ledger key; serializable Tx |
| replacement allocation | SAFE | serializable FIFO query + unique replacement + deterministic credit key |
| whole-Match cancellation retry | SAFE | serializable status/payment transitions + deterministic credit keys |
| deposit same-key sequential retry | SAFE | result replay checks user/amount/provider |
| deposit same-key concurrent retry | PARTIAL | pre-read then unique insert; loser can receive unhandled P2002/500 rather than replay |
| provider success then process crash | UNSAFE for a real provider | PENDING row remains and retries return `DEPOSIT_PENDING`; no webhook/reconciliation worker |
| result submission race | DATA SAFE, UX PARTIAL | unique result prevents two records; loser receives generic conflict/500 path |
| Team invitation acceptance | SAFE | serializable conditional usage increment + unique membership |
| open-position claim | SAFE | MatchTeam row lock + serializable Tx + unique selection assignment; real concurrent smoke passed |

### Financial gaps

`AUDIT-CON-001` (P1, cross-domain): Match join/payment, Match cancellation/refund, result, demo deposit, Team invite acceptance, DM send, and scheduler transitions commit first and then await notification inserts. If notification creation fails, the API/job reports failure after state or money succeeded; retries can return `ALREADY_JOINED`, `RESULT_NOT_READY`, or replay without recreating notifications. Persist required notifications/outbox rows inside the same transaction and publish after commit, as availability/lineup already do.

`AUDIT-FIN-001` (P2): wallet writes are fragmented between `WalletRepository` and the very large `MatchesRepository`; the DB has no `balanceCents >= 0` check, ledger sign/type checks, or reconciliation. Introduce one composable wallet transaction service/repository plus invariant queries before Team Wallet or real funds.

`AUDIT-FIN-002` (P2): demo deposit idempotency is financially single-credit but not operationally complete under concurrent requests or a crash after provider success. Add atomic get-or-create semantics, provider webhook/signature handling, terminal transition rules, and reconciliation before integrating a PSP.

`AUDIT-FIN-003` (P2): wallet and ledger cascade on User deletion and Match payments/cancellations cascade on Match deletion. No deletion API exposes this today, but real-money audit history must be retained or anonymized rather than erased.

`AUDIT-FIN-004` (P2): asynchronously received replacement/full-Match cancellation credits create a notification but do not invalidate the recipient's `currentUser` query. With five-minute stale time, no focus refetch, and no balance-specific event, the header can display an old balance indefinitely during an active session. Invalidate/refetch wallet state on wallet-credit notifications or add a typed wallet event.

`AUDIT-FIN-005` (P3 now, required before PSP): there is no wallet transaction/history endpoint, available/reserved balance distinction, receipt model, adjustment workflow, or external refund state. These are planned features, not current defects.

The current cancellation code is **ALREADY 12H** everywhere found. No live 8-hour logic or duplicate cutoff was found. Partial-refund enum values are legacy/unreachable under the current full-or-zero policy.

## I. MATCH / TEAM DOMAIN FINDINGS

### Actual Match state machines

```text
Quick Game
  create -> OPEN
  OPEN -> READY                    (host action)
  OPEN/READY/FULL -> IN_PROGRESS   (15s scheduler when startsAt arrives)
  IN_PROGRESS -> AWAITING_RESULT   (scheduler at startsAt + duration)
  AWAITING_RESULT -> COMPLETED     (host result submission)
  OPEN/READY/FULL -> CANCELLED     (host cancellation before kickoff)

  Effective DTO state also derives IN_PROGRESS/AWAITING_RESULT from timestamps
  while the scheduler is delayed. FULL is legacy and mapped to OPEN behavior.

Private Team fixture (Phase 1)
  create -> DRAFT
  DRAFT -> CANCELLED               (manager or Team deletion)
  no scheduler, payment, join, participant, or completion path
```

Quick join/leave/change operations require stored OPEN/READY/FULL and `now < startsAt`, not merely frontend status. The Team DRAFT remains an indefinite planning workspace even after its nominal kickoff, by design for Phase 1.

### Formats, capacity, participation, and formations

- Shared starters per Team: 5, 7, or 11.
- Persisted substitutes per Team: 0-10, default 5, database checked.
- Derived total capacities: 10-30, 14-34, or 22-42. No global 32-player rule remains.
- Joining, discovery labels, cards, dialogs, and lobbies use the shared derived helpers.
- Host is not auto-joined and consumes no capacity.
- One MatchParticipant row per Match/User prevents duplicate presence; historical LEFT rows remain.
- A participant can occupy at most one Quick formation slot; side/capacity rules are transactionally checked.
- Quick/Team-Match two-sided boards constrain HOME to `Y >= 50` and AWAY to `Y <= 50`; Team default formation uses the full pitch.
- Team default formation and Match-Day lineup are independent. Only the explicit save-default endpoint copies occupied starter membership assignments; open/empty slots become unassigned and substitutes are ignored.

### Team and Match-Day status

Implemented and verified:

- multiple Team memberships with OWNER/CAPTAIN/MEMBER roles;
- transactional owner membership and three default formations;
- hashed, expiring, single-use Team invites with race-safe acceptance;
- Team image abstraction and validation;
- OWNER/CAPTAIN fixture organization; MEMBER read-only Match-Day access;
- private/free/HOME-only Team DRAFT fixture and historical snapshots;
- availability snapshots/responses/filters/privacy and membership changes;
- independent invitation/starter/substitute/claim/decline/removed states;
- explicit swap/bench/remove semantics, capacity checks, finalization, Captain override;
- first-winner open claims under row lock/serializable isolation;
- Match-Day coordinate movement and explicit save-as-default behavior;
- no wallet or MatchParticipant mutation for Phase 1 Team fixtures.

`AUDIT-API-001` currently prevents several of these from being complete in a browser because their typed client correctly uses `PUT` but CORS does not allow it.

### Domain gaps and conflicts

`AUDIT-MATCH-001` (P2): Team fixtures still contain legacy Quick `FormationSlot` rows and the generic Quick formation endpoint accepts Team managers. Team-Match UI uses `TeamMatchLineupSlot`, so those writes are a second, unused formation source. Reject Team mode on the Quick endpoint or clearly designate/remove the legacy projection before opponent/history conversion.

`AUDIT-MATCH-002` (P2): result submission accepts any historical participant row as a scorer, including LEFT/REMOVED, because the repository loads all participants. Decide whether historical attendance qualifies; if only actual confirmed participants count, enforce that state. Future Team-Match conversion needs an explicit participation snapshot.

`AUDIT-MATCH-003` (P2): Match update permits moving kickoff into the past and emits no room event. Add future/state validation and a Match-details event/cache invalidation policy.

`AUDIT-MATCH-004` (P2): simultaneous result submissions remain database-consistent through the one-result unique key but expose an unhandled Prisma conflict rather than idempotent authoritative state. This becomes more important before opponent confirmation/disputes.

`AUDIT-TEAM-001` (P2): role changes persist but emit no Team event/notification. The affected member's UI can retain old capabilities until a manual refetch; server authorization remains correct. Emit metadata-only invalidation and, if product-approved, a persisted notification.

`AUDIT-TEAM-002` (P2): availability/open-position notification creation loops over an unbounded Team roster while holding a serialized MatchTeam transaction, with some notifications inserted sequentially. Large Teams can hold locks for a long time. Use bulk inserts/outbox publication while preserving atomicity and actor exclusion.

`AUDIT-TEAM-003` (P3): Team update schemas transform empty optional strings to `undefined`, so the settings UI cannot reliably clear description/location/short name by submitting an empty value. Define nullable clearing semantics.

The current fixed future-rule comparison is favorable: format-driven capacity, maximum 10 substitutes, no global 32, separate Team/default/Match-Day data, first-come claim with Captain override, OWNER/CAPTAIN organization, and 12-hour/replacement behavior are already aligned. Team Wallet, 50/50 funding, Admin pricing, availability-before-funds, reservations, configurable 15-minute funding, released reservations, verification gates, platform ADMIN, and Captain reviews are not implemented and are correctly treated as deferred rather than current bugs.

## J. REALTIME / CHAT / NOTIFICATION FINDINGS

### Socket architecture and event inventory

There is one default Socket.IO namespace. Authenticated sockets automatically join `user:<userId>`. Clients may request `match:<matchId>` after chat authorization and `team:<teamId>` after membership lookup.

| Event family | Persisted before broadcast? | Authorization/spoofing | Recovery |
|---|---|---|---|
| participant joined/left/side changed | yes | client cannot emit server mutation; HTTP/service auth | Match query polling/invalidation |
| Quick formation updated | yes | manager service authorization | Match query polling/invalidation |
| lobby message created | yes | every HTTP/socket send calls ChatService authorization + Zod | 5s full-history poll |
| Match started/ended/result/completed | Match state first | scheduler/service authority | Match 30s poll/effective timestamps |
| availability requested/updated | yes; request notifications in same Tx | attached Team role/member checks | query invalidation, but reconnect gap |
| lineup selection/open/claim/move/finalize/default | yes; relevant notifications in same Tx | side lock + Team role/member checks | query invalidation, but reconnect gap |
| direct message created | message first | participant check on every send | 5/10s polling and user room |
| notification created | notification first | server-only domain event | 15s polling and user room |
| Team member/details/formation | Team state first | Team service authorization | Team query invalidation, but reconnect/role gaps |

Metadata-only availability/lineup room payloads reveal `{ matchId, side }`, not another member's private response. Message contents are React-rendered as text, so no stored XSS path was found. There is no edit/delete/report/block/rate-limit system yet.

`AUDIT-RT-001` (P1): room authorization is not continuously enforced. A removed Team member or departed Match user can retain an already-joined room and receive broadcasts. Chat sends are reauthorized, but passive delivery is not.

`AUDIT-RT-002` (P1): `useMatchSocket` and `useTeamSocket` emit room join only when the React effect mounts. Socket.IO creates a new server-side socket/room set after reconnect; the hooks do not listen for `connect` and rejoin. User-room notification/DM delivery recovers because the server autojoins on every connection, while availability, lineup, Team formation, and Team detail queries can remain stale because they have no poll and global focus refetch is disabled.

`AUDIT-NOTIF-001` (P2): persisted notification creation is inconsistent across domains. Availability/lineup use the correct transaction-record + post-commit publish pattern; Match/DM/Team/deposit/scheduler flows use `NotificationsService.create` after domain commit (`AUDIT-CON-001`).

`AUDIT-NOTIF-002` (P2): the toast dedupe race is one-sided. Poll processing checks `seen`, but the socket receiver always calls `notify` without checking whether polling already saw the ID. A poll-first/socket-later race can show the same persisted notification twice.

`AUDIT-RT-003` (P2): Match detail edits, ready/cancel, Team role changes, and Team deletion lack targeted room invalidation events. Polling masks some Match gaps after 30 seconds; Team state has no equivalent periodic recovery.

`AUDIT-CHAT-001` (P2): lobby and DM histories are unpaginated and refetch the entire history every 5 seconds while also receiving realtime invalidations. This produces growing query cost and network transfer. Add cursor pagination and append/id-based cache updates before public chat scale.

`AUDIT-CHAT-002` (P2): message writes have no client message ID/idempotency key. A transport retry can persist duplicate lobby/DM messages. Future reports, blocks, and rate limits should be enforced in the same service path for both HTTP and socket sends.

Important notification producers today: deposit success, Match join, player joined audience info, player cancellation, replacement and wallet credit, whole-Match cancellation/refund, Match start, result submission, direct message, Team member joined, availability request, lineup selection change, position opened/claimed, and lineup finalization. Missing or inconsistent product notifications include Match detail/ready changes, Team role/removal for the affected user, Team deletion, upcoming reminders, and failed/pending payments.

## K. FRONTEND / UX / ACCESSIBILITY FINDINGS

### Frontend route inventory

| Route | Access | Purpose | Backend dependency | Status |
|---|---|---|---|---|
| `/login` | Guest-only | login | `/auth/login`, `/users/me` | Active |
| `/register` | Guest-only | registration | `/auth/register` | Active |
| `/` | Auth | user home/dashboard | users, Matches/Teams links | Active |
| `/matches` | Auth | public Quick Game discovery | `GET /matches` | Active; false-filter defect |
| `/matches/new` | Auth | Quick Game wizard, 3 dummy fields | `POST /matches` | Active fixture data |
| `/matches/:matchId` | Auth/access-controlled | Quick or Team Match lobby | Match, participants, chat, availability, lineup | Active |
| `/matches/invite/:token` | Auth/token | private Quick Game invite landing | Match invite + join | Active |
| `/players/:userId` | Auth page; API profile is public | player profile and DM action | player/users/conversation | Active |
| `/messages` | Auth | conversation list | conversations | Active |
| `/messages/:conversationId` | Auth/participant | DM workspace | conversation/messages/read | Active |
| `/messages/new/:userId` | Auth | start/open direct conversation | conversation create | Active |
| `/teams` | Auth | current user's Teams | `GET /teams` | Active |
| `/teams/create` | Auth | Team wizard | Team create/image | Active |
| `/teams/:teamId` | Auth | overview, Matches, squad, formation, invites, settings | Team domain | Active; read-boundary ambiguity |
| `/teams/:teamId/matches/new` | Auth; UI and server OWNER/CAPTAIN | Team fixture wizard | Team Match create | Active |
| `/teams/invite/:token` | Public landing; auth to accept | inspect/accept Team invite | team-invites | Active |
| `*` | Any | redirect to `/`, then auth guard as applicable | none | Active |

No route points to a missing component. Team Matches is reachable from the Team page. Dummy venues are explicitly development fixture data. There are no wallet ledger, admin, venue, social, verification, moderation, city, or tournament pages.

### State and API-client audit

- TanStack Query owns server state; local React state owns wizard steps/forms, tabs, drag state, menus, and dialog state.
- URL params select resource IDs and conversation destinations. Filter state is local, not URL-shareable.
- Theme and transient toast state use small contexts; authentication derives from the `/users/me` query rather than a duplicate auth store.
- Socket events invalidate targeted query families. Match chat, DMs, notifications, and Match detail also poll.
- No direct web `fetch` bypass was found; every HTTP feature uses `@footy-finder/api-client` through the central client.
- The client always includes credentials, supports optional bearer injection, preserves browser-controlled multipart headers, and maps structured server errors to `ApiError`.
- Mutation cache invalidation is generally targeted. Wallet credit notifications and some Team/Match changes are exceptions documented elsewhere.

`AUDIT-CONTRACT-001` (P2): unchecked discovery sends `availableOnly=false`, which the backend `z.coerce.boolean()` parses as true. Use an explicit `"true"/"false"` transform like Team availability does.

`AUDIT-FE-001` (P2): the mobile header can exceed narrow viewport width: the full “Footy Finder” logo remains visible beside theme, add-funds, balance, notifications, and user controls. Navigation itself is available inside the user menu, but 320px-class layout needs a real viewport test and a compact logo/balance policy.

`AUDIT-FE-002` (P2): Match/Team rooms do not rejoin on reconnect and several non-polled queries can become stale; see `AUDIT-RT-002`.

`AUDIT-FE-003` (P2): FormationBoard assignment rollback is optimistic, but coordinate moves do not update the local confirmed position before awaiting the query response, so a dropped marker can visually snap back then jump. Multiple rapid mutations can also roll back to a stale closure snapshot. Interaction tests currently cover coordinate validity and rendering, not pointer/tap transaction sequences.

### Accessibility

Strengths:

- real buttons/inputs/selects are used throughout; important controls have labels and visible focus styles;
- Formation slots and reserves are buttons, so tap/click/keyboard activation works; slot labels include side/index/player/open state;
- toast container uses `aria-live`, errors use alerts, and dismiss controls are labelled;
- motion CSS disables route/toast/formation animation under `prefers-reduced-motion`;
- Team sides and availability states use text labels/badges rather than color alone;
- mobile Messages and Team tab layouts avoid desktop-only tables.

`AUDIT-A11Y-001` (P2): custom occupied-slot dialogs set `role=dialog`/`aria-modal`, but do not move focus, trap focus, close on Escape, or restore focus. User/notification menus also lack initial focus and arrow-key menu behavior. Add a shared accessible dialog/menu primitive.

`AUDIT-A11Y-002` (P2): `Input` derives its ID from `id ?? name`; local-state fields frequently supply neither. Wrapped labels still label the input, but an error creates repeated `id="undefined-error"`/`aria-describedby="undefined-error"`, and hints are not referenced. Generate stable IDs with `useId` and combine hint/error descriptors.

`AUDIT-A11Y-003` (P3): keyboard users can select/assign Formation players but cannot reposition coordinates with arrows or receive a live announcement of save/rollback state. This is safe to defer if coordinate editing remains an advanced manager action, but it should be included in an accessibility acceptance suite.

### Theme, motion, and responsive behavior

The central `theme.css` is genuinely the color source of truth; no mode-specific Tailwind palette classes were found in components. Light/dark selection persists to localStorage and initially respects OS preference. It does not follow later OS preference changes because the initial choice is immediately persisted; current product exposes explicit light/dark rather than a third “system” mode. Team branding colors are intentionally data-driven.

Route, toast, drag, landing, and rollback animations are centralized in `motion.css` and include reduced-motion overrides. The major pages use responsive grids and mobile-specific visibility. Automated tests do not render real desktop/tablet/mobile viewport matrices, so overflow and touch behavior remain partially verified.

## L. TEST COVERAGE FINDINGS

The 129-test suite is fast and green. Phase 1A-1E database smokes materially improve confidence in concurrency and migrations. Tests are strongest around shared Match validation/lifecycle, Team services, availability/lineup domain errors, Team image signatures, basic auth, and selected Team/formation UI paths.

`AUDIT-TEST-001` (P2): no dedicated tests cover MessagingService/Repository, NotificationsService/Repository, lifecycle scheduler, public/private Team read boundaries, UUID/error mapping, role-change realtime behavior, socket room revocation/reconnect, or wallet header refresh on external credit.

`AUDIT-TEST-002` (P2): API service tests mostly mock repositories and the Supertest file checks only CORS basics/protected access. There is no repeatable authenticated API integration suite over PostgreSQL and no browser end-to-end suite. The audit-only HTTP smoke proved the path once but is not committed regression coverage.

`AUDIT-TEST-003` (P2): the CORS test asserts POST/idempotency headers but not every method used by the API; this directly missed `PUT`. Generate the allowed-method set from route requirements or at least test GET/POST/PUT/PATCH/DELETE preflights.

`AUDIT-TEST-004` (P3): component tests are mostly single happy-path assertions. Formation drag/pointer rollback, dialogs, availability filters/responses, full lineup operations, Messages, notification race/dedupe, mobile header, and accessibility focus are weak or absent.

TypeScript is strict in every workspace and builds/typechecks all `src` tests. Smoke scripts typecheck individually. There is no ESLint; the command named `lint` is TypeScript only, so React Hooks rules, accessibility rules, unused import/style checks, and unsafe `any` policies are not enforced. High-risk `any` use is concentrated in DTO mappers, not spread throughout domain logic.

## M. PERFORMANCE / SCALABILITY FINDINGS

`AUDIT-PERF-001` (P2): public Match discovery loads up to 200 full Match aggregates, including participants, formation participants, results/scorers, Team sides, and each user's profile/wallet/Team memberships, then filters capacity/distance and sorts nearest in application memory. It can miss a geographically closer Match beyond the first 200 chronological rows and is expensive long before 200 full lobbies. Introduce list-specific selects/DTOs and database/geospatial pagination.

`AUDIT-PERF-002` (P2): high-frequency discovery/scheduler/conversation ordering lacks query-shaped composite indexes. Measure with realistic data and add migrations alongside pagination/query redesign.

`AUDIT-PERF-003` (P2): Lobby and DM history are unbounded and repeatedly refetched in full. Notifications are capped at 100 but not cursor-paginated; users are capped at 100 with no next page; Matches cap at 200; Team/member/conversation/availability lists can be unbounded. Every externally growing collection needs an explicit cursor/limit contract before scale.

`AUDIT-PERF-004` (P2): notification fan-out inside serialized availability/lineup transactions can be O(unbounded Team membership) and hold the side lock while inserting sequential rows. Bulk/outbox work belongs in the transaction design, not an after-commit best-effort loop.

`AUDIT-PERF-005` (P3): the production web output is one 484.95 kB JS chunk (141.10 kB gzip) with no route lazy loading. This is acceptable now but route-level splitting will matter as Admin/social/venue modules arrive.

No obvious listener/timer leak was found in normal component cleanup. Toasts trimmed from the visible five-item window keep their short-lived timers until expiration, a low-impact bounded inefficiency.

## N. DOCUMENTATION / CONFIGURATION FINDINGS

### Environment inventory

| Variable | Requirement/classification | Documentation/status |
|---|---|---|
| `DATABASE_URL` | required API/Prisma | documented/example; actual key present |
| `JWT_SECRET` | required, min 32 | documented/example; actual key present; value not audited |
| `PORT` | optional, default 3000 | documented |
| `JWT_EXPIRES_IN_SECONDS` | optional, default 604800 | documented |
| `CLIENT_URL` | optional default, operationally required exact web origin | documented; actual key present |
| `NODE_ENV` | optional schema default, production-security critical | **missing from README/example** |
| three `MATCH_DURATION_*_MINUTES` | optional positive, default 90 | documented |
| `POST_MATCH_CHAT_DURATION_MINUTES` | optional positive, default 25 | documented |
| `PUBLIC_API_URL` | optional default localhost; used for Team image URLs | documented |
| `TEAM_UPLOAD_DIR` | optional default relative path | documented |
| `VITE_API_URL` | optional web default localhost:3000 | documented/example; no local web `.env`, default used |

`AUDIT-DOC-001` (P3): README is broadly accurate but stale in specific places: Team page tabs omit Matches; lobby-chat authorization omits current attached Team members; quality commands omit Phase 1C-1E smokes; migration prose stops before availability/lineup/notification migrations; CORS claims do not mention the broken `PUT` method.

`AUDIT-DOC-002` (P3): `TODO.txt` says notifications are a future major area even though persisted/realtime notifications are implemented; it also mixes old free-form goals with no status/source references. It is misleading as a roadmap.

`AUDIT-DOC-003` (P3): there is no API/OpenAPI contract, architecture decision record, deployment checklist, data-retention policy, threat model, or financial invariant runbook. This audit helps but is not a replacement.

`AUDIT-CFG-002` (P2): observability is limited to startup `console.log`, unknown-error `console.error`, and scheduler `console.error`. There are no request/correlation IDs, structured logs, audit events, metrics, DB/Socket health details, or financial transition/reconciliation logs. Unknown HTTP errors log raw error objects (which may contain private query metadata) to local logs; responses remain safe.

`AUDIT-CFG-003` (P3): `.gitignore` omits the generated `uploads/` tree even though README says local media must not be committed.

`AUDIT-DEP-001` (P3): Express runtime is 4.22.2 while `@types/express` is 5.0.6. The build is green, but type/runtime major versions should be aligned. Automated npm vulnerability data is UNKNOWN because the audit endpoint was unavailable.

`AUDIT-JOB-001` (P2): the in-process 15-second scheduler has a per-process overlap guard, survives restart by querying overdue rows, and uses conditional transitions so multiple API instances cannot transition a Match twice. It is not a durable job system: the winner can lose notifications after transition, there is no lease/outbox/retry/dead-letter/metrics, and no distributed ownership. Do not reuse it unchanged for funding deadlines, reservation expiry, or refunds.

Development seed status: none. No `test/password` account or production auto-seeding exists. A future idempotent development seed should be explicitly environment-gated and kept separate from migrations.

## O. MASTER-SPEC READINESS MATRIX

| Planned capability | Readiness | Evidence / dependency |
|---|---|---|
| format-based capacity, 0-10 substitutes | READY after CORS regression fix | shared config, persisted capacity, DB check, smokes |
| 12-hour cancellation + replacement | READY | centralized helper and transactional FIFO credits |
| Match-Day availability | READY after P1 remediation | complete persistence/UI/realtime; `PUT` and reconnect defects |
| selection statuses/lineup/open claims | READY after P1 remediation | separate models, row lock, concurrency smoke, UI |
| Team default vs Match-Day separation | READY | explicit independent models and save-default operation |
| Team Chat | MAJOR EXTENSION | chat primitives exist; direct Conversation DTO/schema assumes exactly two users and required `directKey` |
| Friends | MAJOR EXTENSION | new request/friendship state and privacy rules |
| User blocking | MAJOR EXTENSION | must become a shared authorization dependency for DM/chat/recruitment/reviews |
| Team recruitment + friend invitations | MAJOR EXTENSION | Team invites exist; discovery/recruitment/social graph do not |
| Web Share/WhatsApp/copy/QR | MINOR EXTENSION | copy link exists; Web Share/WhatsApp/QR and clipboard failure handling missing |
| Team-v-Team openings/challenges | MAJOR EXTENSION | MatchTeam side normalization is ready; compatibility/challenge/atomic opponent attach absent |
| Team-v-Team lifecycle/cards | MAJOR EXTENSION | DRAFT foundation exists; booking/funding/opponent/results absent |
| Platform ADMIN + shell | MAJOR EXTENSION | no platform role/claims/middleware/routes/UI |
| append-only Admin audit log | MAJOR EXTENSION | no audit model or actor/action snapshot pattern |
| VenueField/formats/availability | REQUIRES REWORK | current Venue is Match-local and fields are frontend fixtures |
| effective-dated Admin pricing/history | MAJOR EXTENSION | no field/pricing models or price snapshots |
| Team Wallet account/ledger | REQUIRES REWORK | transaction is wallet-account-centric, but WalletAccount is strictly User-owned and history cascades |
| Team contributions/contributor visibility | MAJOR EXTENSION | new source/receipt/confirmation DTOs and non-refundable rules |
| available/reserved Team balances | MAJOR EXTENSION | no hold/reservation state; add non-negative DB enforcement first |
| atomic field reservation/overlap | BLOCKED | depends on VenueField availability and booking constraints |
| immutable price/obligation snapshots | BLOCKED | depends on Admin pricing/field reservation models |
| fixed 50/50 funding | BLOCKED | depends on Team Wallet, reservation, snapshots, idempotent holds |
| configurable 15-minute funding scheduler | BLOCKED | durable job/outbox work needed; current scheduler insufficient |
| release other Team funds on failure | BLOCKED | funding state machine and ledger holds absent |
| production PSP | REQUIRES REWORK | provider interface exists; webhooks, signatures, pending recovery, reconciliation absent |
| DOB/18+/legal consent | MAJOR EXTENSION | no fields/models; profile separation provides a clean insertion point |
| identity/phone/email verification | MAJOR EXTENSION | no states/providers/secure records; paid-join gate is centralized for Quick Games |
| user/message/review reports | MAJOR EXTENSION | message IDs/history exist; report/evidence/retention models absent |
| suspension/ban/Admin moderation | MAJOR EXTENSION | no platform role/status/policy/audit; JWT revocation needed |
| opponent-confirmed/disputed results | REQUIRES REWORK | current one immutable host-submitted final result has no proposals/state/audit |
| Captain Team reviews | MAJOR EXTENSION | Team roles exist; opponent/participation/one-review constraint absent |
| guest public Match/Team/venue browsing | MAJOR EXTENSION | web and `/matches`/`/teams` are auth-gated; public DTO pieces exist |
| active cities/unsupported-city waitlist | MAJOR EXTENSION | only free-text profile/venue city and dummy fields exist |
| unified Matchmaking/general chat | MAJOR EXTENSION | Match discovery/chat primitives exist; public moderation and general room absent |
| Tournament interest/Admin manual matching | MAJOR EXTENSION | no models/routes/pages; safe to add after Admin/Teams |
| future native/mobile client | MINOR-to-MAJOR EXTENSION | shared contracts and bearer-capable client help; cookie auth and DOM `File` upload need adapters |

## P. RISK REGISTER

No P0 finding was proven.

| ID | Severity | Domain | Evidence / observed finding | Impact | Recommended action | Dependencies |
|---|---|---|---|---|---|---|
| AUDIT-API-001 | P1 | API/CORS | `cors.ts` allows GET/POST/PATCH/DELETE/OPTIONS, while six active endpoints use PUT; runtime preflight omitted PUT | browser Team availability/lineup/default formation actions fail | add PUT, regression-test every used method, verify Socket/API allowlists | none |
| AUDIT-CON-001 | P1 | consistency/financial | join/refund/result/deposit/DM/Team invite/scheduler commit before awaited notification insert | client/job can report failure after money/domain success; retries cannot reliably repair notification | transactional notification/outbox records + post-commit publish | transaction boundary design |
| AUDIT-RT-001 | P1 | security/realtime | room auth occurs at join only; removal/leave does not evict sockets | revoked users can passively receive private Team/Match events/messages | track user sockets; evict/reauthorize on membership/participation change | socket gateway changes |
| AUDIT-RT-002 | P1 | realtime/frontend | Match/Team hooks do not rejoin rooms on Socket.IO reconnect | availability/lineup/Team state silently stops updating | rejoin on every `connect`; add reconnect integration tests and optional recovery refetch | none |
| AUDIT-SEC-001 | P1 | security/abuse | no rate limiter/dependency/service quotas found | brute force, spam, resource/storage and unique-key deposit abuse | tiered IP/user/resource limits with proxy configuration and stable errors | deployment topology |
| AUDIT-CONTRACT-001 | P2 | contract/discovery | `z.coerce.boolean()` interprets query `false` as true | unchecked Available filter still filters | strict boolean parser + shared/API-client test | none |
| AUDIT-API-002 | P2 | errors/validation | route UUIDs are string-cast; Prisma not-found/invalid errors often unmapped | malformed IDs produce meaningless 500s | shared UUID param schemas + central Prisma error mapping | none |
| AUDIT-PRIV-001 | P2 potential | Team authorization | any authenticated caller can read full safe roster/default formation by Team UUID | possible Team IDOR/privacy mismatch | decide public/private; assert membership or create smaller public DTO | product decision |
| AUDIT-PRIV-002 | P2 | privacy/performance | public mappers query email/wallet through `safeUserInclude` | larger sensitive-data blast radius and heavy queries | distinct Prisma public/auth selects | mapper typing cleanup |
| AUDIT-AUTH-001 | P2 | sessions | logout only clears cookie; JWT remains valid until expiry | stolen tokens cannot be revoked | session/token version and suspension-aware verification | verification/Admin design |
| AUDIT-AUTH-002 | P2 | CSRF/deployment | SameSite Lax cookie, no CSRF token/origin mutation check | deployment topology can break auth or weaken CSRF assumptions | document same-site deployment; add CSRF/origin design | deployment plan |
| AUDIT-CFG-001 | P2 | environment | `NODE_ENV` missing from example; default development controls Secure cookie | production misconfiguration can issue non-Secure auth cookie | production env schema/checklist; fail closed in production entrypoint | none |
| AUDIT-SEC-002 | P2 | websocket errors | raw internal `Error.message` emitted by socket send handlers | potential Prisma/internal detail leakage | stable socket error envelope + correlated internal logging | error-contract work |
| AUDIT-SEC-003 | P2 | HTTP hardening | no Helmet/CSP/security-header policy; Express signature exposed | weaker browser defense in depth | add deployment-aware headers/CSP and tests | image/provider origins |
| AUDIT-SEC-004 | P2 | invite secrecy | Quick private token stored raw; Team token hashed | DB readers can use all Quick invite links | hash Quick tokens; rotate/one-time reveal strategy | migration/API DTO change |
| AUDIT-UPLOAD-001 | P2 | files | deletion containment hardcodes Windows backslash | Linux replacement/deletion leaks generated files | cross-platform `path.relative` containment test | none |
| AUDIT-DB-001 | P2 | retention | User/Match cascades can erase ledger/participation/payment/history if hard delete appears | destroys financial/moderation/reliability evidence | explicit deactivate/anonymize/retention model before delete endpoints | legal/product retention policy |
| AUDIT-DB-002 | P2 | integrity | wallet signs/balance, owner role, cross-Team/Match links are service-only | future Admin/import/job writers can create impossible states | add feasible checks/composite designs and invariant audit command | schema migrations |
| AUDIT-DB-003 | P2 potential | legacy migration | master migration creates no MatchPayment backfill for legacy participation | historic paid leave/refund may be incomplete if such data existed | inspect production snapshot and document/backfill only if proven | production data access |
| AUDIT-FIN-001 | P2 | wallet architecture | wallet updates split across WalletRepository/MatchesRepository; no non-negative/check/reconciliation | harder to extend safely to Team Wallet | central composable wallet boundary + DB checks + invariant monitor | financial design |
| AUDIT-FIN-002 | P2 | deposit idempotency | concurrent same key can 500; PENDING has no recovery | poor retries; real PSP success can strand funds | atomic operation creation, webhook/reconciliation state machine | PSP selection |
| AUDIT-FIN-003 | P2 | financial retention | wallet/ledger/payment cascades | future deletion can erase audit trail | same retention remediation as DB-001 | legal policy |
| AUDIT-FIN-004 | P2 | wallet UX | external credits notify but do not refresh `currentUser` | header shows stale money | wallet event/query invalidation or wallet endpoint | realtime fix |
| AUDIT-MATCH-001 | P2 | formation model | Team fixtures expose both legacy FormationSlot and Match-Day lineup; generic endpoint can mutate legacy slots | dual unused source can confuse later history/conversion | reject Team mode or define projection lifecycle | Team-v-Team lifecycle |
| AUDIT-MATCH-002 | P2 | results | scorer validation includes LEFT/REMOVED historical participants | result may credit non-attendees | define confirmed attendance and enforce | participant conversion design |
| AUDIT-MATCH-003 | P2 | lifecycle | update allows past kickoff and emits no event | host can abruptly advance effective state; clients stale | future/state validation + room invalidation | none |
| AUDIT-MATCH-004 | P2 | result concurrency | unique DB row protects data but losing concurrent submit is unmapped | confusing 500 and no authoritative recovery | idempotent conflict response/refetch | future result workflow |
| AUDIT-TEAM-001 | P2 | Team realtime | role changes emit no event/notification | affected UI retains stale role | targeted event and refetch; optional notification | RT reconnect work |
| AUDIT-TEAM-002 | P2 | transaction scaling | unbounded Team notification fan-out in serialized Tx | long locks/timeouts at large roster sizes | bulk notification/outbox inserts | CON-001 design |
| AUDIT-NOTIF-002 | P2 | notifications UI | socket receiver ignores `seen` before toast | duplicate user notification race | symmetric ID dedupe and test | none |
| AUDIT-RT-003 | P2 | realtime coverage | detail/ready/cancel/role/delete events missing | 30s delay or indefinite Team staleness | event/invalidation matrix | RT-002 |
| AUDIT-CHAT-001 | P2 | chat scale | unbounded histories + 5s full refetch + sockets | rising DB/network/render cost | cursor pagination and incremental cache | API pagination contract |
| AUDIT-CHAT-002 | P2 | message idempotency | no client message ID | retry can duplicate message | unique sender/client ID operation key | client/API contract |
| AUDIT-FE-001 | P2 | responsive UI | full logo plus five controls in narrow header | likely small-mobile overflow | compact breakpoint and viewport tests | design decision |
| AUDIT-FE-003 | P2 | FormationBoard | position not locally committed; rollback closure can stale under rapid actions | visible snap/jump or rollback over newer state | operation serialization/versioned optimistic state + interaction tests | none |
| AUDIT-A11Y-001 | P2 | dialogs/menus | no focus trap/initial-return focus/Escape in custom dialog | keyboard/screen-reader friction | shared accessible primitives | none |
| AUDIT-A11Y-002 | P2 | forms | absent id/name yields duplicate `undefined-error` descriptor | invalid ARIA relationships | `useId` + hint/error descriptors | none |
| AUDIT-TEST-001 | P2 | coverage | messaging/notifications/scheduler/socket auth boundaries untested | high-risk regressions can pass suite | focused integration tests | remediation behavior |
| AUDIT-TEST-002 | P2 | integration/E2E | no committed authenticated DB API or browser suite | contracts can drift despite unit green | reusable isolated API suite then Playwright/Cypress critical paths | fixture factory |
| AUDIT-TEST-003 | P2 | CORS tests | only POST preflight tested | PUT regression escaped | method-matrix preflight test | API-001 |
| AUDIT-PERF-001 | P2 | discovery | full aggregate/sensitive include for up to 200 then in-memory distance/filter | slow queries and incorrect nearest window | list DTO/select + DB/geospatial cursor | venue redesign |
| AUDIT-PERF-002 | P2 | indexes | query-shaped discovery/scheduler indexes absent | scans/sorts at scale | measure/query-plan and add composite indexes | query redesign |
| AUDIT-PERF-003 | P2 | pagination | growing users/messages/Teams/conversations not cursor-paginated | response and polling growth | shared cursor contracts | API/client/UI work |
| AUDIT-PERF-004 | P2 | fan-out | serialized per-member notification work | lock contention | bulk/outbox | CON-001 |
| AUDIT-CFG-002 | P2 | observability | console-only logs, no request IDs/metrics/audit | financial/socket/job incidents hard to diagnose | structured redacted logs, metrics, health/readiness | deployment stack |
| AUDIT-JOB-001 | P2 | scheduler | in-process polling, no durable notification/job retry | unsuitable for funding/reservation/refund deadlines | durable scheduler/lease/outbox before Phase 6 | infrastructure decision |
| AUDIT-FIN-005 | P3 | wallet product | no history/receipts/available-reserved UI | incomplete wallet product, no present false claim | deliver with Team Wallet/PSP phases | future phases |
| AUDIT-TEAM-003 | P3 | Team settings | empty optional strings become undefined | cannot clear values | nullable clearing contract | none |
| AUDIT-A11Y-003 | P3 | formation keyboard | no arrow-coordinate editing/live save announcement | advanced action less accessible | keyboard coordinate controls/live status | A11Y primitive work |
| AUDIT-PERF-005 | P3 | bundle | single 485 kB JS chunk | future startup growth | route lazy loading when domains expand | none |
| AUDIT-DOC-001 | P3 | README | tabs/chat/smokes/migrations/CORS prose stale | onboarding/test omissions | targeted doc update after fixes | remediation results |
| AUDIT-DOC-002 | P3 | TODO | implemented notifications listed as future | misleading roadmap | replace with linked phased backlog | product planning |
| AUDIT-DOC-003 | P3 | documentation | API/deploy/retention/threat/runbooks missing | tribal knowledge risk | add small authoritative docs | decisions required |
| AUDIT-CFG-003 | P3 | Git hygiene | uploads not ignored | generated media may be committed | ignore exact upload root | none |
| AUDIT-DEP-001 | P3 | dependencies | Express 4 runtime / Express 5 typings; npm audit unavailable | subtle typing drift/unknown advisories | align major; rerun audit in networked CI | CI registry access |

## Q. TECHNICAL DEBT REGISTER

| Debt | Confidence | Why it matters | Suggested boundary/time |
|---|---|---|---|
| Matches and lineup repositories/services are very large | HIGH | future Team-v-Team/funding will multiply responsibilities | split after P1 consistency fixes, before Phases 3/5/6 |
| DTO mappers use `any` | HIGH | privacy contracts lose compiler verification | type from Prisma validator payloads during privacy-select work |
| “lint” is TypeScript only | HIGH | Hooks/accessibility/style rules are invisible | add ESLint with React Hooks and accessibility rules; do not mass-reformat |
| legacy statuses/enums/columns in public types | HIGH | contributors may use obsolete concepts | document history, remove only with data-safe migration |
| Quick Match and Team-Match formation dual data | HIGH | hidden second source | resolve before actual Team-Match participation/history |
| notification policy spread across services | HIGH | inconsistent transaction/realtime behavior | shared outbox/publisher policy in first remediation |
| browser `File` in API-client | HIGH | weakens native portability | upload adapter/blob contract before native client |
| thin feature API re-export modules | ACTIVE, LOW DEBT | add little but establish feature boundaries | leave unless module conventions change |
| repeated root package builds in lint/test/build | HIGH | slower CI but deterministic | cache/build graph later; safe to defer |
| one-line configuration files | LOW | readability only | formatting cleanup is not urgent |

## R. RECOMMENDED REMEDIATION ORDER

1. **Browser contract restoration:** fix `AUDIT-API-001`, strict boolean parsing, UUID/error mapping, and add full CORS/API-client contract tests.
2. **Atomic notification/outbox policy:** address `AUDIT-CON-001`, then migrate Match/deposit/DM/Team/scheduler producers without changing recipient rules.
3. **Realtime authorization and recovery:** evict revoked sockets, rejoin on reconnect, add missing invalidation events, and refresh wallet state (`AUDIT-RT-001`, `RT-002`, `RT-003`, `FIN-004`).
4. **Production-facing security baseline:** authentication/write rate limits, production env fail-closed behavior, safe socket errors, security headers, Quick invite hashing.
5. **Financial foundation before real PSP/Team Wallet:** central wallet boundary, DB checks, pending-payment reconciliation, history retention, receipts/read APIs.
6. **Data/API scalability:** list-specific public selects, cursor pagination, chat cache strategy, measured indexes, bulk notification fan-out.
7. **Focused regression suite:** authenticated DB API tests, socket reconnect/revocation, notification failure injection, CORS method matrix, key browser paths.
8. **Then start the next planned feature slice.** Resolve the Team public/private DTO decision and the legacy Team-fixture formation source before opponent matchmaking.

## S. SAFE-TO-DEFER ITEMS

- route-level bundle splitting while the current gzip bundle remains modest;
- removal of legacy enums/statuses if historical rows may still use them;
- keyboard coordinate nudging after core dialog/focus accessibility;
- live OS-theme change support/third “system” mode;
- general code formatting and thin re-export cleanup;
- Team role-change notification copy, if realtime invalidation is fixed first;
- wallet history UI until the ledger/retention API design is approved;
- Admin, Team Wallet, venue pricing, verification, moderation, reviews, public cities, and tournaments as planned feature phases—not current bug fixes;
- replacing local image storage before multi-instance/production media deployment, after fixing cross-platform deletion and Git ignore now.

## T. PROPOSED NEXT CODEX PROMPTS

1. **Audit Remediation 1 — Browser/API Contract:** allow and test every active CORS method, fix strict discovery booleans, validate UUID route params, and map expected Prisma not-found/conflict errors without changing domain rules.
2. **Audit Remediation 2 — Atomic Notification Outbox:** extend the Phase 1C/1D persisted-notification pattern to Match payments/refunds/results, deposits, DMs, Team invites, and lifecycle jobs; add rollback/failure-injection tests.
3. **Audit Remediation 3 — Realtime Authorization and Reconnect:** evict revoked sockets, rejoin authorized rooms after reconnect, fill targeted Match/Team invalidation gaps, and refresh wallet queries on credit events.
4. **Audit Remediation 4 — Abuse and Session Hardening:** add tested auth/message/resource rate limits, production env validation, socket-safe errors, security headers, and a documented CSRF/deployment model.
5. **Audit Remediation 5 — Financial Integrity Foundation:** add non-negative/invariant enforcement, centralize wallet transaction composition, define retention/anonymization, and implement durable deposit reconciliation before a real PSP.
6. **Audit Remediation 6 — Pagination and Query Shapes:** add cursor contracts, lightweight Match discovery DTOs, paginated chat/DM/notifications/users, and measured composite indexes.
7. **Audit Remediation 7 — Integration Test Harness:** commit isolated authenticated PostgreSQL API fixtures plus Socket.IO reconnect/revocation tests and a small browser critical-path suite.
8. **Product Decision — Team Visibility:** decide public Team profile versus member-only roster/default formation; then implement separate DTO/authorization contracts.
9. **Phase 2A — Social Foundation:** only after the security/realtime baseline, add blocks, friend requests, and friendships as an independent slice.
10. **Phase 2B — Conversation Generalization and Team Chat:** generalize direct-only conversations, then add Team Chat, unread/report/block/rate-limit enforcement.

---

**Final decision:** READY AFTER P0/P1 REMEDIATION. Fix `AUDIT-API-001`, `AUDIT-CON-001`, `AUDIT-RT-001`, `AUDIT-RT-002`, and `AUDIT-SEC-001` before continuing feature development.
