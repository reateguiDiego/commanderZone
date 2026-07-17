# Gameplay Four-State Responsive Contract

## Opponent drawer interaction

Normal keeps opponent boards in the table layout. Compact, aggressive, and minimal require the explicit accessible drawer trigger: while closed, opponent content is `aria-hidden`, inert, and cannot intercept input; while open, boards are placed within the viewport. Aggressive/minimal tables with three or more opponent boards use the existing drawer as a denser two-column grid; this is layout within the approved state, not a new breakpoint. Hover/focus does not implicitly open the drawer. Multi-player responsive gates keep every player session connected before testing layout so the disconnect control-plane is not exercised by unrelated assertions.

## Alcance

Este documento define el contrato responsive global de Gameplay 1.0 Sprint 3C. CommanderZone sigue siendo una mesa manual de Commander. El responsive no modifica reglas, autoridad, privacidad, coordenadas espaciales ni relaciones de battlefield.

El sistema tiene exactamente cuatro estados conceptuales:

1. `normal`
2. `compact`
3. `aggressive`
4. `minimal` ("Que te pires")

No existe un quinto estado. Por debajo del mínimo soportado el estado continúa siendo `minimal` y `data-responsive-supported="false"` activa un mensaje explícito; no se comprime el gameplay indefinidamente.

## Auditoría previa

Antes de Sprint 3C solo `aggressive` estaba formalizado en TypeScript mediante `matchMedia('(max-width: 1180px) and (max-height: 768px)')`. `normal`, `compact` y el bloqueo que hacía de `minimal` existían de facto en SCSS. Además, el menú contextual repetía la detección agresiva por su cuenta. CSS y TypeScript podían discrepar con browser zoom, altura limitada, paneles abiertos o contenedores que no ocupasen todo `window.innerWidth`.

Los umbrales encontrados se clasifican así:

| Umbral heredado | Uso previo | Mapeo conceptual Sprint 3C |
|---|---|---|
| 1400/1260 px | header, preview y detalles de carta | detalle `normal`/`compact`; nunca selecciona estado |
| 1180 px o 1199 px de alto | densidad general, hand, zones y player panel | detalle `compact`; el atributo raíz manda |
| 900 px | mulligan, zones y densidad intermedia | detalle `aggressive` |
| 768 px de alto | antiguo “aggressive compact” | detalle `aggressive` |
| 760/720 px | hand, zones, header, opponent mini-board | detalle `aggressive`/`minimal`; no selecciona estado |
| 640/560/520 px | modales y grids internos | detalle `minimal` |
| 430 px | subumbral interno de densidad mínima | detalle `minimal`, no quinto estado |
| 745.5 × 524 y portrait <=760 | bloqueo previo de gameplay | sustituido por mínimo explícito 480 × 360 |
| container 34 rem / 21 rem | turn panel y player summary | detalle `compact` / `aggressive-minimal` |

Las media queries de `prefers-reduced-motion`, pointer/hover y safe areas no son estados de layout. Los container queries de componentes solo compactan contenido dentro del estado raíz.

Problemas corregidos:

- una única combinación width/height gobernaba TypeScript;
- tres estados solo existían en CSS;
- el menú contextual infería responsive de forma independiente;
- portrait podía bloquear una mesa que tenía espacio útil suficiente;
- el mini battlefield rival desaparecía a 760 px;
- abrir paneles no participaba en el criterio;
- los umbrales no tenían histéresis ni protección contra thrashing;
- el mínimo soportado era implícito y contradictorio.

## Fuente de verdad TypeScript

`resolveGameTableResponsiveState` es una función pura. Recibe:

```ts
resolveGameTableResponsiveState({
  containerWidth,
  containerHeight,
  playerCount,
  visiblePanels,
  orientation,
  previousState,
})
```

No lee DOM, `window`, browser zoom, battlefield zoom ni backend. El componente mide su contenedor raíz con `ResizeObserver`, agrupa eventos en un solo `requestAnimationFrame` y pasa inputs explícitos al resolver. Los cambios de jugadores y del drawer de rivales vuelven a resolver el estado.

El resultado contiene `state`, `supported`, `usableWidth` y `usableHeight`. Nunca se persiste ni se envía por WebSocket.

## Cálculo de espacio útil

El cálculo determinista normaliza jugadores a 2–6 y descuenta densidad visible:

- 48 px de ancho por cada jugador por encima de dos;
- 18 px de alto por cada jugador por encima de cuatro;
- 72 px cuando el panel de oponentes está abierto;
- 24 px cuando un panel de actividad consume espacio;
- 48 px en orientación portrait.

