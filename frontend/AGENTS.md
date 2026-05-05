# AGENTS.md

## Scope

Frontend workspace for CommanderZone. Follow root [AGENTS.md](C:/Users/alber/Documents/Workspace/commanderZone/AGENTS.md) plus these frontend-specific constraints.

## Frontend Rules

1. Keep changes inside `/frontend` unless cross-layer changes are strictly required.
2. Preserve the app goal: manual online Commander table.
3. Do not implement full Magic rules, stack, priority, or legal-play validation unless explicitly requested.
4. Keep [GameTableComponent](C:/Users/alber/Documents/Workspace/commanderZone/frontend/src/app/features/game/game-table/game-table.component.ts) mostly presentational.
5. Do not keep adding responsibilities to [GameTableStore](C:/Users/alber/Documents/Workspace/commanderZone/frontend/src/app/features/game/game-table/game-table.store.ts) without splitting by concern.
6. Separate responsibilities progressively into focused modules/services for realtime, polling, commands, selection, drag/drop, chat/log, and permissions.
7. Use isolated `BrowserContext` instances for multiuser E2E scenarios.
8. Do not use arbitrary Playwright waits.
9. If frontend code changes, run `npm test` and `npm run build`.
10. Do not change API contracts from frontend work without updating [docs/openapi.yaml](C:/Users/alber/Documents/Workspace/commanderZone/docs/openapi.yaml).
