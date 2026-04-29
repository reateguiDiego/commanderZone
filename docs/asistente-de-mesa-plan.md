Contenido del documento:

# CommanderZone — Plan de implementación: Asistente de Mesa

## 1. Contexto del producto

CommanderZone es una aplicación web para jugar partidas de Commander/EDH.

La app tendrá dos grandes contextos:

1. Partidas online dentro de la propia web.
2. Herramientas auxiliares para partidas físicas o híbridas.

La feature descrita en este documento se llama:

**Asistente de Mesa**

Asistente de Mesa es una herramienta para mejorar la calidad de vida en partidas físicas o híbridas de Commander. Permite crear una sala compartida donde uno o varios móviles pueden seguir la partida de forma sincronizada:

- vidas;
- daño de comandante;
- orden de turnos;
- fases;
- temporizadores;
- trackers configurables;
- enlace/código de sala;
- invitación de amigos de CommanderZone.

La plataforma ya tiene sistema de usuarios/amigos. Esta feature debe reutilizarlo. No debe crear un sistema de amigos nuevo.

---

## 2. Objetivo de la feature

La feature debe permitir:

- mostrar una pantalla de introducción clara y atractiva;
- explicar al usuario qué es Asistente de Mesa y por qué le ayuda;
- iniciar una partida desde un CTA claro;
- abrir modal o pantalla de configuración al iniciar;
- crear una sala;
- elegir modo de uso;
- configurar jugadores;
- configurar vida inicial;
- controlar vidas;
- controlar daño de comandante;
- configurar orden de turnos;
- pasar turno;
- activar o desactivar fases;
- configurar temporizador por fase si las fases están activadas;
- desactivar fases y usar temporizador general por turno de jugador;
- activar o desactivar trackers desde configuración;
- compartir sala mediante enlace/código;
- invitar amigos de la plataforma usando el sistema existente;
- permitir uso con un único dispositivo;
- permitir uso con un dispositivo por jugador;
- preparar frontend y backend para reutilizar piezas en el futuro juego online de CommanderZone.

---

## 3. Principios de producto

La feature debe ayudar realmente durante una partida física o híbrida.

No debe sentirse como:

- panel administrativo;
- formulario gigante;
- contador genérico sin valor;
- herramienta pesada;
- flujo que interrumpe la partida.

Cada decisión de UI debe responder:

> ¿Esto hace que la partida sea más fácil, más rápida o más clara?

Prioridades:

- mobile-first real;
- botones grandes;
- vida muy visible;
- jugador activo claro;
- pasar turno fácil;
- fases visibles solo si están activadas;
- temporizador visible pero no invasivo;
- trackers visibles solo si están activados;
- daño de comandante accesible sin tablas inmanejables;
- configuración moderna, visual y entendible;
- compartir sala fácil;
- invitar amigos sin bloquear el flujo principal;
- cero scroll horizontal en móvil;
- evitar modales enormes;
- evitar pantallas saturadas.

---

## 4. Pantalla de introducción

Debe existir una pantalla, sección o componente de entrada para **Asistente de Mesa**.

No debe ser una landing genérica. Debe explicar en pocos segundos:

- para qué sirve;
- cuándo usarla;
- qué problemas resuelve;
- que puede usarse con un solo dispositivo o con un móvil por jugador;
- que puede controlar vidas, turnos, daño de comandante, fases, timers y trackers;
- que puede compartirse por enlace/código;
- que puede invitar amigos de CommanderZone;
- que no sustituye la partida, la hace más cómoda.

### Textos recomendados

#### Título principal

**Asistente de Mesa**

#### Subtítulo

**Controla tu partida física de Commander sin interrumpir el juego.**

#### Descripción principal

Crea una sala para seguir vidas, daño de comandante, turnos, fases, temporizadores y trackers desde un único dispositivo en la mesa o desde el móvil de cada jugador.

#### Texto de valor