Los costes no son breakpoints adicionales: producen `usableWidth`/`usableHeight`, que se evalúan contra los mismos cuatro estados.

## Entrada, salida, prioridad e histéresis

| Estado | Entrada por espacio útil | Salida hacia menor densidad | Retorno desde estado más denso |
|---|---|---|---|
| `normal` | >=1280 × 820 | al perder cualquiera de los mínimos | >=1344 × 860 |
| `compact` | >=960 × 650 | al perder cualquiera de los mínimos | >=1024 × 690 |
| `aggressive` | >=720 × 520 | al perder cualquiera de los mínimos | >=784 × 560 |
| `minimal` | resto | no hay quinto estado | cuando supera entrada + histéresis del destino |

La degradación hacia un estado más denso es inmediata. Volver al estado adyacente menos denso exige 64 px extra de ancho y 40 px extra de alto. Un salto de dos o más estados se acepta inmediatamente porque ya está lejos de la frontera que podría oscilar. Esto evita ciclos `resize -> state -> layout -> resize` sin dejar un estado antiguo pegado tras volver del browser zoom.

El mínimo funcional soportado es 480 × 360 px del contenedor. Por debajo se conserva `minimal`, se marca `supported=false` y se presenta una explicación con acción accesible para salir de la sala.

## Mapping CSS / TypeScript

TypeScript escribe en `.game-screen`:

- `data-responsive-state="normal|compact|aggressive|minimal"`;
- `data-responsive-supported="true|false"`;
- `data-player-count`;
- dimensiones observadas para diagnóstico QA.

SCSS selecciona únicamente por `data-responsive-state` para el layout conceptual. Cada estado publica custom properties para:

- densidad y escala de cards;
- gaps;
- tamaño mínimo de hit area;
- columnas de player/turn/activity/log;
- altura de hand y zones;
- ancho y comportamiento de aside;
- gutters y límites de modal;
- tamaño de cartas de mulligan;
- densidad de player panels.

Las reglas internas heredadas pueden ajustar un componente, pero no pueden crear o cambiar el estado. El menú contextual recibe `responsiveState` como input; ya no usa `matchMedia` propio.

## Normal

- battlefield y battlefield rival con máximo detalle;
- player panels completos;
- aside de rivales persistente;
- zones y hand con tamaño estándar;
- chat/GameLog visible en su región;
- BF zoom siempre visible;
- modales con gutter amplio;
- 5–6 jugadores admitidos cuando el espacio útil supera el umbral.

## Compact

- gaps, paddings, paneles y mulligan reducidos;
- aside de rivales en drawer accesible;
- labels y chrome conservan acciones esenciales;
- zones y hand siguen siendo clicables;
- BF zoom mantiene control y valor local;
- attachments y stacks conservan orden e hit testing.

## Aggressive

- battlefield priorizado y chrome secundario reducido;
- aside de rivales como overlay temporal por la izquierda;
- chat/GameLog expande temporalmente por focus/hover;
- player strip y zones usan densidad agresiva;
- mulligan pasa a una columna con scroll interno;
- mini battlefield rival continúa visible y enfocable;
- BF zoom, turn/status, hand, zones y acciones esenciales permanecen accesibles.

## Minimal / “Que te pires”

- battlefield ocupa la columna principal;
- player/turn quedan en dos columnas y se omite decoración no esencial;
- rivals y chat/GameLog usan overlays cerrables;
- zones y hand permanecen en el borde inferior;
- modales y mulligan usan gutters mínimos, max-height/max-width de viewport y scroll interno;
- hit areas no bajan de 2.5 rem aunque se reduzca el icono;
- por debajo de 480 × 360 aparece el estado explícito de viewport no soportado sin crear otro breakpoint.

## Player panels 2–6

El número de jugadores forma parte del resolver, no de media queries separadas. El layout conserva nombre, vida, commander damage, counters existentes, current turn, lifecycle y presence. Los nombres usan truncado ya existente con `title`/nombre accesible; los estados defeated/conceded no alteran la cuadrícula global. Seis jugadores reducen el espacio útil, pero no producen overflow horizontal de documento.

## Owner y opponent battlefields

Owner y rivals usan el mismo estado raíz y las mismas reglas de densidad. El foco de un rival no cambia autoridad. Resize, cambio de estado o browser zoom solo recalculan proyección local; no emiten `card.position.changed`, `cards.position.changed`, comandos de relación ni reescriben ratios.

El mini battlefield que antes se ocultaba por debajo de 760 px permanece visible en `aggressive` y `minimal`. La geometría autoritativa sigue siendo ratio y los offsets de attachments/stacks siguen siendo locales.

## Aside, chat y GameLog

