# CommanderZone — Game Table UI v2 Final Implementation Plan

## Objetivo

Implementar la maqueta aprobada de la mesa de juego en la rama `feature/game-table`.

Esta fase es **visual y de composición**:

- reordenar el HTML de `game-table`;
- pulir el SCSS;
- mantener la lógica existente;
- mantener E2E verdes;
- no tocar backend;
- no rehacer servicios ni helpers.

La maqueta aprobada es esta estructura:

```text
┌──────────────────────────────────────────────────────────────┐
│ Player summary                              |  Turn panel    │
├──────────────┬──────────────────────────────┬────────────────┤
│ Opponents    │                              │ Game Log       │
│ mini boards  ├──────────────────────────────┤                │
│              │ Focused player battlefield   │                │
│              │                              │                │
│              ├──────────────────────┬───────┴────────────────┤
│              │ Hand                 │ Library / GY / Exile   │
└──────────────┴──────────────────────┴────────────────────────┘
```

---

## Estado real de la rama

En `feature/game-table`, el directorio público `frontend/src/app/features/game/game-table` contiene:

- `services/`
- `state/`
- `game-table.component.html`
- `game-table.component.scss`
- `game-table.component.spec.ts`
- `game-table.component.ts`
- `game-table.store.ts`

En GitHub se ven servicios ya extraídos:

- `game-table-command.service.ts`
- `game-table-drag.service.ts`
- `game-table-realtime.service.ts`
- `game-table-selection.service.ts`

Y estado separado:

- `game-table-chat-log.state.ts`
- `game-table-ui.state.ts`
- `game-table-zone-modal.state.ts`

Esto significa que **no hay que rehacer arquitectura de lógica**. La tarea principal es ordenar el template y el SCSS.

La rama ya tiene muchos E2E en `frontend/e2e`, incluyendo full gauntlet, drag/drop, draw library, room public/private, deck import y tests de robustez. Por tanto, cada cambio visual debe proteger esos tests.

---

## Regla principal para Codex

Codex debe actuar como frontend/UI implementer, no como arquitecto de backend.

No debe:

- crear un nuevo sistema de game table;
- crear otro store;
- crear otro drag service;
- tocar backend;
- tocar APIs;
- romper E2E;
- duplicar componentes;
- eliminar lógica funcional;
- eliminar data-testid;
- reintroducir commander damage;
- meter topbar con muchos botones;
- duplicar game log;
- meter Library / Graveyard / Exile dentro del contenedor de Game Log.

---

## Prompt maestro para Codex

```text
Lee COMMANDERZONE_GAME_TABLE_UI_V2_FINAL_PLAN.md completo.

Ejecuta únicamente el primer paso pendiente del checklist.
No saltes pasos.
No hagas cambios fuera del alcance.

Antes de modificar archivos, dime:
1. paso detectado;
2. objetivo;
3. ficheros que tocarás;
4. si puedes resolverlo solo con HTML/SCSS;
5. comandos que ejecutarás;
6. riesgos;
7. criterio de aceptación.

Después implementa solo ese paso.
Ejecuta los comandos de verificación indicados.
Si un comando falla, detente y explica el fallo.
Actualiza este MD marcando el paso completado y añade una entrada en el registro de progreso.
No avances al siguiente paso.
```

---

## Reglas visuales obligatorias

### Topbar

Debe contener:

- logo `COMMANDERZONE`;
- game id / nombre de partida / estado breve si ya existe;
- **solo un botón Settings** arriba a la derecha.

No debe mostrar en topbar:

- Leave Table;
- Decks;
- Tools;
- fullscreen;
- botones extra.

Si esas acciones siguen siendo necesarias, deben quedar en Settings/context menu, no arriba.

---

### Left column: opponents mini boards

La columna izquierda muestra rivales, no el jugador enfocado.

Cada rival debe mostrar:

- avatar o placeholder;
- nombre;
- subtítulo si existe;
- vida;
- mini battlefield;
- `Library`;
- `Graveyard`;
- `Exile`.

No mostrar:

- commander damage;
- chat;
- botones de acción.

Mini battlefield:

- usar `battlefield.slice(0, N)`;
- si hay muchas cartas, compactar;
- mantener cartas pequeñas con visual de battlefield;
- si no hay permanents, mostrar estado vacío elegante.

---

### Main top: Player summary + Turn panel

Deben estar en la misma fila superior central, pero como **dos paneles distintos**.

#### Player summary

Muestra:

- avatar;
- nombre;
- subtítulo;
- vida;
- color identity/mana icons si existen.

No muestra:

- commander damage;
- acciones de turno;
- botón End Step.

#### Turn panel

Muestra:

- `Turn N`;
- `Your Turn` o nombre del jugador activo;
- fases;
- fase actual;
- botón principal `End Step`.

El `Turn panel` no debe estar dentro del div visual del jugador. Debe ser un sibling dentro de la fila superior.

---

### Center: focused battlefield

El centro muestra solo el battlefield del jugador enfocado.

Debe conservar:

