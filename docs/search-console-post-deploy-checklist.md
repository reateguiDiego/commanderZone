# Search Console Post-Deploy Checklist

Phase 35 defines the manual Search Console checklist to run after the SEO/i18n deployment is live.

Use the verified `commanderzone.com` Search Console property. Do not use private credentials in scripts, commits, tickets, or shared documents.

## Immediate Post-Deploy Checks

Complete these checks after the production deployment finishes:

- Verify the Domain property in Google Search Console.
- Confirm the canonical production domain is `https://www.commanderzone.com`.
- Confirm `https://www.commanderzone.com/robots.txt` is reachable.
- Confirm `https://www.commanderzone.com/sitemap-index.xml` is reachable.
- Confirm `https://www.commanderzone.com/sitemaps/sitemap-seo.xml` is reachable.
- Confirm `robots.txt` references `Sitemap: https://www.commanderzone.com/sitemap-index.xml`.
- Submit `sitemap-index.xml` in **Indexing > Sitemaps**.
- Inspect representative SEO URLs from `docs/search-console-url-inspection-checklist.md`.
- Request indexing for priority URLs if Search Console says they are eligible and the live test is clean.
- Check that no `runtime-i18n` routes appear in the sitemap.
- Check that no `runtime-i18n` routes are indexable.
- Check **Indexing > Pages** after Google processes the site.
- Check **Performance > Search results** once data is available.

## Initial Baseline

Record the first baseline after the sitemap has been submitted and Search Console starts reporting data.

| Metric | Baseline value | Date checked | Notes |
| --- | --- | --- | --- |
| Submitted URLs |  |  |  |
| Indexed URLs |  |  |  |
| Impressions |  |  |  |
| Clicks |  |  |  |
| Top queries |  |  |  |
| Top pages |  |  |  |

Keep the first baseline as context. Early values can be incomplete while Google discovers, crawls, and processes the site.

## 7-Day Review

Schedule the first review 7 days after deploy.

Check:

- Sitemap status and discovered URL count.
- Indexed URLs vs submitted URLs.
- Any excluded pages that should be indexable.
- Any indexed internal/runtime pages that should be `noindex`.
- Representative URL Inspection results for the highest-priority URLs.
- First impressions, clicks, queries, and pages if available.
- Any crawl, canonical, redirect, or robots issues.

## 28-Day Review

Schedule the second review 28 days after deploy.

Check:

- Indexed URLs vs submitted URLs trend.
- Landing-level impressions and clicks.
- CTR by landing.
- Average position by priority query group.
- Top queries and top pages.
- Locale folder performance for `/es/` and `/en/`.
- Mobile vs desktop split if enough data exists.
- Whether existing landing copy should be improved before creating any new landing.

## Runtime Route Guardrail

Runtime/internal pages must remain outside the sitemap and must not be indexable.

Spot-check examples:

- `/auth/login`
- `/auth/register`
- `/dashboard`
- `/decks`
- `/rooms`
- `/table-assistant`
- `/games/{id}`

Do not block these with `robots.txt` as the primary mechanism if Google needs to read a `noindex` directive. Use the route-level noindex behavior defined by the app.

## Follow-Up Decisions

Use Search Console data before deciding SEO changes:

- Fix crawl/indexing errors before changing content strategy.
- Improve existing SEO landings before creating new landings.
- Create a new landing only if Search Console shows a distinct search intent that cannot be served by the current 10 logical SEO landings.
- Keep Search Console as the primary SEO source of truth.

## Scope Boundary

This phase does not implement 404 handling, redirects, routing changes, new landings, analytics scripts, or Search Console automation.
