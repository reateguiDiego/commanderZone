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
php bin/phpunit
```
