# Gameplay Dynamic Power/Toughness Contract

## Modelo

La fuerza y resistencia impresas son datos estáticos inmutables por cara. El runtime conserva `printedStats[faceKey]` con `power`, `toughness`, `faceIndex` y provenance. Los ajustes manuales viven de forma independiente en `manualOverrides[faceKey]`; cada eje es opcional, un valor `0` explícito es válido y la ausencia del eje no equivale a cero. Los counters permanecen exclusivamente en `counters`.

Las provenance admitidas son `manual`, `token_creation`, `copy_effect` e `imported_legacy`. Un token fija la base de su template al crearse. Una copia fija la base impresa/default disponible en el momento de creación, no hereda overrides manuales mutables y no vuelve a consultar la instancia original.

## Clasificador

El clasificador recorta espacios, normaliza `x` a `X` y distingue:

- `NUMERIC`: enteros con signo y decimales, sin truncado.
- `FORMULA`: valores con `*` o `X`.
- `UNKNOWN_SYMBOLIC`: por ejemplo `?`, `∞` u otro símbolo no evaluable.
- `ABSENT`: `null` o string vacío.

No evalúa fórmulas ni reglas de Magic. El locale no altera la representación persistida.
La presencia explícita de un default `null` se conserva como `ABSENT`; no se confunde con un campo omitido ni hereda el antiguo mutable root.

## Valor base, efectivo y visible

Un override presente es la base del eje. Sin override, solo un printed stat numérico se convierte a número. Una fórmula o símbolo se muestra literalmente. El neto de `+1/+1` y `-1/-1` puede sumarse para presentación únicamente cuando la base es numérica; en bases no evaluables la fórmula y los counters se muestran por separado. El valor efectivo no se persiste.

## Comandos, autorización y errores

`card.stats.override.set` recibe `instanceId`, `faceIndex` o `faceKey`, y al menos `power` o `toughness`. Omitir un eje no lo modifica; `null` explícito lo limpia. `card.stats.override.clear` recibe los ejes en `axes`. Ambos son atómicos, idempotentes por `clientActionId`, respetan controller en battlefield, owner fuera de battlefield y los guards lifecycle/game close.

Los rechazos estables incluyen `INSTANCE_NOT_FOUND`, `INSTANCE_NOT_CONTROLLED`, `INSTANCE_NOT_OWNED`, `INVALID_FACE`, `INVALID_POWER_OVERRIDE`, `INVALID_TOUGHNESS_OVERRIDE`, `NO_STATS_AXIS_PROVIDED`, `PLAYER_NOT_ACTIVE`, `GAME_CLOSED` y `PERMISSION_DENIED`. Un rechazo no cambia versión, evento, patch ni estado local.

Los quick controls solo operan cuando el eje tiene una base numérica u override numérico. Una fórmula o símbolo sin override produce una acción clara para establecerlo; nunca parte de cero, nunca envía el otro eje y nunca genera `NaN`.

## DFC, replay y compatibilidad

Cada cara posee printed stats y overrides separados. Cambiar de cara no copia overrides; volver a una cara recupera su override. Replay nuevo copia el efecto final persistido y no toca counters ni otra cara. Snapshot compacto y bootstrap roundtripan ambas estructuras.

Cuando una carta abandona battlefield por una ruta que históricamente restablece sus stats, replay limpia el override manual y restaura la base impresa/default de la cara inicial sin alterar counters de otras instancias.

Los eventos legacy `card.power_toughness.changed` conservan su semántica histórica. En lectura, un mutable `0` sobre fórmula/símbolo se interpreta conservadoramente como ausencia de override; un mutable distinto de una base numérica puede importarse como `imported_legacy`. Un override manual histórico real a cero sobre fórmula no puede distinguirse del antiguo centinela y no se inventa retroactivamente.

## Patch.v2, privacidad y GameLog

Las operaciones canónicas son `card.stats.override.set` y `card.stats.override.clear`, con `instanceId`, cara, override previo y override final. El reducer guarda por cara y no depende del orden con face change, counters, movement o materialization en la misma versión.

GameLog usa `gameLog.card.statsOverrideSet` y `gameLog.card.statsOverrideCleared`. En zonas privadas no incluye identidad, fórmula ni referencia pública de la carta para viewers no autorizados.

## Deuda explícita

Este contrato no implementa evaluación de `X`, `*`, devoción, cementerios, criaturas, subtipos, efectos continuos, capas ni copy layers completos. Esa lógica requiere una decisión de producto separada y no forma parte de Gameplay 1.0.