Menos cuentas, menos dudas y menos interrupciones. Tú juega la partida; CommanderZone mantiene la mesa ordenada.

### Bloques de beneficios

#### 1. Vidas siempre claras

Actualiza vidas rápido con controles grandes pensados para usar durante la partida.

#### 2. Turnos y fases bajo control

Marca el jugador activo, pasa turno y activa fases solo si tu mesa las necesita.

#### 3. Daño de comandante sin líos

Registra el daño recibido de cada comandante y detecta amenazas letales de un vistazo.

#### 4. Uno o varios móviles

Usad un único dispositivo en el centro de la mesa o conectad un móvil por jugador.

#### 5. Invita a tus amigos

Comparte la sala con un enlace, un código o invita directamente a tus amigos de CommanderZone.

#### 6. Trackers configurables

Activa solo lo que necesitas: veneno, commander tax, energía, experiencia, monarch, initiative, storm y más.

#### 7. Temporizadores flexibles

Juega sin timer, con temporizador por turno o con temporizador por fase.

### CTA principal

**Empezar partida**

### CTA secundario opcional

**Ver cómo funciona**

### Texto de ayuda cerca del CTA

Puedes empezar con valores por defecto y ajustar la configuración antes de crear la sala.

### Comportamiento del CTA

El botón **Empezar partida** debe abrir el modal de configuración o navegar a la pantalla de configuración, según encaje mejor con la arquitectura actual del proyecto.

Reglas:

- si el proyecto usa modales de forma consistente, usar modal;
- si el proyecto prefiere pantallas/rutas para configuración, usar pantalla;
- no forzar modal si no encaja;
- no forzar ruta nueva si no encaja.

---

## 5. Configuración visual moderna

La configuración debe sentirse como un asistente moderno, no como un formulario plano.

Usar patrones como:

- cards seleccionables;
- toggles claros;
- switches modernos;
- secciones agrupadas;
- chips/tags para trackers;
- selector/buscador de amigos si ya existe;
- stepper si encaja;
- acordeones para opciones avanzadas;
- previews de configuración;
- resumen final antes de crear sala si no añade fricción.

La configuración debe tener valores por defecto sensatos para que el usuario pueda empezar rápido.

No debe obligar a rellenar todo.

---

## 6. Bloques de configuración

### 6.1. Modo de uso

Mostrar dos cards seleccionables:

1. **Un dispositivo en la mesa**
2. **Un móvil por jugador**

#### Card: Un dispositivo en la mesa

Título:

**Un dispositivo en la mesa**

Descripción:

Usa un móvil o tablet compartido para controlar toda la partida desde el centro de la mesa.

Ideal para:

Partidas rápidas, casuales o mesas que no quieren conectarse.

#### Card: Un móvil por jugador

Título:

**Un móvil por jugador**

Descripción:

Cada jugador se conecta a la sala y controla su propio panel mientras todo se mantiene sincronizado.

Ideal para:

Partidas largas, grupos organizados o mesas que quieren menos errores.

---

### 6.2. Jugadores

Debe permitir:

- número de jugadores;
- nombres;
- colores o identificadores visuales;
- orden de turno.

Debe poder autogenerar nombres por defecto:

- Jugador 1;
- Jugador 2;
- Jugador 3;
- Jugador 4.

No obligar a rellenar todo para empezar.

---

### 6.3. Invitaciones y amigos

CommanderZone ya tiene sistema de usuarios/amigos.

Debe permitir:

- buscar amigos si ya existe buscador;
- seleccionar amigos de la lista de amigos;
- invitar uno o varios amigos a la sala;
- crear sala sin invitar amigos;
- invitar amigos después de crear sala si encaja;
- combinar invitaciones con enlace/código.

Texto sugerido:

**Invita amigos de CommanderZone o comparte el enlace para que se unan desde su móvil.**

La invitación de amigos debe ser una mejora, no una barrera.

No debe ser obligatorio invitar amigos para crear sala.

Estados visuales recomendados:

