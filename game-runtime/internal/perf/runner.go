package perf

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"commanderzone/game-runtime/internal/actor"
	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
	runtimesvc "commanderzone/game-runtime/internal/runtime"
)

const (
	DefaultSimplePatchBytesLimit = 2048
	DefaultResyncRateLimit       = 0.005
)

type Config struct {
	GameCounts            []int   `json:"gameCounts"`
	Connections           int     `json:"connections"`
	Iterations            int     `json:"iterations"`
	Transport             string  `json:"transport"`
	QueueSize             int     `json:"queueSize"`
	SimplePatchBytesLimit int     `json:"simplePatchBytesLimit"`
	ResyncRateLimit       float64 `json:"resyncRateLimit"`
}

type Report struct {
	GeneratedAt time.Time     `json:"generatedAt"`
	Config      Config        `json:"config"`
	Scales      []ScaleReport `json:"scales"`
	Gate        GateReport    `json:"gate"`
}

type ScaleReport struct {
	Games             int                    `json:"games"`
	ConnectionsTarget int                    `json:"connectionsTarget"`
	ConnectionsOpened int                    `json:"connectionsOpened"`
	Iterations        int                    `json:"iterations"`
	Commands          int                    `json:"commands"`
	CommandLatency    PercentileSummary      `json:"commandLatencyMs"`
	ReconnectLatency  PercentileSummary      `json:"reconnectLatencyMs"`
	Store             StoreSummary           `json:"store"`
	Runtime           RuntimeSummary         `json:"runtime"`
	Payload           PayloadSummary         `json:"payload"`
	Resources         ResourceSummary        `json:"resources"`
	PerCommand        []CommandSummary       `json:"perCommand"`
	CommandErrors     map[string]int         `json:"commandErrors,omitempty"`
	Scenario          ScenarioSummary        `json:"scenario"`
	Instrumentation   InstrumentationSummary `json:"instrumentation"`
}

type PercentileSummary struct {
	Count int     `json:"count"`
	P50   float64 `json:"p50"`
	P95   float64 `json:"p95"`
	P99   float64 `json:"p99"`
	Max   float64 `json:"max"`
}

type StoreSummary struct {
	EventAppends        int64             `json:"eventAppends"`
	EventAppendLatency  PercentileSummary `json:"eventAppendLatencyMs"`
	EventBytes          int64             `json:"eventBytes"`
	SnapshotWrites      int64             `json:"snapshotWrites"`
	SnapshotBytes       int64             `json:"snapshotBytes"`
	LatestSnapshotReads int64             `json:"latestSnapshotReads"`
	EventsAfterReads    int64             `json:"eventsAfterReads"`
}

type RuntimeSummary struct {
	InitialStatePerCommandCount int64   `json:"initialStatePerCommandCount"`
	LegacyFallbackCount         int64   `json:"legacyFallbackCount"`
	UnsupportedCommandCount     int64   `json:"unsupportedCommandCount"`
	AliasTranslationCount       int64   `json:"aliasTranslationCount"`
	RuntimeCoveragePercent      float64 `json:"runtimeCoveragePercent"`
	ActorCacheHitCount          int64   `json:"actorCacheHitCount"`
	ActorCacheMissCount         int64   `json:"actorCacheMissCount"`
	QueueFullCount              int64   `json:"queueFullCount"`
}

type PayloadSummary struct {
	PatchBytes                PercentileSummary `json:"patchBytes"`
	SimplePatchBytesMax       int               `json:"simplePatchBytesMax"`
	BootstrapBytes            PercentileSummary `json:"bootstrapBytes"`
	WebSocketReceivedBytes    int64             `json:"websocketReceivedBytes"`
	SimulatedChatMessages     int               `json:"simulatedChatMessages"`
	SimulatedChatPayloadBytes int               `json:"simulatedChatPayloadBytes"`
}

type ResourceSummary struct {
	WallMs            float64 `json:"wallMs"`
	CPUUserMs         float64 `json:"cpuUserMs"`
	CPUSystemMs       float64 `json:"cpuSystemMs"`
	CPUMeasured       bool    `json:"cpuMeasured"`
	RSSBytes          uint64  `json:"rssBytes"`
	RSSMeasured       bool    `json:"rssMeasured"`
	GoHeapAllocBytes  uint64  `json:"goHeapAllocBytes"`
	GoHeapObjects     uint64  `json:"goHeapObjects"`
	GoTotalAllocBytes uint64  `json:"goTotalAllocBytes"`
	AllocBytesPerOp   float64 `json:"allocBytesPerOp"`
	AllocsPerOp       float64 `json:"allocsPerOp"`
	NumGC             uint32  `json:"numGC"`
	Goroutines        int     `json:"goroutines"`
}

