# Gameplay LibraryOps Baseline

## Objetivo

Este baseline fija una referencia reproducible para los hot paths de `library` antes de fases posteriores de compact state, semantic patches o event store.

## Comandos

Ejecutar tests backend:

```powershell
cd C:\Users\Diego\Dev\commanderZone\backend
$env:APP_ENV='test'
php bin/phpunit
```

Ejecutar baseline de `library`:

```powershell
cd C:\Users\Diego\Dev\commanderZone\backend
$env:APP_ENV='test'
php bin/console app:gameplay:baseline `
  --iterations=3 `
  --scenario=ws_draw_1 `
  --scenario=ws_draw_7 `
  --scenario=ws_reveal_top_10 `
  --scenario=ws_reorder_top_10 `
  --format=json `
  --output=var/perf/libraryops-baseline.json `
  --raw-output=var/perf/libraryops-baseline.ndjson
```

Notas:

- Usar `--iterations=3` o más para evitar ruido de warmup.
- El `.json` agrega por escenario.
- El `.ndjson` conserva una fila por comando con todas las métricas crudas.

## Escenarios Cubiertos

- `ws_draw_1`
- `ws_draw_7`
- `ws_reveal_top_10`
- `ws_reorder_top_10`

La cobertura funcional adicional de `library` queda validada por tests backend para:

- `library.draw`
- `library.draw_many`
- `library.move_top`
- `library.reveal_top`
- `library.reorder_top`
- `library.shuffle`
- `library.view`
- `library.play_top_revealed`
- `card.moved` y `cards.moved` hacia `top`/`bottom` de `library`
- privacidad de `library`

## Ejemplo Real

Salida obtenida localmente el `2026-06-20` con `--iterations=1`:

| scenario | total_server_ms | normalize_ms | projection_ms | patch_build_ms | patch_bytes | snapshot_before | snapshot_after | visible_cards | memory_peak_bytes | resync |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `ws_draw_1` | 1937.34 | 1361.19 | 21.15 | 0.25 | 6880 | 304714 | 383144 | 927 | 18874368 | false |
| `ws_draw_7` | 71.51 | 4.88 | 18.99 | 0.30 | 12726 | 304714 | 383157 | 942 | 23068672 | false |
| `ws_reveal_top_10` | 78.50 | 5.40 | 17.36 | 0.19 | 34292 | 304742 | 383444 | 951 | 25165824 | false |
| `ws_reorder_top_10` | 87.05 | 4.63 | 20.44 | 0.20 | 5157 | 304746 | 383233 | 921 | 27262976 | false |

Interpretación rápida:

- `ws_draw_1` salió inflado por warmup de primera iteración; no usar una sola iteración para comparar fases.
- `reveal_top_10` sigue siendo el escenario de mayor `patch_bytes` en esta muestra.
- `reorder_top_10` mantiene `patch_bytes` bajos respecto a `reveal_top_10`, útil como referencia para validar que no reaparecen resyncs innecesarios.