- amigo seleccionado;
- invitación pendiente;
- invitación enviada;
- amigo conectado;
- jugador asignado a asiento;
- invitación rechazada;
- invitación expirada.

---

### 6.4. Reglas de mesa

Usar toggles claros:

- daño de comandante;
- fases;
- temporizador;
- saltar jugadores eliminados;
- permitir que todos editen todo, solo como opción avanzada;
- trackers adicionales.

---

### 6.5. Temporizador

El temporizador depende de si las fases están activadas o no.

Si las fases están desactivadas, mostrar:

- sin temporizador;
- temporizador por turno.

Si las fases están activadas, mostrar:

- sin temporizador;
- temporizador por turno;
- temporizador por fase.

El temporizador por fase no debe estar disponible como opción activa si las fases están desactivadas.

---

### 6.6. Trackers

Mostrar trackers como chips/toggles visuales.

Trackers esperados:

- daño de comandante;
- veneno;
- commander tax;
- energía;
- experiencia;
- monarch;
- initiative;
- storm;
- custom si no complica el MVP.

Reglas:

- el usuario activa o desactiva trackers desde configuración;
- durante la partida solo se muestran trackers activos;
- trackers de jugador aparecen en el panel del jugador;
- trackers globales aparecen como estado global de mesa;
- daño de comandante tiene tratamiento especial.

---

### 6.7. Resumen de configuración

Antes de crear sala, si no añade fricción, mostrar resumen compacto:

- modo elegido;
- número de jugadores;
- vida inicial;
- fases on/off;
- temporizador;
- trackers activos;
- amigos invitados;
- permisos principales.

CTA final:

**Crear sala**

Texto secundario:

Podrás ajustar algunos detalles durante la partida.

---

## 7. Modos de uso

### 7.1. Modo: Un dispositivo en la mesa

Un único dispositivo se usa en el centro de la mesa.

Debe ser rápido, visual y sencillo.

Reglas:

- setup mínimo;
- todos pueden editar todo;
- sin permisos complejos;
- compartir sala no obligatorio;
- invitación de amigos opcional pero no necesaria;
- vidas grandes;
- turnos claros;
- daño de comandante accesible;
- fases opcionales;
- temporizador opcional;
- trackers opcionales;
- undo rápido.

Evitar:

- configuración excesiva;
- tablas complejas;
- permisos por jugador;
- navegación profunda;
- modales grandes;
- fases activadas por defecto;
- temporizador por fase como opción principal si las fases están desactivadas.

Defaults:

- 4 jugadores;
- 40 vidas;
- daño de comandante activado;
- turnos activados;
- fases desactivadas;
- temporizador desactivado;
- todos pueden editar todo;
- sin permisos;
- sin unión por QR obligatoria;
- trackers adicionales desactivados salvo básicos necesarios.

---

### 7.2. Modo: Un móvil por jugador

Cada jugador puede usar su móvil conectado a la sala.

Debe permitir experiencia personalizada y sincronizada.

Reglas:

- host crea sala;
- jugadores se unen por enlace/código;
- host puede invitar amigos de CommanderZone;
- jugadores invitados pueden entrar desde invitación si el sistema actual lo permite;
- cada jugador controla su panel por defecto;
- cada jugador controla su vida por defecto;
- host puede editar todo;
- viewer opcional;
- compartir sala esencial;
- permisos simples;
- sincronización realtime o preparada;
- reconexión preparada;
- turno/timer/fases sincronizados.

Defaults:

- 4 jugadores;
- 40 vidas;
- daño de comandante activado;
- turnos activados;
- fases desactivadas;
- temporizador desactivado;
- host crea sala;
- jugadores se unen por enlace/código;
- cada jugador controla su panel;
- host puede editar todo;
- trackers adicionales desactivados salvo básicos necesarios.

---

## 8. Compartir sala e invitar jugadores

La feature debe permitir compartir una sala de varias formas, especialmente en modo **Un móvil por jugador**.

Debe soportar:

