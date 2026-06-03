# SEO canonical redirects

Phase 20 defines the public SEO canonical URL policy.

## Canonical policy

- Canonical origin: `https://commanderzone.com`.
- Alternate host: `https://www.commanderzone.com` must permanently redirect to the canonical origin.
- SEO URLs use trailing slash.
- SEO canonical, hreflang, sitemap URLs and `og:url` must use the canonical origin.

## Vercel behavior

`frontend/vercel.json` owns the public host redirect and trailing slash policy:

- `trailingSlash: true` normalizes public routes to trailing slash URLs.
- A permanent redirect sends `www.commanderzone.com` traffic to `https://commanderzone.com`.
- `Strict-Transport-Security` is sent on responses after HTTPS is reached.

Vercel production domains must keep HTTPS enabled for `commanderzone.com` and `www.commanderzone.com`.

## Validation

Run from `frontend`:

```bash
npm run validate:canonical
```

Manual production checks after deployment:

```bash
curl -I http://commanderzone.com/en/play-commander-online
curl -I https://www.commanderzone.com/en/play-commander-online/
curl -I https://commanderzone.com/en/play-commander-online
```

Expected final URL: `https://commanderzone.com/en/play-commander-online/`.
