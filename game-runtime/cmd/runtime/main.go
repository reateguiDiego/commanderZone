package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"commanderzone/game-runtime/internal/gateway"
	"commanderzone/game-runtime/internal/lifecycle"
	"commanderzone/game-runtime/internal/persistence"
	runtimesvc "commanderzone/game-runtime/internal/runtime"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		if err := runHealthcheck(os.Getenv("GAME_RUNTIME_LISTEN")); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ready"))
	})

	runtimeService, closePersistence := runtimeServiceFromEnv(logger)
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = runtimeService.Shutdown(ctx)
		_ = closePersistence()
	}()

	validator := ticketValidatorFromEnv(logger)
	commandTimeout := envDuration(os.Getenv("GAME_RUNTIME_COMMAND_TIMEOUT"), 15*time.Second)
	var presenceOutbox *lifecycle.PresenceOutbox
	if strings.EqualFold(strings.TrimSpace(os.Getenv("GAME_RUNTIME_PERSISTENCE")), "postgres") {
		sink := lifecycleSinkFromEnv(logger)
		if sink == nil {
			logger.Error("postgres runtime requires GAME_RUNTIME_LIFECYCLE_URL for durable all-disconnected cleanup")
			os.Exit(1)
		}
		outbox, err := lifecycle.NewPresenceOutbox(normalizePostgresURL(os.Getenv("DATABASE_URL")))
		if err != nil {
			logger.Error("runtime lifecycle outbox configuration failed", "error", err)
			os.Exit(1)
		}
		outboxCtx, cancelOutbox := context.WithCancel(context.Background())
		defer outbox.Close()
		defer cancelOutbox()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err = outbox.CheckSchema(ctx)
		cancel()
		if err != nil {
			logger.Error("runtime lifecycle outbox schema check failed", "error", err)
			os.Exit(1)
		}
		presenceOutbox = outbox
		go outbox.Run(outboxCtx, sink, func(deliveryErr error) {
			logger.Warn("runtime lifecycle outbox delivery failed", "error", deliveryErr)
		})
	}
	var activityStore gateway.ActivityStore
	if strings.EqualFold(strings.TrimSpace(os.Getenv("GAME_RUNTIME_PERSISTENCE")), "postgres") {
		store, err := gateway.NewPostgresActivityStore(normalizePostgresURL(os.Getenv("DATABASE_URL")))
		if err != nil {
			logger.Error("postgres runtime activity stream configuration failed", "error", err)
			os.Exit(1)
		}
		activityStore = store
		defer func() { _ = store.Close() }()
	}
	webSocketOptions := []gateway.WebSocketOption{}
	if activityStore != nil {
		webSocketOptions = append(webSocketOptions, gateway.WithActivityStore(activityStore))
	}
	if presenceOutbox != nil {
		webSocketOptions = append(webSocketOptions, gateway.WithPresenceLifecycleOutbox(presenceOutbox))
	}
	webSocketOptions = append(webSocketOptions, gateway.WithCommandTimeout(commandTimeout))
	webSocketServer := gateway.NewWebSocketServer(validator, runtimeService, webSocketOptions...)
	runtimeService.SetActorStoppedHook(webSocketServer.CloseGame)
	mux.Handle("/ws", webSocketServer)
	commandServer := gateway.NewCommandHTTPServer(runtimeService)
	if envBool(os.Getenv("GAME_RUNTIME_ALLOW_INITIAL_STATE_COMMANDS")) {
		logger.Warn("GAME_RUNTIME_ALLOW_INITIAL_STATE_COMMANDS is enabled; /commands accepts legacy initialState migration payloads")
		commandServer = gateway.NewCommandHTTPServerAllowingInitialState(runtimeService)
	}
	commandServer.SetCommandTimeout(commandTimeout)
	commandServer.SetResultPublisher(webSocketServer.PublishRuntimeResult)
	mux.Handle("/commands", commandServer)
	mux.Handle("/lifecycle/stop", gateway.NewLifecycleHTTPServer(runtimeService))
	mux.Handle("/metrics", gateway.NewMetricsHTTPServer(runtimeService, webSocketServer))

	addr := os.Getenv("GAME_RUNTIME_LISTEN")
	if addr == "" {
		addr = "0.0.0.0:8091"
	}

	server := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	logger.Info("game runtime skeleton listening", "addr", server.Addr)

	errCh := make(chan error, 1)
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
			return
		}
		errCh <- nil
	}()

	signalCh := make(chan os.Signal, 1)
	signal.Notify(signalCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errCh:
		if err != nil {
			logger.Error("runtime stopped", "error", err)
			os.Exit(1)
		}
	case sig := <-signalCh:
		logger.Info("shutdown signal received", "signal", sig.String())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
		os.Exit(1)
	}

	fmt.Println("stopped")
}

