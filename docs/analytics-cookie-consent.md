# Cookie Consent Preparation

CommanderZone keeps app cookie preferences separate from advertising consent.

## Current State

- `CookieConsentService` stores a versioned consent state for essential cookies and functional preferences.
- It does not grant advertising, analytics or personalized ads consent.
- AdSense may be loaded when a valid publisher id is configured.
- Personalized advertising must come from a certified CMP / IAB TCF signal, not from CommanderZone's local cookie banner.
- Google Consent Mode remains denied in the local app preference service.
- Users can reopen cookie preferences from the footer.

## AdSense / CMP Requirements

- Configure and publish the European regulations message in Google AdSense `Privacy & messaging`.
- Associate the message with `commanderzone.com`.
- Include the real privacy policy and cookie policy URLs.
- Ensure Google Advertising Products are covered by the certified CMP / TCF setup.
- Do not reuse local cookie preference decisions as advertising consent.

## Policy Requirements

- Legal copy must be reviewed before production.
- Policies must cover real cookies/storage, no analytics, AdSense behavior, withdrawal, contact and ownership.
