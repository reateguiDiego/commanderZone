# SEO prerender local build

CommanderZone uses Angular prerender for public SEO landings.

Run from `frontend`:

```bash
npm run build:prerender
```

This command regenerates `src/seo-prerender-routes.txt` from the typed SEO route manifest and runs the production Angular build. The generated route file currently contains 90 localized SEO landings (15 landings across 6 SEO locales); legal pages are included only in the combined prerender manifest.

The prerender output is written to `frontend/dist/frontend/browser`. Each localized SEO URL should have an `index.html` with initial HTML content, including title, meta description, canonical, hreflang alternates, H1, landing copy, FAQ content, and JSON-LD.

Internal runtime routes such as `/games/:id`, `/profile`, `/settings`, `/app`, dashboard routes, the internal table assistant, and every `/community/*` route are configured for client rendering and are not included in `src/seo-prerender-routes.txt`.
