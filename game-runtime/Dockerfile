ARG GO_TOOLCHAIN_IMAGE=commanderzone-go-toolchain:1.22

FROM ${GO_TOOLCHAIN_IMAGE} AS build

WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/game-runtime ./cmd/runtime

FROM scratch

COPY --from=build /out/game-runtime /usr/local/bin/game-runtime

EXPOSE 8091
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD ["/usr/local/bin/game-runtime", "healthcheck"]

ENTRYPOINT ["/usr/local/bin/game-runtime"]
