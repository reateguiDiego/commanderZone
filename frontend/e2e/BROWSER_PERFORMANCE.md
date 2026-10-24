# Experiencia de un usuario: captura guiada

Esta prueba usa el Chromium y la configuración Playwright existentes. No modifica
la aplicación ni lanza carga concurrente. Se activa explícitamente; no se ejecuta
en el E2E habitual. No necesita desplegarse.

## Ejecutar en Windows

Desde PowerShell, con las dependencias de frontend instaladas:

```powershell
Set-Location C:\Users\Diego\Dev\commanderZone\frontend
$env:BROWSER_PERF = 'record'
$env:BROWSER_PERF_URL = 'https://commanderzone.com'
$env:DEPLOYED_COMMIT = '694acfab'
try {
    npx playwright test --workers=1 --reporter=list
}
finally {
    Remove-Item Env:BROWSER_PERF -ErrorAction SilentlyContinue
    Remove-Item Env:BROWSER_PERF_URL -ErrorAction SilentlyContinue
    Remove-Item Env:DEPLOYED_COMMIT -ErrorAction SilentlyContinue
}
```

El comando abre una ventana nueva con perfil temporal. Inicia sesión manualmente
con una cuenta de pruebas que tenga un mazo de unas 100 cartas. El login se excluye
de la captura. No ejecutes k6 ni compilaciones mientras mides. Mantén la ventana
en primer plano, el portátil conectado y el mismo tamaño de ventana en ambas vueltas.

Un panel inferior indica cada acción. Pulsa **Empezar antes** de realizarla y
**Listo · fluido/lento** cuando el contenido sea visible y utilizable. **Omitir**
identifica un paso que no se ha podido medir; no cuenta como éxito. El panel se
superpone a una esquina: si tapa un control, desplaza el contenido o cambia el
tamaño antes de comenzar, manteniéndolo después igual.

Se recorre dos veces: listado de mazos, detalle, spoiler/scroll, análisis, editor,
cartas, Seton, aterrizaje, landfall, filtros/página y salas. Usa el mismo mazo,
idioma y filtros. En el editor no guardes cambios. La búsqueda de aterrizaje es
también una comprobación de corrección funcional: resultados incorrectos no son
aceptables aunque lleguen rápido. Anota aparte diferencias de resultados.

Para medir selección de mazo y entrada a partida, prepara previamente una sala
privada y una partida con cuentas de pruebas, y añade antes de ejecutar:

```powershell
$env:BROWSER_PERF_GAME = '1'
```

Después elimina esa variable. Estos pasos son manuales y optativos: la prueba no
crea salas, no importa mazos ni inicia partidas automáticamente. Omite el paso si
no se puede repetir sin alterar una partida ajena. Para probar ediciones guardadas,
usa una copia desechable del mazo y una sesión funcional separada.

## Informe e interpretación

Para investigar los puntos lentos de la primera captura, añade
`$env:BROWSER_PERF_FOCUS = '1'` antes de ejecutar, y elimina la variable después.
Esta variante conserva solo mazos, detalle, análisis, cartas y búsquedas de texto
y filtros, en dos vueltas. Para otro servidor API especifica
`BROWSER_PERF_API_URL`; por defecto se observa `https://api.commanderzone.com`.

La versión v3 añade `network` por paso: rutas allowlisted con IDs/slugs ocultos,
método GET/OPTIONS, estado HTTP, UUID X-Request-ID y tiempos Playwright (previo al
envío, DNS, conexión, TLS, espera de respuesta y recepción). No requiere
Timing-Allow-Origin ni cambios de CORS. No registra login, cuerpos ni query
strings. Solo se lee la cabecera X-Request-ID, con validación UUID.
La espera de respuesta incluye red y trabajo del servidor: no es tiempo SQL.
Una conexión reutilizada puede no disponer de tiempos DNS/TLS y se indica null.
Se conservan hasta 500 peticiones por paso; llegar a ese número indica posible
truncamiento. Las peticiones se asignan al paso donde comenzaron, aunque terminen
después. Las que siguen pendientes al guardar no se consideran terminadas.

El siguiente diagnóstico consiste en buscar los UUID de las peticiones lentas
en los logs `http_request_completed` del API y comparar duración, SQL y etapas.
No exportes logs completos, cabeceras de autorización ni un HAR sin depurar.

La versión v2 limita los observadores al frame principal. La v1 podía contar
varias veces la misma tarea larga desde iframes; sus sumas de tareas/bloqueo no
son válidas sin revisar los registros. No se atribuye trabajo a funciones con
esta captura. El contenido interno de frames secundarios queda fuera de v2.

La consola muestra `Informe de navegador: ...browser-performance.json`, dentro de
`frontend/test-results/`. Copia el archivo a `reports/` antes de otra ejecución:
Playwright limpia su directorio de resultados. Se escribe tras cada paso y se
adjunta al resultado del test. Si cierras la ventana antes de finalizar, el informe
queda marcado `aborted`; no interpretes una captura parcial como completa.

Incluye por paso y vuelta:

- Percepción fluido/lento/omitido y duración manual hasta «Listo».
- Tareas de más de 50 ms y exceso acumulado sobre 50 ms.
- Peor evento de interacción observado y su espera antes de procesarse.
- Suma de saltos de diseño sin entrada reciente.
- Recursos completados, tamaño observable y los diez más lentos, por categoría.
- Conteos de errores HTTP/JS/red y muestras descartadas si se alcanza el límite.
- Entradas de pintura/LCP del documento, cuando el navegador las emite.

No guarda credenciales, tokens, cookies, texto escrito, nombres de mazos, cuerpos
HTTP, query strings, capturas de pantalla, vídeos ni trazas. Las URL de recursos
se reducen a categorías antes de escribir. No exportes por separado el estado de
sesión. Las peticiones funcionales normales siguen realizándose contra el destino.

**Límites:** la duración manual incluye lectura y reacción humana; no es tiempo
automático de renderizado. La primera vuelta sucede después del login y puede
reutilizar bundles y cachés del servidor; no equivale a una instalación fría.
La segunda vuelta reutiliza la misma sesión. No borra cachés en producción.
El peor Event Timing no es INP, la suma de layout shifts no es CLS por ventanas,
y el exceso de tareas largas no es TBT de Lighthouse. Recursos cross-origin sin
Timing-Allow-Origin pueden ocultar tamaños/TTFB; cero no significa cache hit.
LCP/FCP son del documento, no del cambio de ruta Angular. La superposición y la
instrumentación tienen un coste pequeño; compara usando siempre el mismo método.

No se imponen umbrales de aprobación: terminar la prueba no significa que la UX
sea buena. Primero revisaremos los pasos marcados lentos, errores y tareas largas;
después repetiremos al menos tres veces los recorridos sospechosos y diseñaremos
mediciones automáticas con una condición concreta de «listo». No se calculan p95
de dos recorridos ni se resta red de renderizado: sus trabajos pueden solaparse.

Para separar causa: red lenta con pocas tareas largas apunta a transporte/API;
red terminada con bloqueos/interacciones lentas apunta al hilo principal; imágenes
pendientes o saltos de diseño apuntan a carga visual. Son hipótesis a verificar,
no conclusiones automáticas.

## Verificar el capturador sin acceder a producción

```powershell
$env:BROWSER_PERF = 'verify'
try { npx playwright test --reporter=list }
finally { Remove-Item Env:BROWSER_PERF -ErrorAction SilentlyContinue }
```

Usa una página sintética para comprobar que detecta trabajo real del hilo principal
y categorías de recursos sin identificadores. No inicia Angular ni usa cuentas.
