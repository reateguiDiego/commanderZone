# Asistente de Mesa - Auditoria y plan ajustado

## FASE 0 - Auditoria

### Arquitectura frontend actual

- Aplicacion Angular 21 bajo `frontend/`.
- Componentes standalone con `ChangeDetectionStrategy.OnPush`.
- Estado local de UI con signals y stores por feature cuando hay coordinacion.
- HTTP centralizado en `src/app/core/api`.
- Modelos de contratos API en `src/app/core/models`.
- Features en `src/app/features/*`.
- Tests con Vitest mediante `ng test`.
- Rutas protegidas dentro de `DashboardShellComponent`.

### Arquitectura backend actual

- Backend Symfony 8 bajo `backend/`.
- Entidades de dominio en `src/Domain`.
- Casos de aplicacion en `src/Application`.
- Controladores HTTP en `src/UI/Http`.
- Persistencia Doctrine ORM.
- Realtime ya existe para partidas online mediante Mercure (`GameEventPublisher`).
- Tests PHPUnit para dominio e integracion.

### Sistema existente de usuarios, amigos e invitaciones

- Usuarios: `App\Domain\User\User` en backend y `User` en frontend.
- Amigos: `Friendship` backend y `Friendship`, `FriendUser`, `FriendSearchResult` en frontend.
- API de amigos existente:
  - listar amigos aceptados;
  - buscar usuarios;
  - enviar, aceptar, rechazar y cancelar solicitudes;
  - eliminar amigos.
- Invitaciones de sala existentes:
  - `RoomInvite` backend;
  - `RoomInvite` frontend;
  - solo se puede invitar a amigos aceptados;
  - evita invitarse a uno mismo;
  - evita invitar usuarios ya presentes;
  - reutiliza `Room` y `RoomPlayer`.

### Convenciones detectadas

- Tipos y contratos simples con union types.
- Servicios Angular con `inject`.
- Stores por feature cuando el estado coordina varias acciones.
- Plantillas y estilos separados en componentes.
- No hay NgRx ni arquitectura global adicional.
- Los comandos de juego online se modelan como acciones sobre snapshots.

### Integracion propuesta

- Crear la feature `features/table-assistant`.
- Mantener modelos y helpers de dominio puros en la feature.
- Reutilizar tipos existentes de amigos e invitaciones:
  - `FriendUser` para amigos seleccionables;
  - `RoomInviteStatus` como base de estados de invitacion.
- No crear APIs ni entidades backend nuevas hasta FASE 3.
- No crear UI hasta FASE 4.

### Piezas comunes reutilizables

- Sala/estado versionado.
- Participantes, roles y permisos.
- Jugadores/asientos.
- Turnos y fases.
- Timer modelado como contrato, sin intervalos en estas fases.
- Trackers configurables.
- Acciones de dominio e historial para undo.
- Asignacion de participante/amigo a jugador.

### Piezas especificas de Asistente de Mesa

- Modo de uso:
  - un dispositivo en la mesa;
  - un movil por jugador.
- Defaults de Commander fisico/hibrido.
- Configuracion de mesa auxiliar.
- Codigo/enlace de sala como contrato de compartir.

## Plan de fases ajustado al proyecto real

- FASE 1: contratos frontend puros en `features/table-assistant/models`.
- FASE 2: reducer/helpers puros testeados en `features/table-assistant/domain`.
- FASE 3: extender backend existente de salas/acciones/invitaciones, sin duplicar amigos.
- FASE 4: anadir ruta/menu y setup UI reutilizando `FriendsStore`, `FriendsApi` y `RoomsApi`.
- FASE 5+: construir pantalla de sala sobre los helpers, no sobre estado disperso en componentes.

