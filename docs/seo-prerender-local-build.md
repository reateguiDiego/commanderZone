# SEO prerender local build

CommanderZone uses Angular prerender for public SEO landings.

Run from `frontend`:

```bash
npm run build:prerender
```

This command regenerates `src/seo-prerender-routes.txt` from the typed SEO route manifest and runs the production Angular build. The generated route file must contain 130 URLs: 10 logical SEO landings across 13 locales.

The prerender output is written to `frontend/dist/frontend/browser`. Each localized SEO URL should have an `index.html` with initial HTML content, including title, meta description, canonical, hreflang alternates, H1, landing copy, FAQ content, and JSON-LD.

Internal runtime routes such as `/games/:id`, `/profile`, `/settings`, `/app`, dashboard routes, and the internal table assistant are configured for client rendering and are not included in `src/seo-prerender-routes.txt`.
