package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"commanderzone/game-runtime/internal/perf"
)

func main() {
	var gamesFlag string
	var outputPath string
	var failOnGate bool
	config := perf.DefaultConfig()
	flag.StringVar(&gamesFlag, "games", "10,25,50", "Comma-separated game counts to run, for example 10,25,50,100.")
	flag.IntVar(&config.Connections, "connections", 0, "Target viewer connections. Actor transport records this as requested but does not open network sockets.")
	flag.IntVar(&config.Iterations, "iterations", 1, "Full scenario iterations per scale.")
	flag.StringVar(&config.Transport, "transport", "actor", "Benchmark transport: actor or websocket.")
	flag.IntVar(&config.QueueSize, "queue-size", 256, "Actor mailbox queue size.")
	flag.IntVar(&config.SimplePatchBytesLimit, "simple-patch-bytes-limit", perf.DefaultSimplePatchBytesLimit, "Gate for simple command patch bytes.")
	flag.Float64Var(&config.ResyncRateLimit, "resync-rate-limit", perf.DefaultResyncRateLimit, "Gate for resync rate.")
	flag.StringVar(&outputPath, "output", "", "Optional JSON report path.")
	flag.BoolVar(&failOnGate, "fail-on-gate", false, "Exit non-zero when benchmark gates fail.")
	flag.Parse()

	games, err := parseGameCounts(gamesFlag)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	config.GameCounts = games

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	report, err := perf.Run(ctx, config)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if outputPath != "" {
		if err := os.WriteFile(outputPath, payload, 0o644); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
	_, _ = os.Stdout.Write(payload)
	_, _ = os.Stdout.Write([]byte("\n"))
	if failOnGate && report.Gate.Status != "pass" {
		os.Exit(1)
	}
}

func parseGameCounts(value string) ([]int, error) {
	parts := strings.Split(value, ",")
	counts := make([]int, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		count, err := strconv.Atoi(part)
		if err != nil || count < 1 {
			return nil, fmt.Errorf("invalid game count %q", part)
		}
		counts = append(counts, count)
	}
	if len(counts) == 0 {
		return nil, fmt.Errorf("at least one game count is required")
	}
	return counts, nil
}