type rejectingTicketValidator struct{}

func (rejectingTicketValidator) ValidateTicket(_ context.Context, _ string) (gateway.TicketClaims, error) {
	return gateway.TicketClaims{}, errors.New("runtime ticket secret is not configured")
}

func ticketValidatorFromEnv(logger *slog.Logger) gateway.TicketValidator {
	secret := os.Getenv("GAME_RUNTIME_TICKET_SECRET")
	if strings.TrimSpace(secret) == "" {
		logger.Warn("GAME_RUNTIME_TICKET_SECRET is not configured; websocket gateway will reject gameplay connections")
		return rejectingTicketValidator{}
	}
	validator, err := gateway.NewHMACTicketValidator(secret)
	if err != nil {
		logger.Warn("invalid GAME_RUNTIME_TICKET_SECRET; websocket gateway will reject gameplay connections", "error", err)
		return rejectingTicketValidator{}
	}
	return validator
}

func runtimeServiceFromEnv(logger *slog.Logger) (*runtimesvc.Service, func() error) {
	instanceID := strings.TrimSpace(os.Getenv("GAME_RUNTIME_INSTANCE_ID"))
	if instanceID == "" {
		instanceID = runtimesvc.DefaultRuntimeInstanceID()
	}
	ownershipMode := strings.ToLower(strings.TrimSpace(os.Getenv("GAME_RUNTIME_OWNERSHIP_MODE")))
	if ownershipMode == "" {
		ownershipMode = "single-node"
	}
	if ownershipMode != "single-node" && ownershipMode != "postgres-lease" {
		logger.Error("unsupported game runtime ownership mode; refusing to start without fencing", "mode", ownershipMode, "instanceId", instanceID)
		os.Exit(1)
	}
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("GAME_RUNTIME_PERSISTENCE")))
	if mode == "" {
		mode = "memory"
	}
	if mode != "postgres" {
		if ownershipMode == "postgres-lease" {
			logger.Error("postgres lease ownership requires GAME_RUNTIME_PERSISTENCE=postgres", "mode", mode, "instanceId", instanceID)
			os.Exit(1)
		}
		logger.Info("using in-memory runtime persistence", "mode", mode)
		serviceOptions := []runtimesvc.ServiceOption{
			runtimesvc.WithInstanceID(instanceID),
			runtimesvc.WithOwnershipManager(runtimesvc.NewSingleNodeOwnershipManager()),
			runtimesvc.WithLogger(logger),
		}
		if sink := lifecycleSinkFromEnv(logger); sink != nil {
			serviceOptions = append(serviceOptions, runtimesvc.WithLifecycleSink(sink, 1))
		}
		logger.Info("game runtime ownership policy", "mode", ownershipMode, "instanceId", instanceID)
		return runtimesvc.NewServiceWithStoreAndOptions(persistence.NewInMemoryEventStore(), 128, nil, serviceOptions...), func() error { return nil }
	}
	databaseURL := normalizePostgresURL(os.Getenv("DATABASE_URL"))
	store, err := persistence.NewPostgresEventStore(databaseURL)
	if err != nil {
		logger.Error("postgres runtime persistence configuration failed", "error", err)
		os.Exit(1)
	}
	closePersistence := func() error { return store.Close() }
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := store.Ping(ctx); err != nil {
		logger.Error("postgres runtime persistence ping failed", "error", err)
		os.Exit(1)
	}
	logger.Info("using postgres runtime persistence")

	ownership := runtimesvc.OwnershipManager(runtimesvc.NewSingleNodeOwnershipManager())
	renewBefore := 5 * time.Second
	if ownershipMode == "postgres-lease" {
		leaseTTL := envDuration(os.Getenv("GAME_RUNTIME_OWNERSHIP_LEASE_TTL"), 15*time.Second)
		renewBefore = envDuration(os.Getenv("GAME_RUNTIME_OWNERSHIP_RENEW_BEFORE"), defaultRenewBefore(leaseTTL))
		manager, err := runtimesvc.NewPostgresOwnershipManager(databaseURL, leaseTTL)
		if err != nil {
			logger.Error("postgres runtime ownership configuration failed", "error", err)
			os.Exit(1)
		}
		closeStore := closePersistence
		closePersistence = func() error {
			storeErr := closeStore()
			managerErr := manager.Close()
			if storeErr != nil {
				return storeErr
			}
			return managerErr
		}
		if err := manager.Ping(ctx); err != nil {
			logger.Error("postgres runtime ownership ping failed", "error", err)
			os.Exit(1)
		}
		if err := manager.CheckSchema(ctx); err != nil {
			logger.Error("postgres runtime ownership schema check failed", "error", err)
			os.Exit(1)
		}
		ownership = manager
		logger.Info("using postgres runtime ownership lease", "ttl", leaseTTL.String(), "renewBefore", renewBefore.String())
	}
	serviceOptions := []runtimesvc.ServiceOption{
		runtimesvc.WithInstanceID(instanceID),
		runtimesvc.WithOwnershipManager(ownership),
		runtimesvc.WithOwnershipRenewBefore(renewBefore),
		runtimesvc.WithLogger(logger),
	}
	if sink := lifecycleSinkFromEnv(logger); sink != nil {
		serviceOptions = append(serviceOptions, runtimesvc.WithLifecycleSink(sink, 1))
	}
	logger.Info("game runtime ownership policy", "mode", ownershipMode, "instanceId", instanceID)
	return runtimesvc.NewServiceWithStoreAndOptions(store, 128, nil, serviceOptions...), closePersistence
}