- `normal`: aside en la cuadrícula;
- `compact`: drawer a la derecha;
- `aggressive`: overlay a la izquierda;
- `minimal`: overlay/drawer con battlefield prioritario.

El cambio de estado no modifica unread, no envía comandos y no recrea deliberadamente el input. Focus y `prefers-reduced-motion` se respetan. La deuda general de cursor/IME sigue fuera de Sprint 3C salvo regresión directa.

## Zones, hand y privacidad

Library, graveyard, exile, command zone y hand siguen visibles/clicables en los cuatro estados. Los counts no se eliminan. Los modales de zona están limitados al viewport útil y hacen scroll interno. Responsive no altera concealment, faceDown, DFC ni materialización; un rival no recibe identidad privada ni se introduce `Unknown Card` público.

## Mulligan

El overlay usa tokens del estado raíz para card width, grid, gutters y densidad. `aggressive`/`minimal` usan una columna y scroll interno manteniendo header, acciones y estado de jugadores accesibles. Las reglas London, Vancouver, Paris y Generous no cambian. La cobertura unitaria existente mantiene manos de 7 y 10 cartas y la selección de bottom cards.

## Modales

Zone, number action, P/T y arrow target reciben max-width/max-height relativos al viewport, gutter por estado y scroll interno. Los modales compartidos (`app-modal`) conservan focus trap, header/footer y cierre. Abrir un modal no participa en el resolver, por lo que no cambia el estado responsive global.

## Battlefield zoom

BF zoom permanece disponible en los cuatro estados y mantiene el rango 70–140. Es preferencia local en `localStorage`; no es input del resolver, no cambia `data-responsive-state`, no se persiste en backend y no altera ratios ni relaciones.

Browser zoom tampoco es un dato compartido. Su efecto entra indirectamente porque cambia el espacio CSS realmente disponible al contenedor.

## Attachments y battlefield stacks

Responsive puede modificar densidad visual local, pero no orden, root, dirección ni grafo autoritativo. Los miembros siguen visibles y con región clicable en los cuatro estados. Resize/state transition debe producir cero comandos `attachment.*` y `battlefield.stack.*`.

## Accesibilidad

- BF zoom y acciones icon-only conservan `aria-label` existente;
- el tamaño de hit area se desacopla del icono;
- focus visible y navegación por teclado se conservan;
- no se introduce ninguna acción esencial hover-only;
- labels truncados conservan nombre accesible/tooltip;
- `prefers-reduced-motion` elimina transiciones del drawer/overlay;
- el color no sustituye current turn, lifecycle o estados de acción.

## QA matrix

El gate `game-product-four-state-responsive-gate.spec.ts` usa una matriz pairwise real:

| Jugadores | Viewport owner | Estado | BF zoom |
|---:|---:|---|---:|
| 2 | 1600 × 1000 | normal | 70 |
| 3 | 1280 × 800 | compact | 100 |
| 4 | 1050 × 680 | aggressive | 140 |
| 5 | 850 × 600 | minimal | 70 |
| 6 | 1600 × 1000 y transiciones 1400×850 / 1150×700 / 900×600 | cuatro estados | 140 |

Mulligan se recorre en 1600×1000, 1180×820, 900×600 y 650×480. Cada prueba usa contextos aislados owner/viewer con viewports y BF zoom distintos.

La QA nativa de Chrome usa viewport físico 1280×720 con seis jugadores. El zoom real esperado produce:

| Browser zoom | Espacio CSS aproximado | Estado esperado | BF zoom |
|---:|---:|---|---|
| 80% | 1600 × 900 | normal | 70/100/140 |
| 100% | 1280 × 720 | compact | 70/100/140 |
| 125% | 1024 × 576 | aggressive | 70/100/140 |
| 150% | 853 × 480 | minimal | 70/100/140 |

La ejecución nativa debe comprobar DPR relativo; viewport, CSS transform y `deviceScaleFactor` no sustituyen browser zoom.

## Resultado de QA headed real

Ejecución: 14 de julio de 2026.

- navegador: Google Chrome for Testing 147.0.7727.15 (Chromium real headed);
- sistema: Windows 11 Pro x64, build 26200.8655;
- método: atajos nativos de zoom sobre la ventana Chrome y confirmación por ratio de `window.devicePixelRatio`;
- browser zoom certificado: 80%, 100%, 125% y 150%;
- BF zoom certificado en cada nivel: 70%, 100% y 140%;
- viewport físico de la matriz nativa: 1280 × 720 owner y 1920 × 1080 viewer;
- jugadores de la matriz nativa: 6, dos BrowserContext aislados;
- jugadores del gate pairwise headed/headless: 2, 3, 4, 5 y 6;
- estados observados con zoom nativo: 80=`normal`, 100=`compact`, 125=`aggressive`, 150=`minimal`;
- resultado visual de las 12 combinaciones: PASS;
- retorno 150→100: PASS, estado `compact`, ratios y relaciones idénticos;
- overflow horizontal global, BF zoom oculto, clipping de controles esenciales y estados inválidos: 0;
- position/relation commands causados por zoom/resize: 0;
- `game_patch`, `resync_required`, fallback y `target_not_found`: 0;
- identidad pública `Unknown Card` y leaks faceDown: 0.

