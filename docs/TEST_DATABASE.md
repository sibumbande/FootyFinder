# Disposable test database

Database smoke tests and Playwright tests must run with `NODE_ENV=test` against an explicitly disposable PostgreSQL database. The repository rejects database-backed test tooling unless the host is local/CI and the database name begins with one of these approved names:

- `footy_finder_test`
- `footy_finder_ci`
- `footy_finder_manual_qa`

An optional lowercase worker suffix is supported, for example `footy_finder_ci_worker-1`. The ordinary development database `footy_finder` and remote hosts are deliberately rejected. The guard never prints a database URL because it may contain credentials.

## Docker Compose setup

The root `compose.test.yml` starts PostgreSQL 16 on local port 5433 with an in-memory data directory. All data is discarded when the container stops.

```bash
npm run db:test:up
```

Copy `apps/api/.env.test.example` to `apps/api/.env.test` if an editor or another local tool needs a file. Do not commit that file. For repository commands, export the two required values in the current shell instead:

PowerShell:

```powershell
$env:NODE_ENV = 'test'
$env:DATABASE_URL = 'postgresql://postgres:postgres@localhost:5433/footy_finder_test?schema=public'
```

Bash:

```bash
export NODE_ENV=test
export DATABASE_URL='postgresql://postgres:postgres@localhost:5433/footy_finder_test?schema=public'
```

Apply committed migrations and confirm their status:

```bash
npm run prisma:deploy
npm run prisma:status
```

Run the API readiness check and one representative database smoke test:

```bash
npm run dev:api
curl --fail http://localhost:3000/health
npm run smoke:match-capacity --workspace=@footy-finder/api
```

Run all database smoke scripts or the browser critical path with:

```bash
npm run test:smoke
npm run test:e2e
```

Stop the disposable database:

```bash
npm run db:test:down
```

Each smoke/E2E script creates uniquely tagged fixtures and cleans only those fixtures. The Compose database is also disposable in its entirety, but no repository command automatically drops any database. Never point these tools at production, staging, a shared development database, or a database with data that must be retained.

## Native PostgreSQL alternative

Create a local database using an approved disposable name, set `NODE_ENV=test` and `DATABASE_URL` as above (normally using port 5432), then run the same migration and test commands. Remove that database manually only after confirming its exact name and that it contains no data that must be retained.
