# Auditoría de rendimiento de comandos de gameplay

Fecha: 2026-08-26. Alcance: frontend de la mesa y protocolo WebSocket V2. No cubre animaciones ni `card-arrival`.

## Resultado y criterio

Los 47 comandos públicos usan WebSocket. No existe fallback HTTP automático para comandos V2: HTTP queda para bootstrap, resync explícito, recuperación de errores, Mercure legacy, mulligan y recuperación de drag. Por ello el cambio de mayor retorno está en la proyección del estado y en las actualizaciones optimistas locales, no en el transporte ni en backend.

Abreviaturas de la tabla:

- `P`: patch V2 semántico normalizado.
- `L`: mutación visible local antes del patch (`quirúrgica` desde esta auditoría).
- `R`: superficie de render principal.
- `C`: coalescing/dedupe actual.
- `B`: batch disponible o candidato seguro.
- `S`: recuperación: `WS` = reintento/ack WebSocket; `RS` = resync HTTP coalescido; `M` = ruta especializada.

| Comando | P emitido | L / R | C | B | S |
|---|---|---|---|---|---|
| `game.concede` | `game.status.set` | sin optimismo / estado mesa | dedupe de ciclo | no | WS + RS |
| `chat.message` | stream `chat.message.add` | sin snapshot / chat | idempotencia por id | append de stream | M |
| `chat.reaction.toggled` | stream `chat.reaction.set` | sin snapshot / reacción | idempotencia por mensaje | no | M |
| `dice.rolled` | `dice.result` | sin optimismo / resultado | no | no | WS + RS |
| `life.changed` | `player.life.set` | L jugador / contador de vida | debounce 450 ms + coalesce + dedupe in-flight | por jugador | WS + RS |
| `commander.damage.changed` | `player.commanderDamage.set` | L jugador / damage | debounce 450 ms + coalesce + dedupe | por víctima/comandante | WS + RS |
| `counter.changed` | `player.counters.set` o `game.counters.set` | L jugador/contador compartido | debounce 450 ms + coalesce + dedupe | por scope/clave | WS + RS |
| `card.counter.changed` | `card.counters.patch` | L carta / marcadores y P/T | debounce 450 ms + dedupe in-flight | candidato por carta, no contrato batch | WS + RS |
| `card.power_toughness.changed` | `card.field.set` (stats) | L carta / P/T | no | candidato multi-stat ya atómico | WS + RS |
| `card.moved` | `zone.cards.move` + counts | L para hand→battlefield / zonas | reintento seguro | usar `cards.moved` si selección | WS + RS |
| `cards.moved` | `zone.cards.batchMove` | L para hand→battlefield / zonas | reintento seguro | nativo | WS + RS |
| `card.tapped` | `card.field.set` | patch remoto / carta | reintento seguro | `battlefield.untap_all` si aplica | WS + RS |
| `card.position.changed` | `card.field.set` (posición) | L carta / battlefield | coalesce + dedupe; baja prioridad de cola | `cards.position.changed` | WS + RS |
| `card.dungeon_marker.changed` | `card.field.set` (marker) | patch remoto / carta | reintento seguro | no | WS + RS |
| `cards.position.changed` | N × `card.field.set` | L por lote / battlefield | coalesce + dedupe; baja prioridad | nativo | WS + RS |
| `card.face_down.changed` | `card.field.set` (visibilidad) | patch remoto / carta | reintento seguro | no | WS + RS |
| `card.face_down.inspected` | patch privado de identidad/visibilidad | sin proyección pública extra | no | no | WS + RS |
| `card.face.changed` | `card.field.set` (cara activa) | patch remoto / carta | reintento seguro | no | WS + RS |
| `card.revealed` | `card.field.set` + static card privado | patch remoto / carta/zona | reintento seguro | no | WS + RS |
| `card.token.created` | `zone.cards.add` | patch remoto / zona | reintento seguro | candidato múltiple tokens | WS + RS |
| `card.token_copy.created` | `zone.cards.add` | patch remoto / zona | reintento seguro | candidato múltiple tokens | WS + RS |
| `card.controller.changed` | `card.field.set` | patch remoto / carta | reintento seguro | no | WS + RS |
| `turn.changed` | `turn.set` | patch remoto / controles de turno | dedupe de cola ante concede | no | WS + RS |
| `battlefield.untap_all` | múltiples `card.field.set` | patch remoto / battlefield | reintento seguro | comando batch nativo | WS + RS |
| `zone.changed` | `zone.reordered` | patch remoto / una zona | adaptador a ids | nativo por orden | WS + RS |
| `zone.move_all` | `zone.cards.batchMove` | patch remoto / dos zonas | reintento seguro | comando batch nativo | WS + RS |
| `zone.random_card.selected` | `zone.random_card.selected` + movimiento | patch remoto / zonas | reintento seguro | no | WS + RS |
| `library.draw` | `zone.cards.move` + counts | patch remoto / library, hand | reintento seguro | usar `library.draw_many` | WS + RS |
| `library.draw_many` | `zone.cards.batchMove` + counts | patch remoto / library, hand | reintento seguro | nativo | WS + RS |
| `library.shuffle` | `library.shuffled` + counts | patch remoto / library | reintento seguro | nativo | WS + RS |
| `library.move_top` | `library.top.moved` + movimiento | patch remoto / library/zona | reintento seguro | no | WS + RS |
| `library.play_top_face_down` | movimiento + `card.field.set` | patch remoto / library, battlefield | reintento seguro | no | WS + RS |
| `library.reveal_top` | markers/audiencia/top visible | patch remoto / library | reintento seguro | no | WS + RS |
| `library.reveal` | `library.revealed.set` | patch remoto / modal library | reintento seguro | no | WS + RS |
| `library.view` | `library.top.viewed` o visibilidad | patch remoto / modal library | reintento seguro | no | WS + RS |
| `library.play_top_revealed` | `library.play_top_revealed.set` | patch remoto / library | reintento seguro | no | WS + RS |
| `library.reorder_top` | `library.top.reordered` | patch remoto / library | reintento seguro | orden en un mensaje | WS + RS |
| `stack.card_added` | `stack.add` | patch remoto / stack | reintento seguro | no | WS + RS |
| `stack.item_removed` | `stack.remove` | patch remoto / stack | reintento seguro | no | WS + RS |
| `arrow.created` | `relation.add` | patch remoto / relaciones | reintento seguro | candidato múltiple relaciones | WS + RS |
| `arrow.removed` | `relation.remove` | patch remoto / relaciones | reintento seguro | candidato múltiple relaciones | WS + RS |
| `attachment.created` | `relation.add` | patch remoto / relaciones | reintento seguro | candidato múltiple relaciones | WS + RS |
| `attachment.removed` | `relation.remove` | patch remoto / relaciones | reintento seguro | candidato múltiple relaciones | WS + RS |
| `helper.created` | `helper.add` | patch remoto / helpers | reintento seguro | candidato múltiple helpers | WS + RS |
| `helper.updated` | `helper.update` | patch remoto / helper | reintento seguro | no | WS + RS |
| `helper.removed` | `helper.remove` | patch remoto / helper | reintento seguro | candidato múltiple helpers | WS + RS |
| `disconnect.vote` | servicio dedicado + `disconnect.vote.set` | sin mutación gameplay / modal | reglas del voto | no | M |

