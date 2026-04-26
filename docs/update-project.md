# Project Update Script

Use `update-project.ps1` from the repository root to bring the local workspace up to date after pulling changes.

## Basic Usage

```powershell
cd C:\Users\Diego\Dev\commanderZone
powershell -ExecutionPolicy Bypass -File .\update-project.ps1
```

If your PowerShell execution policy already allows local scripts, this shorter form also works:

```powershell
.\update-project.ps1
```

## What It Does

- Runs `npm install` in `frontend/`.
- Runs `composer install` in `backend/`.
- Starts PostgreSQL and Mercure with Docker Compose.
- Runs Doctrine migrations.
- Validates the Symfony container.
- Validates the Doctrine schema.
- Lints YAML config and `docs/openapi.yaml`.
- Creates and migrates the backend test database.
- Runs backend PHPUnit tests.
- Builds the Angular frontend.

## Useful Options

Rebuild the FrankenPHP API image too:

```powershell
.\update-project.ps1 -BuildApi
```

Skip frontend work:

```powershell
.\update-project.ps1 -SkipFrontend
```

Skip backend work:

```powershell
.\update-project.ps1 -SkipBackend
```

Skip Docker startup:

```powershell
.\update-project.ps1 -SkipDocker
```

Skip Doctrine migrations:

```powershell
.\update-project.ps1 -SkipMigrations
```

Skip checks and builds:

```powershell
.\update-project.ps1 -SkipChecks
```

## Common Examples

Update dependencies and database, but do not run tests or frontend build:

```powershell
.\update-project.ps1 -SkipChecks
```

Only update backend dependencies and run migrations:

```powershell
.\update-project.ps1 -SkipFrontend -SkipChecks
```

Fully refresh the project after a bigger pull, including rebuilding the API container:

```powershell
.\update-project.ps1 -BuildApi
```
