# Audit Remediation Closure Register

This register evaluates every finding from the historical `SYSTEM_AUDIT.md` against the current Slice 9 baseline. “Fixed” means committed implementation and regression coverage exist. “Partial” means a material control landed but the full recommendation remains. “Deferred” means the finding depends on a product, legal, provider, or scalability decision and has not been silently redefined.

| Finding | Status | Current disposition |
| --- | --- | --- |
| AUDIT-A11Y-001 | Deferred | Shared focus-trapped dialog/menu primitives remain a focused accessibility slice. |
| AUDIT-A11Y-002 | Deferred | Stable generated form IDs and descriptor composition remain a focused accessibility slice. |
| AUDIT-A11Y-003 | Deferred | Formation coordinate nudging and live announcements remain an advanced interaction slice. |
| AUDIT-API-001 | Fixed | Complete CORS method/header/origin matrix includes `PUT` and `Idempotency-Key`. |
| AUDIT-API-002 | Fixed | Shared route-param validation and centralized safe Prisma mappings. |
| AUDIT-AUTH-001 | Fixed | Persisted independently revocable sessions are shared by HTTP and sockets. |
| AUDIT-AUTH-002 | Fixed | Cookie mutations verify Origin; same-site HTTPS topology is documented. |
| AUDIT-CFG-001 | Fixed | Production environment validation fails closed and examples include `NODE_ENV`. |
| AUDIT-CFG-002 | Fixed | Correlation IDs, redacted structured logs, readiness, queue/finance metrics, and Admin operations dashboard. |
| AUDIT-CFG-003 | Fixed | Generated upload and Playwright artifact roots are ignored. |
| AUDIT-CHAT-001 | Deferred | Cursor pagination and incremental histories remain a scalability slice. |
| AUDIT-CHAT-002 | Deferred | Client-generated message idempotency remains a messaging contract slice. |
| AUDIT-CON-001 | Fixed | Domain and notification rows commit atomically; publication is post-commit best effort. |
| AUDIT-CONTRACT-001 | Fixed | Discovery booleans parse only literal `true`/`false`. |
| AUDIT-DB-001 | Deferred | Requires explicit legal retention/anonymization policy before hard deletion. |
| AUDIT-DB-002 | Partial | Wallet and result-history constraints landed; broader cross-domain constraints remain targeted work. |
| AUDIT-DB-003 | Deferred | A production data snapshot is required before deciding on a legacy payment backfill. |
| AUDIT-DEP-001 | Deferred | Dependency-major alignment remains a dedicated maintenance change; current audit output is recorded by npm. |
| AUDIT-DOC-001 | Fixed | README commands, domains, migrations, operations, and deployment probes are current. |
| AUDIT-DOC-002 | Fixed | Stale TODO prose is replaced by a phased backlog. |
| AUDIT-DOC-003 | Partial | Architecture, manual testing, Admin, operations, and deployment notes exist; legal/provider runbooks await selection. |
| AUDIT-FE-001 | Deferred | Compact mobile-header remediation remains a focused responsive UI slice. |
| AUDIT-FE-002 | Superseded | Current page motion uses short transform/opacity transitions with reduced-motion support. |
| AUDIT-FE-003 | Deferred | FormationBoard operation versioning remains a focused reliability slice. |
| AUDIT-FIN-001 | Fixed | One transaction-capable financial repository owns current wallet mutations and database checks. |
| AUDIT-FIN-002 | Fixed | Deposit creation/transitions are concurrency-safe, idempotent, terminal, and reconciled. |
| AUDIT-FIN-003 | Deferred | Shares the legal retention decision in `AUDIT-DB-001`. |
| AUDIT-FIN-004 | Fixed | Wallet metadata events invalidate/refetch authenticated balance state. |
| AUDIT-FIN-005 | Deferred | Wallet history/receipts UI belongs with production payments and Team Wallet. |
| AUDIT-JOB-001 | Partial | Funding/enforcement deadlines use distributed durable jobs; the older Match lifecycle poller remains single-logical-worker. |
| AUDIT-MATCH-001 | Deferred | Team-Match legacy formation projection requires the later confirmed participation lifecycle. |
| AUDIT-MATCH-002 | Deferred | Historical scorer eligibility requires an explicit attendance policy. |
| AUDIT-MATCH-003 | Fixed | Kickoff updates validate future time/state and publish authoritative invalidation. |
| AUDIT-MATCH-004 | Fixed | Expected result uniqueness/conflicts have stable responses and authoritative recovery. |
| AUDIT-NOTIF-001 | Fixed | Persisted notification rows are the durable truth and sockets publish only after commit. |
| AUDIT-NOTIF-002 | Fixed | Toast deduplication is symmetric by persisted notification ID. |
| AUDIT-PERF-001 | Deferred | Lightweight geospatial discovery remains tied to the venue redesign. |
| AUDIT-PERF-002 | Deferred | Query-shaped indexes require recorded production-like PostgreSQL plans. |
| AUDIT-PERF-003 | Deferred | Shared bounded cursor contracts remain a list-scaling slice. |
| AUDIT-PERF-004 | Fixed | Recipient sets use bulk transactional persistence and deterministic deduplication. |
| AUDIT-PERF-005 | Deferred | Route-level lazy loading remains an optimization, not a correctness blocker. |
| AUDIT-PRIV-001 | Deferred | Team roster/default-formation visibility remains an explicit product decision. |
| AUDIT-PRIV-002 | Deferred | List-specific Prisma public selects remain a query-shape/privacy-hardening slice. |
| AUDIT-RT-001 | Fixed | Revoked participants/members/sessions are evicted from active rooms. |
| AUDIT-RT-002 | Fixed | Reconnect rejoins authorized rooms and refetches authoritative state. |
| AUDIT-RT-003 | Fixed | Match, Team, wallet, availability, lineup, claim, and finalization invalidations are metadata-only. |
| AUDIT-SEC-001 | Fixed | Tiered stable rate limits cover authentication, messages, deposits, uploads, and costly mutations. |
| AUDIT-SEC-002 | Fixed | Socket errors use stable safe public envelopes and correlated internal logs. |
| AUDIT-SEC-003 | Fixed | Express identification is disabled and deployment-aware Helmet headers are enabled. |
| AUDIT-SEC-004 | Fixed | Quick Match invitation tokens are hashed without invalidating migrated active links. |
| AUDIT-TEAM-001 | Fixed | Role/removal/deletion events invalidate clients and revoke room access. |
| AUDIT-TEAM-002 | Fixed | Team notification persistence is bulk, deduplicated, atomic, and post-commit published. |
| AUDIT-TEAM-003 | Deferred | Explicit nullable clearing remains a small Team settings contract change. |
| AUDIT-TEST-001 | Fixed | Scheduler, notification failure, socket security, finance, and domain smokes are committed. |
| AUDIT-TEST-002 | Fixed | Authenticated PostgreSQL smokes and a real Playwright browser critical path are committed with exact cleanup. |
| AUDIT-TEST-003 | Fixed | The full CORS preflight matrix is regression tested. |
| AUDIT-TEST-004 | Partial | High-risk boundaries are covered; exhaustive UI/accessibility interaction coverage remains with their slices. |
| AUDIT-UPLOAD-001 | Fixed | Local image containment is cross-platform and signature/path tested. |

## Release interpretation

No P1 finding from the historical audit remains open. Deferred items do not block the current Admin back-office feature set, but production payment acceptance still requires a selected PSP, provider webhook verification, legal retention decisions, durable object storage, and a shared rate-limit store for horizontal scaling.
