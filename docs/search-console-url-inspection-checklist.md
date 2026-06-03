# Search Console URL Inspection Checklist

Phase 31 defines the representative SEO URLs to inspect manually after production deployment.

Use the verified `commanderzone.com` Search Console property. Do not automate this workflow with private Google credentials.

## Priority URLs

Inspect at least these ES and EN URLs:

| Page key | Locale | URL |
| --- | --- | --- |
| `home` | ES | `https://www.commanderzone.com/es/` |
| `home` | EN | `https://www.commanderzone.com/en/` |
| `playCommanderOnline` | ES | `https://www.commanderzone.com/es/jugar-commander-online/` |
| `playCommanderOnline` | EN | `https://www.commanderzone.com/en/play-commander-online/` |
| `tableAssistant` | ES | `https://www.commanderzone.com/es/asistente-de-mesa-magic/` |
| `tableAssistant` | EN | `https://www.commanderzone.com/en/commander-life-counter/` |
| `faq` | ES | `https://www.commanderzone.com/es/faq/` |
| `faq` | EN | `https://www.commanderzone.com/en/faq/` |
| `waysToPlayCommanderOnline` | ES | `https://www.commanderzone.com/es/formas-de-jugar-commander-online/` |
| `waysToPlayCommanderOnline` | EN | `https://www.commanderzone.com/en/ways-to-play-commander-online/` |
| `importCommanderDeck` | ES | `https://www.commanderzone.com/es/importar-mazo-commander/` |
| `importCommanderDeck` | EN | `https://www.commanderzone.com/en/import-commander-deck/` |
| `commanderDeckBuilder` | ES | `https://www.commanderzone.com/es/deck-builder-commander/` |
| `commanderDeckBuilder` | EN | `https://www.commanderzone.com/en/commander-deck-builder/` |

## Manual Inspection Steps

For each URL:

1. Open Google Search Console.
2. Use the URL Inspection tool.
3. Paste the full canonical production URL.
4. Run the live test if the indexed result is missing, stale, or unexpected.
5. Record the result and any action needed.

## What To Verify

For each inspected URL, confirm:

- The URL is indexed or eligible for indexing.
- Google-selected canonical matches the user-declared canonical.
- The page is not blocked by `robots.txt`.
- The page is not marked `noindex`.
- Rendered HTML contains visible page content, including the H1 and main landing copy.
- The canonical URL uses `https://www.commanderzone.com`.
- `hreflang` alternates are present and point to the localized canonical URLs.
- The URL appears in the submitted sitemap when applicable.

## If A URL Fails Inspection

Do not change tests or sitemap expectations to hide the issue. Investigate the real cause:

- Deployment not live or returning non-200.
- Redirect chain does not land on the canonical URL.
- Canonical tag points to the wrong URL.
- `noindex` or robots metadata is applied incorrectly.
- Prerendered HTML is missing visible content.
- Sitemap is stale or not yet processed by Search Console.

## Scope Boundary

This checklist does not define Search Console dashboards, recurring reporting, user permissions, or ranking goals. Those are separate phases.
