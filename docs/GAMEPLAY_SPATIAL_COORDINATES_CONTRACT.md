# Gameplay Spatial Coordinates Contract

Estado: Sprint 3A. Contrato canónico para geometría básica del battlefield.

## Contrato canónico

Toda escritura nueva de posición usa exactamente `{ "x": number, "y": number, "unit": "ratio" }`. `x` e `y` son finitos e inclusivos en `[0,1]`. El anchor es **top-left** y se conserva respecto al contrato visual existente: cada eje ratio recorre el espacio disponible entre el content box del battlefield y el tamaño efectivo de la carta.

El tamaño de carta, viewport, `devicePixelRatio`, browser zoom, battlefield zoom, scroll, puntero y offsets DOM son geometría local. Nunca forman parte de command, event, snapshot, bootstrap ni Patch.v2.

Ejemplo válido: `{ "x": 0.42, "y": 0.68, "unit": "ratio" }`.

Ejemplos inválidos: `{ "x": 420, "y": 180 }`, `{ "x": 1.2, "y": 0.5, "unit": "ratio" }`, `{ "x": "0.4", "y": 0.5, "unit": "ratio" }`, `{ "x": 0.4, "y": 0.5, "unit": "px" }` y cualquier objeto con campos de viewport o zoom.

## Flujo

```text
pointer client coordinates
→ battlefield content-box coordinates (scroll incluido)
→ clamp de la carta renderizada
→ ratio lógico top-left
→ command.v2
→ prevalidación runtime
→ event canónico
→ card.position.set / cards.position.set
→ store same-version
→ transformación local de cada viewer
→ CSS left/top
```

`logicalRatioToRenderedPosition` multiplica el ratio por `battlefieldContentSize - effectiveCardSize`. `renderedPositionToLogicalRatio` elimina esa geometría local sin redondeo previo. Solo el wrapper de render redondea cuando necesita píxeles CSS enteros. Resize y cambios de zoom vuelven a renderizar; no reescriben el ratio compartido.

## Legacy pixels

Snapshots y eventos históricos `{x,y}` o `{x,y,unit:"px"}` se conservan literalmente. Los datos existentes no incluyen de forma general board width/height, layout version y card size de referencia, por lo que una conversión determinista no es posible. El fallback los representa como píxeles y puede limitarlos solo en la vista local. No persiste ese clamp ni inventa precisión. El primer movimiento posterior reemplaza esa posición por ratio canónico.

## Validación y autoridad

Single y batch verifican autorización, existencia, battlefield, controller actual, presencia y forma de position, finitud, unit, rango e IDs duplicados antes de mutar. Un batch válido produce una versión, un evento y una op `cards.position.set`. Un rechazo no cambia estado, versión, eventos ni patches. Los códigos espaciales son `INVALID_POSITION`, `POSITION_NOT_FINITE`, `POSITION_OUT_OF_RANGE` y `UNSUPPORTED_POSITION_UNIT`; los errores de autoridad conservan el contrato estructurado existente.

Un cambio de controller conserva la posición lógica. El nuevo controller puede mover la carta y el owner desplazado no. Al salir del battlefield se elimina la posición; si vuelve, recibe la posición inicial estable del comportamiento existente salvo que la misma acción incluya un ratio válido.

## Drag single y batch

Single mueve visualmente en local y envía una única escritura al soltar. El optimistic ratio se mantiene hasta ack; un rechazo elimina la capa optimistic y deja reaparecer el snapshot autoritativo, sin refetch ni resync.

Batch usa la selección existente. Calcula un delta lógico desde la carta arrastrada, limita ese delta una vez contra los extremos de todo el grupo y lo aplica a cada ratio. Así conserva distancias internas y no comprime varias cartas contra un borde. La lista mantiene el orden de selección y no acepta IDs duplicados.

## Persistencia, replay y Patch.v2

Los eventos `card.position.changed` y `cards.position.changed` guardan `effectVersion: 1`, actor, posición anterior y final y `clientActionId` en el envelope. Replay copia el valor final sin viewport, zoom, redondeo ni recalculado. La ruta específica de replay también conserva eventos pixel legacy. Compact snapshot y bootstrap hacen roundtrip literal de la posición.

