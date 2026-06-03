# Google Search Console Property Setup

Phase 28 documents the manual Search Console ownership setup for `commanderzone.com`.

## Recommended Property Type

Use a **Domain property** for `commanderzone.com`.

This is the preferred setup because it covers the whole domain, including:

- `commanderzone.com`
- `www.commanderzone.com`
- HTTP and HTTPS variants
- All public localized SEO URLs
- Future subdomains if they are intentionally part of the same Search Console property

## Preferred Verification Method

Use **DNS TXT verification** for the Domain property.

DNS verification is preferred because it verifies the domain itself instead of a single URL path or deployment artifact. The TXT value must come from Google Search Console and must be copied exactly into the DNS provider.

Do not invent, commit, or document fake verification tokens.

## Manual Owner Checklist

The human owner should complete these steps:

1. Open Google Search Console.
2. Add a Domain property for `commanderzone.com`.
3. Copy the DNS TXT verification value provided by Google.
4. Add the DNS TXT record in the domain provider.
5. Wait for DNS propagation if verification is not immediate.
6. Verify ownership in Google Search Console.
7. Confirm the property is active and covers the expected domain variants.

At least one verified owner must remain active at all times. If ownership changes, add the new owner before removing the previous verified owner.

## Fallback Verification Methods

Use these only if DNS verification is unavailable or blocked:

- **HTML file**: Google provides a real verification file that must be deployed at the public root.
- **HTML meta tag**: Google provides a real verification meta tag that must be added through a supported configuration path.
- **Google Analytics**: available only if Analytics is already implemented with consent handling and the correct Google account.
- **Google Tag Manager**: available only if GTM is already implemented with consent handling and the correct Google account.

Fallback methods must use real values from Google Search Console. Do not hardcode fake `google-site-verification` values, fake GA4 IDs, or fake GTM IDs.

## Technical Support

DNS TXT verification remains the preferred method.

If HTML file verification is required, place the exact Google-provided `google*.html` file in `frontend/public/`. Angular copies that folder to the deployed public root, so the file will be available at `https://www.commanderzone.com/google...html`. The validation script checks Search Console HTML files in the public root and rejects obvious placeholder content.

If HTML meta verification is required, set `googleSearchConsoleVerification` in the active Angular environment file to the real token provided by Google Search Console. Leave it empty by default. When configured, the public SEO home route can render the `google-site-verification` meta tag during prerender.

The token must be reviewed before commit. Do not commit personal account data, placeholder values, or guessed tokens.

## Scope Boundary

This phase does not add real verification files, real tokens, Analytics, Google Tag Manager, or sitemap submission. Those are separate implementation or operational tasks.