Las screenshots headed se adjuntaron como evidencia temporal al reporte Playwright de la ejecución. No se conservan en el worktree.

## Bugs encontrados y fixes

1. El drawer podía quedar visualmente abierto después de cerrarlo porque `:hover`/`:focus-within` dominaba sobre `aria-expanded=false`, tapando BF zoom. Fix: la expansión conceptual depende exclusivamente de `.opponents-open`; teclado y click usan el mismo toggle explícito.
2. Al volver de 150% a 100% en 6P, la histéresis trataba `minimal → compact` como una frontera adyacente y podía dejar `minimal` pegado. Fix: la histéresis solo se aplica entre estados adyacentes; saltos de dos o más estados aceptan el candidato inmediatamente. Se añadió regresión unitaria.
3. El bloque canónico hacía superar el presupuesto por fichero del SCSS histórico. Fix: se separó mecánicamente en `game-table-four-state-responsive.scss` manteniendo el mismo componente y sin elevar budgets globales.

## Bugs adicionales cerrados durante los gates

4. En `compact`, el resumen contextual del rival conservaba demasiada altura y el clamp visual apartaba una carta de ratio bajo para evitar el overlay. Fix: el resumen usa una variante más ancha y baja, oculta solo contexto decorativo y conserva nombre, vida y retorno. El gate spatial vuelve a proyectar la ratio dentro de tolerancia sin mutar estado compartido.
5. Una flecha autoritativa podía interceptar clicks del drawer de rivales abierto porque el layer SVG estaba en un stacking context raíz superior. Fix: mientras el drawer responsive está abierto, su superficie se eleva por encima de las flechas; al cerrarlo, el hit testing de flechas vuelve a su nivel normal. Los helpers E2E abren el drawer mediante el toggle accesible.

## Cierre de gates

- Go: `go test ./...`, `go test -race ./...` y `go vet ./...`, PASS.
- PHP: suite completa con limpieza de estado de integración, 1313 tests y 13917 assertions, PASS; permanecen 9 deprecations y 76 notices ya reportados por la suite.
- WebSocket contracts focalizados: 70 tests y 588 assertions, PASS.
- Frontend: 259 files y 2436 tests, PASS.
- Build Angular: PASS; solo warnings de budgets preexistentes en componentes no modificados por el contrato.
- Four-state responsive gate: 5 escenarios pairwise PASS en headless y headed; el caso de zoom nativo se omite intencionadamente en headless.
- QA headed nativa four-state: 1 escenario PASS con las 12 combinaciones browser/BF zoom y retorno a 100%.
- Attachments/stacks cross-viewer: PASS; spatial cross-viewer y actor restart: PASS.
- Sprint 1 integrado: 2 PASS; Sprint 2 integrado 2–6 jugadores: 5 PASS.
- Movement, batch authorization, state integrity, identity, zone visibility y sensitive privacy: PASS.
- Chat/GameLog, mulligan runtime y P/T dinámica (incluido restart, DFC y privacidad): 6 escenarios PASS.
- API, WebSocket y Runtime `/healthz` y `/readyz`: HTTP 200; flujo real API/WebSocket→Runtime validado por los gates de comandos y restart.
- OpenAPI/config YAML: 18 archivos válidos.

## Assertions globales

Durante resize, browser zoom, BF zoom y transición de estado:

- estado fuera de los cuatro: 0;
- oscilaciones: 0;
- overflow horizontal global: 0;
- BF zoom oculto: 0;
- acción esencial inaccesible: 0;
- position commands: 0;
- relation commands: 0;
- `game_patch`: 0;
- `resync_required`: 0;
- fallback/recovery inesperada: 0;
- `target_not_found`: 0;
- privacy leaks/`Unknown Card` público: 0.

## Deuda explícitamente diferida

Sprint 3C no implementa mana helper vertical, counters responsive completos, selection area, grouped tokens, Oracle helpers, animaciones, cosméticos, nuevos layouts premium ni un refactor visual general. Browser zoom 200% no está certificado. Estas partidas quedan para Sprint 3D o bloques posteriores sin alterar el contrato de cuatro estados.