- compartir mediante enlace;
- compartir mediante código corto;
- copiar enlace de invitación;
- mostrar código de sala;
- preparar QR si encaja con arquitectura/dependencias actuales;
- invitar amigos usando sistema de amigos existente.

### Invitaciones de amigos

CommanderZone ya tiene sistema de usuarios/amigos creado.

Hay que inspeccionarlo y reutilizarlo.

Debe permitir:

- buscar o seleccionar amigos desde configuración o sala;
- invitar amigos a sala;
- mostrar estado básico de invitación si backend lo soporta:
  - pendiente;
  - aceptada;
  - rechazada;
  - expirada;
- reenviar invitación si encaja;
- cancelar invitación si encaja;
- crear sala sin invitar amigos;
- compartir enlace/código aunque existan invitaciones;
- asociar invitados a asientos/jugadores si el flujo lo permite;
- permitir que host reasigne asiento.

No hacer:

- no crear sistema de amigos nuevo;
- no duplicar entidades o servicios de amigos;
- no bloquear MVP si alguna parte avanzada no está disponible;
- no convertir creación de sala en proceso obligatorio de selección de amigos.

Texto sugerido:

**Comparte el enlace, muestra el código de sala o invita amigos de CommanderZone para que se unan desde su móvil.**

---

## 9. Fases y temporizador

### 9.1. Fases desactivadas

- no mostrar navegación por fases;
- control principal: pasar turno;
- puede usarse temporizador general por turno de jugador.

### 9.2. Fases activadas

- mostrar fase actual;
- permitir pasar fase;
- al terminar última fase, pasar al siguiente jugador/turno;
- permitir temporizador por fase.

Fases base:

- untap;
- upkeep;
- draw;
- main-1;
- combat;
- main-2;
- end.

Opciones de temporizador:

- none;
- general por turno de jugador;
- por fase solo si fases están activadas.

No mostrar timer por fase como opción activa si fases están desactivadas.

---

## 10. Trackers

Todos los trackers deben activarse/desactivarse desde configuración.

Trackers:

- daño de comandante;
- veneno;
- commander tax;
- energía;
- experiencia;
- monarch;
- initiative;
- storm;
- custom si no complica MVP.

Reglas:

- no mostrar trackers desactivados durante partida;
- trackers de jugador en panel de jugador;
- trackers globales como monarch/initiative/storm en zona global de mesa;
- daño de comandante con tratamiento especial;
- si un tracker complica demasiado el MVP, dejar modelo preparado y explicarlo.

---

## 11. Permisos

### Modo un dispositivo

- todos pueden editar todo.

### Modo un móvil por jugador

- host puede editar todo;
- player controla su panel;
- player controla su vida;
- viewer solo visualiza si existe;
- opción avanzada: todos pueden editar todo.

Invitar amigos no debe saltarse reglas de sala.

En modo **Un móvil por jugador**:

- host puede invitar amigos;
- invitado puede unirse como player o viewer según configuración;
- host puede asignar o reasignar asiento;
- cada jugador controla su panel;
- host puede editar todo.

---

## 12. Undo y corrección de errores

La feature debe priorizar corregir errores rápido.

Añadir o dejar preparada acción de **Deshacer última acción**.

No pedir confirmación para acciones frecuentes:

- +1 vida;
- -1 vida;
- +5 vida;
- -5 vida;
- pasar turno;
- pasar fase;
- modificar daño de comandante.

Usar undo para corregir errores normales.

Sí pedir confirmación para:

- resetear partida;
- cerrar sala;
- eliminar jugador;
- cambiar configuración importante durante la partida.

---

## 13. Reglas técnicas frontend

Usar Angular moderno y convenciones actuales del proyecto.

Reglas:

- seguir arquitectura existente;
- no crear arquitectura paralela;
- usar standalone components si el proyecto ya los usa o encaja;
- usar ChangeDetectionStrategy.OnPush salvo razón clara;
- usar Signals/computed si encaja y aporta claridad;
- usar effect solo si está justificado;
- usar @if, @for y @switch si la versión lo soporta;
- separar HTML en archivos .html;
- separar estilos en archivos .scss o formato actual del proyecto;
- no usar templates inline grandes;
- no usar estilos inline;
- no usar any salvo justificación clara;
- no meter lógica compleja en templates;
- no llamar funciones pesadas desde templates;
- no generar componentes gigantes;
- no generar ficheros enormes;
- no mezclar timer, sync, UI, amigos, invitaciones y estado en un único componente;
- reutilizar componentes existentes de usuarios/amigos si existen;
- no duplicar lógica de búsqueda/listado/invitación de amigos.

---

## 14. Reglas técnicas backend

Usar backend/lenguaje/framework existente.

Reglas:

- seguir arquitectura actual;
- no inventar backend paralelo;
- no añadir tecnologías nuevas salvo necesidad justificada;
- si no hay backend suficiente, proponer solución mínima coherente antes de crearla;
- backend sincroniza acciones, no pantallas;
- no meter reglas completas de Magic;
- backend mantiene estado de sala, permisos, acciones, turnos, fases, timers, trackers, invitaciones y sincronización;
- reutilizar sistema existente de usuarios/amigos;
- no crear otro modelo de amistad;
- no crear otro sistema de usuarios;
- no crear invitaciones sociales paralelas si ya existe mecanismo de invitación/notificación.

---

## 15. Reutilización futura

Preparar piezas comunes para futuras partidas online:

- sala;
- jugador;
- participante/dispositivo;
- roles;
- turnos;
- fases;
- temporizador;
- trackers;
- daño de comandante;
- acciones;
- versionado de estado;
- sincronización realtime;
- invitaciones a sala;
- reconexión/state sync;
- helpers puros de avance turno/fase;
- lógica de temporizador.

No acoplar todo a Asistente de Mesa si una pieza representa lógica común de partida.

---

## 16. Plan obligatorio por fases

### FASE 0 — Auditoría y plan

Objetivo:

Inspeccionar proyecto y proponer integración.

Debe entregar:

- resumen de arquitectura frontend actual;
- resumen de arquitectura backend actual;
- resumen de sistema de usuarios/amigos;
- convenciones detectadas;
- dónde integrar feature y por qué;
- cómo reutilizar sistema de amigos;
- piezas comunes/reutilizables;
- piezas específicas de Asistente de Mesa;
- plan de fases ajustado al proyecto real.

No implementar código salvo necesidad mínima de exploración.

---

### FASE 1 — Modelado común y contratos

Objetivo:

Crear/adaptar modelos/types/contratos mínimos.

Debe cubrir:

- modo de uso;
- sala;
- jugador;
- participante/dispositivo;
- usuario/amigo invitado usando contratos existentes cuando sea posible;
- invitación a sala;
- estado de invitación;
- rol;
- permisos;
- vida;
- turnos;
- fases;
- temporizador;
- trackers;
- daño de comandante;
- acciones;
- versionado de estado.

Debe dejar claro:

- qué se reutilizará en partidas online;
- qué es específico de Asistente de Mesa;
- qué contratos se integran con usuarios/amigos.

Tests de lógica pura si aplica:

- defaults de sala Commander;
- fases disponibles;
- modos de temporizador válidos;
- trackers activos/inactivos;
- permisos básicos;
- estados básicos de invitación si hay lógica propia.

No crear UI grande.
No crear backend complejo.
No crear sistema de amigos nuevo.

---

### FASE 2 — Estado local/reducers/helpers de dominio

Objetivo:

Implementar lógica central de estado testeable.

Debe incluir:

- crear estado inicial según modo;
- aplicar cambio de vida;
- registrar daño de comandante;
- detectar daño comandante letal;
- pasar turno respetando orden;
- saltar eliminados si setting activa;
- pasar fase si fases activas;
- impedir pasar fase si fases desactivadas;
- transición última fase -> siguiente turno;
- gestionar trackers activos;
- preparar undo/action log si encaja;
- preparar asignación participante/amigo a jugador/asiento si encaja.