Las ops canónicas son `card.position.set {playerId, zone, instanceId, position, effectVersion?}` y `cards.position.set {playerId, zone, positions, effectVersion?}`. Todos los viewers reciben los mismos ratios y versión. Sus píxeles CSS pueden diferir.

## QA automática

Las pruebas puras cubren content box, card sizes distintos, zoom local 70/100/140, independencia de device scale, límites, NaN local, roundtrip sin pérdida, clamp colectivo y ausencia de drift. Runtime cubre límites, strings, units, fuera de rango, NaN/Infinity, single, batch atómico, duplicados/autoridad existentes, retry, replay canónico y replay legacy. Los gates de navegador usan BrowserContext aislados y prohíben esperas arbitrarias.

## Matriz manual

Para battlefield básico, ejecutar cada viewport pequeño/medio/grande con browser zoom 80/100/125/150 y battlefield zoom 70/100/140. Repetir smoke de layout con 2, 3, 4, 5 y 6 jugadores. En cada celda registrar: owner/opponent, orden y distancia lógica, clipping, esquinas, drift tras resize y refresh. El ratio observado antes/después debe ser idéntico y no deben aparecer `game_patch`, `resync_required`, fallback, snapshot/bootstrap inesperado ni filtraciones privadas.

| Eje | Valores obligatorios | Evidencia | Resultado de este cierre |
| --- | --- | --- | --- |
| Browser zoom | 80%, 100%, 125%, 150% | gate headed/manual: posición/relación, clipping y esquinas | PASS real, 2026-07-14 |
| Battlefield zoom | 70%, 100%, 140% | ratios idénticos antes/después | PASS automático |
| Viewport | pequeño, medio, grande | resize sin drift | PASS automático |
| Jugadores | 2, 3, 4, 5, 6 | battlefield básico owner/opponents | PASS gates integrados |
| Continuidad | refresh, reconnect, actor restart | live = recovery y acción posterior válida | PASS automático |

Playwright y el navegador embebido entregan los atajos al contenido y no modifican de forma fiable el chrome del navegador. La fila de browser zoom se ejecuta por ello con el gate manual opt-in, nunca con estado compartido, CSS de producto ni emulación CDP: `$env:E2E_MANUAL_BROWSER_ZOOM='1'; npx playwright test --headed --debug --project=chromium --workers=1 e2e/game-product-spatial-cross-viewer-gate.spec.ts`. En cada pausa se selecciona el porcentaje indicado desde el menú nativo y se reanuda; el gate comprueba el cambio real de `devicePixelRatio`, las relaciones renderizadas y la invariancia exacta del snapshot.

## Real Browser Zoom QA

Ejecución final: 2026-07-14. Navegador: Google Chrome for Testing 147.0.7727.15 (Chromium), headed. Sistema: Microsoft Windows 11 Pro 64-bit, versión 10.0.26200, build 26200. El zoom se cambió mediante el menú nativo de Chrome y cada transición fue confirmada por el cambio normalizado de `window.devicePixelRatio`; no se usaron CSS transforms, `deviceScaleFactor`, cambios de viewport ni battlefield zoom para simular browser zoom.

Se usaron tres jugadores y tres `BrowserContext` aislados. A/controller: viewport 1440x900, browser zoom variable y battlefield zoom 70/100/140. B/viewer: viewport 800x700 y battlefield zoom 70. C/viewer: viewport 1920x1080 y battlefield zoom 140. En el bloque de continuidad A se redimensionó temporalmente a 1180x760 y volvió a 1440x900.

| Browser zoom real | BF 70 | BF 100 | BF 140 | Observación |
| --- | --- | --- | --- | --- |
| 80% | PASS | PASS | PASS | Geometría, esquinas, clickability, clipping y overflow correctos. |
| 100% | PASS | PASS | PASS | Retorno a 100% sin salto, reescritura ni drift. |
| 125% | PASS | PASS | PASS | Resize, refresh, reconnect, reapertura de viewer, controller y faceDown correctos. |
| 150% | PASS | PASS | PASS | Límites, refresh, replay tras restart y acción posterior correctos. |