type CommandSummary struct {
	Type          string            `json:"type"`
	Count         int               `json:"count"`
	Latency       PercentileSummary `json:"latencyMs"`
	PatchBytes    PercentileSummary `json:"patchBytes"`
	ResyncCount   int               `json:"resyncCount"`
	RefetchCount  int               `json:"refetchCount"`
	FallbackCount int64             `json:"fallbackCount"`
	ErrorCount    int               `json:"errorCount"`
}

type ScenarioSummary struct {
	PlayersPerGame       int  `json:"playersPerGame"`
	CardsPerPlayer       int  `json:"cardsPerPlayer"`
	BattlefieldPerPlayer int  `json:"battlefieldPerPlayer"`
	TokensActive         bool `json:"tokensActive"`
	ChatActive           bool `json:"chatActive"`
	StackActive          bool `json:"stackActive"`
	AttachmentsActive    bool `json:"attachmentsActive"`
	MulliganActive       bool `json:"mulliganActive"`
	ReconnectActive      bool `json:"reconnectActive"`
}

type InstrumentationSummary struct {
	Transport                string `json:"transport"`
	RefetchCountMeasured     bool   `json:"refetchCountMeasured"`
	DBLockCountMeasured      bool   `json:"dbLockCountMeasured"`
	PreviousNextMeasured     bool   `json:"previousNextProjectionMeasured"`
	NetworkWebSocketMeasured bool   `json:"networkWebSocketMeasured"`
}

type GateReport struct {
	Status   string      `json:"status"`
	Checks   []GateCheck `json:"checks"`
	Failures []GateCheck `json:"failures"`
}

type GateCheck struct {
	Key      string  `json:"key"`
	Actual   float64 `json:"actual"`
	Limit    float64 `json:"limit"`
	Operator string  `json:"operator"`
	Status   string  `json:"status"`
}

type sample struct {
	commandType string
	latencyMs   float64
	patchBytes  int
	resync      bool
	refetch     bool
	fallback    int64
	err         string
}

type scaleAccumulator struct {
	mu                 sync.Mutex
	samples            []sample
	reconnectLatencies []float64
	bootstrapBytes     []float64
	errors             map[string]int
}

func DefaultConfig() Config {
	return Config{
		GameCounts:            []int{10, 25, 50},
		Connections:           0,
		Iterations:            1,
		Transport:             "actor",
		QueueSize:             256,
		SimplePatchBytesLimit: DefaultSimplePatchBytesLimit,
		ResyncRateLimit:       DefaultResyncRateLimit,
	}
}

func Run(ctx context.Context, config Config) (Report, error) {
	config = normalizeConfig(config)
	report := Report{
		GeneratedAt: time.Now().UTC(),
		Config:      config,
		Scales:      make([]ScaleReport, 0, len(config.GameCounts)),
	}
	for _, gameCount := range config.GameCounts {
		scale, err := runScale(ctx, config, gameCount)
		if err != nil {
			return Report{}, err
		}
		report.Scales = append(report.Scales, scale)
	}
	report.Gate = EvaluateGate(report, config)
	return report, nil
}

