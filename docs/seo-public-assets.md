# SEO public assets

Phase 17 adds the public SEO asset package used by crawlers, social previews, and install surfaces.

## Local files

- `frontend/public/robots.txt`
- `frontend/public/sitemap-index.xml`
- `frontend/public/sitemaps/sitemap-seo.xml`
- `frontend/public/favicon.ico`
- `frontend/public/favicon.svg`
- `frontend/public/apple-touch-icon.png`
- `frontend/public/manifest.webmanifest`
- `frontend/public/assets/og/default-og.png`
- `frontend/public/assets/og/home-og.png`
- `frontend/public/assets/og/play-commander-og.png`
- `frontend/public/assets/og/table-assistant-og.png`
- `frontend/public/assets/og/faq-og.png`
- `frontend/public/assets/og/ways-to-play-og.png`

## Production values to confirm before deployment

- Confirm the canonical production domain in `robots.txt` and `sitemap-index.xml`.
- Replace generated Open Graph placeholders with final branded 1200x630 images if design-approved assets become available.
- Confirm the sitemap domain before deployment if the production host changes.
- Add a Google Search Console HTML verification file only after Google provides a real token. Do not commit fake verification tokens.

## Sitemap generation

Run from `frontend`:

```bash
npm run generate:sitemap
npm run validate:sitemap
npm run validate:canonical
```

The generator reads `SEO_ROUTES` and `SUPPORTED_LOCALES`, writes `sitemap-index.xml` and `sitemaps/sitemap-seo.xml`, and includes every localized SEO URL with self-referencing `hreflang`, all locale alternates, and `x-default`.

The validator fails if the generated XML is stale, omits a SEO URL, includes a runtime/private route, misses `hreflang`, or contains a localized URL that does not match the configured slug for its locale.

## robots.txt validation

Run from `frontend`:

```bash
npm run validate:robots
```

The validator fails if `robots.txt` contains `Disallow: /`, blocks any public SEO landing, misses the sitemap reference, or tries to hide runtime/internal routes. Internal routes must rely on route-level `noindex` when that phase is implemented, not on robots blocking.