## Cuellos de botella reales, priorizados

1. Proyección completa por `patch.v2` (alto impacto). `hydrateGameSnapshotFromV2State` reconstruía todos los `GamePlayerState`, arrays de seis zonas y cada `GameCardInstance` incluso para `player.life.set`. Eso cambiaba inputs de componentes OnPush no afectados. Se sustituye por `GameTableSnapshotProjector`: conserva jugadores, zonas, cartas, relaciones, stack, chat y log cuando sus fuentes normalizadas siguen iguales. Para un patch escalar de jugador no se recorren las zonas.

2. `structuredClone(snapshot)` en interacciones escalares (alto impacto). Se encontraba en vida, daño de comandante, contadores compartidos, contadores de carta, P/T, defensa, saga, lealtad, posición optimista, clamp de viewport y movimiento hand→battlefield. El tamaño del clone era O(mesa completa) para una carta. Se sustituye por actualizaciones inmutables por rama con `updateGameSnapshotPlayer` y `updateGameSnapshotCards`.

3. Trabajo repetido del coordinador en cada publicación (alto impacto durante drag/valores). `GameTableSnapshotCoordinatorState` aplica viewport, posiciones, valores y contadores optimistas para cada snapshot. Las nuevas operaciones son idempotentes y retornan la misma referencia cuando ya contienen el valor optimista, evitando una segunda publicación y evitando invalidar inputs ajenos.

4. Drag multi-carta (alto impacto puntual). El movimiento optimista hand→battlefield clonaba toda la mesa. Ahora copia solo los jugadores origen/destino, sus zonas afectadas, los contadores de zona afectados y las cartas trasladadas. Las posiciones siguen coalescidas mediante `cards.position.changed`.

5. Resync (observabilidad y coste alto, frecuencia ya limitada). `GameTableWebsocketGameplayService` ya coalesce resync activo/en cola, limita firmas repetidas durante 3 s y publica `gameplay.refetch.*`, `gameplay.patch_v2.apply.*`, profundidad de cola y coalescing de drag. No se añadió un fallback HTTP nuevo.

## Comparativa verificable

| Ruta | Antes | Después |
|---|---|---|
| `player.life.set`, daño, contador | clone y publicación de mesa completa | copia de raíz + jugador/scope afectado; no-op conserva referencia |
| Contador/P-T/defensa/saga/lealtad | clone de mesa completa | copia de raíz + jugador + zona + carta afectada |
| Posición simple o lote | clone de mesa completa | una copia por jugador/zona afectada; el lote comparte copia |
| hand→battlefield | clone de mesa completa | origen/destino y sus dos zonas; resto estable |
| Patch V2 escalar | rehidratación y nuevos objetos para todas las cartas | root nuevo por versión; referencias estables para ramas no afectadas |
| `PlayerView[]` | wrapper nuevo para todos los jugadores | wrapper estable para cada jugador no afectado y array estable si no cambia ninguno |

Las pruebas de referencia verifican la propiedad clave: un patch de vida mantiene el `GamePlayerState`, zonas y cartas del oponente; un patch de carta crea únicamente la zona y carta objetivo. Las métricas existentes de cola/resync permiten contrastar en una mesa real que no aumentan `resyncTotal`, `refetchCount` ni los mensajes por drag.

## Límites deliberados

- No se cambia contrato WebSocket ni OpenAPI y no se toca backend: no existe necesidad técnica para ello.
- No se introduce un batch nuevo sin una evidencia de ráfaga que no quede cubierta por los comandos batch existentes.
- Se conserva HTTP resync como recuperación segura, excepcional y coalescida.
- No se modifica animación ni `card-arrival`.
