# Web responsiveness at low load

Start with one user, then ten, before returning to the 50/100-user capacity runs.
Run the generator outside production. Keep the deployment, fixture accounts,
language and test duration unchanged between comparisons. Avoid overlapping
catalog imports, profiling sessions or other load tests.

Set `NAVIGATION_MIX=web` in the existing navigation runner. This profile reads
owned decks, summaries, folders, deck detail, deck sections, card search options,
languages and five search cases: prefix, name, Spanish name, filtered page 2,
and no results. Every account must already have a deck; setup fails otherwise.
It logs in but does not modify decks, create rooms or issue gameplay commands.
It pauses one second between actions. This is a synthetic HTTP journey, not a
measurement of browser rendering or an exact reproduction of SPA requests.

The existing runners now accept `-Users 1` / `-Users 10` (PowerShell) and
`--users 1` / `--users 10` (Bash). `AllPhases` is unchanged: do not use it for
this baseline. Keep the server metrics watchdog enabled. The Bash runner's
server snapshot collection is local; do not run it unchanged on an external
laptop against production. Use the external SSH collector or the PowerShell
runner with `ProductionHost` as documented in production-load-testing.md.

Initial acceptance budgets per endpoint remain p95 < 500 ms, p99 < 1000 ms and
HTTP/application error rate < 1%. Missing stable endpoint samples fail the run.
Report p50, p95, p99, max, sample count and error count; investigate failures at
one or ten users before increasing concurrency. These are targets, not results.

Raw points also carry `visit=first|repeat`. First visits are retained during
ramp-up but are NOT proof of cold server caches: the API may already be warm.
Fixed search cases repeat and can hit cache. Do not purge shared production
caches to simulate cold traffic. Test naturally expired entries or isolated
fixtures separately, and correlate cache state with application logs. The
existing `basic`/`advanced` analysis mixes remain separate experiments.

Alongside the HTTP baseline, inspect a real browser with cache disabled at the
browser level: open the deck list, a full decklist, switch text/spoiler, and search
cards. Record click-to-usable time, API waterfall, downloaded bytes/images and
long tasks. Run the same sequence while the ten-user test is active. The existing
navigation-browser script audits request counts but does not yet measure all of
these deck/search interactions. Fast API responses alone do not establish good UX.

Archive the deployed commit and resource limits, client latency summary, server
samples and request-correlated PHP/SQL timings. Compare timings of matching
requests; do not subtract unrelated p95 values or derive complete SQL deltas
from truncated top-25 snapshots. Optimize the slow path identified by evidence,
preserving pagination, deck cursor contracts and waiting-room behavior.

## First baseline and language coverage correction

Run `czlt-20261005-204604`, deployed commit `8b61faed`, completed with one user,
470 HTTP requests and no HTTP errors. Server gates passed. Stable p95 was
1459 ms for languages, 1243 ms for deck sections, 856 ms for filtered search,
684 ms for deck detail and 601 ms for prefix search. The deck list was 149 ms.

The language coverage cache computed a catalog fingerprint using COUNT/MAX
before every lookup. Its SQL delta recorded 39 calls, averaging 912 ms each.
The local correction caches this fingerprint for 60 seconds in the shared
application cache. Coverage still uses the fingerprint as its key, so catalog
changes refresh coverage when the fingerprint expires. Language coverage may
lag catalog changes by up to one minute. The first request after expiry still
pays for the fingerprint query; this is not a removal of all latency spikes.

After deployment, repeat the same one-user profile and compare both endpoint
percentiles and fingerprint query calls/time. Do not treat unit-test query
elimination as a measured production speedup. Deck sections and search remain
separate investigations.

## Deck detail and sections: repeated card reads

The next one-user run (`czlt-external-2026-10-06T11-11-43Z`, commit
`3ac3e180`) recorded a sections median of 645 ms and p95 of 798 ms. The HTTP
performance logs for its time window averaged 124 queries per sections request
and 107 per deck detail request. These server averages include the whole window;
they are not directly comparable to stable-phase client percentiles.

Deck cards reference lazily loaded card entities. Serializing every line caused
one SELECT per distinct card. The local correction preloads those entities with
one query after the existing ownership check, for detail by ID, detail by slug
and sections only. It leaves the deck collection and its ordering intact, and
does not change listing cursors, rooms, localization or token selection.

The integration regression uses 30 distinct cards across all four sections.
Before the correction it recorded 42 queries for either detail route and 62 for
sections. After the correction, sections uses 33 total queries and two queries
in the card loading/serialization stage; both detail routes stay below 20.
Coverage also checks line IDs, quantities, sections, card identities, empty
decks and rejection of another user's requests.

Existing HTTP logs now expose `deck.sections.load`, `deck.sections.cards`,
`deck.sections.tokens`, `deck.sections.localization` and
`deck.sections.response` stages. Each includes time, query count and row count.
After deployment, repeat the one-user web profile and inspect these stages to
identify remaining costs. Query-count reduction alone is not proof that the
production latency budgets pass.
