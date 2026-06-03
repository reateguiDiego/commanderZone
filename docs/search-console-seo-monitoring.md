# Search Console SEO Monitoring

Phase 32 defines what to monitor in Google Search Console when CommanderZone has production SEO data.

Use this document after the domain property is verified, the sitemap has been submitted, and Search Console has enough data to review. Search Console remains the primary source for SEO decisions; do not create new landings from assumptions alone.

## Reports To Monitor

Review these Search Console reports:

- **Performance > Search results**: impressions, clicks, CTR, average position, queries, pages, countries, devices, and dates.
- **Indexing > Pages**: indexed pages, excluded pages, `noindex`, crawl issues, redirects, duplicate/canonical issues, and soft 404s.
- **Indexing > Sitemaps**: submitted sitemap status, discovered URLs, read errors, and submitted vs indexed URL counts.
- **Experience > Core Web Vitals**: mobile and desktop URL groups if enough field data is available.
- **Links**: external links, internal links, top linked pages, and anchor context.

## Filters To Review

Use filters to isolate useful signals:

- **Country**: start with Spain, United States, and any country that generates meaningful impressions.
- **Device**: compare mobile and desktop performance separately.
- **Page**: inspect each SEO landing instead of only reviewing aggregate traffic.
- **Query**: group similar query intent instead of reacting to one-off searches.
- **Locale folder**: compare `/es/`, `/en/`, and other locale folders as they start receiving data.

## Priority Query Groups

Group queries by search intent:

- **Commander online**: `commander online`, `play commander online`, `jugar commander online`, related localized variants.
- **Magic online with friends**: `play magic online with friends`, `jugar magic online con amigos`, related localized variants.
- **Import Commander deck**: `import commander deck`, `importar mazo commander`, deck import and decklist import queries.
- **Commander deck builder**: `commander deck builder`, `deck builder commander`, `constructor mazos commander`.
- **Asistente de mesa / life counter**: `asistente de mesa magic`, `commander life counter`, `mtg life counter`, `contador vida mtg`.
- **SpellTable alternative**: `spelltable alternative`, `alternativa spelltable`, webcam Commander alternatives.
- **FAQ queries**: setup, account, room, deck import, device, and troubleshooting questions.

## Success Metrics

Track these metrics over time:

- Impressions by landing.
- CTR by landing.
- Queries by landing.
- Average position movement by query group.
- Indexed URLs vs submitted URLs.
- Pages with canonical mismatches or indexing exclusions.
- Mobile vs desktop Core Web Vitals groups when available.

Do not treat one week of data as proof of success or failure. Compare trends over several weeks and account for deploy dates, content changes, and indexing delays.

## Weekly Review Checklist

Every week:

- Review **Performance > Search results** for the last 7 and 28 days.
- Check impressions, clicks, CTR, and average position by landing.
- Review top queries for each priority query group.
- Compare ES and EN locale folders.
- Check **Indexing > Pages** for new exclusions or canonical issues.
- Check **Indexing > Sitemaps** for read or processing errors.
- Note any landing with impressions but very low CTR.
- Note any landing with good position but weak clicks.
- Note any query group that is growing but lacks a well-matched landing.

## Monthly SEO Decision Checklist

Every month:

- Identify query groups with sustained impressions and poor matching content.
- Decide whether existing landing copy should be improved before creating a new landing.
- Consider a new landing only when the intent is distinct from the 10 approved SEO landings.
- Check whether a locale is gaining impressions but has weak CTR or weak average position.
- Review indexed URLs vs submitted URLs and investigate persistent gaps.
- Review Core Web Vitals if available and prioritize mobile regressions.
- Review external and internal links to understand which pages receive authority.
- Document decisions with the query group, target locale, affected landing, and supporting Search Console data.

## Decision Rules

Use Search Console data to improve existing landings first. Create new SEO landings only when data shows a distinct search intent that cannot be served cleanly by the current 10 logical SEO landings.

Do not create one landing per keyword variation. Do not duplicate components or templates per locale. Locale differences must continue to come from localized routes and static localized content.

## Scope Boundary

This phase does not add Analytics, Looker Studio, tracking scripts, dashboards outside Search Console, or automated reporting. Those belong to separate phases.
