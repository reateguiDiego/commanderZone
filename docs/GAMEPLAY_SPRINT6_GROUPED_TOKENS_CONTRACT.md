# Gameplay Sprint 6 — Grouped Tokens contract

## Modelo cerrado en Sprint 6A

Grouped Tokens usa N instancias de carta autoritativas y una relación `TokenGroup` persistida. La cantidad se deriva siempre de la lista ordenada de miembros; no es un counter ni una segunda fuente de verdad. Battlefield stacks y selection group refs mantienen semánticas distintas. Split y merge serán acciones explícitas en bloques posteriores.

## Blockers cerrados en Sprint 6A.1

- `card.token.created` persiste efectos finales versionados y replay aplica esos resultados, sin reinterpretar el evento como un comando ni consultar un catálogo mutable.
- Quantity acepta únicamente enteros de 1 a 20 y rechaza el resto con `INVALID_TOKEN_QUANTITY`, sin clamp ni mutación parcial.
- Arrows, attachments y battlefield stacks faceDown usan referencias viewer-specific coherentes con la proyección de cartas; las relaciones mixtas o no resolubles se omiten fail-closed.
- El reducer remapea conceal/materialize sin refetch, recovery ni `resync_required` normal.

## Implementado en Sprint 6B.1

- Entidad autoritativa `TokenGroupRuntime` con `groupId`, `rootInstanceId`, `orderedMemberIds`, `revision`, `createdByPlayerId`, `createdAtVersion` y `effectVersion`.
- `quantity` derivada de membership. No se serializa en el snapshot autoritativo ni en el efecto del evento.
- `card.token.created` con quantity 1 conserva una instancia independiente; quantity 2–20 crea N instancias y exactamente un TokenGroup. El root es el primer miembro y todos comparten la posición ratio del root.
- El actor valida identidad, membership única, token/battlefield, owner/controller y fingerprint mutable uniforme, posición, ausencia de stacks, arrows y attachments, revision y effect version antes de persistir.
- El evento guarda `tokenGroup` como efecto final opcional. Replay nuevo lo aplica exactamente; eventos legacy sin ese efecto conservan fichas independientes y nunca infieren grupos.
- Snapshot Go, compact snapshot PHP y bootstrap V2 conservan orden, root y revision. Snapshots legacy hidratan con colección vacía.
- La proyección faceDown usa refs opacas y un `groupId` estable por viewer que no se deriva del ID canónico. Quantity sigue siendo pública; una proyección parcial se omite.
- Patch.v2 incorpora `token.group.set` y `token.group.remove`. El frontend mantiene `tokenGroupsById` y `tokenGroupIdByMemberRef`, protege revisiones y remapea conceal/materialize.
- El renderer existente continúa mostrando las N cartas. No se ha añadido UX agrupada.

## Pendiente para 6B.2 / 6C / 6D

- Split, merge, remove K, disolución manual y extracción individual.
- Acciones de tap, counters, P/T, controller o movimiento sobre todo el grupo.
- Integración UX con attachments y battlefield stacks.
- Renderer con badge de cantidad, selection group refs, marquee, drag y toolbar agrupados.
