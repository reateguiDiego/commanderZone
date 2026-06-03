# CommanderZone — Plan definitivo SEO + Multiidioma + Analytics-ready para Codex

## Objetivo

Implementar en CommanderZone una arquitectura **SEO + i18n híbrida** preparada para competir fuerte en Google, búsquedas multiidioma y resultados de IA, sin ensuciar el producto ni mezclar responsabilidades.

La estrategia final es:

- **Landings SEO rankeables**: páginas públicas nuevas, con contenido SEO estático localizado, URL propia por idioma, SSR/prerender, `canonical`, `hreflang`, sitemap, Open Graph, JSON-LD y responsive desde el inicio.
- **Páginas internas/no rankeables**: `ngx-translate`, JSON i18n, `noindex` y fuera del sitemap.
- **Analytics/Cookies**: se deja preparada la arquitectura sin cargar tracking real hasta tener consentimiento y una tarea específica de Analytics.
- **Asistente de mesa**: nombre oficial de la funcionalidad para usar móvil/tablet como marcador durante partidas físicas de Magic.
- **Auditoría final**: Codex debe revisar página por página que cada ruta usa el sistema correcto.

---

## Reglas globales para Codex

```text
CommanderZone usa una arquitectura híbrida SEO/i18n.

1. Las páginas rankeables son landings públicas nuevas.
   - Usan contenido SEO estático localizado.
   - No usan ngx-translate.
   - No usan TranslatePipe.
   - No inyectan TranslateService.
   - Deben tener SSR/prerender.
   - Deben estar en sitemap.
   - Deben ser indexables.

2. Las páginas internas/no rankeables usan ngx-translate.
   - Login, register, app, rooms, game, profile, settings, decks, dashboard, herramienta interna de Asistente de mesa, etc.
   - Usan JSON i18n.
   - Tienen noindex.
   - No aparecen en sitemap.

3. Todas las landings deben ser responsive desde el inicio.
   - Reusar componentes.
   - Mismo sistema visual.
   - No crear layouts aislados por página.
   - Mismo nivel de calidad.
   - Contenido único por intención SEO.

4. No crear una landing por cada keyword.
   - Una landing por intención de búsqueda.

5. No ocultar texto SEO.
   - Nada de texto invisible.
   - Nada de keyword stuffing.
   - Nada de contenido para Google que el usuario no vea.

6. El nombre oficial de la feature de marcador físico es:
   “Asistente de mesa”.

7. Las landings deben ser muy similares en estructura visual, pero no en contenido.
   - Mismo sistema de componentes.
   - Mismo estilo.
   - Misma calidad responsive.
   - Distinto title.
   - Distinto H1.
   - Distinta intención.
   - Distinto copy.
   - Distinta meta description.
   - Distintas FAQs contextuales.

8. Each logical SEO landing must reuse the same component/template across all locales.
   - Locale differences must come from localized routes and static localized content, not from duplicated Angular components.
   - Do not create one Angular component per language or one landing component per locale.
   - The expected SEO architecture is 10 logical SEO landings, 13 locales, and 130 localized SEO URLs using shared components and templates.
```

---

## Regla global de testing — No hacer trampas

REGLA DE TESTING — PROHIBIDO HACER TRAMPAS CON LOS TESTS

Si cualquier test falla durante cualquier fase, Codex debe arreglar el código fuente de la aplicación, la configuración o la implementación que está causando el fallo.

Codex no debe modificar, debilitar, eliminar, saltar, silenciar ni falsear tests solo para conseguir que la suite de tests pase.

Acciones prohibidas:
- No cambiar las expectativas del test para que coincidan con un comportamiento roto.
- No eliminar tests que fallan.
- No añadir .skip, xit, xdescribe, fit o fdescribe.
- No reducir los umbrales de cobertura.
- No mockear el problema real para ocultarlo.
- No sustituir assertions relevantes por assertions débiles.
- No actualizar snapshots a ciegas sin explicar el cambio real en la UI.
- No ignorar tests fallidos de zonas que no se han tocado.
- No marcar tests como flaky salvo que haya evidencia clara y se proponga una solución real.

Comportamiento obligatorio:
- Reproducir el test que falla.
- Identificar si el fallo está causado por el cambio actual, código roto existente, configuración o entorno.
- Arreglar el código, la implementación, el setup o la configuración.
- Mantener la intención original del test.
- Si un test está realmente obsoleto porque el comportamiento del producto ha cambiado de forma intencionada, Codex debe detenerse y reportarlo como una decisión humana en vez de cambiar el test silenciosamente.
- Al final de cada fase, deben pasar todos los tests afectados y toda la suite de tests relevante.

Testing Done:
- El build pasa.
- El lint pasa si está configurado.
- Los tests unitarios pasan.
- Los scripts de validación SEO/i18n pasan si ya existen.
- Ningún test ha sido saltado, debilitado, eliminado o modificado solo para ocultar fallos.
- Cualquier test que fallaba se ha solucionado corrigiendo el código fuente, la configuración o la implementación.

---

## Idiomas finales

```text
es       Español
en       English
de       Deutsch
fr       Français
it       Italiano
pt       Português
ja       日本語
ko       한국어
zh-hans  简体中文
zh-hant  繁體中文
nl       Nederlands
ca       Català
ru       Русский
```

---

## Páginas SEO que deben rankear

Solo estas páginas deben rankear:

```text
1. Home pública
2. Jugar Commander online
3. Jugar Magic online con amigos
4. Crear sala Commander online
5. Importar mazo Commander
6. Deck builder Commander
7. Asistente de mesa para Magic y Commander
8. Otras formas de jugar Commander online
9. Cómo jugar Commander online
10. FAQ / ayuda pública indexable
```

Ejemplo correcto de separación:

```text
/app/decks                         → app interna, noindex, ngx-translate
/es/deck-builder-commander/        → landing SEO pública, indexable, contenido estático

/app/table-assistant               → herramienta real, noindex, ngx-translate
/es/asistente-de-mesa-magic/       → landing SEO pública, indexable, contenido estático
```

---

# Fase 1 — Decidir qué páginas rankean

## Objetivo

Bloquear desde el inicio qué páginas son SEO y cuáles no.

## Prompt para Codex

```text
Define the SEO indexable surface for CommanderZone before implementing translations or SEO infrastructure.

Only the following pages are allowed to rank:

1. Public home
2. Play Commander online
3. Play Magic online with friends
4. Create Commander room online
5. Import Commander deck
6. Commander deck builder
7. Magic and Commander table assistant
8. Ways to play Commander online
9. How to play Commander online
10. Public FAQ/help

Important:
Most of these pages do not exist yet and must be created as new public SEO landing pages.

Existing internal app pages must not be converted into SEO pages.

The official Spanish product name for the physical game helper is “Asistente de mesa”.

Classify all existing and future routes into:

1. seo-static
   New public SEO landing page.
   Uses static localized content.
   Must be prerendered/SSR.
   Must be indexable.
   Must be in sitemap.

2. runtime-i18n
   Internal/non-rankable app page.
   Uses ngx-translate.
   Must be noindex.
   Must be excluded from sitemap.

3. out-of-scope
   Admin, debug, legacy, mock or unused pages.
   Must not be indexed.
   Must not be translated unless needed.

Return:
- Final SEO page list.
- Existing routes that must remain non-indexable.
- New SEO routes that must be created.
- Any ambiguous route that needs human decision.

Do not modify code yet.
```

## Done

```text
- Lista SEO cerrada.
- Rutas internas marcadas como no rankeables.
- Nuevas landings identificadas.
- No se ha cambiado código todavía.
```

---

# Fase 2 — Crear manifiesto de estrategia por página

## Objetivo

Tener una fuente de verdad para saber si una página usa SEO estático, `ngx-translate` o queda fuera de scope.

## Prompt para Codex

