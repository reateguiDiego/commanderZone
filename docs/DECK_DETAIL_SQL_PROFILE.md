# Captura SQL del detalle de un mazo

La reproducción CLI puede calentar buffers antes de EXPLAIN. Para localizar un pico que solo aparece en HTTP, la API admite una captura temporal por consulta en `GET /decks/by-slug/{slug}`.

## Activación tras desplegar

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
