package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"commanderzone/game-runtime/internal/gateway"
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

	runtimeService := runtimesvc.NewService()
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = runtimeService.Shutdown(ctx)
	}()

	validator := ticketValidatorFromEnv(logger)
	mux.Handle("/ws", gateway.NewWebSocketServer(validator, runtimeService))

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