```text
Create a typed page translation strategy manifest.

Requirements:
- Add all seo-static pages from the approved SEO surface:
  home
  playCommanderOnline
  playMagicOnlineWithFriends
  createCommanderRoom
  importCommanderDeck
  commanderDeckBuilder
  tableAssistant
  waysToPlayCommanderOnline
  howToPlayCommanderOnline
  faq

- Add existing internal routes as runtime-i18n:
  login
  register
  app
  rooms
  game
  profile
  settings
  account
  decks
  tableAssistantApp if it exists
  dashboard

- Add out-of-scope routes if detected.

- Add helper functions:
  isSeoStaticPage(pageKey)
  isRuntimeI18nPage(pageKey)
  isOutOfScopePage(pageKey)

- Add tests for these helpers.
- Do not implement translations yet.
```

## Done

```text
- Cada página tiene estrategia explícita.
- Las SEO quedan separadas de las internas.
- Codex no tiene que adivinar.
```

---

# Fase 3 — Crear configuración global de idiomas

## Objetivo

Centralizar idiomas, labels, códigos y `hreflang`.

## Prompt para Codex

```text
Create a centralized locale configuration.

Requirements:
- Add SUPPORTED_LOCALES with:
  es, en, de, fr, it, pt, ja, ko, zh-hans, zh-hant, nl, ca, ru.

- Each locale must include:
  code
  hreflang
  label
  nativeLabel

- Add helpers:
  isSupportedLocale(locale)
  getLocaleByCode(locale)
  getDefaultLocale()
  getLocaleHreflang(locale)

- Add LocaleCode type inferred from SUPPORTED_LOCALES.
- Do not change routing yet.
- Add tests for helpers if the project has test infrastructure.
```

## Done

```text
- Idiomas tipados.
- Helpers funcionando.
- No hay lógica duplicada de idiomas.
```

---

# Fase 4 — Instalar `ngx-translate` al principio

## Objetivo

Meter `ngx-translate` pronto, pero solo para páginas internas/no rankeables.

## Prompt para Codex

```text
Install and configure ngx-translate only for runtime-i18n pages.

Important:
Do not use ngx-translate for seo-static pages.

Requirements:
- Configure ngx-translate.
- Create TranslationService wrapper.
- Create JSON files for all target locales:
  es, en, de, fr, it, pt, ja, ko, zh-hans, zh-hant, nl, ca, ru.

- Add namespaces for internal app UI:
  common
  navigation
  auth
  rooms
  game
  deckBuilder
  tableAssistant
  profile
  settings
  forms
  errors
  modals
  toasts
  emptyStates

- Do not touch seo-static pages.
- Do not use TranslatePipe in future SEO landing components.
- Do not inject TranslateService in future SEO landing components.
```

## Done

```text
- ngx-translate instalado.
- JSON i18n creados.
- TranslationService wrapper creado.
- No afecta a SEO.
```

---

# Fase 5 — Inventario global de cadenas visibles

## Objetivo

Detectar todos los textos visibles para usuario y clasificarlos antes de migrar nada.

## Prompt para Codex

```text
Create a full inventory of user-visible strings across the production app.

Classify every string as:

1. seo-static
   Visible string used in public SEO landing pages.
   Must be translated through static localized SEO content.

2. runtime-i18n
   Visible string used in internal/non-indexable app pages.
   Must be translated through ngx-translate JSON.

3. out-of-scope
   Admin, debug, legacy, unused, mock or not production-visible.

4. do-not-translate
   Technical constants, enum values, logs, test names, IDs, routes, class names, API payload fields.

Return:
- string
- current file
- component/page
- classification
- target translation system
- suggested key if runtime-i18n
- suggested content file if seo-static

Do not modify code yet.
```

## Done

```text
- Inventario completo de cadenas visibles.
- Textos SEO clasificados como seo-static.
- Textos internos clasificados como runtime-i18n.
- Textos técnicos excluidos correctamente.
```

---

# Fase 6 — Migrar strings visibles internos a JSON i18n

## Objetivo

Pasar todo texto visible de páginas internas a `ngx-translate`.

## Prompt para Codex

```text
Migrate user-visible strings from runtime-i18n pages to ngx-translate JSON files.

Scope:
Only routes classified as runtime-i18n.

Do not touch:
- seo-static pages
- SEO metadata
- SEO landing content
- JSON-LD
- Open Graph
- logs
- technical constants
- tests
- mocks not visible to users

Requirements:
- Replace visible hardcoded UI strings with translation keys.
- Add keys to all locale JSON files:
  es, en, de, fr, it, pt, ja, ko, zh-hans, zh-hant, nl, ca, ru.
- Keep keys organized by domain.
```

## Done

```text
- Las páginas internas en scope usan ngx-translate.
- Los strings visibles están en JSON.
- Las landings SEO siguen intactas.
```

---

# Fase 7 — Validar que `ngx-translate` no invade SEO

## Objetivo

Evitar que las landings SEO usen `TranslatePipe`, `TranslateService` o JSON runtime.

## Prompt para Codex

```text
Add validation for runtime-i18n and seo-static boundaries.

Checks:
- Every runtime-i18n page uses ngx-translate for user-visible strings.
- No runtime-i18n page has missing translation keys.
- All locale JSON files have the same key structure.
- No visible translation key appears in rendered UI.
- No seo-static component imports TranslatePipe.
- No seo-static component injects TranslateService.
- No seo-static content comes from assets/i18n runtime JSON.

Add a script or test that can run in CI.
```

## Done

```text
- La capa runtime i18n está controlada.
- Si alguien mete ngx-translate en SEO, falla.
```

---

# Fase 8 — Crear mapa de nuevas rutas SEO

## Objetivo

Definir rutas públicas localizadas para todas las landings SEO.

## Prompt para Codex

```text
Create the public SEO landing route map for CommanderZone.

Important:
These SEO pages are mostly new public landing pages. Do not reuse internal app routes as SEO pages.

Approved SEO landings:
- home
- playCommanderOnline
- playMagicOnlineWithFriends
- createCommanderRoom
- importCommanderDeck
- commanderDeckBuilder
- tableAssistant
- waysToPlayCommanderOnline
- howToPlayCommanderOnline
- faq

Requirements:
- Create a typed SEO_ROUTES configuration.
- Each SEO landing must have localized slugs for:
  es, en, de, fr, it, pt, ja, ko, zh-hans, zh-hant, nl, ca, ru.

- Use “Asistente de mesa” as the official Spanish product name for tableAssistant.
- Use related SEO terms naturally in content, not necessarily in the product name:
  contador de vidas Magic
  contador de vidas Commander
  marcador de vidas
  daño de comandante
  mtg life counter
  commander life counter
  commander damage tracker

- Add helpers:
  getSeoPath(routeKey, locale)
  getLocalizedRouteAlternates(routeKey)
  findSeoRouteByPath(path)

- Prevent duplicated slugs within the same locale.
- Do not create components yet.
- Do not use ngx-translate for these SEO routes.
- Add tests for the route helpers.
```

## Done

```text
- Las nuevas rutas SEO están definidas.
- Hay slug localizado por idioma.
- No hay duplicados.
```

No crear un componente Angular por idioma.

   Correcto:
   - Una landing lógica por intención SEO.
   - Un componente/renderer reutilizable para landings SEO.
   - Plantillas compartidas por tipo de landing.
   - Contenido estático localizado por idioma.
   - URLs localizadas por idioma.

   Incorrecto:
   - PlayCommanderEsComponent.
   - PlayCommanderEnComponent.
   - PlayCommanderFrComponent.
   - Un componente por locale.
   - Un layout duplicado por idioma.

   Ejemplo correcto:
   - Landing lógica: playCommanderOnline
   - Componente reutilizable: SeoLandingPageComponent
   - Template reutilizable: ProductLandingTemplate
   - Contenido localizado:
     content/play-commander-online/es.content.ts
     content/play-commander-online/en.content.ts
     content/play-commander-online/fr.content.ts

   Resultado esperado:
   - 10 landings lógicas.
   - 13 idiomas.
   - 130 URLs SEO localizadas.
   - Componentes compartidos.
   - No 130 componentes.

