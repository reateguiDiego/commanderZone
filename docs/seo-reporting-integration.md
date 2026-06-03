# Optional SEO Reporting Integration

Phase 33 documents optional advanced reporting for CommanderZone without enabling tracking.

Search Console remains the primary SEO source of truth. Looker Studio and Google Analytics 4 are optional reporting layers, not prerequisites for SEO indexing or ranking decisions.

## Current Boundary

- No Analytics, GA4, GTM, Looker Studio connector, tracking script, cookie-impacting script, or measurement ID is added by this phase.
- Do not add analytics scripts unless explicitly approved in a dedicated implementation task.
- Do not add cookie-impacting scripts silently.
- Do not commit fake GA4, GTM, or Looker Studio identifiers.
- Any future analytics integration must respect the existing consent architecture.

## Optional Looker Studio Dashboard

A future Looker Studio dashboard may connect to Search Console data to make SEO trends easier to review.

Recommended data source:

- Google Search Console Domain property for `commanderzone.com`.

Recommended dashboard cards:

- Clicks by landing.
- Impressions by landing.
- CTR by landing.
- Average position by query group.
- Indexed pages.
- Sitemap status.
- Country/device split.

Recommended filters:

- Date range.
- Landing URL.
- Locale folder.
- Country.
- Device.
- Query group.

Looker Studio should not become the source of truth for crawl/indexing decisions. If numbers differ, use Search Console directly for operational decisions.

## Optional Google Analytics 4 Connection

GA4 can be considered later only if product analytics are explicitly approved and legal/privacy requirements are complete.

Potential future uses:

- Compare organic landing visits with downstream product actions.
- Understand device and engagement patterns after consent.
- Measure landing-to-app entry points without collecting personal identifiers.

Do not use GA4 to replace Search Console SEO metrics. GA4 does not provide Google query, canonical, sitemap, or indexing status.

## Privacy And Cookie Implications

If GA4 is added later:

- Analytics must remain disabled until consent allows it.
- Google Consent Mode must be configured before any analytics script loads.
- Rejection of optional cookies must keep the app fully usable.
- Events must not include emails, usernames, room codes, deck names, private game IDs, or other personal identifiers.
- The privacy policy and cookie policy must be reviewed before production.
- Legal copy must explain provider, purpose, retention, consent withdrawal, and optional cookie behavior.

## Implementation Gate For Future Work

Before enabling GA4 or another analytics provider, require:

- Explicit approval for tracking.
- Real measurement IDs from the site owner.
- Reviewed privacy and cookie policy copy.
- Consent-mode implementation wired to `CookieConsentService`.
- Verification that public SEO landings remain fast, prerendered, crawlable, and visible without client-side tracking.
- Tests proving rejected consent does not load analytics.

## Scope Boundary

This phase is documentation only. It does not manage Search Console users, permissions, or ownership.
