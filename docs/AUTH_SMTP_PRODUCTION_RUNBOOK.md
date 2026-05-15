# Auth SMTP Production Runbook

## Goal

Enable production-ready SMTP delivery for authentication emails:

- email verification
- password reset

The backend uses a generic `MAILER_DSN` and keeps auth endpoints available even if SMTP is temporarily unavailable (fail-open with security/audit logs).

## Required Environment Variables

Set these variables in production runtime (do not commit credentials):

- `MAILER_DSN`
- `MAILER_FROM_ADDRESS`
- `MAILER_FROM_NAME`
- `AUTH_PUBLIC_APP_URL`

Recommended baseline:

- `MAILER_FROM_ADDRESS=no-reply@commanderzone.com`
- `MAILER_FROM_NAME=CommanderZone`
- `AUTH_PUBLIC_APP_URL=https://commanderzone.com`

## MAILER_DSN Examples

Generic SMTP with STARTTLS:

```dotenv
MAILER_DSN="smtp://smtp-user:smtp-password@smtp.example.com:587?encryption=tls&auth_mode=login"
```

Mailgun SMTP:

```dotenv
MAILER_DSN="mailgun+smtp://MAILGUN_USERNAME:MAILGUN_PASSWORD@default"
```

SendGrid SMTP:

```dotenv
MAILER_DSN="sendgrid+smtp://SENDGRID_API_KEY@default"
```

Amazon SES SMTP:

```dotenv
MAILER_DSN="ses+smtp://SES_SMTP_USERNAME:SES_SMTP_PASSWORD@default"
```

## Deliverability Checklist (Domain)

Before enabling traffic:

1. Publish SPF for your sender domain and include your SMTP provider.
2. Configure DKIM with provider-provided key(s).
3. Configure DMARC. Start with monitor mode:
   - `v=DMARC1; p=none; rua=mailto:dmarc@commanderzone.com`
4. Validate DNS propagation and alignment for From domain.

After stable delivery, tighten DMARC policy (`quarantine` / `reject`) in phases.

## Smoke Test After Deploy

1. Register a fresh user and verify that a verification email is received.
2. Request email verification re-send and verify the new email is received.
3. Request password reset and verify reset email is received.
4. Open verification/reset links from received emails and verify the full browser flow completes.
5. Verify the user can log in with the new password after reset.

## Operational Behavior on SMTP Failure

Current policy is fail-open:

- Register and reset request endpoints still return success (`201` / `202`).
- Email send failures are logged as `security.audit` events and do not leak SMTP internals to clients.

Email content policy:

- Auth emails include only the action link (no standalone token or API fallback instructions in the email body).

## Observability

Track these security audit events in logs/metrics:

- `auth.mail.email_verification.sent`
- `auth.mail.email_verification.failed`
- `auth.mail.password_reset.sent`
- `auth.mail.password_reset.failed`

Suggested counters:

- `auth_mail_sent_total{type=email_verification|password_reset}`
- `auth_mail_failed_total{type=email_verification|password_reset}`

Alert when failure rate exceeds normal baseline for a sustained window.