---

# Fase 9 — Crear infraestructura de landings nuevas

## Objetivo

Crear la estructura base de la feature SEO.

## Prompt para Codex

```text
Create the SEO landings feature structure.

Requirements:
- Create a dedicated seo-landings feature folder.
- Create a generic SeoLandingPageComponent.
- Create reusable presentational components:
  LandingHeroComponent
  LandingSectionComponent
  LandingFeatureGridComponent
  LandingStepsComponent
  LandingFaqComponent
  LandingCtaComponent
  LandingComparisonComponent

- Components must receive typed content through inputs.
- Do not use TranslatePipe.
- Do not inject TranslateService.
- Do not load content from ngx-translate JSON files.

- Use semantic HTML:
  one H1 per landing
  correct H2/H3 order
  real anchor links with href
  visible FAQ content

- Keep the implementation reusable.
- Avoid one huge component.
```

## Done

```text
- Estructura SEO creada.
- Componentes reutilizables.
- Sin dependencia de ngx-translate.
```

---

# Fase 10 — Crear sistema visual responsive reutilizable

## Objetivo

Todas las landings y FAQ deben nacer responsive y compartir sistema visual.

## Prompt para Codex

```text
Create a reusable responsive SEO landing design system.

Requirements:
- Build mobile-first reusable components for all SEO landings and FAQ.
- Do not create one-off landing layouts.
- Create shared components:
  SeoLandingLayoutComponent
  LandingHeroComponent
  LandingTrustBarComponent
  LandingFeatureGridComponent
  LandingStepsComponent
  LandingUseCasesComponent
  LandingComparisonComponent
  LandingFaqPreviewComponent
  LandingFullFaqComponent
  LandingCtaComponent
  LandingInternalLinksComponent
  LandingBreadcrumbComponent

Responsive requirements:
- Must work at 360px, 390px, 768px, 1024px, 1280px and large desktop.
- No horizontal overflow.
- Mobile-first CSS.
- Cards should use responsive grid.
- CTAs should stack on mobile and align on desktop.
- FAQ accordions/details must be touch-friendly.
- Header and language selector must not overflow.
- Long localized text must wrap safely.
- German, Russian, Portuguese and CJK languages must not break layout.

Architecture:
- Components receive typed content through inputs.
- Do not use TranslatePipe.
- Do not inject TranslateService.
- Do not load content from ngx-translate JSON files.
- Use semantic HTML.
- Keep components small and reusable.
- Avoid duplicating layout logic across landings.
```

## Done

```text
- Sistema visual creado.
- Componentes reutilizables.
- Responsive desde el inicio.
- Sin componentes aislados por landing.
```

---

# Fase 11 — Crear plantillas reutilizables por tipo de landing

## Objetivo

Evitar landings desordenadas o hechas una por una sin patrón.

## Plantillas

```text
ProductLandingTemplate:
- playCommanderOnline
- createCommanderRoom
- importCommanderDeck
- commanderDeckBuilder
- tableAssistant

GuideLandingTemplate:
- playMagicOnlineWithFriends
- howToPlayCommanderOnline

ComparisonLandingTemplate:
- waysToPlayCommanderOnline

FaqLandingTemplate:
- faq
```

## Prompt para Codex

```text
Create reusable landing composition templates.

Requirements:
- Create landing templates based on SEO intent:
  ProductLandingTemplate
  GuideLandingTemplate
  ComparisonLandingTemplate
  FaqLandingTemplate

Use these mappings:
- ProductLandingTemplate:
  playCommanderOnline
  createCommanderRoom
  importCommanderDeck
  commanderDeckBuilder
  tableAssistant

- GuideLandingTemplate:
  playMagicOnlineWithFriends
  howToPlayCommanderOnline

- ComparisonLandingTemplate:
  waysToPlayCommanderOnline

- FaqLandingTemplate:
  faq

Requirements:
- All templates must use the same shared visual components.
- All templates must be responsive.
- All templates must support localized static content.
- Do not create custom duplicated layouts per landing.
- Each landing must still have unique content, H1, title, meta description, FAQ and internal links.
```

## Done

```text
- Plantillas reutilizables creadas.
- Las landings son visualmente consistentes.
- Cada landing mantiene intención SEO única.
```

---

# Fase 12 — Crear sistema de contenido SEO estático localizado

## Objetivo

Crear el contenido SEO por landing e idioma sin usar `ngx-translate`.

## Prompt para Codex

```text
Create the static localized content system for SEO landings.

Requirements:
- Define a SeoLandingContent interface.

Content must include:
- seo.title
- seo.description
- seo.ogTitle
- seo.ogDescription
- hero.eyebrow
- hero.title
- hero.subtitle
- hero.primaryCta
- hero.secondaryCta if needed
- sections
- faqs
- breadcrumbs
- internalLinks
- jsonLd

Add static content files for every approved SEO landing:
- home
- playCommanderOnline
- playMagicOnlineWithFriends
- createCommanderRoom
- importCommanderDeck
- commanderDeckBuilder
- tableAssistant
- waysToPlayCommanderOnline
- howToPlayCommanderOnline
- faq

Add content for every supported locale:
es, en, de, fr, it, pt, ja, ko, zh-hans, zh-hant, nl, ca, ru.

This content must be available during SSR/prerender.
Do not fetch this content through client-only HTTP.
Do not use ngx-translate.
Add validation to ensure no landing/locale content is missing.
```

## Done

```text
- Contenido SEO estático creado.
- Todos los idiomas tienen contenido.
- Preparado para prerender.
```

---

# Fase 13 — Crear las 10 landings públicas nuevas

## Objetivo

Crear todas las landings SEO usando componentes y plantillas reutilizables.

## Prompt para Codex

```text
Implement all approved new public SEO landings using the reusable responsive landing system.

Pages to create:
- home
- playCommanderOnline
- playMagicOnlineWithFriends
- createCommanderRoom
- importCommanderDeck
- commanderDeckBuilder
- tableAssistant
- waysToPlayCommanderOnline
- howToPlayCommanderOnline
- faq

Requirements:
- These are new public SEO landing pages.
- Do not reuse internal app pages as SEO pages.
- Use the static SeoLandingContent system.
- Use the shared responsive landing components.
- Use the landing composition templates.
- Each logical SEO landing must reuse the same component/template across all locales.
- Locale differences must come from localized routes and static localized content, not from duplicated Angular components.
- The expected result is 10 logical SEO landings, 13 locales, 130 localized SEO URLs, shared components, and no per-locale components.
- Do not create one-off layouts.
- Do not duplicate layout code.
- Every landing must support all locales:
  es, en, de, fr, it, pt, ja, ko, zh-hans, zh-hant, nl, ca, ru.

Every landing must render:
- localized title
- localized meta description
- localized H1
- localized hero
- localized body sections
- localized FAQ
- localized CTA
- localized Open Graph
- localized JSON-LD

Every landing must have:
- self canonical
- hreflang alternates
- internal links to related SEO landings
- CTA links to the correct product/app route
- responsive layout from mobile to desktop

Specific content requirements:
- tableAssistant must use “Asistente de mesa” as official Spanish product name.
- tableAssistant must naturally cover:
  contador de vidas Magic
  contador de vidas Commander
  marcador de vidas
  daño de comandante
  móvil como contador
  tablet como marcador
  partidas físicas de Magic

- waysToPlayCommanderOnline must mention competitors neutrally:
  SpellTable
  Cockatrice
  MTGO
  MTG Arena
  Untap.in
  EDHPlay

Do not:
- use ngx-translate
- use TranslatePipe
- inject TranslateService
- create thin duplicated pages
- create one landing per keyword variation
- hide competitor/comparison content
- create non-responsive layouts
- Do not create one Angular component per language.
- Do not create one landing component per locale.
- Do not duplicate templates per language.
- Do not create 130 components for 130 URLs.
```

## Done

