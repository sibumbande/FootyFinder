# Footy Finder

Footy Finder is a TypeScript monorepo for discovering players and organising soccer match lobbies. The current vertical slice includes registration, login, persistent cookie authentication, protected routing, and a database-backed player directory.

## Requirements

- Node.js 20 or newer
- npm 10 or newer (included with current Node.js releases)
- PostgreSQL 14 or newer

## Workspace

- `apps/web` — Vite, React, React Router, TanStack Query, React Hook Form, and Tailwind CSS.
- `apps/api` — Express, Prisma/PostgreSQL, Argon2, JWT authentication, and Socket.IO scaffolding.
- `packages/shared` — platform-independent public types and Zod schemas.
- `packages/api-client` — framework-independent HTTP client for web and a future native app.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `apps/api/.env.example` to `apps/api/.env`. Set a PostgreSQL connection string and replace the example JWT secret:

   ```env
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/footy_finder?schema=public"
   PORT=3000
   JWT_SECRET=replace-this-with-at-least-32-random-characters
   JWT_EXPIRES_IN_SECONDS=604800
   CLIENT_URL=http://localhost:5173
   ```

3. Optionally copy `apps/web/.env.example` to `apps/web/.env` if the API is not at `http://localhost:3000`.

4. Generate Prisma Client and apply the committed initial migration:

   ```bash
   npm run prisma:generate
   npm run prisma:migrate
   ```

   When Prisma prompts for a migration name during later schema work, use a descriptive name. On a clean database, the committed `20260809000000_init` migration creates users, matches, participants, and lobby messages.

5. Start both applications:

   ```bash
   npm run dev
   ```

   The web app runs at `http://localhost:5173` and the API at `http://localhost:3000`. Open `/register` to create the first user; no seed data is required.

Individual commands are `npm run dev:web` and `npm run dev:api`. Quality checks are `npm run lint`, `npm test`, and `npm run build`.

## Authentication overview

Registration and login validate shared Zod contracts. The API hashes passwords with Argon2id and stores only `passwordHash`. It signs a short JWT identity payload and sends it in an HTTP-only, same-site cookie; frontend JavaScript never reads or stores the credential. The API client includes credentials with requests, `GET /users/me` restores the session, and TanStack Query owns the current safe `PublicUser`. Logout clears the cookie and authenticated query cache.

The middleware also accepts an `Authorization: Bearer` token so a future native client can reuse the API contract. In production, serve the web and API in a compatible same-site deployment and use HTTPS so the secure cookie is enforced.

## Implemented API endpoints

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /users/me` (authenticated)
- `GET /users` (authenticated)
- `POST /wallet/deposits/demo` (authenticated; requires `Idempotency-Key`)
- Persistent match create, read, update, delete, join, leave, participant, and message-history routes under `/matches`.

API errors use safe messages and status codes (`400`, `401`, `409`, and `500`) without exposing password hashes, tokens, Prisma errors, or stack traces.

## CORS policy

The Express API and Socket.IO server only expose browser responses to the origin configured by `CLIENT_URL`. For local development this is `http://localhost:5173`. Set `CLIENT_URL` to the deployed web application's exact origin in production; requests from CLI and server-to-server clients without an `Origin` header remain supported.

## Theming

The web application supports persisted light and dark modes and defaults to the operating-system preference on a first visit. All color values live in `apps/web/src/app/theme.css`; components consume semantic Tailwind tokens such as `canvas`, `surface`, `content`, `line`, `brand`, and `danger`. Update the light and dark CSS variables in that file to change the system palette without editing individual components.

Page navigation uses a shared directional spring transition: forward navigation enters from the right, browser-back navigation enters from the left, and redirects use a neutral fade/lift. Its duration, distance, spring curve, and keyframes are controlled centrally in `apps/web/src/app/motion.css`. The transition restarts for every React Router history location and automatically disables itself when the visitor requests reduced motion.

## Match booking and lobbies

Authenticated players can start the booking wizard from the Home banner or `/matches/new`. The current field catalogue contains three temporary frontend fixtures; it is isolated in `apps/web/src/features/matches/constants/fields.ts` so it can be replaced by a fields API later. A booking records its selected field, address, kickoff date/time, name, and optional description in PostgreSQL.

Creating a match also creates a persistent lobby and assigns its creator to Home Team starter slot 1. Each lobby supports 30 joined players split into two teams, with 10 starters and 5 reserves per team. Players can join and leave, while the host remains responsible for the lobby and is the only user allowed to delete it. Deleting a lobby cascades to its participants and persisted lobby messages. The chat panel is intentionally display-only until message persistence and Socket.IO delivery are implemented.

The `20260810000000_add_match_team_slots` migration adds persistent team, squad-role, and slot assignments. Apply committed migrations with `npm run prisma:migrate` during local setup.

## Wallet and match fees

Each signed-in user has a private ZAR wallet balance, stored as integer cents. The header displays the balance and provides a temporary **Add funds** action that credits R500.00 through the demo payment operator. Creating a match or joining one costs R80.00; the fee and the match operation are committed in one database transaction, so either both succeed or neither does.

The deposit module accepts a provider-neutral success, failure, or error result. Each attempt is recorded in `WalletTransaction` with an idempotency key, provider reference, and status. A future card gateway can implement `PaymentOperator` without changing the wallet settlement flow. The demo route is development scaffolding and should be disabled or replaced before production payments are enabled.
