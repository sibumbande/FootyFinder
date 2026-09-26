# Gate 2 onboarding and legal-release runbook

Date: 2026-09-25  
Migration: `20260925120000_gate_2_onboarding`

Gate 2 application code is implemented, but production activation remains blocked until counsel supplies the five approved document bodies, company facts, and the approved retention matrix. Do not replace those inputs with sample wording.

## Migration contents

- Adds nullable DOB, controlled city, experience, ordered positions, onboarding state, email-verification state, and completion timestamps without fabricating legacy values.
- Marks pre-migration accounts as the legacy cohort (`emailVerificationRequired=false`) so they retain sign-in/read access. Their protected mutations remain gated until profile/photo/current legal completion.
- Adds immutable legal-document versions and append-only acceptance evidence.
- Adds controlled cities with Cape Town active and Johannesburg, Durban, Pretoria, Gqeberha, and Bloemfontein as waiting-list-only values.
- Adds deduplicated, consent-scoped city interests with private management tokens.
- Adds hashed, single-use verification/recovery/email-change tokens and delivery state.
- Adds private normalized player-photo metadata and ordered preferred positions.
- Adds played/forfeit result outcome representation used by the supported statistics projection.

## Required external inputs

Before production release, counsel/operations must provide:

1. Exact Terms, Privacy/POPIA, participation acknowledgement, Code of Conduct, and company-disclosure text.
2. An immutable version, effective timestamp, material flag, and reacceptance-required flag for each document.
3. The approved legal/accounting retention matrix.
4. A verified Postmark sending domain, scoped server token, sender address, webhook/incident owner, and rotation procedure.

## Publish approved legal versions

Prepare a protected JSON file containing exactly one entry for each legal-document type. Never commit counsel source files or secrets merely to run the importer.

```powershell
npm run legal:publish --workspace=@footy-finder/api -- --file C:\approved\footy-finder-legal.json
```

The importer calculates the content checksum, refuses a changed body for an existing type/version, and publishes immutable rows. Published rows cannot be updated or deleted by application SQL.

## Deployment sequence

1. Back up the database and drain old application processes.
2. Apply Gate 1 first and complete its runbook.
3. Apply migrations with `npm run prisma:deploy`.
4. Configure `PLAYER_UPLOAD_DIR` on durable private storage. The directory must not be mounted as a public static path.
5. Configure `EMAIL_PROVIDER=postmark`, `EMAIL_FROM`, and `POSTMARK_SERVER_TOKEN`; production configuration rejects console/test delivery.
6. Import the approved legal versions.
7. Run `npm run gate2:preflight --workspace=@footy-finder/api`.
8. Verify all five legal types are current, invalid-profile counts are zero, and no completed profile points to a waiting-list city.
9. Exercise registration, verification, profile/photo/legal completion, password reset, email change, waiting-list management, and a legacy read/mutation-gate journey.

## Runtime verification status

Prisma generation, unit/component tests, lint, builds, image-processing tests, and npm audit passed on 2026-09-25. Migration deployment, database smoke, Postmark test delivery, and Playwright onboarding verification remain pending because this workspace has no reachable PostgreSQL/Docker runtime or production provider credentials/content.
