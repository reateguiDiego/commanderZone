# Production API capacity

The deployment workflow applies `docker-compose.api-capacity.yml` after the base
Compose file and the server's `docker-compose.prod.yml`. It fixes the API at
1.5 CPUs and four FrankenPHP threads (`num_threads` and `max_threads`). Both
Compose CPU limit fields agree. Memory limits remain defined by the production
configuration (currently 1258291200 bytes); the capacity file does not set them.

This reproduces the configuration of the previous external 100-user navigation
tests. It is a benchmark baseline, not a claim that the latency budgets pass or
that the server can support 500 users. Local development using only
`docker-compose.yml` is unaffected.

For manual production operations that recreate services, use the same file order
as deployment. Omitting the final file can restore the server's older API limits:

```bash
docker compose --env-file .env.prod \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.api-capacity.yml config --quiet
```

The example only validates configuration; apply changes through the normal
reviewed deployment workflow. The existing Caddy configuration must continue to
expand `FRANKENPHP_CONFIG` inside its `frankenphp` block. This capacity file owns
that variable and replaces any previous value; review any other directives before
adding them there.

After deployment, check actual CPU/memory limits, the PHP thread metrics and the
presence of warmed Doctrine metadata before running load. Run the generator on a
separate computer, outside scheduled catalog/price imports. Do not apply temporary
profiling or thread overrides for the baseline measurement.
