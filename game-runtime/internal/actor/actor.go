package actor

import (
	"context"
	"errors"
	"sync"
	"time"

	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

var (
	ErrQueueFull       = errors.New("game actor queue full")
	ErrVersionConflict = errors.New("baseVersion does not match actor version")
	ErrUnknownCommand  = errors.New("unknown command")
	ErrActorStopped    = errors.New("game actor stopped")
	ErrActorPermission = errors.New("actor is not allowed to perform command")
)

const maxSeenActionCache = 512

type Applier interface {
	Type() string
	Apply(ctx context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error)
}

type CommandRequest struct {
	Command    protocol.CommandEnvelopeV2
	ActorID    string
	Reply      chan CommandResult
	Deadline   time.Time
	EnqueuedAt time.Time
}

type CommandResult struct {
	Event   protocol.EventPayloadV2
	Patches []protocol.PatchEnvelopeV2
	Err     error
}

type SnapshotPolicy struct {
	EveryEvents   int
	EveryDuration time.Duration
}

func DefaultSnapshotPolicy() SnapshotPolicy {
	return SnapshotPolicy{EveryEvents: 100, EveryDuration: 30 * time.Second}
}

type GameActor struct {
	gameID              string
	state               *state.GameState
	store               persistence.EventStore
	appliers            map[string]Applier
	mailbox             chan CommandRequest
	seenActions         map[string]CommandResult
	seenActionOrder     []string
	startedAt           time.Time
	lastHeartbeat       time.Time
	stop                chan struct{}
	stopped             chan struct{}
	stopOnce            sync.Once
	stateMu             sync.RWMutex
	metricsMu           sync.RWMutex
	metrics             ActorMetrics
	snapshotPolicy      SnapshotPolicy
	eventsSinceSnapshot int
	lastSnapshotAt      time.Time
}

type ActorMetrics struct {
	GameID                string  `json:"gameId"`
	QueueDepth            int     `json:"actor.queue_depth"`
	QueueCapacity         int     `json:"actor.queue_capacity"`
	QueueFullCount        int64   `json:"actor.queue_full_count"`
	CommandEnqueuedCount  int64   `json:"actor.command_enqueued_count"`
	CommandRejectedCount  int64   `json:"actor.command_rejected_count"`
	CommandAppliedCount   int64   `json:"actor.command_applied_count"`
	CommandLatencyMs      float64 `json:"actor.command_latency_ms"`
	QueueWaitMs           float64 `json:"actor.queue_wait_ms"`
	RuntimeCoveragePct    float64 `json:"command.runtime_coverage_percent"`
	AliasTranslationCount int64   `json:"command.alias_translation_count"`
	UnsupportedCount      int64   `json:"command.unsupported_count"`
	LegacyFallbackCount   int64   `json:"command.legacy_fallback_count"`
}

func NewGameActor(gameID string, initial state.GameState, store persistence.EventStore, queueSize int, appliers []Applier) *GameActor {
	return NewGameActorWithSnapshotPolicy(gameID, initial, store, queueSize, appliers, DefaultSnapshotPolicy())
}

func NewGameActorWithSnapshotPolicy(gameID string, initial state.GameState, store persistence.EventStore, queueSize int, appliers []Applier, snapshotPolicy SnapshotPolicy) *GameActor {
	byType := make(map[string]Applier, len(appliers))
	for _, applier := range appliers {
		byType[applier.Type()] = applier
	}
	if queueSize < 1 {
		queueSize = 1
	}
	return &GameActor{
		gameID:          gameID,
		state:           &initial,
		store:           store,
		appliers:        byType,
		mailbox:         make(chan CommandRequest, queueSize),
		seenActions:     map[string]CommandResult{},
		seenActionOrder: make([]string, 0, maxSeenActionCache),
		startedAt:       time.Now().UTC(),
		lastHeartbeat:   time.Now().UTC(),
		stop:            make(chan struct{}),
		stopped:         make(chan struct{}),
		metrics: ActorMetrics{
			GameID:             gameID,
			QueueCapacity:      queueSize,
			RuntimeCoveragePct: CommandRuntimeCoveragePercent(appliers, FinalGameplayCommandTypes()),
		},
		snapshotPolicy: snapshotPolicy,
		lastSnapshotAt: time.Now().UTC(),
	}
}

func (a *GameActor) Enqueue(request CommandRequest) error {
	if request.EnqueuedAt.IsZero() {
		request.EnqueuedAt = time.Now().UTC()
	}
	select {
	case <-a.stopped:
		a.recordRejected(0, 0)
		return ErrActorStopped
	default:
	}

	select {
	case <-a.stopped:
		a.recordRejected(0, 0)
		return ErrActorStopped
	case a.mailbox <- request:
		a.recordEnqueued()
		return nil
	default:
		a.recordQueueFull()
		return ErrQueueFull
	}
}

func (a *GameActor) Submit(ctx context.Context, command protocol.CommandEnvelopeV2, actorID string) CommandResult {
	reply := make(chan CommandResult, 1)
	if err := a.Enqueue(CommandRequest{Command: command, ActorID: actorID, Reply: reply}); err != nil {
		return CommandResult{Err: err}
	}

	select {
	case result := <-reply:
		return result
	case <-ctx.Done():
		return CommandResult{Err: ctx.Err()}
	}
}

func (a *GameActor) Start(ctx context.Context) {
	go a.Run(ctx)
}

func (a *GameActor) Run(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	defer close(a.stopped)

	for {
		select {
		case <-ctx.Done():
			return
		case <-a.stop:
			return
		case <-ticker.C:
			a.TouchHeartbeat()
		case request := <-a.mailbox:
			result := a.apply(ctx, request)
			if request.Reply != nil {
				request.Reply <- result
			}
		}
	}
}

func (a *GameActor) Stop(ctx context.Context) error {
	a.stopOnce.Do(func() {
		close(a.stop)
	})
	select {
	case <-a.stopped:
		return a.SaveCompactSnapshot(ctx)
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (a *GameActor) Heartbeat() time.Time {
	a.stateMu.RLock()
	defer a.stateMu.RUnlock()
	return a.lastHeartbeat
}

func (a *GameActor) TouchHeartbeat() {
	a.stateMu.Lock()
	defer a.stateMu.Unlock()
	a.lastHeartbeat = time.Now().UTC()
}

func (a *GameActor) QueueDepth() int {
	return len(a.mailbox)
}

func (a *GameActor) Metrics() ActorMetrics {
	a.metricsMu.RLock()
	defer a.metricsMu.RUnlock()
	metrics := a.metrics
	metrics.QueueDepth = len(a.mailbox)
	metrics.QueueCapacity = cap(a.mailbox)
	return metrics
}

func (a *GameActor) Version() int64 {
	a.stateMu.RLock()
	defer a.stateMu.RUnlock()
	return a.state.Version
}

func (a *GameActor) Snapshot() state.GameState {
	a.stateMu.RLock()
	defer a.stateMu.RUnlock()
	return a.state.Clone()
}

func (a *GameActor) ApplyDirect(ctx context.Context, command protocol.CommandEnvelopeV2, actorID string) CommandResult {
	return a.apply(ctx, CommandRequest{Command: command, ActorID: actorID})
}

func (a *GameActor) SaveCompactSnapshot(ctx context.Context) error {
	if a.store == nil {
		return nil
	}
	a.stateMu.RLock()
	snapshot, err := persistence.NewCompactSnapshot(a.state.Clone())
	a.stateMu.RUnlock()
	if err != nil {
		return err
	}
	return a.store.SaveSnapshot(ctx, snapshot)
}

func (a *GameActor) apply(ctx context.Context, request CommandRequest) CommandResult {
	startedAt := time.Now().UTC()
	queueWait := time.Duration(0)
	if !request.EnqueuedAt.IsZero() {
		queueWait = startedAt.Sub(request.EnqueuedAt)
	}
	a.stateMu.Lock()
	defer a.stateMu.Unlock()

	command := request.Command
	if err := command.Validate(); err != nil {
		return a.rejectedResult(err, queueWait, startedAt)
	}
	aliasTranslated := false
	if canonicalType, translated := CanonicalCommandType(command.Type); translated {
		command.Type = canonicalType
		aliasTranslated = true
		a.recordAliasTranslation()
	}
	if existing, ok := a.seenActions[command.ClientActionID]; ok {
		return existing
	}
	if a.store != nil && command.ClientActionID != "" {
		existing, ok, err := a.store.EventByClientActionID(ctx, command.GameID, command.ClientActionID)
		if err != nil {
			return a.rejectedResult(err, queueWait, startedAt)
		}
		if ok {
			return CommandResult{Event: existing}
		}
	}
	if command.BaseVersion != a.state.Version {
		return a.rejectedResult(ErrVersionConflict, queueWait, startedAt)
	}
	applier, ok := a.appliers[command.Type]
	if !ok {
		a.recordUnsupported()
		return a.rejectedResult(ErrUnknownCommand, queueWait, startedAt)
	}
	if command.Type == "game.concede" {
		playerID, _ := command.Payload["playerId"].(string)
		if playerID == "" || playerID != request.ActorID {
			return a.rejectedResult(ErrActorPermission, queueWait, startedAt)
		}
	}

	nextVersion := a.state.Version + 1
	emitter := NewPatchEmitter()
	rollback := newCommandRollback(a.state, command)
	eventPayload, err := applier.Apply(ctx, a.state, command, emitter)
	if err != nil {
		rollback.Restore(a.state)
		return a.rejectedResult(err, queueWait, startedAt)
	}
	if eventPayload == nil {
		eventPayload = map[string]any{}
	}
	addCommandMetric(eventPayload, "command.runtime_coverage_percent", a.commandRuntimeCoveragePercent())
	addCommandMetric(eventPayload, "command.unsupported_count", 0)
	addCommandMetric(eventPayload, "command.legacy_fallback_count", 0)
	if aliasTranslated {
		addCommandMetric(eventPayload, "command.alias_translation_count", 1)
	} else {
		addCommandMetric(eventPayload, "command.alias_translation_count", 0)
	}
	a.state.Version = nextVersion
	eventType := command.Type
	if override, ok := eventPayload["_eventType"].(string); ok && override != "" {
		eventType = override
		delete(eventPayload, "_eventType")
	}

	event := protocol.EventPayloadV2{
		GameID:         a.gameID,
		Version:        nextVersion,
		Type:           eventType,
		Payload:        eventPayload,
		CreatedBy:      request.ActorID,
		ClientActionID: command.ClientActionID,
		CreatedAt:      time.Now().UTC(),
	}
	if err := event.Validate(); err != nil {
		rollback.Restore(a.state)
		return a.rejectedResult(err, queueWait, startedAt)
	}
	if a.store != nil {
		if err := a.store.AppendEvent(ctx, event); err != nil {
			rollback.Restore(a.state)
			return a.rejectedResult(err, queueWait, startedAt)
		}
	}

	result := CommandResult{
		Event:   event,
		Patches: emitter.Envelopes(a.gameID, nextVersion, command.ClientActionID),
	}
	a.rememberSeenAction(command.ClientActionID, result)
	a.lastHeartbeat = time.Now().UTC()
	a.eventsSinceSnapshot++
	if err := a.saveSnapshotIfDueLocked(ctx); err != nil {
		return a.rejectedResult(err, queueWait, startedAt)
	}
	a.recordApplied(queueWait, time.Since(startedAt))
	return result
}

func (a *GameActor) rememberSeenAction(clientActionID string, result CommandResult) {
	if clientActionID == "" {
		return
	}
	if _, exists := a.seenActions[clientActionID]; !exists {
		a.seenActionOrder = append(a.seenActionOrder, clientActionID)
	}
	a.seenActions[clientActionID] = result
	for len(a.seenActionOrder) > maxSeenActionCache {
		oldest := a.seenActionOrder[0]
		a.seenActionOrder = a.seenActionOrder[1:]
		delete(a.seenActions, oldest)
	}
}

func (a *GameActor) rejectedResult(err error, queueWait time.Duration, startedAt time.Time) CommandResult {
	a.recordRejected(queueWait, time.Since(startedAt))
	return CommandResult{Err: err}
}

func (a *GameActor) recordEnqueued() {
	a.metricsMu.Lock()
	defer a.metricsMu.Unlock()
	a.metrics.CommandEnqueuedCount++
}

func (a *GameActor) recordQueueFull() {
	a.metricsMu.Lock()
	defer a.metricsMu.Unlock()
	a.metrics.QueueFullCount++
	a.metrics.CommandRejectedCount++
}

func (a *GameActor) recordRejected(queueWait time.Duration, latency time.Duration) {
	a.metricsMu.Lock()
	defer a.metricsMu.Unlock()
	a.metrics.CommandRejectedCount++
	a.metrics.QueueWaitMs = durationMs(queueWait)
	a.metrics.CommandLatencyMs = durationMs(latency)
}

func (a *GameActor) recordApplied(queueWait time.Duration, latency time.Duration) {
	a.metricsMu.Lock()
	defer a.metricsMu.Unlock()
	a.metrics.CommandAppliedCount++
	a.metrics.QueueWaitMs = durationMs(queueWait)
	a.metrics.CommandLatencyMs = durationMs(latency)
}

func (a *GameActor) recordAliasTranslation() {
	a.metricsMu.Lock()
	defer a.metricsMu.Unlock()
	a.metrics.AliasTranslationCount++
}

func (a *GameActor) recordUnsupported() {
	a.metricsMu.Lock()
	defer a.metricsMu.Unlock()
	a.metrics.UnsupportedCount++
}

func (a *GameActor) commandRuntimeCoveragePercent() float64 {
	a.metricsMu.RLock()
	defer a.metricsMu.RUnlock()
	return a.metrics.RuntimeCoveragePct
}

func durationMs(duration time.Duration) float64 {
	if duration <= 0 {
		return 0
	}
	return float64(duration.Microseconds()) / 1000
}

func addCommandMetric(payload map[string]any, key string, value any) {
	metrics, ok := payload["metrics"].(map[string]any)
	if !ok || metrics == nil {
		metrics = map[string]any{}
		payload["metrics"] = metrics
	}
	metrics[key] = value
}

func (a *GameActor) saveSnapshotIfDueLocked(ctx context.Context) error {
	if a.store == nil {
		return nil
	}
	policy := a.snapshotPolicy
	if policy.EveryEvents <= 0 && policy.EveryDuration <= 0 {
		return nil
	}
	now := time.Now().UTC()
	dueByEvents := policy.EveryEvents > 0 && a.eventsSinceSnapshot >= policy.EveryEvents
	dueByTime := policy.EveryDuration > 0 && now.Sub(a.lastSnapshotAt) >= policy.EveryDuration
	if !dueByEvents && !dueByTime {
		return nil
	}
	snapshot, err := persistence.NewCompactSnapshot(a.state.Clone())
	if err != nil {
		return err
	}
	if err := a.store.SaveSnapshot(ctx, snapshot); err != nil {
		return err
	}
	a.eventsSinceSnapshot = 0
	a.lastSnapshotAt = now
	return nil
}