```text
- Existen las 10 landings SEO.
- Cada landing tiene ruta en los 13 idiomas.
- Cada landing usa contenido estático.
- Ninguna landing usa ngx-translate.
- Ninguna landing reutiliza una pantalla interna.
- Todas son responsive.
- Todas usan componentes compartidos.
```

---

# Fase 14 — Crear FAQ público indexable y acceso rápido

## Objetivo

Crear FAQ SEO real, público, responsive y enlazado desde la web actual.

## Debe estar accesible desde

```text
1. Header público
2. Footer
3. Bloque corto en Home
4. Link desde app interna: menú, sidebar, settings o help
```

## Preguntas principales

```text
1. ¿Qué es CommanderZone?
2. ¿Cómo puedo jugar Commander online con amigos?
3. ¿Puedo jugar Magic: The Gathering online en CommanderZone?
4. ¿Necesito descargar algo para jugar?
5. ¿CommanderZone funciona desde navegador?
6. ¿Puedo crear una sala privada para jugar Commander?
7. ¿Cómo invito a mis amigos a una partida?
8. ¿Puedo jugar Commander online gratis?
9. ¿Necesito registrarme para crear una sala?
10. ¿CommanderZone está pensado para Commander multijugador?

11. ¿Puedo importar mi mazo de Commander?
12. ¿Puedo pegar una decklist para jugar online?
13. ¿CommanderZone tiene deck builder?
14. ¿Puedo crear un mazo de Commander desde cero?
15. ¿Puedo editar mi mazo antes de jugar?
16. ¿Puedo importar mazos desde Moxfield, Archidekt u otras plataformas?
17. ¿Qué formatos de decklist acepta CommanderZone?
18. ¿Puedo jugar online con un mazo que ya tengo creado?

19. ¿Qué es el Asistente de mesa?
20. ¿Puedo usar CommanderZone como asistente de mesa en una partida física?
21. ¿Puedo usar el móvil como contador de vidas de Magic?
22. ¿Puedo usar una tablet como asistente de mesa para Commander?
23. ¿El Asistente de mesa funciona para partidas presenciales?
24. ¿Puedo controlar el daño de comandante?
25. ¿Puedo contar vidas de varios jugadores?
26. ¿Puedo controlar veneno o infect?
27. ¿Necesito crear una sala online para usar el Asistente de mesa?

28. ¿CommanderZone es una alternativa a SpellTable?
29. ¿CommanderZone es una alternativa a Cockatrice?
30. ¿CommanderZone es una alternativa a MTGO?
31. ¿CommanderZone es una alternativa a MTG Arena?
32. ¿CommanderZone es una alternativa a Untap.in?
33. ¿CommanderZone es una alternativa a EDHPlay?
34. ¿Qué diferencia a CommanderZone de otras plataformas para jugar Commander online?

35. ¿CommanderZone funciona en móvil?
36. ¿CommanderZone funciona en tablet?
37. ¿CommanderZone funciona en Mac, Windows y Linux?
38. ¿Necesito cámara o webcam?
39. ¿Puedo jugar sin webcam?
40. ¿Puedo jugar con cartas físicas?
41. ¿Mis partidas son privadas?
42. ¿Puedo compartir una sala con un enlace?
43. ¿Qué necesito para empezar a jugar?
```

## Prompt para Codex

```text
Create the public FAQ/help SEO landing using the shared responsive landing system.

Requirements:
- FAQ must be a seo-static public landing.
- FAQ must use FaqLandingTemplate.
- FAQ must reuse:
  LandingHeroComponent
  LandingFullFaqComponent
  LandingCtaComponent
  LandingInternalLinksComponent
  LandingBreadcrumbComponent

- FAQ must be fully responsive.
- FAQ categories must be easy to scan on mobile.
- FAQ accordion/details must be touch-friendly.
- FAQ must use static localized SEO content, not ngx-translate.

Add FAQ content for all supported locales:
es, en, de, fr, it, pt, ja, ko, zh-hans, zh-hant, nl, ca, ru.

Add localized:
- title
- meta description
- H1
- FAQ questions
- FAQ answers
- CTA
- Open Graph
- JSON-LD FAQPage

Make the FAQ accessible from:
1. Public header navigation.
2. Public footer.
3. Home public landing section.
4. Internal app help/settings/sidebar link if such layout exists.

Links to FAQ must be real anchor links with href.
Do not implement FAQ as a modal.
Do not hide FAQ behind login.
Do not use TranslatePipe in FAQ landing.
Do not inject TranslateService in FAQ landing.
Do not claim support for features that are not implemented.
Use neutral comparison language when mentioning competitors.
```

## Done

```text
- FAQ público creado.
- FAQ responsive.
- FAQ accesible desde header, footer, home y app interna.
- FAQ incluido en sitemap.
- FAQ usa JSON-LD FAQPage.
- FAQ no usa ngx-translate.
```

---

# Fase 15 — Crear `SeoService`

## Objetivo

Centralizar toda la metadata SEO.

## Prompt para Codex

```text
Create a centralized SeoService.

Requirements:
- Set document title.
- Set meta description.
- Set robots meta.
- Set canonical link.
- Set hreflang alternate links.
- Set Open Graph tags.
- Set Twitter card tags if simple to add.
- Set JSON-LD scripts.
- Clean previous SEO tags before adding new route tags.
- Canonical must always point to the current localized URL.
- hreflang must include equivalent localized URLs.
- Add x-default support.
- Must be SSR-safe.
- Add tests for pure helper functions.
```

## Done

```text
- Metadata centralizada.
- No se duplican tags.
- Canonical correcto.
- hreflang correcto.
```

---

# Fase 16 — SSR/prerender de landings SEO

## Objetivo

Que Google reciba HTML real con contenido, no solo una SPA vacía.

## Prompt para Codex

```text
Configure SSR/prerender for all public SEO landing pages.

Requirements:
- Detect the Angular version and use the correct Angular SSR/prerender setup.
- Prerender every localized SEO landing URL.
- Do not prerender private/dynamic runtime-i18n routes:
  /game/:id
  /profile
  /settings
  /app

Ensure generated HTML contains:
- title
- meta description
- canonical
- hreflang
- H1
- main landing copy
- FAQ content
- JSON-LD

Add/update build scripts:
- build
- build:ssr or build:prerender
- serve:ssr if applicable

Document how to run the SEO build locally.
```

## Done

```text
- Todas las URLs SEO quedan prerenderizadas.
- El HTML inicial tiene contenido real.
- Las rutas internas no se prerenderizan como SEO.
```

---

# Fase 17 — Crear paquete completo de ficheros y assets SEO

## Objetivo

Crear todos los ficheros públicos que ayudan a rastreo, SEO técnico, compartición y validación.

## Ficheros

```text
/public/robots.txt
/public/sitemap.xml o /public/sitemap-index.xml
/public/favicon.ico
/public/favicon.svg
/public/apple-touch-icon.png
/public/manifest.webmanifest
/public/assets/og/default-og.png
/public/assets/og/home-og.png
/public/assets/og/play-commander-og.png
/public/assets/og/table-assistant-og.png
/public/assets/seo/google-site-verification.html si se usa verificación por HTML
```

## Prompt para Codex

```text
Create the full public SEO assets package.

Requirements:
- Add robots.txt.
- Add sitemap index support if needed.
- Add favicon.ico and favicon.svg references if assets exist.
- Add apple-touch-icon.png if asset exists.
- Add manifest.webmanifest.
- Add default Open Graph image location.
- Add per-main-landing Open Graph image path support.
- Add optional Google Search Console HTML verification file support, but do not invent a verification token.
- Ensure assets are referenced with absolute URLs where required.
- Ensure missing optional assets do not break the build.
- Document which files require real production values before deployment.
```

## Done

```text
- robots.txt existe.
- sitemap.xml o sitemap-index.xml existe.
- favicons referenciados.
- manifest.webmanifest creado.
- Open Graph image paths preparados.
- Search Console verification documentado.
```

---

# Fase 18 — Crear `robots.txt` completo

## Objetivo

