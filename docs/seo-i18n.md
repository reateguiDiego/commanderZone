# CommanderZone SEO/i18n architecture

CommanderZone uses a hybrid SEO and i18n architecture:

- Public rankable pages are static localized SEO landings.
- Internal and non-rankable app pages use runtime i18n through `ngx-translate`.
- Debug, wildcard and demo routes are out of scope for SEO and must not be indexed.

The source of truth for page strategy is `frontend/src/app/core/localization/page-translation-strategy.ts`.

## Page Strategies

### seo-static

These pages are public SEO landings. They must use static localized content, localized routes, prerender, canonical, hreflang, sitemap entries and shared landing components.

| Page key | Purpose |
|---|---|
| `home` | Public localized home landing |
| `playCommanderOnline` | Play Commander online landing |
| `playMagicOnlineWithFriends` | Play Magic online with friends landing |
| `createCommanderRoom` | Create Commander room landing |
| `importCommanderDeck` | Import Commander deck landing |
| `commanderDeckBuilder` | Commander deck builder landing |
| `tableAssistant` | Public SEO landing for Asistente de mesa |
| `waysToPlayCommanderOnline` | Comparison/options landing |
| `howToPlayCommanderOnline` | Guide landing |
| `faq` | Public FAQ landing |

There are 10 logical SEO landings, 13 locales and 130 localized SEO URLs.

### runtime-i18n

These pages are internal or non-rankable. They use runtime JSON translations and must be `noindex`.

| Page key | Route or area |
|---|---|
| `login` | `/auth/login` |
| `register` | `/auth/register` |
| `passwordReset` | `/auth/password-reset` |
| `emailVerification` | `/email-verification` |
| `app` | Authenticated app shell / root app entry |
| `dashboard` | `/dashboard` |
| `cards` | `/cards` |
| `cardDetail` | `/cards/:scryfallId` |
| `rooms` | `/rooms` |
| `waitingRoom` | `/rooms/:id/waiting` |
| `game` | `/games/:id` |
| `profile` | Internal profile area |
| `settings` | Internal settings area |
| `account` | Internal account area |
| `decks` | `/decks` |
| `deckEditor` | `/decks/:id` |
| `tableAssistantApp` | `/table-assistant`, `/table-assistant/:id` |

### out-of-scope

These routes are not SEO pages and must not be indexed or included in sitemap.

| Page key | Route |
|---|---|
| `demoRoom` | `/room/:id` |
| `gameDebug` | `/games/:id/debug` |
| `wildcardRedirect` | `**` |

## Why `ngx-translate` Is Internal Only

`ngx-translate` loads copy at runtime. That is correct for internal app UI because users are already inside the product and pages are non-rankable.

SEO landing main copy must not depend on runtime translation loading. Search engines and AI crawlers need the localized title, description, H1 and body content in prerendered HTML. For that reason, SEO landings must not use `TranslatePipe`, inject `TranslateService`, or load main copy from `assets/i18n/*.json`.

## Why SEO Uses Static Localized Content

Static localized SEO content keeps each localized URL deterministic:

- The URL slug is localized.
- The title and meta description are localized.
- The H1 and visible body copy are localized.
- Canonical points to the same localized URL.
- Hreflang points to equivalent localized URLs.
- The page can be prerendered and included in sitemap.

The SEO content registry lives under `frontend/src/app/features/seo-landings/content/`.

## Reusable Landing System

Do not create one component per language. Do not create one landing component per locale.

Each logical SEO landing uses the same route component and shared rendering system:

- `SeoLandingRouteComponent` selects static content by `routeKey` and `locale`.
- `SeoLandingPageComponent` chooses the reusable template for the landing intent.
- `SeoLandingLayoutComponent` owns the shared public header, main wrapper, internal links and footer.
- Template components render landing types:
  - `ProductLandingTemplateComponent`
  - `GuideLandingTemplateComponent`
  - `ComparisonLandingTemplateComponent`
  - `FaqLandingTemplateComponent`
- Shared section components render hero, feature grid, FAQ, CTA, sections, comparison and related links.

Locale differences must come from localized routes and static localized content, not duplicated Angular components.

## How To Add A New SEO Landing

Only add a new SEO landing for a new approved search intent, not for a keyword variation.

1. Add the page key as `seo-static` in `frontend/src/app/core/localization/page-translation-strategy.ts`.
2. Add localized slugs for every locale in `frontend/src/app/core/localization/seo-routes.ts`.
3. Add static localized content under `frontend/src/app/features/seo-landings/content/`.
4. Register the content in `SEO_LANDING_CONTENT`.
5. Assign the page to a shared template in `frontend/src/app/features/seo-landings/models/seo-landing-template.model.ts`.
6. Ensure content includes localized SEO title, meta description, H1, FAQ, internal links, OG image and JSON-LD.
7. Run:

```bash
cd frontend
npm run write:seo-prerender-routes
npm run generate:sitemap
npm run validate:seo-assets
npm run validate:seo-i18n
npm test -- --watch=false
npm run build
```

Do not reuse internal app screens as SEO landings.

## How To Add A Runtime Translation Key

Runtime keys belong to internal/non-indexable pages only.

