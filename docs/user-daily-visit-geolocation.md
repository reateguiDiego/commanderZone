# User daily visit geolocation

This tracking is for contextual moderation only. IP-derived country data is not a marketing signal and must not be used as an automatic moderation verdict.

## Root cause for `geo_source=local`

Production traffic reaches the Symfony API through a reverse proxy in front of the `api` container. The API container is a FrankenPHP/Caddy service, and `docker-compose.prod.yml` publishes it on `8000:80`.

If Symfony is not configured with trusted proxies, `Request::getClientIp()` ignores `X-Forwarded-For` and returns `REMOTE_ADDR`. In Docker this is the internal proxy address, observed as `172.18.x.x`, so `IpGeolocationService` correctly classifies it as `geo_source=local` and leaves `country_code` null.

## Required Symfony environment

Set these in `.env.prod` and keep the trusted proxy range limited to the Docker/proxy network that can actually reach the API container:

```dotenv
SYMFONY_TRUSTED_PROXIES=172.18.0.0/16
SYMFONY_TRUSTED_HEADERS=x-forwarded-for,x-forwarded-host,x-forwarded-proto,x-forwarded-port
USER_VISIT_HASH_SECRET=replace-with-long-random-secret
USER_VISIT_GEOIP_COUNTRY_DATABASE=/app/var/geoip/GeoLite2-Country.mmdb
USER_DAILY_VISIT_RETENTION_DAYS=180
```

Confirm the proxy subnet with:

```bash
docker network inspect commanderzone_internal
```

Use the exact subnet if it differs from `172.18.0.0/16`. Do not use `0.0.0.0/0`.

## Reverse proxy headers

The public reverse proxy must pass the client IP chain to the API. The repo currently contains the backend FrankenPHP Caddyfile, while the public reverse proxy config is environment-specific.

For nginx:

```nginx
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
```

For Caddy, `reverse_proxy` sends `X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Host` by default. Keep that behavior, and add `X-Real-IP` only if operators need it for logs:

```caddyfile
reverse_proxy 127.0.0.1:8000 {
    header_up X-Real-IP {remote_host}
}
```

If Cloudflare is in front, terminate trust at the public reverse proxy and have that proxy forward the verified client address in `X-Forwarded-For`. Do not make Symfony trust arbitrary client-supplied `CF-Connecting-IP`.

## GeoIP database

Place the local MaxMind/GeoLite2 Country database at:

```text
backend/var/geoip/GeoLite2-Country.mmdb
```

The prod compose file mounts this directory read-only into `/app/var/geoip`. If the file is missing or unreadable, requests continue normally and visits use `geo_source=unconfigured`.

## Verification

From the host:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec api php bin/console app:user-daily-visits:debug-client-ip \
  --remote-addr=172.18.0.1 \
  --x-forwarded-for=8.8.8.8 \
  --x-forwarded-proto=https \
  --x-forwarded-host=api.commanderzone.com
```

Expected:

- `Request::getClientIp()` is the public client IP from `X-Forwarded-For`.
- `Trusted proxies` contains the configured Docker/proxy range.
- `Geo source` is `geoip2-country` when the GeoLite2 DB resolves the IP.
- `Geo source` remains `local` for private or loopback IPs such as `172.18.x.x`, `10.x.x.x`, `192.168.x.x`, or `127.0.0.1`.

The debug command does not persist visit data and should be run only by operators with shell access.

## Secret rotation

`USER_VISIT_HASH_SECRET` is used for HMAC hashing of IP and user-agent metadata. If unset, the app falls back to `APP_SECRET` for compatibility. Rotating it changes future hashes; old rows remain valid for retention/prune purposes but will not match new hashes.