Controlar rastreo sin romper indexación.

## Prompt para Codex

```text
Create and validate robots.txt.

Requirements:
- robots.txt must allow public SEO landings.
- robots.txt must reference the sitemap index or sitemap.xml.
- Do not use robots.txt as the only mechanism to keep pages out of Google.
- Internal pages should use noindex.
- Avoid blocking noindex pages if Google needs to crawl them to see the noindex tag.
- Do not disallow the whole site.
- Add tests or validation to detect accidental "Disallow: /" in production.
```

## Done

```text
- robots.txt correcto.
- Sitemap referenciado.
- No hay Disallow: / accidental.
```

---

# Fase 19 — Crear sitemaps multiidioma completos

## Objetivo

Generar sitemap desde configuración, no a mano.

## Prompt para Codex

```text
Generate multilingual XML sitemaps from SEO_ROUTES and SUPPORTED_LOCALES.

Requirements:
- Generate sitemap-index.xml.
- Generate sitemap-seo.xml.
- Include every seo-static URL for every supported locale.
- Include hreflang alternates using xhtml:link.
- Include self-referencing hreflang.
- Include x-default.
- Exclude all runtime-i18n pages.
- Exclude all out-of-scope pages.
- Add npm script:
  npm run generate:sitemap
- Add tests/snapshots for generated sitemap.
- Fail if sitemap contains private routes.
- Fail if sitemap contains mixed slugs.
```

## Done

```text
- Sitemap index creado.
- Sitemap SEO multiidioma creado.
- Hreflang incluido.
- Rutas privadas excluidas.
```

---

# Fase 20 — Definir canonical, trailing slash, dominio y redirects

## Objetivo

Evitar duplicados por dominio, protocolo o slash.

## Prompt para Codex

```text
Add canonical URL and redirect strategy.

Requirements:
- Choose canonical domain:
  https://commanderzone.com
  or
  https://www.commanderzone.com
- Enforce HTTPS.
- Enforce one host version.
- Enforce trailing slash or no trailing slash consistently.
- Ensure canonical tags match final redirected URLs.
- Add deployment config depending on platform:
  vercel.json, netlify.toml, firebase.json, nginx config, or equivalent.
- Do not create redirect loops.
- Add tests or documented manual checks.
```

## Done

```text
- Dominio canónico definido.
- HTTPS forzado.
- Slash consistente.
- Canonical coincide con URL final.
```

---

# Fase 21 — Implementar meta robots / noindex por ruta

## Objetivo

Que solo indexen las landings SEO.

## Prompt para Codex

```text
Implement route-level robots meta rules.

Requirements:
- seo-static pages:
  index, follow
- runtime-i18n pages:
  noindex, follow
- out-of-scope pages:
  noindex, nofollow if appropriate
- Do not include noindex pages in sitemap.
- Add validation that every route has the expected robots behavior.
```

## Done

```text
- Landings indexables.
- Internas noindex.
- Fuera de scope protegido.
```

---

# Fase 22 — Implementar Open Graph y Twitter Cards

## Objetivo

Que al compartir la web se vea profesional.

## Prompt para Codex

```text
Implement complete Open Graph and Twitter Card metadata.

Requirements:
- Every seo-static page must have:
  og:title
  og:description
  og:type
  og:url
  og:image
  og:locale
  og:locale:alternate
  twitter:card
  twitter:title
  twitter:description
  twitter:image

- Use localized metadata.
- Use absolute URLs.
- Use default OG image fallback.
- Add specific OG images for:
  home
  playCommanderOnline
  tableAssistant
  faq
  waysToPlayCommanderOnline

- Do not break SSR/prerender.
```

## Done

```text
- Open Graph completo.
- Twitter Cards completas.
- Imágenes fallback.
- Metadata localizada.
```

---

# Fase 23 — Implementar JSON-LD completo

## Objetivo

Estructurar el contenido para que Google entienda bien cada página.

## Tipos recomendados

```text
Home:
- WebSite
- Organization
- SoftwareApplication

Landings producto:
- SoftwareApplication
- BreadcrumbList
- FAQPage si hay FAQ visible

Guías:
- Article
- BreadcrumbList
- FAQPage

Comparativa:
- Article
- BreadcrumbList
- FAQPage

FAQ:
- FAQPage
- BreadcrumbList
```

## Prompt para Codex

```text
Implement complete localized JSON-LD for all seo-static pages.

Requirements:
- Add WebSite JSON-LD on home.
- Add Organization JSON-LD where appropriate.
- Add SoftwareApplication JSON-LD for product landings.
- Add Article JSON-LD for guide/comparison pages.
- Add BreadcrumbList JSON-LD for every SEO landing.
- Add FAQPage JSON-LD only where FAQ content is visible.
- JSON-LD must be localized.
- JSON-LD must match visible content.
- Do not add fake reviews.
- Do not add fake ratings.
- Do not add unsupported claims.
- Add validation for JSON-LD generation.
```

## Done

```text
- JSON-LD localizado.
- JSON-LD coherente con contenido visible.
- Sin reviews/rating falsos.
```

---

# Fase 24 — Validar enlaces internos crawlables

## Objetivo

Que Google pueda descubrir páginas por enlaces reales.

## Prompt para Codex

```text
Validate internal SEO linking.

Requirements:
- Header public navigation uses real anchor href links.
- Footer uses real anchor href links.
- Home links to all main SEO landings.
- FAQ links to relevant landings.
- Landings link between related SEO pages.
- CTA links use href when pointing to SEO pages.
- Runtime app navigation can remain router-based, but SEO discovery links must be crawlable.
- Add validation to detect important SEO links implemented only as buttons.
```

## Done

```text
- Enlaces internos con href.
- Header/footer rastreables.
- CTAs SEO crawlables.
```

---

# Fase 25 — Optimizar imágenes y assets visuales

## Objetivo

Mejorar SEO de imágenes, rendimiento y layout.

## Prompt para Codex

```text
Implement image SEO and asset optimization.

Requirements:
- Use descriptive image filenames.
- Add alt text for meaningful images.
- Decorative images should use empty alt.
- Add width and height to prevent layout shift.
- Use lazy loading for below-the-fold images.
- Do not lazy load the hero image if it is LCP-critical.
- Use optimized formats where possible.
- Use stable URLs for shared/OG images.
- Add validation for missing alt on SEO landing images.
```

## Done

```text
- Imágenes optimizadas.
- Alt correcto.
- Menos layout shift.
- OG images estables.
```

---

# Fase 26 — Optimizar Core Web Vitals/performance SEO

## Objetivo

Que las landings sean rápidas, estables y ligeras.

## Prompt para Codex

```text
Optimize SEO landing performance and Core Web Vitals.

Requirements:
- Optimize LCP on SEO landings.
- Avoid layout shifts.
- Avoid heavy JS on public landings.
- Avoid blocking font loading.
- Preload critical font only if useful.
- Defer non-critical scripts.
- Keep landing bundle as small as possible.
- Ensure SSR/prerender pages show meaningful content without waiting for client JS.
- Add Lighthouse/PageSpeed checklist to documentation.
```

## Done

```text
- Landings ligeras.
- Menos JS innecesario.
- LCP/CLS cuidados.
- Checklist de performance añadido.
```

---

# Fase 27 — Preparar cookies, consentimiento y Analytics sin dañar SEO

## Objetivo

Dejar preparada la futura integración de Analytics y cookies sin perjudicar SEO, SSR/prerender, Core Web Vitals, experiencia móvil, privacidad ni rastreo de Google.

Esta fase **no implementa Analytics completo todavía**. Solo deja la arquitectura lista para que luego haya una tarea específica de Analytics.

## Prompt para Codex

