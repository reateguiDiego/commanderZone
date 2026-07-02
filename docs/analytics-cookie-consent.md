# Cookie Consent Preparation

Phase 1.1 keeps CommanderZone production-ready for cookies without enabling analytics or ads.

## Current State

- `CookieConsentService` stores a versioned consent state with essential cookies, functional preferences, and a prepared advertising category.
- No analytics or ad scripts are loaded.
- Google Consent Mode remains denied.
- Users can reopen cookie preferences from the footer.

## Future Ads Requirements

- Add ad providers only in a dedicated task.
- Do not reuse Phase 1.1 decisions as future ad consent.
- Update policies and use a certified CMP where required before enabling ads.

## Policy Requirements

- Legal copy must be reviewed before production.
- Policies must cover real cookies/storage, no analytics, ads readiness, withdrawal, contact and ownership.