Tests mínimos:

- crea sala con 40 vidas;
- crea modo un dispositivo;
- crea modo un móvil por jugador;
- cambia vida;
- registra commander damage;
- detecta 21 commander damage;
- pasa turno;
- salta eliminados;
- pasa fase;
- no pasa fase si fases desactivadas;
- muestra/oculta trackers según configuración;
- asigna participante a jugador si aplica.

---

### FASE 3 — Backend mínimo de salas, acciones e invitaciones

Objetivo:

Implementar soporte backend siguiendo arquitectura existente.

Debe incluir:

- crear sala;
- obtener sala;
- unirse a sala;
- asignar dispositivo/participante a jugador si aplica;
- aplicar acciones;
- versionar estado;
- clientActionId para idempotencia;
- validaciones mínimas;
- persistencia según infraestructura existente o almacenamiento temporal encapsulado;
- integración con sistema existente de amigos para invitar amigos a sala.

No implementar realtime complejo si no existe, pero dejarlo preparado.

Invitaciones backend:

- usar sistema de amigos/usuarios existente;
- invitar amigo a sala;
- aceptar invitación;
- rechazar invitación;
- listar invitaciones pendientes;
- asociar invitación con roomId;
- asociar invitación con invitedUserId;
- asociar invitación con invitedByUserId;
- asociar invitación con estado;
- expirar invitaciones si aplica.

Si existe sistema genérico de invitaciones/notificaciones, reutilizarlo.

Tests mínimos:

- crea sala;
- obtiene sala;
- une participante;
- asigna jugador;
- aplica acción de vida;
- impide acción inválida;
- incrementa version;
- no duplica acción con mismo clientActionId;
- respeta permisos básicos;
- invita amigo existente a sala;
- no invita usuario que no sea amigo si esa es regla actual;
- lista invitaciones pendientes si aplica;
- acepta/rechaza invitación si aplica;
- no duplica invitación pendiente.

---

### FASE 4 — Intro de feature y setup frontend

Objetivo:

Crear entrada de menú, pantalla introductoria y flujo de configuración.

Debe incluir:

- opción de menú "Asistente de Mesa";
- pantalla/componente de intro;
- textos explicativos;
- cards de beneficios;
- CTA "Empezar partida";
- CTA opcional "Ver cómo funciona";
- al pulsar CTA, abrir modal o navegar a configuración según patrón del proyecto;
- selección de modo:
  - un dispositivo en la mesa;
  - un móvil por jugador;
- cards seleccionables para modos;
- defaults según modo;
- configuración de jugadores;
- vida inicial;
- orden de turnos;
- invitar amigos usando sistema existente;
- compartir por enlace/código;
- activar/desactivar fases;
- configurar temporizador:
  - none;
  - general por turno;
  - por fase solo si fases activas;
- activar/desactivar trackers con chips/toggles;
- opciones avanzadas agrupadas;
- configuración moderna, clara y bonita;
- evitar formulario largo y plano.

Tests mínimos:

- aparece menú;
- muestra descripción;
- aparece intro;
- muestra CTA "Empezar partida";
- CTA abre/navega a configuración;
- permite elegir modo;
- aplica defaults;
- no permite timer por fase si fases desactivadas;
- muestra trackers configurables;
- muestra copiar enlace/código;
- muestra invitar amigos;
- permite seleccionar amigos si existe componente/servicio.

---

### FASE 5 — Sala frontend: vidas, turnos y modo local

Objetivo:

Crear pantalla principal funcional sin depender de realtime complejo.

Debe incluir:

- paneles de jugador;
- vida grande;
- +1/-1/+5/-5;
- edición manual de vida;
- jugador activo;
- número de turno;
- pasar turno;
- volver turno si es sencillo;
- marcar/restaurar eliminado;
- compartir enlace/código;
- ver estado básico de amigos invitados/conectados si está disponible;
- comportamiento por modo:
  - un dispositivo: todos editan todo;
  - un móvil por jugador: cada jugador controla su panel, host todo.

