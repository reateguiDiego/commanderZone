# AGENTS.md

## Scope

Backend workspace for CommanderZone. Follow root [AGENTS.md](C:/Users/alber/Documents/Workspace/commanderZone/AGENTS.md) plus these backend-specific constraints.
Active plan: [COMMANDERZONE_GAMEPLAY_BROWSER_MASTER_PLAN.md](C:/Users/alber/Documents/Workspace/commanderZone/docs/COMMANDERZONE_GAMEPLAY_BROWSER_MASTER_PLAN.md).

## Backend Rules

1. Keep the app scope as a manual online Commander table.
2. Do not implement full Magic rules, stack, priority, or legal-play validation unless explicitly requested.
3. [GameCommandHandler](C:/Users/alber/Documents/Workspace/commanderZone/backend/src/Application/Game/GameCommandHandler.php) must not keep growing without extracting focused handlers.
4. Every backend change must include backend tests.
5. Every synchronization change must include integration or E2E coverage.
6. Do not change API contracts without updating [docs/openapi.yaml](C:/Users/alber/Documents/Workspace/commanderZone/docs/openapi.yaml).
7. Do not introduce dependencies without explicit justification.
8. Do not add secrets to the repository.
9. If backend code changes, run `APP_ENV=test php bin/phpunit`.
10. Use existing rooms and deck validation endpoints/flows; do not create parallel backend systems unless explicitly requested.
11. Prioritize functional hardening (validation, permissions, gauntlet support) over deployment or visual concerns.
