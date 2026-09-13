# Header freshness and navigation request budget

The header reads `GET /friends/summary` and `GET /messages/summary`. Lists and message bodies load only when their panel opens. Stores live for the authenticated session, including recreation of the public/private dashboard shells. Changing the user clears the cache and discards in-flight responses from the old account. Each independent resource has `idle`, `loading`, `loaded`, and `stale` states plus a successful-load timestamp. Freshness lasts 60 seconds; navigation and reopening panels reuse fresh data. Concurrent calls share one HTTP operation. Errors leave the resource stale and retryable; successful sibling resources remain cached. Invalidations received during a request discard that response and trigger one follow-up read.

Mercure invalidates the matching summary and body resource. Closed panels do not fetch bodies. Invitation events invalidate invitations only. The existing coarse `friend.list.changed` event does not say which friendship operation occurred, so it invalidates the accepted/incoming/outgoing friendship resources, but not invitations or messages. Presence events patch known friends locally and invalidate only the summary; counter deltas are unsafe when the summary is newer than the cached list. Message events affect messages only. Navigation/open after the TTL is the recovery path when an event is missed.

Backend contract and publication changes were implemented in the separate task **Resúmenes del header y eventos de mensajes**, commit `dc9f1c209595357c312b4e314f09c524d8ea7759`, integrated as `fc47b688c`. OpenAPI documents both summaries and the private message topic. No dependency was added to the application.

## k6 browser gate

`load-tests/commanderzone-navigation-browser.k6.js` observes actual browser requests during login and six SPA navigations (decks, rooms, community, repeated). It uses a dedicated test account without concurrent activity. It records all API requests, including failures, rather than asserting a hardcoded number of simulated calls.

Budgets:

- Cold header: at most **2** requests (the summaries).
- Warm header: **0** requests per navigation within 60 seconds.
- Header bodies while panels remain closed: **0**.
- All API requests per warm navigation: at most **9**, including CORS OPTIONS requests (override with `NAVIGATION_HTTP_BUDGET` only when a reviewed route change justifies it).
- The Rooms page independently loads its invitation list: at most one such request is allowed on `/rooms`, and zero on other routes.
- All API responses must succeed; exactly seven samples (login plus six navigations) must be recorded. This prevents an aborted script with empty metrics from passing. All warm navigations must finish before the TTL expires.

Run against a local frontend and API with both summary endpoints, using k6 with a Chromium executable:

```powershell
$env:FRONTEND_BASE_URL = 'http://127.0.0.1:4200'
$env:API_BASE_URL = 'http://127.0.0.1:8000'
$env:USER_EMAIL = '<dedicated-test-user>'
$env:USER_PASSWORD = '<test-password>'
$env:K6_BROWSER_EXECUTABLE_PATH = '<chromium-path>'
k6 run --summary-export navigation-browser-summary.json load-tests/commanderzone-navigation-browser.k6.js
```

The existing `commanderzone-navigation.k6.js` remains the protocol throughput scenario. It cannot detect Angular fan-out by itself; run the browser gate alongside it to catch frontend regressions. Browser request instrumentation uses [k6 request events](https://grafana.com/docs/k6/latest/javascript-api/k6-browser/page/on/). Waiting uses rendering frames followed by completion of fetch/XHR, without arbitrary sleeps; Mercure's long-lived SSE connections do not block it.

## Validation — 2026-09-12

- Frontend: `npm test -- --watch=false` — **275 files, 2,634 tests passed**.
- Production build: `npm run build` — passed; existing SCSS size warnings remain.
- Separate backend task: `APP_ENV=test TEST_TOKEN=_header php bin/phpunit` — **1,295 tests, 13,850 assertions**, exit 0; 13 PHPUnit deprecations and 79 notices. Executed against an isolated database.
- Playwright: `e2e/header-navigation-cache.spec.ts` — **1 passed**. Uses the existing authenticated-context helper and verifies actual HTTP across public/private shells and opening both panels. The animated unread-message button is activated with Enter.
- k6 2.1.0 + Chromium, local development frontend and API with a dedicated empty test account and an isolated migrated database: **7/7 checks**, all request budgets passed. This is a fan-out regression measurement, not a capacity benchmark.

| Navigation | All API HTTP (including OPTIONS) | Header application requests | Friends/message bodies | Rooms page invitations |
| --- | ---: | ---: | ---: | ---: |
| Login | 14 | 2 | 0 | 0 |
| Decks | 6 | 0 | 0 | 0 |
| Rooms | 9 | 0 | 0 | 1 |
| Community | 5 | 0 | 0 | 0 |
| Decks again | 6 | 0 | 0 | 0 |
| Rooms again | 6 | 0 | 0 | 1 |
| Community again | 3 | 0 | 0 | 0 |

The global budget was set to the measured maximum of nine, including the first Rooms preflights. The independent zero-header budget catches cache regressions even when a page remains below that global maximum. Community may reuse its own cache; the browser gate waits for rendered content instead of demanding a nonexistent network request.

Custom k6 metrics are saved in [HEADER_NAVIGATION_K6_RESULT.json](HEADER_NAVIGATION_K6_RESULT.json).
