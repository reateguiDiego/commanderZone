# Search Console Sitemap Submission

Phase 30 prepares the manual sitemap submission workflow for CommanderZone.

## Sitemap Files

The public sitemap entry point is:

```text
https://commanderzone.com/sitemap-index.xml
```

`robots.txt` must reference the final sitemap index:

```text
Sitemap: https://commanderzone.com/sitemap-index.xml
```

The sitemap index currently points to:

```text
https://commanderzone.com/sitemaps/sitemap-seo.xml
```

Submit the sitemap index, not individual localized landing URLs.

## Manual Search Console Steps

The human owner should complete these steps after the Search Console property is verified and the production deployment is live:

1. Open the verified `commanderzone.com` property in Google Search Console.
2. Go to **Indexing > Sitemaps**.
3. Submit `sitemap-index.xml`.
4. Check that Search Console discovers the nested sitemap and URLs.
5. Check processing errors and fix real crawl, canonical, redirect, or XML issues if they appear.

Sitemap submission is a discovery hint for Google. It does not guarantee crawling, indexing, ranking, or immediate Search Console reporting.

## Post-Deploy Checklist

Before submitting or resubmitting the sitemap, verify:

- `https://commanderzone.com/sitemap-index.xml` returns HTTP 200.
- `https://commanderzone.com/sitemaps/sitemap-seo.xml` returns HTTP 200.
- `https://commanderzone.com/robots.txt` returns HTTP 200.
- `robots.txt` includes `Sitemap: https://commanderzone.com/sitemap-index.xml`.
- `sitemap-index.xml` uses the canonical production domain: `https://commanderzone.com`.
- `sitemaps/sitemap-seo.xml` uses the canonical production domain for all `<loc>` URLs.
- Internal/runtime routes are not included in the SEO sitemap.
- The sitemap includes only indexable public SEO landing URLs.

## Scope Boundary

This phase does not inspect individual URLs, request indexing, configure Search Console reports, or manage Search Console users. Those are separate phases.
