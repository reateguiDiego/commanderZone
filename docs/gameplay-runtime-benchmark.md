# Gameplay Runtime Benchmark

Benchmark reproducible para estabilidad/performance del runtime Go de CommanderZone.

## CI smoke

GitHub Actions ejecuta en `go-runtime-ci`:

```bash
cd game-runtime
go test ./...
go test -race ./...
go vet ./...
go test -run '^$' -bench 'BenchmarkRuntimeGameplaySmoke|BenchmarkApplyOnlyRuntimeCommands4Players100' -benchmem ./internal/perf ./internal/actor
go run ./cmd/runtime-bench -games=10 -iterations=1 -transport=actor -fail-on-gate -output=runtime-bench-smoke.json
```

## Local

Smoke:

```bash
cd game-runtime
go run ./cmd/runtime-bench -games=10 -iterations=1 -transport=actor -fail-on-gate -output=runtime-bench-smoke.json
```

Escala progresiva:

```bash
cd game-runtime
go run ./cmd/runtime-bench -games=10,25,50,100 -connections=400 -iterations=1 -transport=websocket -fail-on-gate -output=runtime-bench-scale.json
```

## Escenario

Cada partida usa:

- 4 jugadores.
- 100 cartas por jugador.
- 20 cartas en battlefield por jugador.
- tokens activos.
- chat simulado como stream no gameplay.
- stack inicial y comando de stack.
- attachment inicial y comando de attachment.
- mulligan Vancouver take/keep/scry.
- reconnect medido cuando `-transport=websocket`.

Comandos cubiertos:

- `life.changed`
- `turn.changed`
- `card.tapped`
- `card.moved`
- `library.draw`
- `library.draw_many` con `count=7`
- `library.reveal_top` con `count=10`
- `cards.moved`
- `zone.move_all`
- `card.token.created` con `quantity=20`
- `stack.card_added`
- `attachment.created`
- `mulligan.take`
- `mulligan.keep`
- `mulligan.scry.confirm`

## Gates

`runtime-bench` siempre escribe un JSON con `gate.checks`, `gate.failures`,
`gate.criticalFailures` y `gate.advisoryFailures`.

Con `-fail-on-gate`, el proceso sale con codigo `1` solo si existe al menos un
fallo critico. Los fallos advisory quedan en el JSON/log, pero no bloquean.

Checks criticos:

- runtime route con comandos reales: `runtime_route_command_count > 0`.
- refetch por comando normal = 0.
- legacy fallback = 0.
- snapshot load/write en runtime command path = 0.
- `initialState` por comando = 0.
- comando runtime unsupported = 0.
- patch/event contract invalid = 0.
- errores de benchmark/comando = 0.
- DB lock runtime path = 0.
- previous/next projection runtime path = 0.
- resync rate < limite configurado.

Checks advisory:

- patch simple max <= `-simple-patch-bytes-limit`.

## Limites actuales

- `actor` es el modo determinista para CI smoke.
- `websocket` usa servidor Go `httptest` y conexiones reales con tickets HMAC, no navegador Angular.
- DB writes/latency se miden sobre el `EventStore` usado por el runner. El smoke usa store en memoria instrumentado.
- Las lecturas de snapshot usadas para preparar fixtures se reinician antes de ejecutar comandos; `snapshot_load_runtime_path` mide solo el hot path de comandos.
- Refetch es un concepto frontend; el runner Go reporta `refetchCount=0` y marca `refetchCountMeasured=false`.