- drag/drop;
- context menu;
- tap/untap;
- counters;
- face down;
- hover preview;
- selección;
- `data-testid="main-battlefield"`;
- `data-testid="game-card"`;
- `data-card-instance-id`;
- `data-zone="battlefield"`.

No debe mezclar battlefields de rivales en el centro.

---

### Bottom: hand + independent zone piles

La parte inferior se divide en:

```text
Hand                                      Library / Graveyard / Exile
```

La mano debe ocupar el espacio izquierdo/central.

Library / Graveyard / Exile deben:

- tener panel propio;
- no pertenecer al Game Log;
- no estar dentro del div derecho del Game Log;
- aprovechar el espacio libre que deja la mano;
- tener tres cajas iguales;
- mismo ancho;
- misma altura;
- mismo gap;
- label arriba;
- icon/card stack en el centro;
- count abajo;
- hover/click claro;
- mantener acciones existentes: abrir library, graveyard, exile, context menu, modal.

---

### Right: Game Log

El lateral derecho debe contener **solo Game Log**.

Debe:

- sustituir cualquier tab/panel de `Players`;
- no duplicarse;
- ser scrollable;
- tener altura controlada;
- ser legible;
- usar colores por jugador si ya existen;
- mantener `data-testid="game-log"` y `data-testid="game-log-entry"` si existen o añadirlos si faltan.

No meter:

- Library / Graveyard / Exile;
- Chat visible;
- Players tab;
- commander damage.

Chat no debe eliminarse del modelo. Si existe E2E de chat, conservar una forma de abrirlo mediante Settings/floating panel o actualizar el test de manera explícita. No borrar funcionalidad de chat sin confirmación.

---

## Grid CSS objetivo

Usar esta estructura conceptual:

```scss
.game-table-v2 {
  min-height: 100dvh;
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr) 320px;
  grid-template-rows: 56px 112px minmax(0, 1fr) 180px;
  grid-template-areas:
    "topbar topbar topbar"
    "opponents mainTop gameLog"
    "opponents battlefield gameLog"
    "opponents hand zones";
  gap: 12px;
  padding: 12px;
  overflow: hidden;
}
```

Áreas:

```scss
.game-table-topbar { grid-area: topbar; }
.game-table-opponents { grid-area: opponents; }
.game-table-main-top { grid-area: mainTop; }
.game-table-battlefield { grid-area: battlefield; }
.game-table-hand { grid-area: hand; }
.game-table-zones { grid-area: zones; }
.game-table-game-log { grid-area: gameLog; }
```

Este grid permite que:

- Game Log quede independiente a la derecha;
- Library/GY/Exile queden en un panel propio inferior derecho;
- la mano use el espacio inferior central;
- los rivales sigan en lateral izquierdo;
- el centro se dedique al battlefield enfocado.

---

## Breakpoints mínimos

### Desktop grande: `>= 1600px`

- columnas: `320px 1fr 320px`;
- mano visible con 6–8 cartas;
- zonas grandes y simétricas.

### Desktop medio: `1366px–1599px`

- columnas: `290px 1fr 300px`;
- cartas algo más pequeñas;
- mini battlefields compactos;
- Game Log scrollable.

### Pantallas pequeñas desktop: `< 1366px`

No hace falta mobile real en esta fase, pero sí evitar desastre:

- reducir left column a `260px`;
- right column a `280px`;
- battlefield con scroll interno si hace falta;
- hand con scroll horizontal;
- zone piles compactos;
- cero horizontal scroll de página.

---

## Checklist principal

- [x] 1. Auditar HTML/SCSS/componentes reales en local.
- [x] 2. Crear snapshot visual de estado actual antes de tocar.
- [x] 3. Renombrar/ordenar clases raíz del template para el grid v2.
- [x] 4. Implementar grid principal exacto.
- [x] 5. Pulir topbar con solo Settings.
- [x] 6. Separar Player Summary y Turn Panel como paneles hermanos.
- [x] 7. Pulir left opponents mini boards.
- [x] 8. Pulir focused battlefield.
- [x] 9. Pulir hand area.
- [x] 10. Crear/pulir independent Zone Piles panel.
- [x] 11. Pulir Game Log lateral derecho.
- [x] 12. Ocultar commander damage en toda la UI principal.
- [x] 13. Preservar Settings/context actions para acciones eliminadas de topbar.
- [x] 14. Verificar context menu, drag/drop, hover preview y zone modal.
- [x] 15. Ajustar responsive desktop.
- [x] 16. Actualizar E2E solo si selectores cambiaron.
- [x] 17. Ejecutar QA visual headed con Playwright.
- [x] 18. Fix loop visual: corregir bugs encontrados.
- [x] 19. Auditoría final del diff.

---

# Pasos detallados

## Paso 1 — Auditar estado local

