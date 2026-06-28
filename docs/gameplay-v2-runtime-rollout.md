# Gameplay V2 Runtime Rollout

## Flags

- `GAMEPLAY_V2_ENABLED`: master switch for every backend V2 gameplay path.
- `GAMEPLAY_V2_COMMAND_ENABLED`: routes allowlisted commands through PHP V2 appliers as source of truth.
- `GAMEPLAY_V2_COMMANDS_ALLOWLIST`: comma-separated command allowlist.
- `RUNTIME_SERVICE_ENABLED`: permits integration with the Go runtime service when ticket issuance and transport are ready.
- `SEMANTIC_PATCHES_ENABLED`: enables direct semantic patches for migrated commands.
- `COMPACT_BOOTSTRAP_ENABLED`: enables compact bootstrap responses.
- `SHADOW_COMPARE_ENABLED`: runs V2 comparison in parallel while legacy remains source of truth.

## Shadow Mode

Shadow mode runs only after the legacy command path succeeds. It applies the allowlisted V2 applier to a cloned snapshot, normalizes volatile fields, compares the final state, and records metrics. It never mutates the persisted game, emitted patch, event payload, stream log, or user response.

Recorded fields:

- `shadow_compare_enabled`
- `shadow_compare_ms`
- `shadow_diverged`
- `shadow_divergence_count`
- `divergence_count`
- `shadow_fallback_count`
- `fallback_count`
- `shadow_runtime_error_count`
- `runtime_error_count`
- `shadow_patch_size_bytes`
- `runtime_service_enabled`

## Rollout Order

1. Local: set `GAMEPLAY_V2_ENABLED=1`, `SHADOW_COMPARE_ENABLED=1`, and keep `GAMEPLAY_V2_COMMAND_ENABLED=0`.
2. Staging: enable the same flags with the initial allowlist.
3. Internal games: monitor divergence and fallback counts for a full session.
4. Low percentage: enable `GAMEPLAY_V2_COMMAND_ENABLED=1` only for commands with zero critical divergences.
5. Semantic patches: enable `SEMANTIC_PATCHES_ENABLED=1` after command routing is stable.
6. Runtime service: enable `RUNTIME_SERVICE_ENABLED=1` only after Symfony issues signed runtime tickets and the Go service has production persistence validated.
7. Compact bootstrap: enable `COMPACT_BOOTSTRAP_ENABLED=1` after viewer privacy golden tests pass.

## Rollback

Set these to `0`:

```text
GAMEPLAY_V2_COMMAND_ENABLED=0
SEMANTIC_PATCHES_ENABLED=0
RUNTIME_SERVICE_ENABLED=0
COMPACT_BOOTSTRAP_ENABLED=0
```

Legacy snapshot gameplay remains the source of truth during shadow mode, so rollback does not require state migration.

## Initial Command Allowlist

```text
life.changed,turn.changed,dice.rolled,card.tapped,library.draw,library.draw_many,card.moved,cards.moved,library.reveal_top
```

Dice roll shadow comparison is skipped unless the payload already contains a deterministic result.