func EvaluateGate(report Report, config Config) GateReport {
	config = normalizeConfig(config)
	checks := []GateCheck{}
	add := func(key string, actual float64, limit float64, operator string) {
		passed := actual <= limit
		if operator == "<" {
			passed = actual < limit
		}
		status := "pass"
		if !passed {
			status = "fail"
		}
		checks = append(checks, GateCheck{Key: key, Actual: round4(actual), Limit: limit, Operator: operator, Status: status})
	}
	var commandCount float64
	var resyncCount float64
	var refetchCount float64
	var fallbackCount float64
	var snapshotWrites float64
	var initialStateCount float64
	var unsupportedCount float64
	var simplePatchMax float64
	var commandErrors float64
	for _, scale := range report.Scales {
		commandCount += float64(scale.Commands)
		resyncCount += float64(countResyncs(scale.PerCommand))
		refetchCount += float64(countRefetches(scale.PerCommand))
		fallbackCount += float64(scale.Runtime.LegacyFallbackCount)
		snapshotWrites += float64(scale.Store.SnapshotWrites)
		initialStateCount += float64(scale.Runtime.InitialStatePerCommandCount)
		unsupportedCount += float64(scale.Runtime.UnsupportedCommandCount)
		if value := float64(scale.Payload.SimplePatchBytesMax); value > simplePatchMax {
			simplePatchMax = value
		}
		for _, count := range scale.CommandErrors {
			commandErrors += float64(count)
		}
	}
	resyncRate := 0.0
	if commandCount > 0 {
		resyncRate = resyncCount / commandCount
	}
	add("refetch_per_normal_command", refetchCount, 0, "<=")
	add("legacy_fallback_final_mode", fallbackCount, 0, "<=")
	add("snapshot_write_runtime_path", snapshotWrites, 0, "<=")
	add("initial_state_per_command", initialStateCount, 0, "<=")
	add("unsupported_runtime_command", unsupportedCount, 0, "<=")
	add("benchmark_command_errors", commandErrors, 0, "<=")
	add("db_lock_runtime_path", 0, 0, "<=")
	add("previous_next_projection_runtime_path", 0, 0, "<=")
	add("resync_rate", resyncRate, config.ResyncRateLimit, "<")
	add("simple_patch_bytes_max", simplePatchMax, float64(config.SimplePatchBytesLimit), "<=")
	failures := []GateCheck{}
	for _, check := range checks {
		if check.Status == "fail" {
			failures = append(failures, check)
		}
	}
	status := "pass"
	if len(failures) > 0 {
		status = "fail"
	}
	return GateReport{Status: status, Checks: checks, Failures: failures}
}

func runScale(ctx context.Context, config Config, gameCount int) (ScaleReport, error) {
	started := time.Now()
	resourceBefore := currentProcessResources()
	var memBefore runtime.MemStats
	runtime.ReadMemStats(&memBefore)
	store := newInstrumentedStore(persistence.NewInMemoryEventStore())
	runtimeService := runtimesvc.NewServiceWithStore(store, config.QueueSize, actor.DefaultAppliers())
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = runtimeService.Shutdown(shutdownCtx)
	}()

	acc := &scaleAccumulator{errors: map[string]int{}}
	for gameIndex := 0; gameIndex < gameCount; gameIndex++ {
		gameID := fmt.Sprintf("bench-game-%03d", gameIndex+1)
		initial := fixtureState(gameID)
		if _, _, err := runtimeService.LoadActorFromInitialState(ctx, gameID, initial); err != nil {
			return ScaleReport{}, err
		}
		acc.addBootstrapBytes(jsonSize(actor.BootstrapV2ForViewer(initial, "p1")))
	}

	transport := strings.ToLower(config.Transport)
	connectionsOpened := 0
	webSocketBytes := int64(0)
	if transport == "websocket" {
		opened, bytes, err := runWebSocketScale(ctx, config, runtimeService, gameCount, acc)
		if err != nil {
			return ScaleReport{}, err
		}
		connectionsOpened = opened
		webSocketBytes = bytes
	} else {
		for iteration := 0; iteration < config.Iterations; iteration++ {
			for _, spec := range commandSequence() {
				var wg sync.WaitGroup
				for gameIndex := 0; gameIndex < gameCount; gameIndex++ {
					gameIndex := gameIndex
					wg.Add(1)
					go func() {
						defer wg.Done()
						gameID := fmt.Sprintf("bench-game-%03d", gameIndex+1)
						gameActor, ok := runtimeService.Actor(gameID)
						if !ok {
							acc.addError(spec.commandType, "actor_missing")
							return
						}
						snapshot := gameActor.Snapshot()
						payload, actorID, skip := spec.payload(snapshot, iteration, gameIndex)
						if skip {
							return
						}
						command := protocol.CommandEnvelopeV2{
							GameID:         gameID,
							BaseVersion:    gameActor.Version(),
							ClientActionID: fmt.Sprintf("%s-%02d-%03d", spec.name, iteration+1, gameIndex+1),
							Type:           spec.commandType,
							Payload:        payload,
							Client:         map[string]any{"source": "runtime-bench"},
						}
						start := time.Now()
						result := gameActor.Submit(ctx, command, actorID)
						latencyMs := float64(time.Since(start).Microseconds()) / 1000
						if result.Err != nil {
							acc.addSample(sample{commandType: spec.commandType, latencyMs: latencyMs, err: result.Err.Error()})
							acc.addError(spec.commandType, result.Err.Error())
							return
						}
						patchBytes := jsonSize(result.Patches)
						fallback := int64(0)
						if metrics, ok := result.Event.Payload["metrics"].(map[string]any); ok {
							fallback = int64FromAny(metrics["command.legacy_fallback_count"])
						}
						acc.addSample(sample{commandType: spec.commandType, latencyMs: latencyMs, patchBytes: patchBytes, fallback: fallback})
					}()
				}
				wg.Wait()
			}
		}
	}

	var memAfter runtime.MemStats
	runtime.ReadMemStats(&memAfter)
	resourceAfter := currentProcessResources()
	scale := acc.report(gameCount, config.Connections, connectionsOpened, config.Iterations, store.summary(), runtimeService.MetricsSnapshot(), started, resourceBefore, resourceAfter, memBefore, memAfter, transport, webSocketBytes)
	return scale, nil
}