```text
Audita la implementación actual de la UI de game-table.

No modifiques archivos.

Revisa:
1. frontend/src/app/features/game/game-table/game-table.component.html
2. frontend/src/app/features/game/game-table/game-table.component.scss
3. frontend/src/app/features/game/game-table/game-table.component.ts
4. frontend/src/app/features/game/game-table/game-table.store.ts
5. frontend/src/app/features/game/game-table/services
6. frontend/src/app/features/game/game-table/state
7. frontend/e2e tests que usan data-testid de mesa

Devuelve:
- estructura DOM actual;
- clases principales actuales;
- data-testid actuales;
- qué partes del layout ya coinciden con el mockup;
- qué partes se pueden arreglar solo con SCSS;
- qué partes requieren mover HTML;
- riesgos de romper E2E;
- plan de cambios para el paso 2.
```

Criterio de aceptación:

- No hay cambios de código.
- Codex identifica correctamente que ya existen `services` y `state`.
- Codex no propone tocar backend.

---

## Paso 2 — Snapshot visual antes de tocar

```text
Crea una captura visual del estado actual.

Usa Playwright headed o screenshot si el entorno lo permite.

Objetivo:
Tener referencia visual antes del cambio.

No modifiques código.

Comandos sugeridos:
cd frontend
npm run build
npx playwright test e2e/game-robustness.multiplayer.spec.ts --headed --trace on --video on

Si no se puede capturar:
- explica por qué;
- no avances sin reportarlo.
```

Criterio:

- Build OK.
- Hay screenshot/trace/video o explicación clara.
- No cambios funcionales.

---

## Paso 3 — Preparar clases raíz para grid v2

```text
Reordena el HTML principal para exponer las áreas del layout v2.

Áreas obligatorias:
- game-table-v2
- game-table-topbar
- game-table-opponents
- game-table-main-top
- player-summary-panel
- turn-phase-panel
- game-table-battlefield
- game-table-hand
- game-table-zones
- game-table-game-log

Restricciones:
- No cambies lógica.
- No cambies backend.
- No borres context menu.
- No borres zone modal.
- No borres hover preview.
- No rompas data-testid.
- No hagas todavía grandes cambios visuales.
- Ejecuta npm run build.
```

Criterio:

- Build pasa.
- El DOM tiene áreas claras.
- El diff es principalmente HTML/clases.

---

## Paso 4 — Grid principal exacto

```text
Implementa el SCSS del grid principal según el layout ASCII.

Usa:
- grid-template-columns;
- grid-template-rows;
- grid-template-areas;
- overflow controlado;
- min-width: 0 en áreas internas;
- min-height: 0 en áreas scrollables.

Debe cumplir:
- left opponents fijo;
- center fluid;
- right game log fijo;
- zones abajo a la derecha, fuera de game log;
- hand abajo centro;
- no horizontal scroll.

Ejecuta:
npm run build
```

Criterio:

- Visualmente ya se ve la estructura general.
- No hay overflow horizontal en desktop.
- Game Log y Zone Piles son paneles distintos.

---

## Paso 5 — Topbar final

```text
Pulir topbar.

Debe mostrar:
- logo CommanderZone;
- game id / friendly match / sync status si ya existe;
- solo botón Settings.

Eliminar visualmente:
- Leave Table;
- Decks;
- Tools;
- fullscreen;
- botones extra.

No eliminar acciones:
- si siguen existiendo, moverlas al menú Settings/context menu o dejarlas en contexto actual.

Ejecutar build.
```

Criterio:

- Solo Settings arriba a la derecha.
- No se pierde Leave/Concede funcional si estaba en context menu.

---

## Paso 6 — Player Summary + Turn Panel separados

```text
Pulir fila superior central.

Debe contener dos paneles hermanos:

1. Player Summary:
   - avatar;
   - displayName;
   - title/subtitle;
   - life;
   - color identity icons si existen.

2. Turn Phase:
   - Turn N;
   - active player / Your Turn;
   - phase tracker;
   - End Step.

Restricciones:
- TurnPhasePanel no debe estar dentro del div visual de PlayerSummary.
- No mostrar commander damage.
- Mantener acciones de cambio de fase/turno existentes.
- Ejecutar build.
```

Criterio:

- Paneles claramente separados.
- Turn panel en su propia caja.
- End Step sigue funcionando.

---

## Paso 7 — Left opponents mini boards

```text
Pulir lateral izquierdo de rivales.

Debe mostrar solo jugadores que no sean focused player.

Cada panel:
- avatar;
- nombre;
- vida;
- mini battlefield;
- counts Library/GY/Exile.

No mostrar:
- commander damage;
- acciones de jugador;
- hand real de rivales.

Mini battlefield:
- usar battlefield.slice(0, 14) o el límite actual;
- usar posiciones compactas;
- si hay muchas cartas, agrupar/compactar visualmente;
- si no hay permanents, estado vacío.

Mantener:
- data-testid si existe;
- data-player-id.

Ejecuta build y E2E si afecta selectores.
```

Criterio:

- Los rivales se ven como mini-tableros.
- No ocupan demasiado.
- No rompen en 4 jugadores.

---

## Paso 8 — Focused battlefield

