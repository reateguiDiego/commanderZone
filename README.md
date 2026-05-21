# CommanderZone

Monorepo for an online Magic: The Gathering Commander table.

## Layout

- `backend/`: Symfony API, PostgreSQL persistence, JWT auth, Scryfall import and Mercure events.
- `frontend/`: Angular client for auth, cards, decks, rooms and the manual game table.

## Backend quick start

```bash
docker compose up -d
docker compose exec api php bin/console doctrine:migrations:migrate
```

The API runs through FrankenPHP at `http://127.0.0.1:8000`.

For local CLI work outside Docker:

```bash
cd backend
composer install
php bin/console doctrine:database:create --if-not-exists
php bin/console doctrine:migrations:migrate
symfony serve
```

The backend expects PostgreSQL on `127.0.0.1:5433` from the host, PostgreSQL on `database:5432` from Docker, and Mercure on `http://127.0.0.1:3000/.well-known/mercure`.

## Useful commands

```bash
cd backend
php bin/console app:scryfall:sync --limit=100
php bin/console app:scryfall:sync --memory-limit=1024M
php -d memory_limit=1536M bin/console app:scryfall:sync --env=prod --no-debug --skip-existing --memory-limit=1536M
docker compose exec api php -d memory_limit=1536M bin/console app:scryfall:sync --env=prod --no-debug --skip-existing --memory-limit=1536M
php bin/phpunit
```

## Backend test environment (reproducible)

The backend test suite must run in `APP_ENV=test` and uses a separate database (`commanderzone_test` via Doctrine `dbname_suffix`).
It does not use or modify the dev database.

### Docker

```bash
docker compose exec -e APP_ENV=test api php bin/console doctrine:database:create --if-not-exists --no-interaction
docker compose exec -e APP_ENV=test api php bin/console doctrine:migrations:migrate --no-interaction
docker compose exec api php bin/phpunit
```

### Local CLI (outside Docker)

```bash
cd backend
APP_ENV=test php bin/console doctrine:database:create --if-not-exists --no-interaction
APP_ENV=test php bin/console doctrine:migrations:migrate --no-interaction
APP_ENV=test php bin/phpunit
```

## API contract

The OpenAPI contract is available at `docs/openapi.yaml`.

## PHP memory

The Scryfall bulk import is streaming and uses DBAL upserts, but the full file is large. The command defaults to `SCRYFALL_SYNC_MEMORY_LIMIT=1024M`; you can override it per run:

```bash
cd backend
php -d memory_limit=1536M bin/console app:scryfall:sync --env=prod --no-debug --skip-existing --memory-limit=1536M
```

Use `--skip-existing` to resume after a failed import without rewriting cards already stored in PostgreSQL. The command still has to scan the Scryfall JSON from the beginning, but existing `scryfall_id` rows are skipped and the database is not reset.

On Windows with the local Scoop PHP install, the CLI memory limit can also be checked with:

```bash
php -i | findstr memory_limit
```

## Frontend quick start

```bash
cd frontend
npm install
npm start
```

The frontend expects the API on `http://localhost:8000` and Mercure on `http://127.0.0.1:3000/.well-known/mercure`.

## Environments

### Local/develop

Use this mode for day-to-day development. It keeps the frontend connected to the local Docker/Symfony services, not production.

```bash
docker compose up -d
docker compose exec api php bin/console doctrine:migrations:migrate --no-interaction

cd frontend
npm start
```

Local frontend URLs are defined in `frontend/src/environments/environment.ts`:

- API: `http://localhost:8000`
- Mercure: `http://127.0.0.1:3000/.well-known/mercure`

### Production

Production frontend builds use `frontend/src/environments/environment.production.ts` through Angular file replacement.

```bash
cd frontend
npm run build:prod
```

The production frontend currently targets:

- API: `https://api.commanderzone.com`
- Mercure: `https://api.commanderzone.com/.well-known/mercure`

Backend production values must be provided by the hosting environment or by an untracked `backend/.env.prod`. Use `backend/.env.prod.example` as a template and never commit real secrets.

## GitHub Actions (CI/CD)

### CI workflows for PRs

- `backend-ci.yml`: backend tests on PRs touching `backend/**`.
- `frontend-ci.yml`: frontend build + unit tests on PRs touching `frontend/**`.

Both are also reusable workflows (`workflow_call`) so the release pipeline can invoke them on merges to `main`.

### Release workflow for `main`

- `repo-main-release.yml` runs on `push` to `main` (and manual dispatch).
- It orchestrates:
  1. Backend CI
  2. Frontend CI
  3. Backend deploy (Hetzner)
  4. Frontend deploy (Vercel production)

Deploy order is backend first, then frontend. If frontend deploy fails after backend deploy succeeded, the release workflow fails and remains visible for follow-up (no automatic rollback).

### Backend deploy guardrail

`backend-deploy.yml` now runs via `workflow_call` (from the main release workflow) or manual dispatch.

For production safety, `HETZNER_ENV_FILE` is mandatory and must be exactly:

- `/opt/commanderZone/.env.prod`

Deploys are rejected if that path is missing, different, points to `.env`, or does not exist on the server.

### Frontend deploy requirements

`frontend-deploy.yml` deploys to Vercel production (`vercel deploy --prod`) and requires these GitHub repository secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

### E2E workflow (out of merge gate)

- `frontend-e2e.yml` is manual (`workflow_dispatch`) and runs the Playwright suite with artifact upload.
- It is intentionally outside the blocking PR/main merge gate to keep release validation focused on backend PHPUnit + frontend build/unit checks.