```text
Prepare cookie consent and analytics integration without damaging SEO.

Context:
CommanderZone will later use analytics to understand user behavior, but SEO landings must remain fast, crawlable, prerendered and user-friendly.

Requirements:
- Do not add full analytics tracking yet unless explicitly approved.
- Do not add GA4 directly to index.html without consent handling.
- Do not add Google Tag Manager directly without consent handling.
- Do not load non-essential analytics scripts before consent when consent is required.
- Prepare a ConsentService or CookieConsentService abstraction.
- Prepare an AnalyticsService interface with a no-op/default implementation.
- Prepare integration points for Google Consent Mode, but do not hardcode IDs or fake values.
- Do not collect personal data in analytics events.
- Do not send emails, usernames, room codes, deck names, private game IDs or personal identifiers.
- Ensure rejecting cookies does not break the app.
- Ensure accepting cookies can later enable analytics scripts safely.
- Ensure the cookie banner does not block SEO content from rendering.
- Ensure the cookie banner does not replace the page content.
- Ensure the cookie banner does not hide the H1 or main content from crawlers.
- Ensure the cookie banner does not create major layout shift.
- Ensure the cookie banner is responsive and usable on mobile.
- Ensure SEO landing HTML remains visible in prerendered output.
- Add documentation for future Analytics implementation.
- Add documentation for privacy/cookie policy requirements.
- Add a note that legal copy must be reviewed before production.

SEO constraints:
- Cookie banner must not be implemented as a full-screen intrusive modal on SEO landings unless legally required.
- Cookie banner should be lightweight.
- Cookie banner should not hurt Core Web Vitals.
- Cookie banner should not prevent users or crawlers from seeing public SEO content.
- Cookie banner should include clear actions:
  Accept
  Reject
  Configure
- Cookie policy and privacy policy links must be real anchor links with href.

Do not:
- Track users before consent.
- Add fake analytics IDs.
- Add personal data to event parameters.
- Add heavy third-party scripts to SEO landings.
- Block rendering of SEO content until cookies are accepted.
```

## Done

```text
- CookieConsentService or ConsentService exists.
- AnalyticsService abstraction exists.
- AnalyticsService defaults to no-op.
- No real tracking is active yet unless explicitly approved.
- No fake GA4/GTM IDs are committed.
- Cookie banner is prepared and responsive.
- Cookie banner does not block SEO content.
- Cookie banner does not create major layout shift.
- SEO landings remain prerenderable.
- Rejecting cookies does not break the app.
- Future Analytics implementation is documented.
- Privacy/cookie policy requirements are documented.
```

---

# Fase 28 — Preparar propiedad de Google Search Console

## Objetivo

Documentar y preparar el alta de Search Console.

## Prompt para Codex

```text
Prepare Google Search Console property setup documentation.

Requirements:
- Document recommended property type:
  Domain property for commanderzone.com.
- Explain that DNS TXT verification is preferred for the domain property.
- Document fallback verification methods:
  HTML file
  HTML meta tag
  Google Analytics
  Google Tag Manager
- Do not invent verification tokens.
- Do not hardcode fake google-site-verification values.
- Add a deployment checklist for the human owner:
  1. Open Google Search Console.
  2. Add Domain property.
  3. Copy DNS TXT verification value.
  4. Add DNS TXT record in the domain provider.
  5. Verify ownership.
- Document that at least one verified owner must remain active.
```

## Done

```text
- Hay documentación clara para crear la propiedad.
- Se recomienda Domain property por DNS.
- No hay tokens falsos en código.
- Queda claro qué parte es manual.
```

---

# Fase 29 — Soporte técnico para verificación

## Objetivo

Dejar la web preparada para métodos de verificación sin valores falsos.

## Prompt para Codex

```text
Add Search Console verification support without hardcoding fake values.

Requirements:
- Support HTML verification file placement in public root if needed.
- Support optional meta tag verification through environment/config.
- Do not commit fake verification tokens.
- Do not commit personal Google account data.
- Add comments explaining where the real token should be placed if using meta verification.
- Prefer DNS verification in documentation.
- Ensure verification support does not affect SSR/prerender.
- Ensure the public home page can expose the meta verification tag if configured.
```

## Done

```text
- HTML verification file support ready.
- Meta verification support ready.
- DNS verification documented.
- No fake token committed.
```

---

# Fase 30 — Envío de sitemap a Search Console

## Objetivo

Dejar preparado el envío del sitemap principal.

## Prompt para Codex

```text
Prepare Search Console sitemap submission workflow.

Requirements:
- Ensure robots.txt references the final sitemap index:
  Sitemap: https://commanderzone.com/sitemap-index.xml
- Document manual Search Console steps:
  1. Open the verified property.
  2. Go to Sitemaps.
  3. Submit sitemap-index.xml.
  4. Check discovered URLs.
  5. Check processing errors.
- Document that sitemap submission is a hint and does not guarantee indexing.
- Add a post-deploy checklist to verify:
  /sitemap-index.xml returns 200
  /sitemaps/sitemap-seo.xml returns 200
  robots.txt returns 200
  sitemap URLs use canonical production domain
```

## Done

```text
- Sitemap listo para enviar.
- robots.txt referencia el sitemap.
- Pasos manuales documentados.
- Checklist post-deploy creado.
```

---

# Fase 31 — Configurar inspección de URLs clave

## Objetivo

Definir las URLs prioritarias que hay que inspeccionar tras desplegar.

## URLs mínimas

```text
/
/es/
/en/
/es/jugar-commander-online/
/en/play-commander-online/
/es/asistente-de-mesa-magic/
/en/magic-commander-table-assistant/
/es/faq/
/en/faq/
/es/otras-formas-jugar-commander-online/
/en/ways-to-play-commander-online/
```

## Prompt para Codex

```text
Create a Search Console URL Inspection checklist.

Requirements:
- Generate a list of representative SEO URLs to inspect after deployment.
- Include:
  home
  playCommanderOnline
  tableAssistant
  faq
  waysToPlayCommanderOnline
  importCommanderDeck
  commanderDeckBuilder
- Include ES and EN at minimum.
- Add instructions to verify in Search Console:
  URL is indexed or eligible for indexing
  Google-selected canonical matches user-declared canonical
  page is not blocked by robots.txt
  page is not noindex
  rendered HTML contains visible content
  hreflang/canonical are correct
- Do not automate with private Google credentials.
```

## Done

```text
- Checklist de inspección URL creado.
- Se revisan páginas clave, no solo la home.
- No se usan credenciales privadas.
```

---

# Fase 32 — Definir dashboard de métricas SEO en Search Console

## Objetivo

Documentar qué mirar cuando haya datos.

## Prompt para Codex

```text
Create Search Console monitoring documentation for CommanderZone.

Requirements:
- Document the exact Search Console reports to monitor:
  Performance > Search results
  Indexing > Pages
  Indexing > Sitemaps
  Experience/Core Web Vitals if available
  Links
- Define filters to review:
  country
  device
  page
  query
  locale folder
- Define priority query groups:
  Commander online
  Magic online with friends
  import Commander deck
  Commander deck builder
  Asistente de mesa / life counter
  SpellTable alternative
  FAQ queries
- Define success metrics:
  impressions by landing
  CTR by landing
  queries by landing
  average position movement
  indexed URLs vs submitted URLs
- Add weekly review checklist.
- Add monthly SEO decision checklist.
```

## Done

```text
- Sabemos qué mirar en Search Console.
- Sabemos qué queries agrupar.
- Sabemos cómo decidir nuevas landings con datos reales.
```

---

# Fase 33 — Preparar integración opcional con Looker Studio / Analytics

## Objetivo

Dejar preparado reporting avanzado, sin meter tracking sin permiso.

## Prompt para Codex

```text
Prepare optional SEO reporting integration documentation.

Requirements:
- Document optional Looker Studio dashboard.
- Document optional Google Analytics 4 connection.
- Do not add analytics scripts unless explicitly approved.
- Do not add cookie-impacting scripts silently.
- Define recommended dashboard cards:
  clicks by landing
  impressions by landing
  CTR by landing
  average position by query group
  indexed pages
  sitemap status
  country/device split
- Document privacy/cookie implications if GA4 is added later.
```

## Done

