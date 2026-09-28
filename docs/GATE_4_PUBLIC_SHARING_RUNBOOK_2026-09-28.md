# Gate 4 public sharing runbook

Status: implementation complete in code; PostgreSQL migration/preflight and Playwright runtime verification remain pending.

## Delivered behavior

- Every public Match receives an immutable opaque identifier shaped as `m-` plus 24 lowercase hexadecimal characters. Existing public Matches are backfilled; private Matches must keep `publicSlug` null.
- `CLIENT_URL` is the single canonical web origin. Public URLs are generated as `${CLIENT_URL}/m/:slug` with no referral, campaign, or private token data. Slugs never change, so no alias/redirect lifecycle is needed. Existing authenticated `/matches/:uuid` lobby URLs remain non-canonical application routes.
- `GET /public/matches/:slug` is outside authentication and protected by a dedicated per-minute rate limit. Its database projection and response contain only the DEC-004 facts: slug/canonical URL, public name/description, venue summary, kickoff/duration/format/fee/rules, safe status/joinability, and aggregate capacity.
- The anonymous query never selects participant identity, profile/contact data, wallets/payments, chat, creator identity, invite data, or detailed address. Private and unknown valid slugs produce the same `PUBLIC_MATCH_NOT_FOUND` response.
- `/m/:slug` supports direct navigation and refresh. Logged-out visitors can sign in or register with a validated same-match `returnTo`; verified/onboarded users can resolve the full Match and join through the existing transactional wallet/capacity path.
- Every public preview and authenticated public lobby exposes Web Share, WhatsApp, and copy actions generated from live facts and the canonical URL. Private lobbies retain their separate hashed, rotatable invitation flow.

## Configuration

Set the externally reachable canonical player origin and anonymous-preview rate limit:

```env
CLIENT_URL=https://app.example.com
RATE_LIMIT_PUBLIC_PREVIEWS_PER_MINUTE=120
```

Production configuration already requires HTTPS for `CLIENT_URL`. Replace the process-local rate-limit store with a shared store before horizontally scaling the API.

## Migration and verification

Against the disposable database first:

```bash
npm run db:test:up
npm run prisma:deploy --workspace=@footy-finder/api
npm run gate4:preflight --workspace=@footy-finder/api
npm run test:e2e
npm run db:test:down
```

The preflight is read-only and exits nonzero if any public Match has a missing/invalid slug, a private Match has a public slug, or a duplicate exists. The browser path covers anonymous shared-link preview, login and same-link return, a uniquely keyed environment-gated demo deposit, transactional join, and safe full/cancelled/private outcomes. It never edits a wallet balance directly.

Fast unit/component coverage verifies slug shape/uniqueness, canonical generation, exact privacy DTO, safe lifecycle states, generic not-found behavior, rate limiting, API-client paths, auth continuation links, Web Share, WhatsApp encoding, and copy fallback.

## Rollout

1. Back up PostgreSQL and confirm `CLIENT_URL` is the final HTTPS player origin.
2. Deploy migration `20260928120000_gate_4_public_match_sharing` in staging. It backfills public Matches, then adds unique, visibility/shape, and immutability enforcement.
3. Run `gate4:preflight` and the browser acquisition flow.
4. Inspect an anonymous response and confirm it has only the approved DTO keys.
5. Deploy API and web together so generated canonical links resolve immediately.
6. Monitor `PUBLIC_MATCH_NOT_FOUND`, `RATE_LIMITED`, auth-return completion, join conflicts, and demo-deposit use by environment.

## Rollback and forward fixes

Do not change or recycle a published slug and do not reuse it as a private invitation token. If application behavior must be disabled, remove public share entry points while leaving identifiers and the anonymous status resolver available for already-shared links. Do not drop the column, unique index, constraint, or trigger after links have escaped; correct schema issues with a forward migration.

Gate 4 does not introduce real payment processing. The acquisition E2E uses only the existing disposable-environment demo operator; production payments remain Gate 6 work.