1. Add the key to every JSON file in `frontend/src/assets/i18n/`.
2. Use the existing runtime translation APIs or `runtimeTranslate` pipe in internal UI.
3. Keep key names under the existing namespaces such as `common`, `navigation`, `auth`, `rooms`, `game`, `deckBuilder`, `tableAssistant`, `profile`, `settings`, `forms`, `errors`, `modals`, `toasts` and `emptyStates`.
4. Run:

```bash
cd frontend
npm run validate:seo-i18n
npm test -- --watch=false
```

Do not add runtime translation keys for SEO landing main copy.

## How To Add A Locale

Adding a locale affects both SEO and runtime i18n.

1. Add the locale in `frontend/src/app/core/localization/locale-config.ts`.
2. Map it in runtime language selection if needed.
3. Add its runtime JSON file in `frontend/src/assets/i18n/`.
4. Add localized SEO slugs for every SEO route in `seo-routes.ts`.
5. Add static SEO content for every SEO landing.
6. Ensure `hreflang`, sitemap and prerender routes regenerate.
7. Run the full SEO validation and build commands.

The SEO URL count should equal `seo-static page count * locale count`.

## Sitemap

Sitemap generation is script-driven:

- Source config: `frontend/src/app/core/localization/locale-config.ts` and `frontend/src/app/core/localization/seo-routes.ts`.
- Generator: `frontend/scripts/seo-sitemap-generator.mjs`.
- Command: `npm run generate:sitemap`.
- Output:
  - `frontend/public/sitemap-index.xml`
  - `frontend/public/sitemaps/sitemap-seo.xml`

Only `seo-static` URLs belong in sitemap. Private, runtime-i18n and out-of-scope routes must stay out.

## Hreflang

Hreflang is generated from the localized SEO route map. Every localized SEO URL must link to all locale alternates plus `x-default`.

Rules:

- Hreflang alternates must be reciprocal.
- Hreflang must point to equivalent localized URLs.
- Do not mix locale prefixes and slugs from different languages.

## Canonical

Canonical URLs are generated by `SeoService`.

Rules:

- Every SEO URL has exactly one canonical.
- Canonical points to itself.
- Do not canonicalize one language to another.
- Runtime and out-of-scope routes are not SEO canonical targets.

## Redirects

Redirects must preserve the SEO architecture:

- Canonical production origin is `https://www.commanderzone.com`.
- Redirect rules must not create alternate canonical hosts.
- Redirect validation is handled by `npm run validate:canonical`.
- Do not redirect localized SEO URLs to a different language unless it is a deliberate user navigation outside canonical metadata.

## robots.txt

`frontend/public/robots.txt` points crawlers to the sitemap index.

Rules:

- SEO landings are indexable.
- Internal app routes are not meant to rank and must stay out of sitemap.
- Robots validation is handled by `npm run validate:robots`.

## Noindex

Noindex is strategy-driven:

- `seo-static` -> `index, follow`
- `runtime-i18n` -> `noindex, follow`
- `out-of-scope` -> `noindex, nofollow`

The route robots metadata is controlled by `frontend/src/app/core/seo/route-robots.ts` and `RouteRobotsMetaService`.

## Open Graph And Twitter Cards

SEO metadata is applied by `SeoService` from static landing content:

- title
- description
- Open Graph title
- Open Graph description
- Open Graph image
- Twitter card tags
- image dimensions
- locale alternates

OG images live under `frontend/public/assets/og/` and are validated by `npm run validate:seo-images`.

## JSON-LD

JSON-LD is generated from static SEO content. Expected graph nodes depend on landing type:

- `Organization`
- `BreadcrumbList`
- `WebSite` for home
- `SoftwareApplication` for product-style landings
- `Article` for guide/comparison landings
- `FAQPage` when visible FAQ content exists

Do not add fake review or rating schema.

## Hybrid Language Selector

SEO and runtime language selection are related but separate.

SEO landings:

- Use localized URL alternates.
- Render crawlable `<a href>` links through `SeoLanguageSelectorComponent`.
- Do not switch main copy with client-side translation.

Runtime app:

- Uses user language preferences and runtime JSON translations.
- Uses `RuntimeLanguageSelectorService` to map app language codes to SEO locale codes where needed.

## SEO Validation

Run these commands from `frontend`:

```bash
npm run validate:seo-assets
npm run validate:seo-i18n
npm test -- --watch=false
npm run build
```

Useful focused commands:

```bash
npm run validate:sitemap
npm run validate:canonical
npm run validate:seo-final
npm run validate:seo-links
npm run validate:seo-images
npm run validate:robots
npm run validate:indexation
```

There is no `lint` script currently configured in `frontend/package.json`.

## Hard Rules

- No `TranslatePipe` in SEO landing content.
- No `TranslateService` in SEO landing components.
- No client-only translations for SEO landing main copy.
- No canonical across languages.
- No private routes in sitemap.
- No hidden SEO text.
- No landing per keyword variation.
- Existing internal app pages must not be converted into SEO pages.
- All SEO landings must reuse shared responsive components.
- All SEO links must be crawlable anchors with real `href`.
- No visible translation keys or placeholder text.

## Official Product Naming

Spanish feature name: `Asistente de mesa`.

Use `Asistente de mesa` for the physical table helper feature in Spanish. Keep the public SEO page `tableAssistant` separate from the internal runtime-i18n tool route `tableAssistantApp`.