```text
- Reporting avanzado documentado.
- No se añaden scripts de tracking sin aprobación.
- Search Console sigue siendo la fuente principal de SEO.
```

---

# Fase 34 — Gestionar usuarios y permisos de Search Console

## Objetivo

Evitar perder acceso o dar permisos de más.

## Prompt para Codex

```text
Document Search Console users and permissions.

Requirements:
- Document recommended access model:
  verified owner: project/domain owner
  delegated owner: trusted technical owner if needed
  full user: SEO/marketing lead if needed
  restricted user: read-only collaborators if needed
- Document that at least one verified owner must remain.
- Document not to use personal-only credentials as the single access point.
- Document access review checklist every quarter.
```

## Done

```text
- Permisos documentados.
- Menos riesgo de perder acceso.
- Accesos preparados para equipo.
```

---

# Fase 35 — Crear checklist post-deploy Search Console

## Objetivo

Que después del deploy no se olvide nada.

## Prompt para Codex

```text
Create post-deploy Search Console checklist.

Checklist:
- Verify Domain property in Search Console.
- Confirm canonical production domain.
- Confirm robots.txt is reachable.
- Confirm sitemap-index.xml is reachable.
- Submit sitemap-index.xml.
- Inspect representative SEO URLs.
- Request indexing for priority URLs if appropriate.
- Check that no runtime-i18n routes appear in sitemap.
- Check that no runtime-i18n routes are indexable.
- Check Pages report after Google processes the site.
- Check Performance report once data is available.
- Record first baseline:
  submitted URLs
  indexed URLs
  impressions
  clicks
  top queries
  top pages
- Schedule first review after 7 days.
- Schedule second review after 28 days.
```

## Done

```text
- Checklist listo para después del deploy.
- Hay baseline SEO inicial.
- Hay seguimiento a 7 y 28 días.
```

---

# Fase 36 — Implementar 404 SEO-safe

## Objetivo

Evitar rutas rotas indexables o redirecciones malas.

## Prompt para Codex

```text
Implement SEO-safe 404 handling.

Requirements:
- Add localized 404 page.
- Invalid SEO locale paths should render a proper not-found page.
- 404 pages should not be included in sitemap.
- 404 pages should use noindex.
- 404 page should link to localized home and FAQ.
- Do not redirect every invalid URL to home.
```

## Done

```text
- 404 localizado.
- 404 noindex.
- No se redirige todo a home.
```

---

# Fase 37 — Añadir `llms.txt` opcional

## Objetivo

Crear un archivo útil para crawlers de IA, sin tratarlo como factor SEO oficial de Google.

## Prompt para Codex

```text
Optionally create llms.txt for AI crawler readability.

Requirements:
- Do not treat this as a Google ranking factor.
- Include concise descriptions of CommanderZone.
- Include links to main public SEO landings.
- Include FAQ link.
- Keep it factual.
- Do not include private/internal routes.
```

## Done

```text
- llms.txt creado si se decide usar.
- Sin rutas privadas.
- Sin claims falsos.
```

---

# Fase 38 — Selector de idioma híbrido

## Objetivo

El selector debe cambiar de URL en landings SEO y cambiar runtime en app interna.

## Prompt para Codex

```text
Implement the hybrid language selector.

Requirements:
- On seo-static pages:
  language switch navigates to the equivalent localized SEO URL.
  use SEO_ROUTES to resolve translated slugs.

- On runtime-i18n pages:
  language switch updates ngx-translate runtime locale.
  do not force route changes unless the app already uses locale-prefixed internal routes.

Use native labels:
- English
- Español
- Deutsch
- Français
- Italiano
- Português
- 日本語
- 한국어
- 简体中文
- 繁體中文
- Nederlands
- Català
- Русский

Do not rely only on flags.
Do not generate mixed URLs like /en/jugar-commander-online/.
```

## Done

```text
- Selector correcto en SEO.
- Selector correcto en app interna.
- No hay slugs mezclados.
```

---

# Fase 39 — Control de indexación final

## Objetivo

Confirmar que solo rankean landings SEO.

## Prompt para Codex

```text
Add final indexation controls.

Requirements:
- All seo-static pages must be indexable.
- All runtime-i18n internal pages must use noindex.
- Out-of-scope pages must not be indexable.
- Noindex pages must not be included in sitemap.
- Do not block noindex pages in robots.txt if crawler needs to read the noindex meta.
- Add localized not-found route for invalid SEO paths.
- Invalid locale paths should render a proper not-found page.
```

## Done

```text
- Landings SEO indexables.
- App interna noindex.
- Sitemap limpio.
- 404 controlado.
```

---

# Fase 40 — QA lingüístico SEO

## Objetivo

Evitar traducciones malas, claims inventados o mezclas de idiomas.

## Prompt para Codex

```text
Audit all seo-static landing translations.

Check:
- no placeholders
- no untranslated Spanish leftovers
- no untranslated English leftovers
- no visible translation keys
- natural Magic: The Gathering terminology
- neutral competitor comparisons
- no invented features
- title length
- meta description length
- unique H1 per landing
- no duplicated thin content

Return:
- report per landing
- report per locale
- files fixed
```

## Done

```text
- Sin placeholders.
- Sin mezcla de idiomas.
- Sin claims inventados.
- Reporte por idioma y landing.
```

---

# Fase 41 — QA visual responsive multiidioma

## Objetivo

Comprobar que todas las landings, FAQ y app interna funcionan en todos los idiomas.

## Prompt para Codex

```text
Run visual/responsive QA for all SEO landings, FAQ and internal translated app pages.

Requirements:
- Check every SEO landing in:
  es, en, de, fr, it, pt, ja, ko, zh-hans, zh-hant, nl, ca, ru.

- Check breakpoints:
  360px
  390px
  768px
  1024px
  1280px
  1440px

- Check:
  header
  language selector
  hero
  CTA buttons
  feature grids
  steps
  comparison blocks
  FAQ accordions
  footer
  internal links
  Asistente de mesa landing
  FAQ page
  table assistant UI

- Ensure:
  no horizontal scroll
  no broken text
  no overlapping buttons
  no clipped cards
  no hidden SEO content
  no layout shift caused by images
  good touch targets on mobile
  consistent spacing across all landings

Fix layout issues using shared components, not page-specific hacks.
```

## Done

```text
- Landings no se rompen.
- FAQ usable.
- Selector usable.
- App interna usable.
- Asistente de mesa usable en móvil/tablet.
```

---

# Fase 42 — Validaciones automáticas finales

## Objetivo

Que una futura PR no rompa la arquitectura.

## Prompt para Codex

```text
Create SEO/i18n validation scripts.

Checks:
- SEO landing components must not use TranslatePipe.
- SEO landing components must not inject TranslateService.
- SEO landing main content must come from static content files.
- Every SEO URL has one title.
- Every SEO URL has one meta description.
- Every SEO URL has one canonical.
- Canonical points to itself.
- Every SEO URL has hreflang alternates.
- Hreflang alternates are reciprocal.
- Every SEO URL is in sitemap.
- No private route is in sitemap.
- Every prerendered SEO HTML contains H1.
- Every prerendered SEO HTML contains main content.
- No landing contains visible translation keys.
- No landing contains placeholder text.
- No duplicate slugs within same locale.
- App translation JSON files have no missing keys.
- Runtime-i18n pages do not contain hardcoded visible UI strings.
- SEO static content files exist for every locale and landing.
- Every seo-static page uses the shared SeoLandingLayoutComponent.
- FAQ uses FaqLandingTemplate or approved FAQ shared components.
- No seo-static page contains duplicated large layout markup.
- Header and footer are shared across SEO landings.
- Internal links use real href anchors.
```

## Done

```text
- Validaciones automáticas creadas.
- Pueden ejecutarse en CI.
- Si alguien mezcla SEO con ngx-translate, falla.
- Si alguien crea una landing no reutilizable, falla.
```

---

# Fase 43 — Auditoría final página por página

## Objetivo

Codex debe comprobar ruta por ruta que cada página usa el sistema correcto.

