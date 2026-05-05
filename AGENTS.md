# AGENTS.md

## Active Plan

1. Active execution plan: [COMMANDERZONE_GAMEPLAY_BROWSER_MASTER_PLAN.md](C:/Users/alber/Documents/Workspace/commanderZone/docs/COMMANDERZONE_GAMEPLAY_BROWSER_MASTER_PLAN.md).
2. Treat [CODEX_COMMANDERZONE_E2E_PLAN.md](C:/Users/alber/Documents/Workspace/commanderZone/docs/CODEX_COMMANDERZONE_E2E_PLAN.md) as historical context only, not as an active checklist.

## Project Reality

CommanderZone is a manual online Commander table. It is not a full Magic rules engine.

## Non-Negotiable Rules

1. Keep the product scope as a manual online Commander table.
2. Do not implement complete Magic rules.
3. Do not implement stack, priority, or legal-play validation unless explicitly requested.
4. Do not change frontend and backend in the same task unless strictly necessary.
5. Do not change API contracts without updating [docs/openapi.yaml](C:/Users/alber/Documents/Workspace/commanderZone/docs/openapi.yaml).
6. Do not introduce dependencies without clear technical justification.
7. Do not add secrets, tokens, or private credentials to the repository.
8. Do not work on deployment/infra rollout in this phase.
9. Do not prioritize advanced visual redesign in this phase.
10. Keep existing E2E coverage green while evolving functionality.

## Current Phase Priorities

1. Use existing rooms flow (public/private/invites); do not create a parallel rooms system.
2. Use existing deck flows (import, quick-build, deck editor); do not create a parallel deckbuilder.
3. Do not recreate Playwright setup or baseline E2E tests that already exist.
4. Prioritize real Commander deck validation, public/private room readiness, and browser gauntlet stability.

## Frontend Architecture Guardrails

1. [GameTableComponent](C:/Users/alber/Documents/Workspace/commanderZone/frontend/src/app/features/game/game-table/game-table.component.ts) must remain mostly presentational.
2. [GameTableStore](C:/Users/alber/Documents/Workspace/commanderZone/frontend/src/app/features/game/game-table/game-table.store.ts) must not keep growing as a single unit.
3. Split GameTable responsibilities progressively into focused pieces:
   - realtime
   - polling
   - commands
   - card selection
   - drag and drop
   - chat and log
   - control permissions
4. For Playwright tests, do not use arbitrary waits (`waitForTimeout`-style sleeps).
5. For multiuser E2E, use two isolated `BrowserContext` instances.
6. If frontend code changes, run:
   - `npm test`
   - `npm run build`

## Backend Architecture Guardrails

1. [GameCommandHandler](C:/Users/alber/Documents/Workspace/commanderZone/backend/src/Application/Game/GameCommandHandler.php) must not continue growing without extracting specific handlers.
2. Any backend behavior change must include backend tests.
3. Any synchronization change (realtime, polling, ordering, idempotency) must include E2E or integration coverage.
4. If backend code changes, run:
   - `APP_ENV=test php bin/phpunit`
