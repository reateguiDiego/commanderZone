# ADR: Google Login as Additional Provider

## Status

Accepted for V1 implementation

## Context

CommanderZone already supports first-party login (`/auth/register` + `/auth/login`).
We want to evaluate Google login without breaking existing auth flows.

## Decision

Implement Google authentication as an additional OIDC provider while keeping local auth active.

V1 approach:

1. Frontend obtains Google ID token using Google Identity Services.
2. Backend receives ID token at a dedicated endpoint (`/auth/google/exchange`).
3. Backend validates token issuer, audience, signature and expiry.
4. Backend resolves or creates a local user and issues CommanderZone JWT.

## User Identity Model

Introduce a dedicated linked-identity table, for example `auth_identity`:

- `user_id`
- `provider` (`google`)
- `provider_user_id` (`sub`)
- `provider_email`
- `provider_email_verified`

Unique index on (`provider`, `provider_user_id`).

## Account Linking Rules

- If provider identity exists, sign in mapped local user.
- If provider identity does not exist and local email is unused, create new verified local user.
- If local email already exists, require proof-of-possession before linking (local password login or explicit linking challenge).

## Security Requirements

- Never trust frontend-only validation.
- Validate audience against configured Google client IDs.
- Require `email_verified=true` claim to auto-provision accounts.
- Log federated sign-in and linking events with hashed email.

## Consequences

- Local login remains fully supported.
- Google login can be rolled out incrementally behind configuration flags.
- Identity linking adds complexity but avoids account takeover on same-email collisions.
