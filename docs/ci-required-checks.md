# CI Required Checks

CommanderZone keeps active gameplay runtime validation in CI. The Go runtime is part of the required merge gate because gameplay commands now depend on the runtime WebSocket, actor, recovery, fallback, and catalog contracts.

## Pull Requests

Every pull request to `main` runs `.github/workflows/pr-required-checks.yml`.

The branch protection target should be the `required` job from `PR Required Checks`. That job fails unless all child checks succeed:

- `backend`
- `frontend`
- `go-runtime`

The `go-runtime` child check calls `.github/workflows/go-runtime-ci-reusable.yml` and runs with Go `1.22.12`:

```bash
cd game-runtime
go test ./...
go test -race ./...
go vet ./...
go test -run '^$' -bench 'BenchmarkRuntimeGameplaySmoke|BenchmarkApplyOnlyRuntimeCommands4Players100' -benchtime=1x -benchmem ./internal/perf ./internal/actor
go run ./cmd/runtime-bench -games=10 -iterations=1 -transport=actor -fail-on-gate -output=runtime-bench-smoke.json
```

`runtime-bench` writes `gate.criticalFailures` and `gate.advisoryFailures`.
With `-fail-on-gate`, CI fails only for critical runtime-final regressions.
Latency and payload targets remain advisory unless a future change explicitly
promotes them.

The same reusable workflow also uploads `go-runtime-ci-logs` with test, vet, benchmark, and gate output.

## Pushes To Main

Pushes to `main` run `.github/workflows/repo-main-release.yml`. Deploy jobs depend on backend CI, frontend CI, and `Validate Go Runtime`, so main release cannot deploy when Go runtime validation fails.

`.github/workflows/go-runtime-ci.yml` also runs the standalone `Validate Go Runtime` workflow on pull requests, pushes to `main`, and manual dispatch for visible runtime-only reruns.

## Local Docker Runtime Checks

Use Docker when `go` is not installed on the host:

```powershell
docker build -f game-runtime/Dockerfile.toolchain -t commanderzone-go-toolchain:1.22 --build-arg GO_VERSION=1.22.12 .
docker run --rm -v "${PWD}:/workspace" -w /workspace/game-runtime commanderzone-go-toolchain:1.22 go test ./...
docker run --rm -v "${PWD}:/workspace" -w /workspace/game-runtime commanderzone-go-toolchain:1.22 go test -race ./...
docker run --rm -v "${PWD}:/workspace" -w /workspace/game-runtime commanderzone-go-toolchain:1.22 go vet ./...
docker run --rm -v "${PWD}:/workspace" -w /workspace/game-runtime commanderzone-go-toolchain:1.22 go test -run '^$' -bench 'BenchmarkRuntimeGameplaySmoke|BenchmarkApplyOnlyRuntimeCommands4Players100' -benchtime=1x -benchmem ./internal/perf ./internal/actor
docker run --rm -v "${PWD}:/workspace" -w /workspace/game-runtime commanderzone-go-toolchain:1.22 go run ./cmd/runtime-bench -games=10 -iterations=1 -transport=actor -fail-on-gate -output=runtime-bench-smoke.json
```

For a Docker smoke that requires the real Go runtime route through Symfony:

```powershell
.\scripts\run-runtime-final-smoke.ps1
```

That script runs `app:gameplay:baseline --suite=smoke --iterations=1 --fail-on-regression --require-runtime-route`
inside Docker and fails if runtime route records are absent, runtime/fallback
counters are non-zero, required runtime counters are missing, or hot-path
legacy counters are non-zero.