UX:

- mobile-first real;
- botones grandes;
- sin scroll horizontal;
- jugador activo visible;
- pantalla principal no parece formulario.

Tests:

- modifica vida;
- respeta permisos;
- pasa turno;
- salta eliminados;
- identifica jugador activo;
- copia enlace;
- muestra código;
- muestra invitaciones si existen.

---

### FASE 6 — Fases y temporizador

Objetivo:

Añadir fases y temporizador sin ensuciar componentes.

Debe incluir:

- fases opcionales;
- mostrar fase solo si activada;
- pasar fase;
- transición última fase -> siguiente turno;
- temporizador none;
- temporizador general por turno;
- temporizador por fase;
- pause/resume/reset;
- limpiar intervalos;
- lógica encapsulada fuera de componentes visuales.

Backend:

- persistir/modelar timer;
- actualizar timer al pasar turno/fase;
- no permitir timer por fase si fases desactivadas.

Tests:

- no muestra fases si off;
- pasa fase si on;
- timer general por turno;
- timer por fase;
- pause/resume/reset;
- no permite timer por fase sin fases.

---

### FASE 7 — Daño de comandante y trackers

Objetivo:

Añadir tracking avanzado sin saturar UI.

Debe incluir:

- panel de daño de comandante accesible;
- daño recibido por jugador desde oponentes;
- alerta al llegar a 21;
- trackers activados/desactivados desde configuración;
- mostrar solo trackers activos;
- trackers de jugador en panel jugador;
- trackers globales en zona global;
- custom tracker solo si no complica.

Tests:

- commander damage;
- lethal commander damage;
- tracker desactivado no visible;
- tracker activado visible;
- modifica tracker activo;
- no modifica tracker desactivado si esa es regla elegida.

---

### FASE 8 — Sincronización realtime, invitaciones o preparación final

Objetivo:

Conectar o dejar preparada sincronización entre dispositivos e invitaciones.

Debe incluir:

- capa sync frontend;
- capa realtime backend si arquitectura lo permite;
- eventos join/leave/dispatch action/request state;
- eventos room state/action applied/participant joined/participant left/sync error;
- eventos de invitación si sistema existente lo permite:
  - friend invited;
  - invitation accepted;
  - invitation declined;
  - invitation expired;
- reconexión/state sync preparada;
- room version;
- participants presence si encaja;
- estado de amigos invitados/conectados.

Si no se implementa realtime real:

- explicar limitación;
- dejar contratos claros;
- mantener mock/local separado;
- no acoplar UI a mock.

Tests:

- dispatch action;
- recibe state update si hay realtime/mock;
- reconexión/request state sync si aplica;
- invita amigo si backend lo soporta;
- actualiza estado invitación si backend lo soporta.

---

### FASE 9 — Responsive polish, accesibilidad y hardening

Objetivo:

Asegurar que feature ayuda al jugador y se ve bien en móvil.

Debe revisar:

- móvil estrecho;
- móvil grande;
- tablet;
- desktop;
- sin scroll horizontal;
- botones grandes;
- vida legible;
- jugador activo claro;
- temporizador visible pero no invasivo;
- daño comandante sin tabla inmanejable;
- trackers sin saturar;
- invitaciones visibles pero no invasivas;
- compartir enlace/código fácil;
- opciones avanzadas no bloquean uso;
- pantalla intro clara y atractiva;
- CTA visible;
- configuración moderna;
- labels accesibles;
- feedback visual claro;
- confirmaciones solo donde toca;
- undo preparado o implementado.

Debe corregir:

- componentes demasiado grandes;
- templates complejos;
- lógica duplicada;
- estado duplicado;
- servicios con demasiadas responsabilidades;
- estilos frágiles;
- UI móvil pobre;
- integración de amigos duplicada o mal acoplada.

