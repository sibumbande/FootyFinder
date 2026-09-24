# Dependency security triage

Status: **VERIFIED — REMEDIATED**  
Ticket: TKT-004  
Reviewed: 2026-09-24  
Source: authorized `npm audit --json` and `npm audit --omit=dev --json`

## Summary

The baseline advisory graph contained 14 affected dependency nodes: 1 critical, 5 high, and 8 moderate. Remediation completed on 2026-09-24. A fresh authorized `npm audit --json` now reports **0 vulnerabilities**.

The baseline nodes collapsed into five independently verifiable remediation tickets. All five are now addressed. Prisma was migrated as a matched CLI/client pair after reviewing the v7 migration requirements; no further force fix was used.

## Remediation outcome

- SEC-001: `multer@2.4.0`, strict one-file/5 MB/zero-text-field multipart limits, and adversarial tests for oversized files, crafted names/indices, unexpected fields, and truncated bodies.
- SEC-002: `express@4.22.3`, `body-parser@1.20.8`, and `qs@6.16.0`, with regressions for non-callable `constructor.isBuffer` and array-limit bypasses.
- SEC-003/TKT-101: `react-router-dom@7.18.4`; a shared safe return contract rejects raw/encoded backslashes, external/protocol-relative URLs, controls, malformed encodings, and excessive encoding. Focused route tests pass and Playwright coverage is committed.
- SEC-004: `vitest@5.0.1` across every workspace. Every Vitest configuration explicitly excludes `dist/**`.
- SEC-005: `prisma@7.10.0`, `@prisma/client@7.10.0`, and `@prisma/adapter-pg@7.10.0`; schema/config/client construction migrated to Prisma 7. Root overrides pin Prisma's still-vulnerable CLI transitives to `deepmerge-ts@8.0.2` and `mysql2@3.24.4` until Prisma adopts them upstream.

| Group | Reported nodes | Deployment class | Repository reachability | Disposition |
|---|---|---|---|---|
| Team image upload | `multer` | Production, direct | **Reachable.** Authenticated `POST /teams/:teamId/image` invokes Multer memory storage, file filtering, and limits. | **Resolved by SEC-001.** |
| HTTP query parsing | `express`, `body-parser`, `qs` | Production, direct/transitive | **Reachable through Express query parsing.** Query DTOs are subsequently validated by Zod. | **Resolved by SEC-002.** |
| Browser routing | `react-router-dom`, `react-router` | Production browser, direct/transitive | **Reachable.** Both apps use client-side routing and the player app consumes query-string `returnTo` values. | **Resolved by SEC-003/TKT-101.** |
| Test toolchain | `vitest`, `@vitest/mocker`, `vite`, `esbuild` | Development/test only | **Not production-reachable.** CI and package scripts run one-shot tests; no test UI is deployed. | **Resolved by SEC-004.** |
| Prisma CLI configuration | `prisma`, `@prisma/config`, `deepmerge-ts`, `mysql2` | Development/build/migration only | **Not application-runtime-reachable.** Prisma CLI configuration is trusted build input; this application uses PostgreSQL rather than MySQL. | **Resolved by SEC-005.** |

## Advisory disposition by all 14 reported nodes

| Node | Severity | Direct | Owner | Disposition / expiry |
|---|---:|---:|---|---|
| `multer@2.2.0` | High | Yes | API/security owner | Resolved: `multer@2.4.0` plus adversarial upload tests |
| `express@4.22.2` | Moderate | Yes | API owner | Resolved: `express@4.22.3` |
| `body-parser@1.20.6` | Moderate | No | API owner | Resolved: `body-parser@1.20.8` |
| `qs@6.15.3` | Moderate | No | API owner | Resolved: `qs@6.16.0` plus parser regressions |
| `react-router-dom@6.30.4` | Moderate | Yes | Web owner | Resolved: `react-router-dom@7.18.4` plus TKT-101 |
| `react-router@6.30.4` | Moderate | No | Web owner | Resolved: `react-router@7.18.4` plus navigation tests |
| `vitest@2.1.9` | Critical | Yes (dev) | Test-platform owner | Resolved: `vitest@5.0.1` |
| `@vitest/mocker@2.1.9` | Moderate | No | Test-platform owner | Resolved through `vitest@5.0.1` |
| `vite-node@2.1.9` | Moderate | No | Test-platform owner | Resolved through `vitest@5.0.1` |
| nested `vite@5.4.21` | High | No | Test-platform owner | Resolved through the upgraded toolchain |
| nested `esbuild@0.21.5` | Moderate | No | Test-platform owner | Resolved through the upgraded toolchain |
| `prisma@6.19.3` | High | Yes (dev) | Data-platform owner | Resolved: matched Prisma 7.10.0 migration |
| `@prisma/config@6.19.3` | High | No | Data-platform owner | Resolved: `@prisma/config@7.10.0` with patched transitive override |
| `deepmerge-ts@7.1.5` | High | No | Data-platform owner | Resolved: root override to `deepmerge-ts@8.0.2` |

## Advisory details