```text
Pulir el battlefield central.

Debe:
- mostrar solo cartas de battlefield del jugador enfocado;
- tener fondo oscuro tipo mesa/arena;
- organizar lands/permanents de manera legible usando el layout actual;
- mantener drag/drop;
- mantener tap/untap;
- mantener context menu;
- mantener hover preview;
- mantener counters/stat overlays.

No implementar nuevas reglas.
No cambiar GameTableDragService salvo bug real.

Ejecutar:
npm run build
npm run e2e si toca drag/drop.
```

Criterio:

- Centro limpio.
- Cartas legibles.
- Drag/drop sigue verde.

---

## Paso 9 — Hand area

```text
Pulir mano inferior.

Debe:
- ocupar el área inferior central;
- dejar espacio visual a Zone Piles;
- tener scroll horizontal si hay muchas cartas;
- no crecer en altura sin control;
- mostrar cartas legibles;
- mantener interacción actual:
  - doble click si existe;
  - context menu;
  - drag/drop desde mano si existe.

Mantener:
- data-testid="hand-zone"
- data-testid="game-card"
- data-zone="hand"

Ejecuta build.
```

Criterio:

- Mano no invade zonas.
- Zona inferior queda limpia.

---

## Paso 10 — Zone Piles independientes

```text
Pulir Library / Graveyard / Exile como panel independiente.

Ubicación:
- grid-area: zones;
- bottom-right;
- fuera de Game Log;
- al lado de Hand.

Debe:
- tener tres cajas iguales;
- mismo ancho;
- misma altura;
- mismo gap;
- label arriba;
- icon/card stack centro;
- count abajo;
- hover state;
- click/context menu operativo.

Zonas:
- Library
- Graveyard
- Exile

Mantener:
- data-testid="zone-piles"
- data-testid="zone-pile"
- data-zone
- data-player-id

Ejecutar:
npm run build
npm run e2e si hay tests de zonas.
```

Criterio:

- Panel independiente.
- Tres pilas simétricas.
- Click abre modal/acciones como antes.

---

## Paso 11 — Game Log derecho

```text
Pulir Game Log lateral.

Debe:
- ser único;
- estar en grid-area: gameLog;
- tener scroll interno;
- no contener zonas;
- no contener Players tab;
- no contener Chat tab visible;
- no duplicarse en floating panel visible por defecto.

Mantener:
- data-testid="game-log";
- data-testid="game-log-entry" si existe.

Si Chat E2E falla:
- conservar chat como floating/drawer accesible desde Settings;
- actualizar el test para abrirlo de forma estable;
- no borrar chat backend/modelo.

Ejecutar build y E2E si toca tests.
```

Criterio:

- Game Log único.
- No hay duplicados.
- Scroll interno.

---

## Paso 12 — Ocultar commander damage

```text
Oculta commander damage de la UI principal.

Ocultar en:
- player summary;
- opponent mini panels;
- header;
- visible controls.

Revisar también:
- context menu de player;
- botones visibles.

No eliminar:
- modelo;
- backend;
- comandos;
- tests de backend si existen.

Si hay E2E que dependen de commander damage visible, actualizar o marcar como no aplicable para esta versión visual.

Ejecutar build/tests.
```

Criterio:

- No se ve commander damage.
- No se pierde lógica de dominio innecesariamente.

---

## Paso 13 — Settings como puerta de acciones secundarias

```text
Asegura que Settings o el context menu dejan accesibles acciones secundarias eliminadas de topbar.

Acciones:
- Leave table;
- Concede;
- Refresh snapshot;
- Open chat si se mantiene;
- View game id/copy;
- Settings reales si existen.

No hace falta diseñar un modal final.
Puede reutilizar context menu actual.

Ejecutar build.
```

Criterio:

- Topbar limpia.
- Acciones críticas no desaparecen.

---

## Paso 14 — Verificar interacciones

```text
Ejecuta verificación funcional.

Comandos:
cd frontend
npm run build
npm test
npm run e2e

Verificar que siguen funcionando:
1. draw;
2. draw 7;
3. shuffle;
4. move hand -> battlefield;
5. drag/drop;
6. move to graveyard;
7. move to exile;
8. open library;
9. open graveyard;
10. open exile;
11. context menu;
12. zone modal;
13. game log;
14. reconnect/refetch si hay test.
```

Criterio:

- Build OK.
- Unit tests OK.
- E2E OK o fallos clasificados.

---

## Paso 15 — Responsive desktop

```text
Ajusta responsive desktop.

Objetivo:
Funcionar bien en:
- 1920x1080;
- 1680x950;
- 1440x900;
- 1366x768.

No hace falta mobile todavía.

Reglas:
- no horizontal scroll;
- left panels legibles;
- game log no tapa mesa;
- hand scroll horizontal;
- zone piles no se aplastan;
- End Step visible;
- battlefield usable.

Añadir media queries solo si hace falta.

Ejecutar build.
```

Criterio:

- Desktop robusto.
- Nada se sale de pantalla.

---

## Paso 16 — QA visual headed

