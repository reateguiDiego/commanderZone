# Analytics and Cookie Consent Preparation

Phase 27 prepares the frontend for a future Analytics task without enabling real tracking.

## Current State

- `CookieConsentService` stores only the user's consent choice and whether optional analytics is allowed.
- `AnalyticsService` is an abstraction backed by `NoopAnalyticsService` by default.
- No GA4, GTM, analytics script, fake measurement ID, or tracking endpoint is configured.
- Rejecting optional cookies keeps analytics disabled and must not break the app.
- The consent banner is a small fixed-bottom UI rendered after page content, so SEO landing content remains visible in prerendered HTML.

## Future Analytics Requirements

- Add a real Analytics provider only in a dedicated Analytics implementation task.
- Do not hardcode fake GA4 or GTM IDs.
- Do not load analytics scripts before the consent state allows analytics.
- Wire Google Consent Mode through the existing consent state before loading any provider.
- Keep ad storage, ad user data, and ad personalization denied unless a reviewed legal requirement explicitly changes that.
- Never send emails, usernames, room codes, deck names, private game IDs, or other personal identifiers in analytics parameters.
- Keep SEO landings prerenderable and crawlable if Analytics is added later.

## Policy Requirements

- Public privacy and cookie policy pages must exist before production Analytics is enabled.
- The banner links currently reserve `/privacy-policy/` and `/cookie-policy/` as public policy URLs.
- Legal copy must be reviewed before production.
- The policy must explain essential app cookies, optional analytics cookies, retention, provider details, withdrawal of consent, and contact/legal ownership.
