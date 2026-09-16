# Backend sitemap handoff

The frontend keeps generating the static landing sitemap at `sitemap-index.xml` and `sitemaps/sitemap-seo.xml`. Community URLs are deliberately excluded. When dynamic sitemap delivery is implemented, the backend owns that community-only process.

## Public contract

- Serve backend-generated community child sitemaps from the canonical production origin, for example paginated deck, user, commander and card sitemaps.
- Once those endpoints are deployed, replace the static `GET /sitemap-index.xml` with an aggregator that references both the preserved static sitemap and the backend community child sitemaps.
- Return XML with `application/xml; charset=utf-8`, a stable canonical URL in every `<loc>`, and cache headers appropriate for the refresh frequency.
- Keep the existing `Sitemap` directive in `frontend/public/robots.txt`; it already points to the static index.

## Data and indexation rules

- Build community entries from backend data, with deterministic pagination and no frontend-file fallback.
- Include only canonical, publicly indexable URLs. Exclude authentication, settings, games, rooms, dashboards, private decks, redirects, and every `noindex` route.

## Operational requirements

- Generate asynchronously or cache the result; never make the sitemap endpoint depend on a full live traversal at request time.
- Publish a complete new sitemap set atomically so the index never references partial child files.
- Cover the endpoint, URL filtering, locale alternates, pagination, canonical origin, and XML validity with backend tests.
- Monitor endpoint availability and expose an explicit refresh command or scheduled job before enabling the robots directive.