```text
Ejecuta QA visual con Playwright headed.

Comandos:
cd frontend
npm run build
npm test
npm run e2e
npx playwright test e2e/full-game-browser-gauntlet.spec.ts --headed --trace on --video on
npx playwright test e2e/game-robustness.multiplayer.spec.ts --headed --trace on --video on

Revisar visualmente:
1. layout coincide con ASCII;
2. topbar solo Settings;
3. Player summary y Turn panel separados;
4. Game Log único;
5. Library/GY/Exile independientes;
6. tres zone piles iguales;
7. no commander damage;
8. center solo focused battlefield;
9. left mini boards claros;
10. hand no invade zonas;
11. no overflow horizontal;
12. drag/drop funciona.
```

Criterio:

- Gauntlet visual no revela bugs graves.
- Si falla, reportar trace/video.

---

## Paso 17 — Fix loop visual

```text
Corrige errores visuales encontrados.

Reglas:
1. Un bug por iteración.
2. No refactorizar de paso.
3. No tocar backend.
4. Reejecutar test afectado.
5. Registrar fallo, causa y fix.

Tipos de bugs:
- overflow;
- solapamiento;
- cards demasiado pequeñas;
- zone piles mal alineadas;
- game log duplicado;
- settings/topbar incorrecto;
- left mini boards demasiado altos;
- drag/drop roto.
```

Criterio:

- Bug corregido.
- Test afectado verde.
- Registro actualizado.

---

## Paso 18 — Auditoría final del diff

```text
Audita el diff final.

No modifiques código salvo correcciones menores aprobadas.

Devuelve:
1. ficheros modificados;
2. cambios visuales implementados;
3. cambios funcionales, si hay alguno;
4. data-testid modificados;
5. E2E ejecutados;
6. riesgos;
7. bugs visuales pendientes;
8. si está listo para revisar manualmente.
```

Criterio:

- Resumen claro.
- Sin cambios inesperados.
- Listo para revisión humana.

---

## Registro de progreso

Codex debe añadir aquí una entrada tras cada paso.

## 2026-05-05 - Paso 1

Estado: completado.
Cambios: auditoria local de `game-table.component.html`, `game-table.component.scss`, `game-table.component.ts`, `game-table.store.ts`, `services/`, `state/`, tests E2E relacionados con mesa y referencia visual `docs/game-board.png`. No se modifico codigo de aplicacion.
Comandos: lectura completa de `docs/COMMANDERZONE_GAME_TABLE_UI_V2_FINAL_PLAN.md`; apertura de `docs/game-board.png`; lecturas de ficheros de `frontend/src/app/features/game/game-table`; listado de `services/` y `state/`; busqueda de `data-testid` y clases usadas por E2E.
Resultado: la UI actual usa `game-screen > table-surface`, `game-hud`, `focused-board`, `bottom-play-area`, `zone-dock`, `hand-row`, `player-sidebar` y `floating-panel`; existen `services` y `state` extraidos; la referencia visual confirma topbar limpia, rivales a la izquierda, player summary y turn panel separados, battlefield central, game log derecho y zone piles independientes abajo a la derecha.
Riesgos: muchos E2E dependen de clases visuales (`.focused-board`, `.player-sidebar`, `.floating-panel`, `.floating-handle`, `.chat-form`, `.panel-feed`, `.zone-modal`) ademas de `data-testid`; los pasos siguientes deben preservar compatibilidad o actualizar tests de forma explicita.
Siguiente: Paso 2, crear snapshot visual del estado actual antes de tocar HTML/SCSS.

## 2026-05-05 - Paso 2

Estado: completado.
Cambios: no se modifico codigo de aplicacion. Se genero una referencia visual reproducible del estado actual mediante Playwright headed con trace.
Comandos: `npm run build`; `npx playwright test e2e/game-robustness.multiplayer.spec.ts --headed --trace on`; `Get-ChildItem -Path test-results -Recurse -File`.
Resultado: build OK con warnings de budget existentes; el comando sugerido original con `--video on` no es compatible con esta version de Playwright, asi que se sustituyo por `--trace on`; E2E OK, 1 passed; artefacto generado en `frontend/test-results/game-robustness.multiplaye-4455b-break-UI-or-duplicate-cards-chromium/trace.zip`.
Riesgos: no hay video en ejecucion exitosa porque `playwright.config.ts` retiene video solo en fallo; el trace generado contiene la referencia visual suficiente para comparar antes/despues.
Siguiente: Paso 3, preparar clases raiz para el grid v2 sin grandes cambios visuales.

## 2026-05-05 - Paso 3