En las doce combinaciones se conservaron ratios idénticos en A/B/C, la cuadrícula y sus separaciones lógicas, las cuatro esquinas visibles/clicables, y cero overflow o scrollbars causados por posiciones. Cambiar browser zoom, battlefield zoom o viewport emitió cero comandos de posición. Los CSS pixels y tamaños de carta variaron por viewer, como exige el contrato.

Drag single se ejecutó cuatro veces por browser zoom: centro, cerca de esquina, límite derecho y límite inferior. Drag batch se ejecutó en 80%, 125% y 150%, con clamp colectivo, distancias internas preservadas, una sola versión por batch y ratios idénticos en los tres viewers. En 80% y 125% se restauró el baseline mediante un batch ratio atómico antes del zoom siguiente para demostrar ausencia de acumulación; en 150% se mantuvo geometría desplazada durante refresh y actor restart. El rechazo de un batch con carta ajena produjo `MIXED_AUTHORITY_BATCH` sin mutación parcial.

Todos los `card.position.changed` y `cards.position.changed` observados usaron números finitos en `[0,1]` y `unit:"ratio"`. No aparecieron px nuevos, strings numéricos, zoom, viewport, dimensiones de carta, offsets DOM ni `devicePixelRatio`. Patch.v2, snapshot y bootstrap normalizado conservaron ratios, controller y faceDown; `{0,0}` continuó siendo válido. No aparecieron `game_patch`, `resync_required` ni bootstrap de recuperación inesperado.

Bugs espaciales encontrados y corregidos durante la QA:

- El batch recalculaba distancias desde CSS redondeado y podía introducir drift aproximado de `0.000111524`; ahora usa el ratio canónico para cartas ratio y tiene regresión focalizada.
- El control de battlefield zoom desaparecía en el layout compacto observado con browser zoom 125%; ahora permanece disponible sin añadir breakpoints.
- El layout compacto forzaba battlefield zoom 70 aunque el estado local fuese 100/140; ahora respeta el zoom local seleccionado y no lo persiste en estado compartido.
- Una carta con controller transferido medía el DOM del controller en vez del battlefield del owner, aplicando un tamaño fallback incorrecto; ahora la proyección local localiza la carta por owner y tiene regresión focalizada.
- El replay PHP no aplicaba las nuevas operaciones semánticas `card.position.set` y `cards.position.set`, por lo que un GET reconstruido podía volver de `.50/.50` a una posición anterior `.32/.18`; ahora ambas operaciones se reproducen literalmente y quedan cubiertas por regresión unitaria single/batch y por el test de integración de snapshot recargado.

Los demás fallos intermedios fueron de aislamiento del fixture (attachments/land stacks involuntarios por soltar cartas deliberadamente superpuestas, ventanas headed huérfanas y traversal incorrecto del bootstrap normalizado) y se corrigieron en el gate, sin cambiar contrato ni arquitectura de producto.

Limitaciones conocidas: esta sección certifica la mesa manual básica y el contrato espacial de Sprint 3A. Attachments, stacks, selection area, responsive completo, counters, mana helper y grouped tokens permanecen fuera de alcance. Las screenshots headed fueron evidencia temporal del reporte de QA y no se conservan en el worktree.

## Interaccion con relaciones de battlefield (Sprint 3B)

Mientras una carta pertenece a un attachment o battlefield stack, el target/root conserva la ratio top-left canonica del grupo y los children usan geometria local derivada; no se persisten posiciones child redundantes. Detach/member removal materializa una ratio final mediante `card.position.set`, y dissolve materializa el batch final mediante `cards.position.set`. El grafo, autoridad y lifecycle se definen en `GAMEPLAY_BATTLEFIELD_RELATIONS_CONTRACT.md` sin modificar el contrato ratio de Sprint 3A.

## Deuda fuera de Sprint 3A

Attachments cross-viewer, stacks de tierras, marquee/select area, responsive completo, mana helper, counters responsive, grouped tokens, animaciones y cosméticos se validan en bloques posteriores. No se añaden breakpoints en Sprint 3A.