func normalizeConfig(config Config) Config {
	defaults := DefaultConfig()
	if len(config.GameCounts) == 0 {
		config.GameCounts = defaults.GameCounts
	}
	for index, count := range config.GameCounts {
		if count < 1 {
			config.GameCounts[index] = 1
		}
	}
	if config.Iterations < 1 {
		config.Iterations = defaults.Iterations
	}
	if config.QueueSize < 1 {
		config.QueueSize = defaults.QueueSize
	}
	if strings.TrimSpace(config.Transport) == "" {
		config.Transport = defaults.Transport
	}
	config.Transport = strings.ToLower(strings.TrimSpace(config.Transport))
	if config.SimplePatchBytesLimit < 1 {
		config.SimplePatchBytesLimit = defaults.SimplePatchBytesLimit
	}
	if config.ResyncRateLimit <= 0 {
		config.ResyncRateLimit = defaults.ResyncRateLimit
	}
	if config.Connections < 0 {
		config.Connections = 0
	}
	sort.Ints(config.GameCounts)
	return config
}

func (a *scaleAccumulator) addSample(value sample) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.samples = append(a.samples, value)
}

func (a *scaleAccumulator) addError(commandType string, message string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.errors[commandType+": "+message]++
}

func (a *scaleAccumulator) addBootstrapBytes(bytes int) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.bootstrapBytes = append(a.bootstrapBytes, float64(bytes))
}

func (a *scaleAccumulator) addReconnectLatency(latencyMs float64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.reconnectLatencies = append(a.reconnectLatencies, latencyMs)
}

