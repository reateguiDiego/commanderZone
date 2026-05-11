# Auth Data Protection Policy

## Scope

This policy defines how authentication data is protected in CommanderZone backend.

## Data Classification and Protection

| Data | Protection | Notes |
| --- | --- | --- |
| User passwords | One-way hash (`password_hashers`) | Never reversible, never logged |
| Password reset token | One-way HMAC hash at rest | Plain token only returned by reset request flow (in real deployment, send by email) |
| Email verification token | One-way HMAC hash at rest | Plain token only used to verify ownership |
| Email address | Stored as normalized lowercase | Operational PII; avoid logging raw value in security events |
| Security audit email reference | HMAC hash | Enables correlation without exposing raw email in logs |

## Security Events

The backend logs these auth events with timestamp, IP, and identifiers:

- `auth.registered`
- `auth.login.succeeded`
- `auth.login.failed`
- `auth.login.locked`
- `auth.password_reset.requested`
- `auth.password_reset.completed`
- `auth.password_reset.failed`
- `auth.email_verification.requested`
- `auth.email_verification.completed`
- `auth.email_change.requested`

## Rate Limiting and Abuse Controls

- Login lockout is applied progressively by email and IP after repeated failed attempts.
- Password reset request and confirm endpoints are throttled by IP/email windows.
- Email verification re-send endpoint is throttled by IP/email windows.

## Operational Notes

- Transport security (HTTPS/TLS) is required in production for any auth flow.
- Debug token fields used by integration tests are restricted to `APP_ENV=test`.