---

## 17. Criterios finales frontend

- aparece "Asistente de Mesa";
- hay pantalla intro clara;
- la intro explica problema y valor;
- hay CTA "Empezar partida";
- CTA abre modal o pantalla de configuración;
- configuración moderna con cards, toggles, chips o componentes claros;
- dos modos de uso;
- setup rápido;
- vidas funcionales;
- cada jugador controla su vida por defecto en modo varios dispositivos;
- host puede corregir todo;
- turnos funcionales;
- fases opcionales;
- timer general por turno;
- timer por fase solo con fases activas;
- trackers configurables;
- solo se muestran trackers activos;
- daño comandante funcional;
- compartir por enlace/código;
- invitar amigos usando sistema existente;
- invitaciones no bloquean creación de sala;
- UI mobile-first real;
- sin componentes gigantes;
- sin templates inline grandes;
- sin lógica compleja en HTML;
- tests relevantes pasan;
- build pasa.

---

## 18. Criterios finales backend

- crea sala;
- obtiene sala;
- une dispositivos;
- asigna participante a jugador;
- aplica acciones;
- estado versionado;
- idempotencia con clientActionId;
- permisos básicos;
- timer modelado;
- fases/timer validados;
- trackers configurables;
- integración con sistema de amigos existente;
- invita amigos a sala;
- gestiona estado básico de invitación si backend actual lo permite;
- no duplica sistema de amigos;
- sync realtime implementada o preparada;
- persistencia implementada o encapsulada;
- tests relevantes pasan;
- build pasa.

---

## 19. Entrega final global

Al final de todas las fases, resumir:

1. Arquitectura frontend seguida.
2. Arquitectura backend seguida.
3. Cómo se ha reutilizado sistema de amigos.
4. Archivos creados.
5. Archivos modificados.
6. Endpoints/handlers/eventos añadidos.
7. Cómo funciona estado.
8. Cómo funciona sincronización.
9. Cómo funcionan invitaciones.
10. Cómo funciona persistencia.
11. Qué partes son específicas de Asistente de Mesa.
12. Qué partes quedan preparadas para juego online.
13. Qué está mockeado.
14. Qué limitaciones quedan.
15. Riesgos técnicos pendientes.
16. Tests ejecutados y resultado.
17. Build ejecutado y resultado.

---

## 20. Revisión antes de entregar cada fase

Antes de entregar cada fase, revisar como arquitecto responsable de aprobar PR.

No entregar si hay:

- código spaghetti;
- componente gigante;
- fichero enorme;
- template con lógica compleja;
- estado duplicado;
- servicio con demasiadas responsabilidades;
- backend acoplado a UI;
- frontend acoplado a mock/localStorage;
- timer metido en componente visual;
- trackers hardcodeados sin configuración;
- permisos mezclados caóticamente;
- responsive pobre;
- botones pequeños;
- pantalla saturada;
- intro poco clara;
- configuración fea o difícil de entender;
- sistema de amigos duplicado;
- sistema de invitaciones paralelo innecesario;
- reglas completas de Magic innecesarias.

Si se detecta algo de esto, refactorizar antes de finalizar la fase.


- nse si lo has hecho ya, pero borra todo lo relacionado con la calavera que has creado tu y deja solo la skull de assets. 
- pon un icono adiente a la opcion del menu asistente de mesa
- en el select de colores, de cada jugador añade los simbolos de mana correspondientes, nombre a la izquierda del todo y colores a la derecha del todo. 
- los gradientes de color no funcionan nada, esta todo amarillo y blanco. Funciona fatal actualmente
- el nombre del jugador se ve la g partida, no se ve la parte de abajo, arreglalo porfavor
- los botones de + y - al lado de la vida, los simbolos no estan centrados del todo. Falta o sobre margin o padding top
- elimina el boton volver turno y el turno 3 añadelo justo encima del temporizador, en pequeño.