# Gate 3 venues, slots, and home runbook

Status: implementation complete in code; production venue data and database/browser runtime verification remain gated.

## Delivered behavior

- `ManagedVenue` now has a frozen canonical slug, aliases, public copy, licensed-media metadata, amenities, publication state, submit/approve/deactivate evidence, and effective cancellation policies.
- Only active, independently published venues are returned by `GET /venues`, `GET /venues/:slug`, and `GET /venues/:slug/slots`.
- Slots are calculated, not persisted: 60 minutes on a 30-minute grid in the venue timezone, from two hours through 60 days ahead, with a maximum 31-day request window.
- Weekly hours, exceptions, format support, effective scoped prices, active reservations, and both reservations' turnaround buffers are applied. The PostgreSQL exclusion constraint remains the final concurrency guard across all formats on the physical field.
- The player home is venue-first and includes a bounded six-item Upcoming Matches section. Empty venue data is stated honestly; no placeholder production venues appear.
- Quick Match creation requires a selected managed field/slot. The server re-resolves the field, price, policy, schedule, and availability in one serializable transaction.
- The player fee is a whole-rand R0-R500 amount capped at the venue-cost fair share across configured paid capacity. The organiser holds the entire venue cost and is charged the remaining cost at kickoff after participant fees are applied.
- Organiser cancellation restores participant fees and applies the snapshotted venue cancellation policy to the organiser guarantee. Historical venue, price, policy, timezone, buffer, duration, capacity, and match-fee facts remain immutable snapshots.

## Publication workflow

1. An MFA-verified administrator creates and completes a draft under `/admin/venues`.
2. Completeness requires public description, coordinates, cover metadata, at least three attributed gallery images, amenities, fields, formats, recurring availability, an effective price, and an effective cancellation policy.
3. The submitting administrator submits the draft.
4. A different MFA-verified administrator approves and publishes it.
5. Any catalogue change returns the venue to draft. Emergency deactivation records actor, time, and reason and immediately removes the venue from public reads.
6. CEO touch-up batch 3 (D1): photo edits on a **live** venue no longer return it to draft. Photos are uploaded (JPG/PNG/WebP, resized to 1600 px WebP plus a 400 px thumbnail, metadata stripped) and saved as a pending change; the venue stays live with its current photos until a different MFA-verified admin approves the change (or anyone rejects it). Draft venues apply photo edits directly. Smoke: `npm run smoke:venue-photos`. File storage for launch: `docs/LAUNCH_FILE_STORAGE.md`.

Canonical slugs are not changed by ordinary updates. Alias lookup is supported for explicitly migrated historical slugs.

## Production-data blocker

Do not create substitute or synthetic production packs. TKT-302 remains blocked until an owner/operator supplies approved facts for Queens Park, Cape Town City FC, and Italian Club, including:

- canonical name, address, coordinates, timezone, field identities, and supported formats;
- recurring schedules and approved exceptions;
- VAT-inclusive ZAR prices per 60-minute field/format/day-time scope and effective dates;
- cancellation terms;
- media rights, URLs, alt text, and attribution; and
- beneficiary facts required by the later settlement gate.

After approved packs are loaded through the dual-control workflow, run:

```bash
npm run gate3:preflight --workspace=@footy-finder/api
```

The command exits nonzero when any required venue is missing, unpublished, inactive, or incomplete.

## Verification

Fast checks completed on 2026-09-28:

```bash
npm run lint --workspace=apps/api
npm run lint --workspace=apps/web
npm run lint --workspace=apps/admin
npm run test --workspace=packages/shared
npm run test --workspace=apps/api
npm run test --workspace=apps/web
npm run test --workspace=packages/api-client
```

The suites passed with 71 shared, 163 API, 40 web, and 20 API-client tests. Added coverage includes IANA timezone validation, DST/local-time conversion, skipped DST wall time, fee rounding/capping/free slots, publication completeness and dual control, managed-reservation kickoff immutability, managed-field creation UI context, bounded discovery input, and venue API-client query encoding.

Database and browser checks still required in an environment with Docker/PostgreSQL and Chromium:

```bash
npm run db:test:up
npm run prisma:deploy --workspace=@footy-finder/api
npm run smoke:field-bookings --workspace=@footy-finder/api
npm run test:e2e
npm run db:test:down
```

The field-booking smoke performs two concurrent Quick Match reservations for the same physical field/time and requires exactly one success plus one `FIELD_TIME_CONFLICT`; it also verifies immutable price and organiser-guarantee snapshots. The browser critical path covers home venue card → venue calendar → calculated slot → Quick Match creation → home Upcoming Matches.

The attempted disposable database start on 2026-09-28 could not run because the `docker` executable is not installed or available on this workstation. This is a verification limitation, not a passed database check.

## Rollout and rollback

1. Back up the database and run migration `20260926100000_gate_3_venues_slots_home` in staging.
2. Run the Gate 3 preflight and database/browser checks above.
3. Load verified packs as drafts, review them, and publish with a separate administrator.
4. Confirm public venue responses contain no admin actor IDs, audit data, reservations, or beneficiary facts.
5. Monitor `FIELD_TIME_CONFLICT`, guarantee settlement jobs, failed financial transitions, and wallet reconciliation.

If application behavior must be rolled back, deactivate affected venues first so public booking stops without deleting history. Do not drop snapshot columns or venue/field rows referenced by reservations. Use a forward-fix migration for schema defects.