Estado: completado.
Cambios: se anadieron clases de area v2 al template principal manteniendo las clases existentes usadas por CSS y E2E: `game-table-v2`, `game-table-topbar`, `game-table-opponents`, `game-table-main-top`, `player-summary-panel`, `turn-phase-panel`, `game-table-battlefield`, `game-table-hand`, `game-table-zones` y `game-table-game-log`. No se modifico backend, TypeScript, servicios, state, context menu, zone modal ni hover preview.
Comandos: `npm run build`; busqueda de clases v2 en `game-table.component.html`; `git diff -- frontend/src/app/features/game/game-table/game-table.component.html`.
Resultado: build OK con warnings de budget existentes; el diff es principalmente HTML/clases; todas las areas obligatorias quedan presentes en el DOM y se preservan `data-testid` y clases legacy como `.focused-board`, `.player-sidebar`, `.floating-panel`, `.hand-row` y `.zone-dock`.
Riesgos: `turn-phase-panel` sigue ubicado en el HUD actual y `game-table-game-log` sigue sobre el panel flotante con chat/log; los pasos 5, 6 y 11 deberan separarlos visualmente segun el mockup sin romper E2E.
Siguiente: Paso 4, implementar el grid principal exacto en SCSS.

## 2026-05-05 - Paso 4

Estado: completado.
Cambios: se implemento el grid base v2 en `game-table.component.scss`: columnas desktop `320px minmax(0, 1fr) 320px`, filas `56px 112px minmax(0, 1fr) 180px`, areas para topbar, opponents, board y gameLog, overflow controlado, y grids internos para `mainTop`, `battlefield`, `hand` y `zones`. Se anadieron breakpoints desktop para `1599px` y `1365px`.
Comandos: `npm run build`; `git diff -- frontend/src/app/features/game/game-table/game-table.component.scss`.
Resultado: build OK con warnings de budget existentes; Game Log y Zone Piles quedan en areas separadas desde SCSS, manteniendo clases y `data-testid` existentes.
Riesgos: por la estructura HTML actual, `focused-board` ocupa el area central y la zona inferior derecha mediante grid interno; la separacion visual final de topbar, turn panel y game log se completara en pasos 5, 6 y 11.
Siguiente: Paso 5, pulir topbar con solo Settings.

## 2026-05-05 - Paso 5

Estado: completado.
Cambios: la topbar ahora muestra marca `COMMANDERZONE`, game id, estado de sincronizacion y un unico boton visible `Settings`. Se quitaron de la topbar los botones `Draw mine`, `Draw 7 mine`, `Concede`, `My board` y los controles manuales de turno. Para no perder acceso funcional antes del paso 6, los controles de turno se movieron al menu Settings/context menu. Se elimino CSS muerto de `.my-actions` para mantener el build dentro del budget hard.
Comandos: `npm run build`; `git diff -- frontend/src/app/features/game/game-table/game-table.component.html frontend/src/app/features/game/game-table/game-table.component.scss`.
Resultado: build OK con warnings de budget existentes. El primer build fallo por `game-table.component.scss` 64 bytes por encima del limite hard de 14 KB; se soluciono eliminando estilos muertos de `.my-actions`.
Riesgos: los E2E que accionan `select[name="activePlayer"]` directamente necesitaran el paso 6 para volver a tener controles de turno visibles en su panel definitivo o una actualizacion explicita de selectores.
Siguiente: Paso 6, separar Player Summary y Turn Panel como paneles hermanos.

## 2026-05-05 - Paso 6

Estado: completado.
Cambios: la fila superior central ahora contiene dos paneles hermanos dentro de `game-table-main-top`: `player-summary-panel` con avatar placeholder, nombre, subtitulo, vida y color identity; y `turn-phase-panel` con turno, jugador activo/`Your Turn`, tracker de fases, boton `End Step` y controles existentes de active player/phase/turn. Se quitaron del menu Settings los controles de turno duplicados y se retiro CSS muerto para mantener el budget.
Comandos: `npm run build`; `git diff -- frontend/src/app/features/game/game-table/game-table.component.html frontend/src/app/features/game/game-table/game-table.component.scss docs/COMMANDERZONE_GAME_TABLE_UI_V2_FINAL_PLAN.md`.
Resultado: build OK con warnings de budget existentes. Durante la implementacion el build fallo primero por `game-table.component.scss` sobre el limite hard de 14 KB; se compacto el SCSS del propio paso hasta dejarlo en 13.99 KB.
Riesgos: el margen del SCSS sigue muy ajustado; los siguientes pasos visuales deberan reemplazar o compactar estilos existentes en vez de anadir mucho CSS nuevo.
Siguiente: Paso 7, pulir left opponents mini boards.

## 2026-05-05 - Paso 7

Estado: completado.
Cambios: el lateral izquierdo ahora renderiza solo jugadores que no son el focused player. Cada mini board conserva `.player-thumb`, anade `data-testid="opponent-mini-board"` y `data-player-id`, muestra avatar placeholder, nombre, estado, vida, mini battlefield compacto y counts de Library/Graveyard/Exile. Se actualizo el smoke E2E afectado para validar el jugador enfocado en `player-panel` y el rival en `opponent-mini-board`.
Comandos: `npm run build`; `npx playwright test e2e/game-multiplayer.smoke.spec.ts --trace on`; busqueda local de usos de `.player-thumb` en E2E.
Resultado: el primer build fallo por `game-table.component.scss` sobre el limite hard de 14 KB; se compacto el SCSS del sidebar hasta dejarlo en 13.99 KB. Build OK con warnings de budget existentes. E2E smoke OK, 1 passed.
Riesgos: quedan otros E2E con expectativas antiguas de sidebar que pueden requerir actualizacion en el paso 16 si se ejecuta la suite completa. El budget de SCSS sigue ajustado.
Siguiente: Paso 8, pulir focused battlefield.

