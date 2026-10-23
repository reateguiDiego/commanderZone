# PHP security update — 21 October 2026

Status: local build, full backend suite and HTTP smoke checks passed. No production changes.

## Scope and upstream availability

PHP's advisory explicitly includes FrankenPHP among web installations at risk:
https://www.php.net/archive/2026.php

The fixes for CVE-2026-109618 and CVE-2026-109619 are in PHP 8.4.27.
Production reports PHP 8.4.26 ZTS, FrankenPHP 1.13.1 and Caddy 2.11.7.
Keep PHP 8.4, Debian Bookworm, composer.lock, application configuration and
resource limits unchanged for this update.

On 23 October, Docker Hub confirms `1.13.1-php8.4.27-bookworm`, published
21 October at 17:45 UTC, with digest:
`sha256:433c1d21d37e256069cd65fbb475cc0d2f75240e49a20584712bbe155b033814`.
The Dockerfile now pins this tag and digest. The application image builds
successfully from this base using the existing composer.lock.

## Prepared build guard

The Dockerfile fixes the FrankenPHP version to 1.13.1 and accepts a
`FRANKENPHP_IMAGE` build argument, defaulting to the pinned security image above.
Before dependencies are installed, `docker/check-php-runtime.php` verifies:

- Stable PHP 8.4.27 or later within 8.4, not 8.5 or a release candidate.
- A ZTS CLI build.
- The PHP embedded in FrankenPHP meets the same floor and matches the CLI.

An old upstream image will intentionally fail this check. PHP syntax validation
passes and the guard rejects local PHP 8.4.16.

Local validation on 23 October uses image `commanderzone-php8427-validation`
and a disposable PostgreSQL 16 database, separate from existing local services:

- Build guard passes: CLI and embedded PHP both report 8.4.27 ZTS.
- FrankenPHP remains 1.13.1 and Caddy remains 2.11.7.
- All modules in the supplied production inventory are present.
- `composer check-platform-reqs` passes, with no dependency update.
- All 114 database migrations apply successfully to the disposable database.
- Production cache warmup and Caddy configuration validation pass.
- Actual production-mode FrankenPHP serves `/healthz` with HTTP 200 and
  `{"status":"ok"}` on a separate loopback port.
- Full backend suite exits 0: 1,396 tests, 15,839 assertions, no failures.
  The 13 PHPUnit deprecations and 80 notices match the previous baseline.
  Log: `reports/php8427-backend.log`.
- Gameplay baseline smoke (`--iterations=1 --fail-on-regression`) exits 0;
  log `reports/php8427-gameplay.log`. Runtime-specific counters marked skipped
  are not evidence of a live game-runtime/WebSocket validation.
- With isolated test accounts, real production-mode HTTP login succeeds and
  authenticated `/me`, `/decks`, `/rooms` and `/cards/languages` return HTTP 200.

Browser E2E, production override/thread verification and post-deploy load testing
remain separate checks; the health request does not validate those flows.

## Validation and release sequence

1. Obtain the patched Bookworm image, verify CLI and FrankenPHP versions and
   record its immutable digest. The default digest is pinned; verify its runtime
   before merging. A new tag or timestamp alone is not proof of a fix.
2. Build the application with the new base (`docker build --pull`), retaining
   composer.lock. Do not run composer update. Verify extensions against the
   production inventory, including pdo_pgsql, intl, mbstring, zip, sodium,
   openssl and OPcache; run `composer check-platform-reqs` in the resulting image.
3. Run the complete `APP_ENV=test php bin/phpunit` suite inside the candidate
   image against a disposable PostgreSQL database. Prior tests on PHP 8.4.26 or
   the Windows CLI do not validate the new runtime.
4. Check production-mode cache clear/warmup, actual Caddy configuration and four
   PHP threads. Run existing browser coverage for login, deck import/edit,
   localized searches, room deck selection, joining a game and reconnection.
5. Review the deployment workflow before rollout: build API and websocket from
   the verified base before migrations, and ensure every PHP service uses the
   new image. The new immutable base digest ensures this build selects the
   patched base; still verify the actual running versions after recreation.
6. User performs deployment in a controlled window. API, websocket,
   lifecycle-sweeper and runtime-stop-worker must be recreated. Include the
   moderation-evidence-worker if enabled later. Preserve database volumes and
   the established Compose override files. PHP alone requires no schema change.
7. Verify the version and image ID in every running PHP container, plus
   `frankenphp version` in the API. A common image tag does not prove running
   containers use the same image ID. Check health, logs and reconnect behavior.
8. Repeat the 10-user web-editor-v2-gzip test before raising load. Retain the
   previous application image for recovery, but rolling back to vulnerable PHP
   restores the security exposure and is not a completed remediation.

No commit, push, deployment or background monitoring is part of this preparation.