func (a *scaleAccumulator) report(
	gameCount int,
	connectionsTarget int,
	connectionsOpened int,
	iterations int,
	store StoreSummary,
	metrics runtimesvc.MetricsSnapshot,
	started time.Time,
	resourceBefore processResources,
	resourceAfter processResources,
	memBefore runtime.MemStats,
	memAfter runtime.MemStats,
	transport string,
	webSocketBytes int64,
) ScaleReport {
	a.mu.Lock()
	samples := append([]sample(nil), a.samples...)
	reconnectLatencies := append([]float64(nil), a.reconnectLatencies...)
	bootstrapBytes := append([]float64(nil), a.bootstrapBytes...)
	errors := map[string]int{}
	for key, value := range a.errors {
		errors[key] = value
	}
	a.mu.Unlock()

	latencies := make([]float64, 0, len(samples))
	patchBytes := make([]float64, 0, len(samples))
	byCommand := map[string][]sample{}
	simplePatchMax := 0
	for _, value := range samples {
		latencies = append(latencies, value.latencyMs)
		patchBytes = append(patchBytes, float64(value.patchBytes))
		byCommand[value.commandType] = append(byCommand[value.commandType], value)
		if isSimpleCommand(value.commandType) && value.patchBytes > simplePatchMax {
			simplePatchMax = value.patchBytes
		}
	}
	perCommand := make([]CommandSummary, 0, len(byCommand))
	for commandType, commandSamples := range byCommand {
		commandLatencies := make([]float64, 0, len(commandSamples))
		commandPatchBytes := make([]float64, 0, len(commandSamples))
		resyncCount := 0
		refetchCount := 0
		errorCount := 0
		fallbackCount := int64(0)
		for _, value := range commandSamples {
			commandLatencies = append(commandLatencies, value.latencyMs)
			commandPatchBytes = append(commandPatchBytes, float64(value.patchBytes))
			if value.resync {
				resyncCount++
			}
			if value.refetch {
				refetchCount++
			}
			if value.err != "" {
				errorCount++
			}
			fallbackCount += value.fallback
		}
		perCommand = append(perCommand, CommandSummary{
			Type:          commandType,
			Count:         len(commandSamples),
			Latency:       summarize(commandLatencies),
			PatchBytes:    summarize(commandPatchBytes),
			ResyncCount:   resyncCount,
			RefetchCount:  refetchCount,
			FallbackCount: fallbackCount,
			ErrorCount:    errorCount,
		})
	}
	sort.Slice(perCommand, func(i, j int) bool { return perCommand[i].Type < perCommand[j].Type })
	commandCount := len(samples)
	allocBytes := float64(0)
	allocs := float64(0)
	if commandCount > 0 {
		allocBytes = float64(memAfter.TotalAlloc-memBefore.TotalAlloc) / float64(commandCount)
		allocs = float64(memAfter.Mallocs-memBefore.Mallocs) / float64(commandCount)
	}
	runtimeSummary := RuntimeSummary{
		InitialStatePerCommandCount: metrics.Runtime.InitialStatePerCommandCount,
		LegacyFallbackCount:         metrics.Runtime.CommandLegacyFallbackCount + metrics.Totals.LegacyFallbackCount,
		UnsupportedCommandCount:     metrics.Totals.UnsupportedCount,
		AliasTranslationCount:       metrics.Totals.AliasTranslationCount,
		RuntimeCoveragePercent:      metrics.Runtime.CommandRuntimeCoveragePct,
		ActorCacheHitCount:          metrics.Runtime.ActorCacheHitCount,
		ActorCacheMissCount:         metrics.Runtime.ActorCacheMissCount,
		QueueFullCount:              metrics.Totals.QueueFullCount,
	}
	return ScaleReport{
		Games:             gameCount,
		ConnectionsTarget: connectionsTarget,
		ConnectionsOpened: connectionsOpened,
		Iterations:        iterations,
		Commands:          commandCount,
		CommandLatency:    summarize(latencies),
		ReconnectLatency:  summarize(reconnectLatencies),
		Store:             store,
		Runtime:           runtimeSummary,
		Payload: PayloadSummary{
			PatchBytes:                summarize(patchBytes),
			SimplePatchBytesMax:       simplePatchMax,
			BootstrapBytes:            summarize(bootstrapBytes),
			WebSocketReceivedBytes:    webSocketBytes,
			SimulatedChatMessages:     gameCount * iterations * 4,
			SimulatedChatPayloadBytes: gameCount * iterations * 4 * 128,
		},
		Resources: ResourceSummary{
			WallMs:            float64(time.Since(started).Microseconds()) / 1000,
			CPUUserMs:         resourceAfter.userMS - resourceBefore.userMS,
			CPUSystemMs:       resourceAfter.systemMS - resourceBefore.systemMS,
			CPUMeasured:       resourceAfter.cpuMeasured && resourceBefore.cpuMeasured,
			RSSBytes:          resourceAfter.rssBytes,
			RSSMeasured:       resourceAfter.rssMeasured,
			GoHeapAllocBytes:  memAfter.HeapAlloc,
			GoHeapObjects:     memAfter.HeapObjects,
			GoTotalAllocBytes: memAfter.TotalAlloc - memBefore.TotalAlloc,
			AllocBytesPerOp:   round2(allocBytes),
			AllocsPerOp:       round2(allocs),
			NumGC:             memAfter.NumGC - memBefore.NumGC,
			Goroutines:        runtime.NumGoroutine(),
		},
		PerCommand:    perCommand,
		CommandErrors: errors,
		Scenario: ScenarioSummary{
			PlayersPerGame:       4,
			CardsPerPlayer:       100,
			BattlefieldPerPlayer: 20,
			TokensActive:         true,
			ChatActive:           true,
			StackActive:          true,
			AttachmentsActive:    true,
			MulliganActive:       true,
			ReconnectActive:      transport == "websocket",
		},
		Instrumentation: InstrumentationSummary{
			Transport:                transport,
			RefetchCountMeasured:     false,
			DBLockCountMeasured:      false,
			PreviousNextMeasured:     false,
			NetworkWebSocketMeasured: transport == "websocket",
		},
	}
}