## 2026-05-05 - Paso 8

Estado: completado.
Cambios: se pulio el battlefield central con fondo oscuro tipo mesa/arena, etiqueta `main-battlefield` y conservacion de `battlefield-zone`, drag/drop, tap/untap, context menu, hover preview, counters y overlays existentes. No se modifico `GameTableDragService`.
Comandos: `npm run build`; `npx playwright test e2e/game-drag-drop.multiplayer.spec.ts --trace on` como parte de la bateria afectada.
Resultado: build OK con warnings de budget existentes; drag/drop incluido en la bateria E2E afectada OK.
Riesgos: el SCSS del componente sigue cerca del limite hard, por lo que futuros cambios visuales deberian reemplazar estilos en vez de acumular mas reglas.
Siguiente: Paso 9, pulir hand area.

## 2026-05-05 - Paso 9

Estado: completado.
Cambios: se pulio la mano inferior como area central con etiqueta `Hand`, scroll horizontal y conservacion de `data-testid="hand-zone"`, `game-card` y `data-zone="hand"`. La mano no invade el panel de zonas.
Comandos: `npm run build`; E2E de robo y movimiento mano -> battlefield dentro de la bateria afectada.
Resultado: build OK; E2E afectados OK tras actualizar tests a la semantica de jugador enfocado.
Riesgos: la mano visible depende del jugador enfocado; los E2E deben llamar a `focusPlayer` antes de interactuar con cartas de mano.
Siguiente: Paso 10, crear/pulir independent Zone Piles panel.

## 2026-05-05 - Paso 10

Estado: completado.
Cambios: se separo `Library / Graveyard / Exile` en `game-table-zones` con `data-testid="zone-piles"` y pilas simetricas `data-testid="zone-pile"`; se oculto `command` de las pilas inferiores para ajustar la UI principal al plan visual. Se conservaron `drop-zone`, `open-zone`, `zone-count`, `data-zone` y `data-player-id`.
Comandos: `npm run build`; E2E de zonas/full decks/robustez dentro de la bateria afectada.
Resultado: build OK; E2E de zonas OK; los tests se ajustaron a que la zona command no forma parte de las pilas visibles principales.
Riesgos: el contador visible del test full-decks suma 99 porque commander/command queda fuera de las pilas principales visibles.
Siguiente: Paso 11, pulir Game Log lateral derecho.

## 2026-05-05 - Paso 11

Estado: completado.
Cambios: se dejo el lateral derecho como panel unico de Game Log por defecto, con `data-testid="game-log"` y `game-log-entry`; el chat se conserva como panel flotante accesible desde Settings sin tab visible permanente.
Comandos: `npm run build`; E2E de chat y gauntlet dentro de la bateria afectada.
Resultado: build OK; chat sync y full gauntlet OK usando apertura estable desde Settings.
Riesgos: los tests ya no deben depender de un tab visible `Chat`; deben abrir chat mediante Settings.
Siguiente: Paso 12, ocultar commander damage en la UI principal.

## 2026-05-05 - Paso 12

Estado: completado.
Cambios: se oculto commander damage de la UI principal y del menu visible de jugador, sin eliminar modelo, comandos ni backend.
Comandos: `npm run build`; `npm test -- --watch=false`; `npm run e2e`.
Resultado: build OK; unit tests OK; E2E OK.
Riesgos: la funcionalidad de dominio queda disponible internamente pero no expuesta en esta version visual.
Siguiente: Paso 13, preservar Settings/context actions.

## 2026-05-05 - Paso 13

Estado: completado.
Cambios: las acciones secundarias eliminadas de topbar quedan accesibles desde Settings/context menu: draw mine, draw 7, shuffle, refresh snapshot, open chat, my board, concede/leave segun flujo existente. La topbar mantiene solo Settings.
Comandos: `npm run build`; E2E afectados por draw/chat/gauntlet.
Resultado: build OK; E2E afectados OK tras centralizar helpers `clickGameMenuAction`, `drawMine` y `openChat`.
Riesgos: las acciones son menos visibles que antes, intencionado por el plan visual; los tests deben usar el menu Settings.
Siguiente: Paso 14, verificacion funcional completa.

## 2026-05-05 - Paso 14

