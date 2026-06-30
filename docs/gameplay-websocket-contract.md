# Gameplay WebSocket Contract

Estado: transporte WebSocket base disponible solo para gameplay `games/:id`.

No sustituye todavia a Mercure ni al polling. Mercure sigue vigente para rooms, waiting room, invites, friends y notificaciones ligeras. Este contrato no aplica a presencia global de la app ni a otras features.

## Conexion

La conexion usa ticket corto, no el JWT principal en el query string.

1. El cliente pide `POST /games/{id}/websocket-ticket` con la autenticacion HTTP actual.
2. El backend valida `Game::canBeViewedBy($user)`.
3. El backend devuelve `{ ticket, expiresAt, websocketUrl, route, claims }`.
4. `route` debe ser `runtime_ws` para gameplay activo. `php_gateway_ws` y `legacy_ws` solo pueden usarse con flags de emergencia explicitos fuera del flujo normal.
5. El cliente abre `websocketUrl`, por defecto `ws://127.0.0.1:8091/ws?ticket=...` solo en desarrollo/test.

## Configuracion

- `GAME_RUNTIME_WEBSOCKET_PUBLIC_URL` define la URL publica que recibira el navegador para el Go runtime `/ws`.
- En desarrollo/test puede omitirse y usar el default local `ws://127.0.0.1:8091/ws`.
- En `APP_ENV=prod` con `GAME_RUNTIME_ENABLED=1`, debe configurarse como una URL publica `wss://...`; el backend rechaza el ticket con error explicito si queda vacia, usa el default local o apunta a `localhost`/loopback.
- El fallback PHP WebSocket no es automatico para gameplay runtime. `php_gateway_ws` y `legacy_ws` no son rutas validas del endpoint de ticket normal.

Claims firmados del ticket runtime:

- `gameId`
- `userId`
- `playerId`
- `role`
- `permissions` (`view`, `command`; `game.close` solo para el owner autorizado)
- `exp`
- `protocol: "v2"`

Si el ticket falta, expira, no pertenece al `gameId`, o el usuario ya no tiene acceso, el servidor cierra con codigo `1008`.

El WebSocket ya ejecuta los comandos de gameplay migrados para `games/:id`. Los comandos no migrados o no reconocidos se rechazan con `command_ack` y `COMMAND_NOT_SUPPORTED_OVER_WEBSOCKET`.

## Bootstrap Y Resync

El estado completo sigue siendo `GameSnapshot`.

- Bootstrap y resync son HTTP: `GET /games/{id}/snapshot` o `GET /games/{id}/bootstrap`.
- Si `/games/{id}/bootstrap` existe, debe devolver exactamente el mismo `GameSnapshot` proyectado que `/snapshot`.
- No existe `GameBootstrap` ni `GameBootstrapPlayer` reducido.
- `backgroundName` y `sleevesName` son parte estable del estado del player.
- WebSocket no manda snapshots completos ni documentos grandes.

## Mensajes Cliente -> Servidor

```ts
type GameplayClientMessage =
  | {
      kind: 'command';
      gameId: string;
      messageId: string;
      command: {
        type: GameCommandType;
        payload: Record<string, unknown>;
        clientActionId: string;
        baseVersion: number;
      };
    }
  | {
      kind: 'ping';
      gameId?: string;
      messageId: string;
      sentAt: string;
    };
```

Reglas:

- `GameCommandType` es el union actual de gameplay.
- Todo `command` lleva `clientActionId` y `baseVersion`.
- Un mensaje no puede cambiar el `gameId` autenticado en la conexion; si trae otro `gameId`, el servidor responde `GAME_ID_MISMATCH`.

## Mensajes Servidor -> Cliente

```ts
type GameplayServerMessage =
  | GameplayCommandAckMessage
  | GameplayGamePatchMessage
  | GameplayResyncRequiredMessage
  | GameplayErrorMessage
  | GameplayPongMessage
  | GameplayConnectionStateMessage
  | GameplayConnectionJoinedMessage
  | GameplayConnectionLeftMessage;
```

El exito normal de un command aplicado es `game_patch` con `clientActionId`. No existe `command_ack accepted` en el flujo normal.

`command_ack` solo representa comandos no aplicados o que requieren recuperacion:

```ts
interface GameplayCommandAckMessage {
  kind: 'command_ack';
  gameId: string;
  messageId?: string;
  clientActionId: string;
  status: 'rejected' | 'duplicate' | 'resync_required';
  version: number;
  error?: GameplayErrorPayload;
}
```

`game_patch` describe cambios pequenos de dominio aplicables sobre el `GameSnapshot` actual:

```ts
interface GameplayGamePatchMessage {
  kind: 'game_patch';
  gameId: string;
  baseVersion: number;
  version: number;
  operations: GameSnapshotPatchOperation[];
  event?: GameEvent;
  clientActionId?: string;
}
```

`ping` y `pong` solo miden vida/latencia de conexion; no cambian estado de partida. `pong.gameId` siempre es el `gameId` autenticado en la conexion.

El runtime Go acepta `type` solo como adaptador explicito de entrada para clientes antiguos. Los mensajes servidor -> cliente deben emitirse con `kind`; no se permite emitir `type` como contrato principal.

Los mensajes `connection_state`, `connection_joined` y `connection_left` son presencia tecnica de socket. No son estado de jugador ni gameplay.

## Patches Tipados

El contrato principal no usa JSON Patch, JSON Pointer ni paths string. Cada operacion existe para mandar el minimo cambio necesario e identifica entidades por ids y campos explicitos.

Operaciones actuales:

- `card.position.set`
- `cards.position.set`
- `card.move`
- `card.state.set`
- `card.projection.set`
- `card.counters.set`
- `card.stats.set`
- `cards.state.set`
- `card.create`
- `zone.counts.set`
- `zone.visible.set`
- `player.life.set`
- `player.counters.set`
- `player.commanderDamage.set`
- `player.sleeves.set`
- `player.background.set`
- `player.library.visibility.set`
- `player.status.set`
- `stack.item.add`
- `stack.item.remove`
- `stack.set`
- `arrow.add`
- `arrow.remove`
- `arrows.set`
- `attachment.add`
- `attachment.remove`
- `attachments.set`
- `chat.append`
- `eventLog.append`
- `turn.set`
- `timer.set`

`zone.counts.set` actualiza contadores de zona sin mandar cartas ni zonas completas, especialmente para hand/library de rivales.

`zone.visible.set` reemplaza solo la proyeccion visible de una zona oculta para un viewer. No transporta la zona raw.

`card.projection.set` reemplaza una carta por su representacion proyectada para ese viewer. Se usa cuando cambia la privacidad/visibilidad y el cliente no debe conservar datos anteriores.

`card.create` solo se usa para nuevas instancias, por ejemplo tokens o copias de token. No sustituye zonas completas.

`card.counters.set`, `card.stats.set` y `cards.state.set` mantienen cambios avanzados de carta en payloads pequenos y tipados.

`stack.item.add/remove`, `arrow.add/remove` y `attachment.add/remove` son las operaciones normales para relaciones y stack. Los `*.set` completos quedan como fallback acotado para listas pequenas cuando el diff por ids no es suficientemente expresivo; si la lista crece o no se puede proyectar con seguridad, el servidor debe emitir `resync_required`.

`player.status.set` cubre cambios de estado del jugador, como `game.concede`, sin alterar `backgroundName` ni `sleevesName`.

`game.close` no introduce `GameSnapshot.status`: el estado top-level de cierre pertenece al modelo `Game`, no al snapshot de gameplay. El patch de cierre transporta el cambio minimo aplicable al snapshot, normalmente `eventLog.append`; cualquier sincronizacion de estado top-level fuera del snapshot debe resolverse fuera de este contrato.

`turn.set` y `timer.set` evitan pedir snapshot completo para cambios de turno o temporizador. `timer.set` existe porque `timer` forma parte del `GameSnapshot` actual.

Si una accion nueva no encaja, se anade una operacion de dominio nueva en vez de usar `unknown`, JSON Pointer o paths genericos.

## Versiones Y Resync

- `game_patch.version` es monotonica y representa estado aplicado real.
- Si `patch.version <= snapshot.version`, el patch es duplicado/tardio y se ignora.
- Si `patch.baseVersion !== snapshot.version`, hay gap o divergencia y se pide resync.
- Si `patch.version !== snapshot.version + 1`, se pide resync aunque `baseVersion` coincida.
- Solo se aplica si `patch.baseVersion === snapshot.version` y `patch.version === snapshot.version + 1`.
- No se permiten saltos de version por ahora. Batches/replay se disenaran explicitamente si hacen falta.
- El resync usa el mismo snapshot/bootstrap completo y proyectado que el flujo actual.
- Reconnect al runtime usa `lastAppliedVersion`. `lastSeenVersion` queda reservado al WebSocket PHP legacy y no debe enviarse en `runtime_ws`.

## Privacidad

Los mensajes servidor -> cliente deben mantener la proyeccion actual por jugador:

- mano, biblioteca, cartas ocultas y cartas boca abajo no deben filtrar informacion privada;
- las cartas boca abajo siguen dependiendo de las sleeves del owner;
- la biblioteca oculta sigue usando las sleeves del jugador de la pila;
- si el servidor no puede generar un patch privado seguro, debe enviar `resync_required` en lugar del patch.