## Prompt para Codex

```text
Run a final page-by-page audit of the hybrid translation and SEO architecture.

For every route, verify:

If strategy is seo-static:
- It is a new public SEO landing or approved SEO page.
- It uses static localized content.
- It does not use TranslatePipe.
- It does not inject TranslateService.
- It does not load main copy from ngx-translate JSON.
- It uses shared responsive landing components.
- It is prerendered.
- It has localized title.
- It has localized meta description.
- It has localized H1.
- It has self canonical.
- It has hreflang.
- It is included in sitemap.
- It is indexable.

If strategy is runtime-i18n:
- It uses ngx-translate for user-visible strings.
- It has noindex.
- It is excluded from sitemap.
- It is not treated as an SEO landing.

If strategy is out-of-scope:
- It is excluded from sitemap.
- It is not indexable.

Also check:
- no mixed localized slugs
- no private routes in sitemap
- no canonical across languages
- no missing translation keys
- no placeholders
- no visible translation keys
- all Asistente de mesa naming is consistent in Spanish
- tableAssistant SEO landing is separate from the internal tool route
- all SEO links are crawlable href links
- all SEO files exist: robots, sitemap, manifest, favicons if available

Return:
- route-by-route table
- PASS/FAIL
- exact files to fix for every FAIL
```

## Done

```text
- Todas las páginas auditadas.
- Cada ruta usa el sistema correcto.
- Las SEO usan contenido estático.
- Las internas usan ngx-translate.
- No hay mezcla peligrosa.
```

---

# Fase 44 — Documentación final

## Objetivo

Que nadie rompa la arquitectura después.

## Prompt para Codex

```text
Create documentation for the hybrid SEO/i18n architecture.

Document:
- Which pages are seo-static.
- Which pages are runtime-i18n.
- Which pages are out-of-scope.
- Why ngx-translate is only for internal/non-indexable pages.
- Why SEO landings use static localized content.
- How to add a new SEO landing.
- How to add a new runtime translation key.
- How to add a new locale.
- How sitemap is generated.
- How hreflang is generated.
- How canonical works.
- How redirects work.
- How robots.txt works.
- How noindex is applied.
- How Open Graph/Twitter Cards are generated.
- How JSON-LD is generated.
- How to run SEO validation.
- How the hybrid language selector works.
- How the reusable landing system works.
- Official product naming:
  Spanish: Asistente de mesa

Rules:
- No TranslatePipe in SEO landing content.
- No TranslateService in SEO landing components.
- No client-only translations for SEO landing main copy.
- No canonical across languages.
- No private routes in sitemap.
- No hidden SEO text.
- No landing per keyword variation.
- Existing internal app pages must not be converted into SEO pages.
- All SEO landings must reuse shared responsive components.
```

## Done

```text
- docs/seo-i18n.md creado.
- Reglas claras para el equipo.
- Mantenimiento futuro controlado.
```

---

# Fase 45 — Checklist final de producción

## Objetivo

Confirmar que todo queda listo antes de publicar.

## Prompt para Codex

```text
Run the final production readiness checklist for SEO and i18n.

Verify:
- 10 SEO landings exist.
- 13 locales exist.
- 130 localized SEO URLs are generated.
- All SEO pages are prerendered.
- All SEO pages are responsive.
- All SEO pages use shared landing components.
- All SEO pages have localized title.
- All SEO pages have localized meta description.
- All SEO pages have localized H1.
- All SEO pages have localized copy.
- All SEO pages have self canonical.
- All SEO pages have hreflang alternates.
- All SEO pages are in sitemap.
- Runtime-i18n pages are noindex.
- Runtime-i18n pages are excluded from sitemap.
- All runtime user-visible strings are in ngx-translate JSON.
- All SEO strings are in static localized content.
- FAQ is public and linked from header, footer, home and app help/settings if available.
- Asistente de mesa SEO landing exists.
- Asistente de mesa internal tool remains runtime-i18n/noindex unless explicitly approved as SEO.
- robots.txt exists.
- sitemap-index.xml or sitemap.xml exists.
- manifest.webmanifest exists.
- favicons are referenced if available.
- Open Graph images are configured.
- JSON-LD is present where expected.
- Search Console verification is documented.
- Cookie consent and analytics placeholders do not damage SEO.
- 404 page is localized and noindex.
- No placeholder text.
- No visible translation keys.
- No hidden SEO text.
- No private routes in sitemap.
- Build passes.
- Tests pass.
- SEO validation passes.
- i18n validation passes.
- Responsive QA passes.

Return:
- PASS/FAIL
- remaining blockers
- recommended manual checks before deployment
```

## Done

```text
- Todo queda listo para SEO técnico.
- Todo queda listo para multiidioma.
- Bloqueos claros si algo falla.
```

---

# Orden final completo

```text
1. Decidir qué páginas rankean
2. Crear manifiesto de estrategia por página
3. Crear configuración global de idiomas
4. Instalar ngx-translate al principio
5. Inventario global de cadenas visibles
6. Migrar strings visibles internos a JSON i18n
7. Validar que ngx-translate no invade SEO
8. Crear mapa de nuevas rutas SEO
9. Crear infraestructura de landings nuevas
10. Crear sistema visual responsive reutilizable
11. Crear plantillas reutilizables por tipo de landing
12. Crear sistema de contenido SEO estático localizado
13. Crear las 10 landings públicas nuevas
14. Crear FAQ público indexable y acceso rápido
15. Crear SeoService
16. SSR/prerender de landings SEO
17. Crear paquete completo de ficheros y assets SEO
18. Crear robots.txt completo
19. Crear sitemaps multiidioma completos
20. Definir canonical, trailing slash, dominio y redirects
21. Implementar meta robots / noindex por ruta
22. Implementar Open Graph y Twitter Cards
23. Implementar JSON-LD completo
24. Validar enlaces internos crawlables
25. Optimizar imágenes y assets visuales
26. Optimizar Core Web Vitals/performance SEO
27. Preparar cookies, consentimiento y Analytics sin dañar SEO
28. Preparar propiedad de Google Search Console
29. Soporte técnico para verificación
30. Envío de sitemap a Search Console
31. Configurar inspección de URLs clave
32. Definir dashboard de métricas SEO en Search Console
33. Preparar integración opcional con Looker Studio / Analytics
34. Gestionar usuarios y permisos de Search Console
35. Crear checklist post-deploy Search Console
36. Implementar 404 SEO-safe
37. Añadir llms.txt opcional
38. Selector de idioma híbrido
39. Control de indexación final
40. QA lingüístico SEO
41. QA visual responsive multiidioma
42. Validaciones automáticas finales
43. Auditoría final página por página
44. Documentación final
45. Checklist final de producción
```

---

# Resultado final esperado

Al terminar todo, CommanderZone debe tener:

```text
- Web multiidioma real.
- 10 landings SEO públicas nuevas.
- 13 idiomas.
- 130 URLs SEO localizadas.
- Landings responsive desde el inicio.
- Sistema visual reutilizable.
- FAQ público indexable.
- Asistente de mesa con landing propia.
- App interna traducida con ngx-translate.
- Rutas internas noindex.
- Sitemap multiidioma.
- robots.txt.
- canonical correcto.
- hreflang correcto.
- Open Graph.
- Twitter Cards.
- JSON-LD.
- manifest.webmanifest.
- favicons.
- 404 SEO-safe.
- Search Console preparada.
- Cookies/Analytics preparados sin dañar SEO.
- Validaciones automáticas.
- Auditoría final página por página.
```

## Nota crítica final

Este plan deja CommanderZone con una base SEO, multiidioma y técnica muy fuerte. No se debe vender como “ranking top garantizado”, porque eso depende también de autoridad, enlaces, comunidad, competencia y datos reales de Search Console.

La frase correcta es:

> CommanderZone quedará preparado para competir fuerte en SEO multiidioma y en resultados de IA, con una arquitectura limpia, escalable y difícil de romper.
