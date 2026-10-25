# Captura SQL del detalle de un mazo

La reproducción CLI puede calentar buffers antes de EXPLAIN. Para localizar un pico que solo aparece en HTTP, la API admite una captura temporal por consulta en `GET /decks/by-slug/{slug}`.

## Activación tras desplegar

### Varios mazos de un usuario (recomendado para primeras aperturas)

Configurar estas variables en el `.env.prod` utilizado por el despliegue:

```dotenv
DECK_DETAIL_SQL_PROFILE_SLUG=
DECK_DETAIL_SQL_PROFILE_USER_ID=UUID_DEL_USUARIO
DECK_DETAIL_SQL_PROFILE_UNTIL=TIMESTAMP_UNIX_DE_CADUCIDAD
```

El UUID es `user.id` de la respuesta autenticada `GET /me`; no es el correo ni el token. Generar la caducidad justo antes de recrear la API: en el servidor Linux, `date -u -d '+30 minutes' +%s`. Copiar ese número a `DECK_DETAIL_SQL_PROFILE_UNTIL` y recrear únicamente la API con los mismos archivos Compose y límites del despliegue habitual.

Este modo tiene prioridad sobre el slug antiguo, incluso cuando la ventana ha caducado o agotado sus muestras. Una configuración incompleta no activa la captura. Solo perfila las peticiones de ese usuario autenticado a `/decks/by-slug/{slug}`; no concede acceso a mazos ajenos.

Límite: **40 peticiones por ventana y contenedor API**, compartidas por sus workers mediante un contador con bloqueo de fichero, y hasta 64 consultas por petición. Se detiene automáticamente cuando llega la caducidad o se consume el cupo. El contador vive en `kernel.cache_dir`: limpiar esa caché o recrear el contenedor puede reiniciar el cupo, pero no amplía la fecha de caducidad. En varias réplicas el cupo es por réplica. No hacer esas operaciones durante la captura. Si no puede escribir el contador, no perfila.

Abrir entre 5 y 10 mazos distintos durante navegación normal. Para cada uno, registrar la primera apertura observada y una segunda apertura inmediata, manteniendo el idioma. No vaciar cachés. Una primera apertura observada no garantiza buffers fríos en el servidor.

Los eventos incluyen `sql_profile_deck`, el SHA-256 del slug, para agrupar ambos accesos sin guardar nombres de mazos ni el identificador del usuario. `request_id` permite cruzarlos con Network. El log no etiqueta automáticamente una petición como fría o caliente: anotar el orden de navegación.

Al terminar, dejar las tres variables vacías y aplicar la configuración habitual. No se realizan cambios en producción desde este repositorio automáticamente.

### Un único slug (modo anterior)

Configurar `DECK_DETAIL_SQL_PROFILE_SLUG=deck-panoramix-commander-10e95bda` en el entorno utilizado por el despliegue de Compose. El servicio `api` transmite esta variable; por defecto está vacía y no captura consultas individuales. Aplicar el cambio mediante el procedimiento habitual de despliegue/recreación de la API, conservando todos sus archivos Compose y límites. Un simple `docker exec -e` no cambia el entorno del servidor HTTP que ya está ejecutándose.

Abrir ese mismo mazo de tres a cinco veces con su propietario desde el navegador. Anotar el `request_id` de la petición lenta. No es necesario ejecutar carga ni vaciar cachés. También se siguen registrando las etapas agregadas `deck.load`, `deck.preload`, `deck.serialize` y `deck.localize`.

Recoger los eventos existentes `http_request_completed` de la API con `route=app_ui_http_decks_showbyslug`. Los eventos del mazo seleccionado incorporan `sql_profile`; la captura no añade un endpoint ni modifica el JSON devuelto al navegador. Los permisos de lectura habituales siguen siendo necesarios.

Volver a dejar la variable vacía y aplicar el mismo procedimiento de despliegue al terminar. La captura permanece activa para ese slug hasta desactivarla, con un máximo de 64 ejecuciones por petición y un contador `sql_profile_dropped` para detectar truncamientos.

## Interpretación

- `sequence`: posición en el contador de consultas de la petición, incluidas las anteriores a la activación; puede comenzar por un número mayor que uno.
- `fingerprint`: SHA-256 del SQL con espacios normalizados. No se guardan el SQL, los parámetros, las credenciales ni los resultados en estos eventos.
- `stage`: etapa activa durante la ejecución.
- `prepare_ms`: preparación del statement; solo se atribuye a su primera ejecución.
- `execute_ms`: tiempo del driver al ejecutar. Incluye esperas y el buffering que haga el driver; no equivale exclusivamente al tiempo de CPU de PostgreSQL.
- `fetch_ms`, `fetch_calls`, `fetch_failures`: lectura mediante el driver después de ejecutar. No incluyen hidratación de Doctrine ni serialización PHP.
- `rows`: recuento informado por el driver, no necesariamente el número de filas que consumió la aplicación.
- `failed`: fallo de ejecución. Los errores se propagan igual que antes. Un fallo durante la preparación no llega a generar un perfil de ejecución.

Las consultas de autenticación anteriores al controlador no se perfilan individualmente, aunque siguen incluidas en las métricas agregadas de la petición. La diferencia entre una etapa y sus tiempos de driver puede incluir trabajo PHP e hidratación; no debe atribuirse automáticamente a una sola causa.

El script `scripts/explain-deck-detail.php` exporta el mismo fingerprint con cada plan. Para informes anteriores, calcular SHA-256 de `trim(SQL con secuencias de espacios sustituidas por un espacio)`. Correlacionar fingerprint **y etapa**; una consulta puede ejecutarse varias veces, y cambios en la cantidad de placeholders pueden producir otro fingerprint. Comparar tiempos dentro del mismo `request_id`, mazo, idioma y commit. No comparar una apertura de un mazo con otra de un mazo distinto como si fuera una prueba de caché.

El diagnóstico CLI permanece separado: `scripts/run-deck-detail-diagnostic.ps1` reproduce lecturas dentro de una transacción READ ONLY y luego ejecuta EXPLAIN ANALYZE. Sus planes están calentados por la reproducción y no sustituyen los tiempos originales HTTP. Ese informe administrativo sí contiene SQL y parámetros de las consultas seleccionadas; revisarlo antes de compartirlo.