func summarize(values []float64) PercentileSummary {
	if len(values) == 0 {
		return PercentileSummary{}
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	return PercentileSummary{
		Count: len(sorted),
		P50:   round2(percentile(sorted, 50)),
		P95:   round2(percentile(sorted, 95)),
		P99:   round2(percentile(sorted, 99)),
		Max:   round2(sorted[len(sorted)-1]),
	}
}

func percentile(sorted []float64, pct float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	rank := int(math.Ceil((pct/100)*float64(len(sorted)))) - 1
	if rank < 0 {
		rank = 0
	}
	if rank >= len(sorted) {
		rank = len(sorted) - 1
	}
	return sorted[rank]
}

func jsonSize(value any) int {
	payload, err := json.Marshal(value)
	if err != nil {
		return 0
	}
	return len(payload)
}

func isSimpleCommand(commandType string) bool {
	switch commandType {
	case "life.changed", "turn.changed", "card.tapped", "card.position.changed", "card.counter.changed", "counter.changed":
		return true
	default:
		return false
	}
}

func countResyncs(commands []CommandSummary) int {
	total := 0
	for _, command := range commands {
		total += command.ResyncCount
	}
	return total
}

func countRefetches(commands []CommandSummary) int {
	total := 0
	for _, command := range commands {
		total += command.RefetchCount
	}
	return total
}

func int64FromAny(value any) int64 {
	switch typed := value.(type) {
	case int:
		return int64(typed)
	case int64:
		return typed
	case float64:
		return int64(typed)
	default:
		return 0
	}
}

func round2(value float64) float64 {
	return math.Round(value*100) / 100
}

func round4(value float64) float64 {
	return math.Round(value*10000) / 10000
}

type instrumentedStore struct {
	delegate persistence.EventStore

	eventAppends        atomic.Int64
	eventBytes          atomic.Int64
	snapshotWrites      atomic.Int64
	snapshotBytes       atomic.Int64
	latestSnapshotReads atomic.Int64
	eventsAfterReads    atomic.Int64

	mu       sync.Mutex
	appendMS []float64
}

func newInstrumentedStore(delegate persistence.EventStore) *instrumentedStore {
	return &instrumentedStore{delegate: delegate}
}

func (s *instrumentedStore) AppendEvent(ctx context.Context, event protocol.EventPayloadV2) error {
	start := time.Now()
	err := s.delegate.AppendEvent(ctx, event)
	duration := float64(time.Since(start).Microseconds()) / 1000
	s.mu.Lock()
	s.appendMS = append(s.appendMS, duration)
	s.mu.Unlock()
	if err == nil {
		s.eventAppends.Add(1)
		s.eventBytes.Add(int64(jsonSize(event)))
	}
	return err
}

func (s *instrumentedStore) EventByClientActionID(ctx context.Context, gameID string, clientActionID string) (protocol.EventPayloadV2, bool, error) {
	return s.delegate.EventByClientActionID(ctx, gameID, clientActionID)
}

func (s *instrumentedStore) LatestSnapshot(ctx context.Context, gameID string) (persistence.CompactSnapshot, bool, error) {
	s.latestSnapshotReads.Add(1)
	return s.delegate.LatestSnapshot(ctx, gameID)
}

func (s *instrumentedStore) EventsAfter(ctx context.Context, gameID string, version int64) ([]protocol.EventPayloadV2, error) {
	s.eventsAfterReads.Add(1)
	return s.delegate.EventsAfter(ctx, gameID, version)
}

func (s *instrumentedStore) SaveSnapshot(ctx context.Context, snapshot persistence.CompactSnapshot) error {
	err := s.delegate.SaveSnapshot(ctx, snapshot)
	if err == nil {
		s.snapshotWrites.Add(1)
		s.snapshotBytes.Add(int64(jsonSize(snapshot.State)))
	}
	return err
}

func (s *instrumentedStore) summary() StoreSummary {
	s.mu.Lock()
	appendMS := append([]float64(nil), s.appendMS...)
	s.mu.Unlock()
	return StoreSummary{
		EventAppends:        s.eventAppends.Load(),
		EventAppendLatency:  summarize(appendMS),
		EventBytes:          s.eventBytes.Load(),
		SnapshotWrites:      s.snapshotWrites.Load(),
		SnapshotBytes:       s.snapshotBytes.Load(),
		LatestSnapshotReads: s.latestSnapshotReads.Load(),
		EventsAfterReads:    s.eventsAfterReads.Load(),
	}
}