Estado: completado.
Cambios: se actualizaron E2E afectados por la nueva semantica de jugador enfocado, sidebar de oponentes, chat desde Settings y acciones de draw desde Settings. Se anadio helper compartido `frontend/e2e/support/game-table.ts`.
Comandos: `npm run build`; `npm test -- --watch=false`; `npm run e2e`; `npx playwright test e2e/game-alternating-actions.multiplayer.spec.ts --trace on` tras corregir el unico fallo.
Resultado: build OK con warnings de budget existentes; unit tests OK, 39 files y 132 tests passed; primer `npm run e2e` fallo 1/27 por un test que movia carta de A mientras la pagina A tenia enfocado a B; corregido con `focusPlayer`; rerun completo OK, 27 passed.
Riesgos: quedan warnings de budget existentes en bundle inicial y SCSS de varios componentes; no bloquean build.
Siguiente: Paso 15, responsive desktop.

## 2026-05-05 - Paso 15

Estado: completado.
Cambios: se mantuvieron y ajustaron breakpoints desktop para 1599px y 1365px, columnas mas compactas, hand con scroll horizontal, game log con scroll interno y areas con `min-width: 0` / `min-height: 0` para evitar overflow horizontal.
Comandos: `npm run build`; E2E completo con viewport por defecto de Playwright.
Resultado: build OK; E2E completo OK.
Riesgos: no se hizo QA mobile real porque el plan lo excluye; la validacion responsive queda limitada a desktop.
Siguiente: Paso 16, actualizar E2E si selectores cambiaron.

## 2026-05-05 - Paso 16

Estado: completado.
Cambios: se actualizaron E2E que asumian que el sidebar incluia al jugador enfocado, que el chat tenia tab visible o que `Draw mine` estaba siempre visible en topbar. Se conservaron selectores estables y se concentraron nuevas operaciones en `support/game-table.ts`.
Comandos: bateria E2E afectada: `npx playwright test e2e/game-chat-sync.multiplayer.spec.ts e2e/game-life-sync.multiplayer.spec.ts e2e/game-draw-library.multiplayer.spec.ts e2e/game-move-hand-battlefield.multiplayer.spec.ts e2e/game-drag-drop.multiplayer.spec.ts e2e/game-full-decks.multiplayer.spec.ts e2e/game-robustness.multiplayer.spec.ts --trace on`; `npm run e2e`.
Resultado: bateria afectada OK, 7 passed; suite completa OK, 27 passed.
Riesgos: los E2E ahora modelan la UI real: antes de interactuar con mano/campo de un jugador concreto, deben enfocar ese jugador.
Siguiente: Paso 17, QA visual headed con Playwright.

## 2026-05-05 - Paso 17

Estado: completado.
Cambios: no se modifico codigo durante QA headed. Se ejecuto gauntlet y robustez en modo headed con trace para validar layout e interacciones principales.
Comandos: `npx playwright test e2e/full-game-browser-gauntlet.spec.ts --headed --trace on`; `npx playwright test e2e/game-robustness.multiplayer.spec.ts --headed --trace on`.
Resultado: full gauntlet headed OK, 1 passed; robustness headed OK, 1 passed. El flag `--video on` del MD no se uso porque esta version de Playwright no lo acepta por CLI; se mantuvo `--trace on`.
Riesgos: la revision visual humana final sigue siendo recomendable contra `docs/game-board.png`, aunque las pruebas headed no revelaron fallos graves.
Siguiente: Paso 18, fix loop visual.

## 2026-05-05 - Paso 18

Estado: completado.
Cambios: se corrigio el fallo funcional detectado en E2E: `game-alternating-actions` intentaba mover carta de A con B enfocado en la pagina A; se anadio `focusPlayer(pageA, playerA.user.displayName)` antes de mover. No se detectaron bugs visuales adicionales en QA headed. Se reviso SCSS para estilos muertos; `.clicked` no se elimino porque se aplica dinamicamente desde `GameTableStore`.
Comandos: `npx playwright test e2e/game-alternating-actions.multiplayer.spec.ts --trace on`; script Node de deteccion de clases SCSS no presentes en HTML; busqueda de `clicked` en game-table.
Resultado: spec afectado OK, 1 passed; no hay estilos muertos seguros que eliminar en `game-table.component.scss`.
Riesgos: la deteccion de estilos muertos fue conservadora; no elimina clases dinamicas ni selectores usados por estado.
Siguiente: Paso 19, auditoria final del diff.

## 2026-05-05 - Paso 19

Estado: completado.
Cambios: auditoria final del diff de HTML/SCSS/E2E/documentacion. No se tocaron backend, APIs, stores ni servicios de mesa. La implementacion mantiene la app como mesa manual online de Commander.
Comandos: `git status --short`; `git diff --stat`; revision de cambios en `game-table.component.html`, `game-table.component.scss` y E2E afectados.
Resultado: checklist completado; verificaciones principales verdes: build OK, unit OK, E2E OK, headed QA OK.
Riesgos: quedan artefactos generados por Playwright en `frontend/test-results` y `frontend/playwright-report` producidos por las ejecuciones; revisar antes de commit si el repo no debe versionarlos.
Siguiente: listo para revision manual.

```md
## YYYY-MM-DD — Paso X

Estado:
Cambios:
Comandos:
Resultado:
Riesgos:
Siguiente:
```