- Multer: `GHSA-wc9g-mqfw-jrwm`, `GHSA-qfvm-cv95-jqjf`, `GHSA-qvfw-j98x-7q72`, and `GHSA-535w-7cp7-47q4`. The report identifies 2.3.0 as the minimum version outside all four affected ranges.
- `qs`: `GHSA-x5fp-wj9c-mxmx` and `GHSA-4mjr-xmp4-gh2g`. Version 6.16.0 is outside both affected ranges.
- React Router: `GHSA-wrjc-x8rr-h8h6`, `GHSA-337j-9hxr-rhxg`, and `GHSA-jjmj-jmhj-qwj2`. Eliminating the full reported chain requires evaluating the current Router major, not merely suppressing the direct `react-router-dom` finding.
- Vitest toolchain: `GHSA-5xrq-8626-4rwp`, `GHSA-82fw-gwwq-j7x9`, `GHSA-4w7w-66w2-5vf9`, `GHSA-v6wh-96g9-6wx3`, `GHSA-fx2h-pf6j-xcff`, and `GHSA-67mh-4wv8-2f99`. npm proposes Vitest 5.0.1, a SemVer-major change.
- Prisma CLI: `GHSA-ggr8-5vv4-36mx` through `deepmerge-ts`. npm reports a fix, but the paired `prisma`/`@prisma/client` target must be selected and verified together.

## Remediation tickets

### SEC-001 — Upgrade Multer and regression-test bounded uploads

Status: **VERIFIED — COMPLETE**  
Priority: P0  
Owner: API/security owner  
Target: 2026-09-26

- Upgrade Multer to 2.3.0 or newer without force-fixing unrelated packages.
- Retain one-file and 5 MB limits, MIME filtering, signature validation, randomized storage names, and OWNER-only mutation authorization.
- Test crafted multipart field names, oversized indices, aborted uploads, size-limit behavior, wrong signatures, and valid upload/replacement.
- Verify `npm audit`, API tests, lint, build, and the image-upload smoke/manual path.

### SEC-002 — Upgrade Express query-parser dependency chain

Status: **VERIFIED — COMPLETE**  
Priority: P1  
Owner: API owner  
Target: 2026-10-01

- Select a compatible Express/body-parser release resolving `qs` to 6.16.0 or newer; use a root override only if upstream resolution is unavailable and compatibility is demonstrated.
- Add bounded-query/parser-abuse tests for public discovery and Admin list endpoints.
- Verify API contract tests, rate limiting, query Zod validation, lint, build, and audit.

### SEC-003 — Upgrade React Router and close unsafe navigation inputs

Status: **VERIFIED — COMPLETE**  
Priority: P1  
Owner: Web owner  
Target/exception expiry: 2026-10-08

- Upgrade both browser apps together to a release outside every reported range; treat a major upgrade as a focused migration.
- Complete TKT-101 so `returnTo` rejects absolute URLs, protocol-relative paths, backslashes, control characters, and malformed encoded forms.
- Test login, registration, protected routes, Team invites, Match invites, links, back/replace navigation, and open-redirect/XSS payloads.
- The temporary exception is justified only by client-only rendering, no SSR hydration, predominantly internally constructed links, and the existing partial `safeReturnTo` guard.

### SEC-004 — Upgrade the Vitest toolchain

Status: **VERIFIED — COMPLETE**  
Priority: P2  
Owner: Test-platform owner  
Target/exception expiry: 2026-10-24

- Upgrade Vitest consistently across all four workspaces to 5.0.1 or a newer fixed compatible release.
- Reconcile configuration/API changes and confirm only one intended Vitest/Vite-node toolchain remains.
- Keep test/UI servers bound to loopback and do not enable Vitest UI in shared or production environments.
- The temporary exception is justified because current scripts use one-shot `vitest run`, and no test server or UI is deployed.

### SEC-005 — Upgrade Prisma CLI and Client as a tested pair

Status: **VERIFIED — COMPLETE**  
Priority: P2  
Owner: Data-platform owner  
Target/exception expiry: 2026-10-24

- Select matching fixed `prisma` and `@prisma/client` versions; review the official migration notes for every crossed major.
- Regenerate the Client and verify schema validation, migration status/deploy against the disposable database, API lint/build/unit tests, and one database smoke.
- Do not rewrite committed migrations or run against production.
- The temporary exception is justified because the vulnerable merge path is confined to trusted CLI/build configuration and is not imported by the running API.

## Verification record

- Baseline `npm audit --json`: 14 total (1 critical, 5 high, 8 moderate).
- Post-remediation `npm audit --json`: 0 total vulnerabilities.
- `prisma generate`: passes with Prisma 7.10.0 and the `prisma-client` generator.
- API TypeScript lint: passes after the Prisma 7 generated-client/type migration.
- Focused security tests: 10/10 API multipart/query-parser tests and 14/14 web return/navigation tests pass.
- Focused Playwright authentication return/open-redirect coverage is committed to `e2e/critical-path.spec.ts`; execution remains part of the disposable-database CI tier.
- Playwright discovery/type loading passes: 1 browser spec discovered.
- Full repository unit suite passes: 58 files and 238 tests, with no compiled `dist` duplicates.
- Full repository lint and production build pass; the player-web chunk-size warning remains non-blocking.
- `npm ls ... --all`: exact installed paths reviewed.
- Source reachability reviewed for Team image upload, Express query DTOs, browser navigation/`returnTo`, Vitest commands, Vite bundling, and Prisma usage.
- No committed Prisma migration was rewritten and no production database command was run.
