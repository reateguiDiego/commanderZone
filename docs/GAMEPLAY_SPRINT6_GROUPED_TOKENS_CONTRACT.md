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
- La proyección faceDown usa refs opacas y un `groupId` estable por viewer que no se deriva del ID canónico. Quantity sigue siendo pública; si membership no puede proyectarse completa, el grupo conserva root/quantity seguros y omite `memberRefs`.
- Patch.v2 incorpora `token.group.set` y `token.group.remove`. El frontend mantiene `tokenGroupsById` y `tokenGroupIdByMemberRef`, protege revisiones y remapea conceal/materialize.
- El renderer existente continúa mostrando las N cartas. No se ha añadido UX agrupada.

## Pendiente para 6B.2 / 6C / 6D

- Split, merge, remove K, disolución manual y extracción individual.
- Acciones de tap, counters, P/T, controller o movimiento sobre todo el grupo.
- Integración UX con attachments y battlefield stacks.
- Renderer con badge de cantidad, selection group refs, marquee, drag y toolbar agrupados.

## Certificado en Sprint 6B.2

- El esquema canonico compartido contiene exclusivamente `groupId`, `rootInstanceId`, `orderedMemberIds`, `revision`, `createdByPlayerId`, `createdAtVersion` y `effectVersion`. `quantity` se deriva y los aliases se rechazan en escrituras nuevas.
- PHP usa un canonicalizer unico en replay, compact snapshot, invariantes, runtime-off, bootstrap y adaptadores Patch.v2. El orden de `orderedMemberIds` es contractual y no se reordena. Nuevas creaciones escriben final-effects version 2; version 1 sin grupo se conserva como lectura legacy explicita y nunca infiere membership.
- Runtime ON y runtime-off comparten vectores versionados para IDs de instancias y `groupId`. Runtime-off crea el mismo efecto final, posicion normalizada, revision y GameLog semantico agregado.
- El roundtrip canonical state -> compact snapshot -> canonical state conserva grupos sin perdida. Snapshots legacy sin `tokenGroups` producen una coleccion vacia y nunca infieren membership.
- La proyeccion autorizada incluye IDs canonicos y membership completa. La no autorizada usa `groupId` y `rootRef` opacos por viewer, publica `quantity` y omite `memberRefs`; nunca entrega un subset ambiguo.
- Patch.v2 soporta `token.group.set` y `token.group.remove`. En conceal/materialize, las operaciones se ordenan como remove -> identidad de instancias -> set -> counts/log para mantener equivalencia con bootstrap sin recovery.
- OpenAPI y WebSocket distinguen efecto canonico, proyeccion viewer-safe, relacion bootstrap y operaciones Patch.v2. El fixture reutilizable unico vive en `backend/tests/Fixtures/token-group-contract-v1.json` y lo consumen las suites PHP y Go.

## Implementado en Sprint 6C

- Comandos autoritativos `token.group.split`, `token.group.merge`, `token.group.remove_members` y `token.group.dissolve`, todos con `groupId`, revision esperada, final-effects versionados, una version de partida e idempotencia por `clientActionId`.
- Split extrae miembros desde el final sin extraer el root mientras exista otra opcion. La porcion original conserva grupo/root y sube una revision; una porcion de uno queda independiente y una porcion de dos o mas recibe un ID determinista nuevo y revision 1.
- Merge soporta grupo+grupo, grupo+instancia e instancias independientes, conserva el target explicito o el grupo mas antiguo y rechaza incompatibilidad, relaciones, revisiones stale, duplicados y resultados mayores de 20.
- Remove K elimina instancias y localizaciones de forma atomica; conserva el root hasta el ultimo miembro, incrementa una revision si sobreviven dos o mas y disuelve cuando queda cero o uno. La promocion defensiva selecciona el primer miembro restante y nunca ordena por ID.
- Dissolve conserva instancias, elimina indices de membership y persiste posiciones explicitas o offsets ratio deterministas. No crea battlefield stacks.
- `token.group.state.set`, `token.group.position.set` y `token.group.move` aplican tap/untap, faceDown/faceUp, posicion o salida completa del battlefield como una unica intencion. La revision representa toda la proyeccion compartida y sube exactamente una vez.
- Mutaciones individuales y relaciones sobre miembros agrupados fallan con `TOKEN_GROUP_MEMBER_REQUIRES_SPLIT` o `TOKEN_GROUP_RELATION_CONFLICT`; no hay auto-split oculto.
- Replay Go/PHP aplica los grupos, posiciones, estados y removals finales sin recalcular decisiones. Runtime-off usa los mismos IDs deterministas, orden, revisiones, limites y errores.
- Los efectos uniformes faceDown persisten `visibleToMask` y `revealedTo`; replay PHP resuelve audiencia cero fail-closed. `cards.tapped.set`, `cards.face_down.set` y `battlefield.untap_all` persisten tambien los `resultingGroups`, por lo que Patch live, refresh y restart conservan exactamente la misma revision.
- Patch.v2 sigue usando exclusivamente `token.group.set/remove`, con mutaciones de instancias entre remove y set cuando corresponda. El store normalizado reconstruye indices y termina equivalente a bootstrap.
- GameLog agrega una entrada por intencion y no incluye groupId, root ni member IDs.

## Reservado para Sprint 6C.1

- Counters, P/T overrides y cambio de controller uniformes. Las primitivas actuales son single-only y no se simula atomicidad mediante bucles de comandos.

## Pendiente para Sprint 6D

- Renderer y badge de cantidad.
- Selection group refs, marquee, drag y toolbar de grupos.
- UX `separate and attach`, integracion visual con battlefield stacks y certificacion responsive/accesible final.
