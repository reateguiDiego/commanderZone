# CommanderZone RC Release Suites

This document separates the RC beta release gate from older broad Playwright
coverage. It does not remove legacy tests.

## Release-Critical Suite

The beta-prod release-critical Playwright suite is the product suite:

```bash
cd frontend
npm run e2e:release-product -- --reporter=line
npm run e2e:release-product:parallel -- --reporter=line
```

Current product suite pattern:

```text
e2e/game-product-.*\.spec\.ts
```

It includes the final 3-player real-game regression gate and the closed RC
contracts:

- identity and hydration
- movement and battlefield position
- gameplay semantics
- UI consistency
- state integrity, replay, and bootstrap
- zone transition rules and visibility
- turn/runtime continuity
- disconnect vote and runtime presence
- chat and gamelog

Rollback is validated separately:

```bash
cd frontend
npm run e2e:rollback-legacy -- --reporter=line
```

## Broad Legacy Suite

The broader historical `*gate*` collection remains useful as legacy and harness
coverage, but it is not the beta-prod release blocker until each spec is updated
to the final RC runtime contract.

Known broad legacy classifications from the RC packaging pass:

| Spec | Classification | Reason |
| --- | --- | --- |
| `game-actor-backpressure-runtime-gate.spec.ts` | legacy/migration-only | Uses `initialState`, which final runtime rejects unless the explicit migration flag is enabled. |
| `game-chat-stream-release-gate.spec.ts` | legacy harness | Waits for debug observer state while beta-prod runs with `GAME_DEBUG_HEALTH_ENABLED=0`. |
| `game-movement-runtime-release-gate.spec.ts` | legacy harness | Same debug observer dependency. |
| `game-sensitive-runtime-release-gate.spec.ts` | legacy harness | Same debug observer dependency. |
| `game-queue-concurrency-gate.multiplayer.spec.ts` | harness/test-data debt | Rematch modal state can intercept unrelated UI controls. |

## Debt

Before promoting broad legacy gates back into release-critical status:

1. Remove migration-only `initialState` assumptions or place them behind an
   explicit migration test profile.
2. Replace debug observer requirements with production-observable metrics or
   enable the debug observer only in a dedicated debug profile.
3. Isolate rematch/test-data state so old games cannot affect unrelated UI
   interactions.
4. Keep any real behavioral assertion by moving it into a `game-product-*` gate
   or updating the existing spec to the final RC contract.

The broad legacy suite does not block beta-prod because the release-critical
product suite covers the real 3-player user flows and closed RC contracts using
the final runtime, patch.v2, compact bootstrap, presence, chat, gamelog, and
rollback paths.