func lifecycleSinkFromEnv(logger *slog.Logger) lifecycle.Sink {
	url := strings.TrimSpace(os.Getenv("GAME_RUNTIME_LIFECYCLE_URL"))
	if url == "" {
		logger.Warn("GAME_RUNTIME_LIFECYCLE_URL is not configured; lifecycle handoffs are disabled")
		return nil
	}
	sink, err := lifecycle.NewHTTPSink(url, os.Getenv("GAME_RUNTIME_TICKET_SECRET"), envDuration(os.Getenv("GAME_RUNTIME_LIFECYCLE_TIMEOUT"), 5*time.Second))
	if err != nil {
		logger.Error("invalid lifecycle handoff configuration", "error", err)
		os.Exit(1)
	}
	return sink
}

func envDuration(value string, fallback time.Duration) time.Duration {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	duration, err := time.ParseDuration(value)
	if err != nil || duration <= 0 {
		return fallback
	}
	return duration
}

func defaultRenewBefore(ttl time.Duration) time.Duration {
	if ttl <= 2*time.Second {
		return ttl / 2
	}
	return ttl / 3
}

func normalizePostgresURL(databaseURL string) string {
	databaseURL = strings.TrimSpace(databaseURL)
	if databaseURL == "" {
		return databaseURL
	}
	databaseURL = removeDoctrinePostgresURLParams(databaseURL)
	if strings.Contains(databaseURL, "sslmode=") {
		return databaseURL
	}

	separator := "?"
	if strings.Contains(databaseURL, "?") {
		separator = "&"
	}
	return databaseURL + separator + "sslmode=disable"
}

func removeDoctrinePostgresURLParams(databaseURL string) string {
	parsed, err := url.Parse(databaseURL)
	if err != nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") {
		return databaseURL
	}

	query := parsed.Query()
	for key := range query {
		switch strings.ToLower(key) {
		case "serverversion", "charset":
			query.Del(key)
		}
	}
	parsed.RawQuery = query.Encode()

	return parsed.String()
}

func envBool(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func runHealthcheck(listen string) error {
	addr := normalizeHealthcheckAddr(listen)
	client := http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://" + addr + "/healthz")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected healthcheck status: %d", resp.StatusCode)
	}
	return nil
}

func normalizeHealthcheckAddr(listen string) string {
	if listen == "" {
		return "127.0.0.1:8091"
	}
	if strings.HasPrefix(listen, ":") {
		return "127.0.0.1" + listen
	}
	host, port, err := net.SplitHostPort(listen)
	if err != nil {
		return listen
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	return net.JoinHostPort(host, port)
}
