# CommanderZone

Monorepo for an online Magic: The Gathering Commander table.

## Layout

- `backend/`: Symfony API, PostgreSQL persistence, JWT auth, Scryfall import and Mercure events.
- `frontend/`: reserved for the Angular client.

## Backend quick start

```bash
docker compose up -d
cd backend
composer install
php bin/console doctrine:database:create --if-not-exists
php bin/console doctrine:migrations:migrate
symfony serve
```

The backend expects PostgreSQL on `127.0.0.1:5433` and Mercure on `http://127.0.0.1:3000/.well-known/mercure`.

## Useful commands

```bash
cd backend
php bin/console app:scryfall:sync --limit=100
php bin/console app:scryfall:sync --memory-limit=1024M
php -d memory_limit=1536M bin/console app:scryfall:sync --env=prod --no-debug --skip-existing --memory-limit=1536M
php bin/phpunit
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
