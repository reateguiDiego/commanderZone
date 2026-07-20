# Gameplay Sprint 6 — Grouped Tokens contract

## Modelo cerrado en Sprint 6A

Grouped Tokens se implementará como N instancias de carta autoritativas y una relación `TokenGroup` persistida. La cantidad será derivada del membership; no será un counter ni una segunda fuente de verdad. Battlefield stacks y selection group refs conservan semánticas distintas. Crear N fichas podrá crear la relación en Sprint 6B; split y merge serán explícitos.

Nada de ese dominio se implementa en 6A.1: no existen todavía `groupId`, membership, split, merge, renderer de cantidad ni operaciones Patch.v2 de grupos.

## Blockers encontrados y cierre 6A.1

- Replay Go: live escribía `count/tokens`, pero replay reinyectaba el evento como un comando que esperaba `quantity/card`; el fallback producía una sola ficha genérica y podía cambiar identidad/print. Los eventos nuevos guardan `effectVersion` y efectos finales por token, y replay los aplica directamente. Un adaptador explícito conserva eventos legacy sin reescribir el event store.
- Quantity: el clamp silencioso a `1..20` se sustituyó por validación estricta en frontend, PHP/API, WebSocket y Runtime Go. El contrato acepta únicamente enteros de 1 a 20 y rechaza el resto con `INVALID_TOKEN_QUANTITY`, sin mutación.
- Relaciones faceDown: la proyección de la carta sustituía su `instanceId`, pero arrows, attachments y battlefield stacks mantenían referencias canónicas. La proyección final usa el mismo mapa viewer-specific; proyecta referencias compatibles y omite relaciones que mezclarían endpoints canónicos y opacos.
- Paridad live: el reducer normalizado remapea atómicamente las referencias al aplicar conceal/materialize; conserva relaciones totalmente canónicas u opacas y elimina de forma fail-closed cualquier relación mixta, sin recovery ni refetch.
- Gate responsive: el helper apuntaba a una mini-board oculta. Ahora abre el drawer vigente mediante su control accesible, exige un target visible y único, enfoca al jugador y restaura el drawer, incluso ante target ausente.

## Readiness para Sprint 6B

Sprint 6B puede comenzar únicamente con los gates de replay/identity, quantity, privacidad de relaciones, bootstrap/restart, frontend, PHP, Go y Playwright verdes. El próximo bloque podrá añadir el modelo autoritativo de grupo definido por 6A, sin reutilizar battlefield stacks y sin alterar la autoridad individual de las N instancias.
