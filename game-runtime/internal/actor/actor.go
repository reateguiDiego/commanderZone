package actor

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"commanderzone/game-runtime/internal/lifecycle"
	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

var (
	ErrQueueFull                  = errors.New("game actor queue full")
	ErrVersionConflict            = errors.New("baseVersion does not match actor version")
	ErrUnknownCommand             = errors.New("unknown command")
	ErrActorStopped               = errors.New("game actor stopped")
	ErrGameClosing                = errors.New("game is closing")
	ErrGameFinished               = errors.New("game is finished")
	ErrActorPermission            = errors.New("actor is not allowed to perform command")
	ErrStalePresenceGeneration    = errors.New("stale presence generation")
	ErrRuntimePatchReceiptMissing = errors.New("runtime patch receipt missing for duplicate command")
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
	gameID                  string
	state                   *state.GameState
	store                   persistence.EventStore
	appliers                map[string]Applier
	mailbox                 chan CommandRequest
	seenActions             map[string]CommandResult
	seenActionOrder         []string
	startedAt               time.Time
	lastHeartbeat           time.Time
	stop                    chan struct{}
	stopped                 chan struct{}
	stopOnce                sync.Once
	stateMu                 sync.RWMutex
	metricsMu               sync.RWMutex
	metrics                 ActorMetrics
	snapshotPolicy          SnapshotPolicy
	eventsSinceSnapshot     int
	lastSnapshotAt          time.Time
	closing                 bool
	commandGuard            func(context.Context) (persistence.FencingToken, error)
	lifecycleSink           lifecycle.Sink
	lifecycleGeneration     int64
	lifecycleConfirmed      func(lifecycle.Handoff)
	internalResultPublisher func(context.Context, CommandResult)
}

type ActorMetrics struct {
	GameID                         string  `json:"gameId"`
	QueueDepth                     int     `json:"actor.queue_depth"`
	QueueCapacity                  int     `json:"actor.queue_capacity"`
	QueueFullCount                 int64   `json:"actor.queue_full_count"`
	CommandEnqueuedCount           int64   `json:"actor.command_enqueued_count"`
	CommandRejectedCount           int64   `json:"actor.command_rejected_count"`
	CommandAppliedCount            int64   `json:"actor.command_applied_count"`
	CommandLatencyMs               float64 `json:"actor.command_latency_ms"`
	QueueWaitMs                    float64 `json:"actor.queue_wait_ms"`
	RuntimeCoveragePct             float64 `json:"command.runtime_coverage_percent"`
	AliasTranslationCount          int64   `json:"command.alias_translation_count"`
	UnsupportedCount               int64   `json:"command.unsupported_count"`
	LegacyFallbackCount            int64   `json:"command.legacy_fallback_count"`
	DuplicateActionCount           int64   `json:"actor.duplicate_action_count"`
	DuplicateMemoryCount           int64   `json:"actor.duplicate_memory_count"`
	DuplicateDurableCount          int64   `json:"actor.duplicate_durable_count"`
	DuplicateReceiptMissingCount   int64   `json:"actor.duplicate_receipt_missing_count"`
	VersionConflictCount           int64   `json:"actor.version_conflict_count"`
	SnapshotPostAppendFailureCount int64   `json:"actor.snapshot_post_append_failure_count"`
	SeenActionCacheSize            int     `json:"actor.seen_action_cache_size"`
	SeenActionCacheCapacity        int     `json:"actor.seen_action_cache_capacity"`
}

func NewGameActor(gameID string, initial state.GameState, store persistence.EventStore, queueSize int, appliers []Applier) *GameActor {
	return NewGameActorWithSnapshotPolicy(gameID, initial, store, queueSize, appliers, DefaultSnapshotPolicy())
}

func NewGameActorWithCommandGuard(gameID string, initial state.GameState, store persistence.EventStore, queueSize int, appliers []Applier, guard func(context.Context) (persistence.FencingToken, error)) *GameActor {
	gameActor := NewGameActor(gameID, initial, store, queueSize, appliers)
	gameActor.commandGuard = guard
	return gameActor
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

func (a *GameActor) SetLifecycleSink(sink lifecycle.Sink, generation int64) {
	a.stateMu.Lock()
	defer a.stateMu.Unlock()
	a.lifecycleSink = sink
	if generation < 1 {
		generation = 1
	}
	a.lifecycleGeneration = generation
}

// SetLifecycleConfirmedHook runs only after Symfony has accepted an idempotent
// lifecycle handoff. Runtime owns this hook to release an actor after finish;
// it never writes to the gameplay event stream.
func (a *GameActor) SetLifecycleConfirmedHook(hook func(lifecycle.Handoff)) {
	a.stateMu.Lock()
	defer a.stateMu.Unlock()
	a.lifecycleConfirmed = hook
}

// SetInternalResultPublisher is used only by actor-owned lifecycle work (for
// example a disconnect deadline resolved from the heartbeat). It lets the WS
// gateway fan out the already persisted compact patch without making an extra
// command or polling the actor.
func (a *GameActor) SetInternalResultPublisher(publisher func(context.Context, CommandResult)) {
	a.stateMu.Lock()
	defer a.stateMu.Unlock()
	a.internalResultPublisher = publisher
}

// BeginClosing fences the actor before runtime disposal. Already-completed
// events remain durable, while queued and subsequent gameplay commands receive
// a semantic closing result instead of a version conflict.
func (a *GameActor) BeginClosing() {
	a.stateMu.Lock()
	defer a.stateMu.Unlock()
	a.closing = true
}

// ClearDisconnectVotesForAllOffline removes actor-hot vote state and records
// the final offline presence in the compact snapshot without a gameplay event.
// With zero connected players there is no eligible voter; the persisted
// all-disconnected lifecycle is the only authority.
func (a *GameActor) ClearDisconnectVotesForAllOffline() bool {
	a.stateMu.Lock()
	defer a.stateMu.Unlock()
	changed := len(a.state.DisconnectVotes) > 0
	a.state.DisconnectVotes = map[string]map[string]any{}
	for playerID, player := range a.state.Players {
		if online, ok := player["isOnline"].(bool); ok && !online {
			continue
		}
		player["isOnline"] = false
		a.state.Players[playerID] = player
		changed = true
	}
	return changed
}

func (a *GameActor) Enqueue(request CommandRequest) error {
	if request.EnqueuedAt.IsZero() {
		request.EnqueuedAt = time.Now().UTC()
	}
	if a.isClosing() {
		a.recordRejected(0, 0)
		return ErrGameClosing
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
			a.resolveDueDisconnectVotes(ctx)
		case request := <-a.mailbox:
			result := a.apply(ctx, request)
			if request.Reply != nil {
				request.Reply <- result
			}
		}
	}
}

// resolveDueDisconnectVotes shares the actor's existing heartbeat tick. It
// resolves expired ballots and reopens cooldowns for targets that remain
// offline. The number of inspected votes is bounded by the current game,
// never global.
func (a *GameActor) resolveDueDisconnectVotes(ctx context.Context) {
	snapshot := a.Snapshot()
	if snapshot.Status == "finished" || a.isClosing() {
		return
	}
	now := time.Now().UTC()
	for targetPlayerID, vote := range snapshot.DisconnectVotes {
		var actionID string
		var payload map[string]any
		switch vote["status"] {
		case "open":
			deadlineAt, ok := vote["deadlineAt"].(string)
			if !ok {
				continue
			}
			deadline, err := time.Parse(time.RFC3339, deadlineAt)
			if err != nil || now.Before(deadline) {
				continue
			}
			actionID = fmt.Sprintf("disconnect-timeout:%s:%s", targetPlayerID, deadlineAt)
			payload = map[string]any{"targetPlayerId": targetPlayerID, "status": "timeout"}
		case "resolved_wait":
			cooldownUntil, ok := vote["cooldownUntil"].(string)
			if !ok {
				continue
			}
			cooldown, err := time.Parse(time.RFC3339, cooldownUntil)
			if err != nil || now.Before(cooldown) {
				continue
			}
			eligible := disconnectVoteEligible(vote, &snapshot, targetPlayerID, nil)
			if len(eligible) == 0 {
				continue
			}
			actionID = fmt.Sprintf("disconnect-reopen:%s:%s", targetPlayerID, cooldownUntil)
			payload = map[string]any{"targetPlayerId": targetPlayerID, "status": "offline", "connectedUserIds": eligible}
		default:
			continue
		}
		result := a.ApplyDirect(ctx, protocol.CommandEnvelopeV2{
			GameID: a.gameID, BaseVersion: a.Version(),
			ClientActionID: actionID,
			Type:           "disconnect.vote",
			Payload:        payload,
			Client:         map[string]any{"source": "runtime_actor_tick"},
		}, "")
		if result.Err != nil && !errors.Is(result.Err, ErrVersionConflict) {
			slog.Warn("runtime due disconnect vote transition failed", "gameId", a.gameID, "targetPlayerId", targetPlayerID, "error", result.Err)
			continue
		}
		if result.Err == nil {
			a.publishInternalResult(ctx, result)
		}
	}
}

func (a *GameActor) isClosing() bool {
	a.stateMu.RLock()
	defer a.stateMu.RUnlock()
	return a.closing
}

func (a *GameActor) publishInternalResult(ctx context.Context, result CommandResult) {
	a.stateMu.RLock()
	publisher := a.internalResultPublisher
	a.stateMu.RUnlock()
	if publisher != nil {
		publisher(ctx, result)
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
	a.stateMu.RLock()
	seenActionCacheSize := len(a.seenActions)
	a.stateMu.RUnlock()

	a.metricsMu.RLock()
	defer a.metricsMu.RUnlock()
	metrics := a.metrics
	metrics.QueueDepth = len(a.mailbox)
	metrics.QueueCapacity = cap(a.mailbox)
	metrics.SeenActionCacheSize = seenActionCacheSize
	metrics.SeenActionCacheCapacity = maxSeenActionCache
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

// PresenceGeneration exposes only the actor-owned fence for a player. The
// gateway uses it to seed a new local presence sequence after process/runtime
// recovery without consulting the gameplay event store.
func (a *GameActor) PresenceGeneration(playerID string) int64 {
	a.stateMu.RLock()
	defer a.stateMu.RUnlock()
	return a.state.PresenceGenerations[playerID]
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
	var fence persistence.FencingToken
	if a.commandGuard != nil {
		var err error
		fence, err = a.commandGuard(ctx)
		if err != nil {
			return a.rejectedResult(err, queueWait, startedAt)
		}
	}
	a.stateMu.Lock()
	defer a.stateMu.Unlock()
	if a.closing {
		return a.rejectedResult(ErrGameClosing, queueWait, startedAt)
	}

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
	// Gateway presence is an actor-internal lifecycle signal, not a browser
	// gameplay command. Its execution point is the mailbox, so rebase it under
	// the actor lock instead of reading the stream to discover a version. The
	// presence generation in the payload still fences stale async transitions.
	a.rebaseRuntimePresenceCommandLocked(&command)
	if existing, ok := a.seenActions[command.ClientActionID]; ok {
		if !eventCreatedByMatches(existing.Event, request.ActorID) {
			return a.rejectedResult(ErrActorPermission, queueWait, startedAt)
		}
		a.recordDuplicateMemoryAction(queueWait, time.Since(startedAt))
		a.deliverLifecycleHandoffLocked(ctx, existing.Event, fence.Token)
		slog.Debug("runtime duplicate command served from actor memory", "gameId", a.gameID, "version", existing.Event.Version, "clientActionId", command.ClientActionID)
		return existing
	}
	// Presence commands carry an actor-persisted generation fence, so their
	// normal path never needs an idempotency lookup just to discover state. A
	// retried generation is rejected locally as stale; durable lookup remains
	// available only on the exceptional append-conflict path below.
	if a.store != nil && command.ClientActionID != "" && !isRuntimePresenceCommand(command) {
		result, ok, err := a.storedDuplicateResult(ctx, command, request.ActorID)
		if err != nil {
			if errors.Is(err, ErrActorPermission) {
				return a.rejectedResult(err, queueWait, startedAt)
			}
			a.recordDuplicateDurableAction(queueWait, time.Since(startedAt))
			return a.duplicateDurableErrorResult(err, command.ClientActionID, queueWait, startedAt)
		}
		if ok {
			a.recordDuplicateDurableAction(queueWait, time.Since(startedAt))
			a.deliverLifecycleHandoffLocked(ctx, result.Event, fence.Token)
			slog.Debug("runtime duplicate command served from durable event store", "gameId", a.gameID, "version", result.Event.Version, "clientActionId", command.ClientActionID)
			return result
		}
	}
	if err := a.permissionErrorLocked(command, request.ActorID); err != nil {
		return a.rejectedResult(err, queueWait, startedAt)
	}
	if result, ok := a.idempotentConcedeResultLocked(command, request.ActorID, queueWait, startedAt); ok {
		return result
	}
	if a.state.Status == "finished" {
		return a.rejectedResult(ErrGameFinished, queueWait, startedAt)
	}
	if command.BaseVersion > a.state.Version && a.store != nil {
		if err := a.catchUpPersistedEventsLocked(ctx, command.BaseVersion); err != nil {
			a.recordVersionConflict()
			slog.Warn("runtime actor catch-up failed before command", "gameId", a.gameID, "actorVersion", a.state.Version, "baseVersion", command.BaseVersion, "clientActionId", command.ClientActionID, "error", err)
			return a.rejectedResult(ErrVersionConflict, queueWait, startedAt)
		}
	}
	if command.BaseVersion < a.state.Version {
		accepted, err := a.canAcceptStaleBaseVersionLocked(ctx, command.BaseVersion)
		if err != nil {
			a.recordVersionConflict()
			slog.Warn("runtime actor stale-base inspection failed before command", "gameId", a.gameID, "actorVersion", a.state.Version, "baseVersion", command.BaseVersion, "clientActionId", command.ClientActionID, "error", err)
			return a.rejectedResult(ErrVersionConflict, queueWait, startedAt)
		}
		if !accepted {
			a.recordVersionConflict()
			return a.rejectedResult(ErrVersionConflict, queueWait, startedAt)
		}
	}
	if command.BaseVersion != a.state.Version {
		if command.BaseVersion > a.state.Version {
			a.recordVersionConflict()
			return a.rejectedResult(ErrVersionConflict, queueWait, startedAt)
		}
	}
	applier, ok := a.appliers[command.Type]
	if !ok {
		a.recordUnsupported()
		return a.rejectedResult(ErrUnknownCommand, queueWait, startedAt)
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

	createdAt := time.Now().UTC()
	if logEntries := runtimeEventLogEntries(a.state, command, eventPayload, request.ActorID, nextVersion, createdAt); len(logEntries) > 0 {
		eventPayload["eventLogEntries"] = logEntries
		emitter.EmitPublic(protocol.PatchOp{
			Op:   "eventLog.append",
			Data: map[string]any{"entries": logEntries},
		})
		for viewerID, privateEntries := range runtimePrivateRevealLogEntries(a.state, command, eventPayload, logEntries) {
			emitter.EmitPrivate(viewerID, protocol.PatchOp{
				Op:   "eventLog.append",
				Data: map[string]any{"entries": privateEntries},
			})
		}
	}

	event := protocol.EventPayloadV2{
		GameID:         a.gameID,
		Version:        nextVersion,
		Type:           eventType,
		Payload:        eventPayload,
		CreatedBy:      request.ActorID,
		ClientActionID: command.ClientActionID,
		CreatedAt:      createdAt,
	}
	if err := event.Validate(); err != nil {
		rollback.Restore(a.state)
		return a.rejectedResult(err, queueWait, startedAt)
	}
	patches := emitter.Envelopes(a.gameID, nextVersion, command.ClientActionID)
	if err := validatePatchEnvelopes(patches); err != nil {
		rollback.Restore(a.state)
		return a.rejectedResult(err, queueWait, startedAt)
	}
	if a.store != nil {
		appendEvent := eventWithRuntimePatchReceipt(event, patches)
		if a.commandGuard != nil {
			var err error
			fence, err = a.commandGuard(ctx)
			if err != nil {
				rollback.Restore(a.state)
				return a.rejectedResult(err, queueWait, startedAt)
			}
		}
		var err error
		if fence.Required {
			fencedStore, ok := a.store.(persistence.FencedEventStore)
			if !ok {
				err = persistence.ErrOwnershipNotHeld
			} else {
				err = fencedStore.AppendEventWithFence(ctx, appendEvent, fence)
			}
		} else {
			err = a.store.AppendEvent(ctx, appendEvent)
		}
		if err != nil {
			rollback.Restore(a.state)
			if errors.Is(err, persistence.ErrGameClosing) {
				return a.rejectedResult(ErrGameClosing, queueWait, startedAt)
			}
			if isRecoverableDuplicateAppend(err) && command.ClientActionID != "" {
				result, ok, lookupErr := a.storedDuplicateResult(ctx, command, request.ActorID)
				if lookupErr != nil {
					if errors.Is(lookupErr, ErrActorPermission) {
						return a.rejectedResult(lookupErr, queueWait, startedAt)
					}
					a.recordDuplicateDurableAction(queueWait, time.Since(startedAt))
					return a.duplicateDurableErrorResult(lookupErr, command.ClientActionID, queueWait, startedAt)
				}
				if ok {
					a.recordDuplicateDurableAction(queueWait, time.Since(startedAt))
					a.deliverLifecycleHandoffLocked(ctx, result.Event, fence.Token)
					slog.Debug("runtime duplicate command recovered after durable append conflict", "gameId", a.gameID, "version", result.Event.Version, "clientActionId", command.ClientActionID)
					return result
				}
			}
			if errors.Is(err, persistence.ErrDuplicateVersion) {
				previousVersion := a.state.Version
				if recoveryErr := a.recoverAuthoritativeStateLocked(ctx); recoveryErr != nil {
					slog.Error("runtime actor authoritative recovery failed after stream version conflict", "gameId", a.gameID, "actorVersion", previousVersion, "clientActionId", command.ClientActionID, "error", recoveryErr)
				} else {
					slog.Warn("runtime actor recovered after stream version conflict", "gameId", a.gameID, "previousVersion", previousVersion, "authoritativeVersion", a.state.Version, "clientActionId", command.ClientActionID)
				}
				a.recordVersionConflict()
				return a.rejectedResult(ErrVersionConflict, queueWait, startedAt)
			}
			return a.rejectedResult(err, queueWait, startedAt)
		}
	}

	result := CommandResult{
		Event:   event,
		Patches: patches,
	}
	a.deliverLifecycleHandoffLocked(ctx, event, fence.Token)
	a.rememberSeenAction(command.ClientActionID, result)
	a.lastHeartbeat = time.Now().UTC()
	a.eventsSinceSnapshot++
	if err := a.saveSnapshotIfDueLocked(ctx); err != nil {
		a.recordSnapshotPostAppendFailure()
		slog.Warn("runtime compact snapshot save failed after event append", "gameId", a.gameID, "version", event.Version, "clientActionId", command.ClientActionID, "error", err)
	}
	a.recordApplied(queueWait, time.Since(startedAt))
	return result
}

func isRuntimePresenceCommand(command protocol.CommandEnvelopeV2) bool {
	if command.Type != "disconnect.vote" || command.Client == nil {
		return false
	}
	source, _ := command.Client["source"].(string)
	return source == "runtime_ws_presence"
}

func (a *GameActor) rebaseRuntimePresenceCommandLocked(command *protocol.CommandEnvelopeV2) {
	if command == nil || !isRuntimePresenceCommand(*command) {
		return
	}
	baseVersion := a.state.Version
	if baseVersion < 1 {
		baseVersion = 1
	}
	command.BaseVersion = baseVersion
}

// recoverAuthoritativeStateLocked is deliberately restricted to the exceptional
// append-conflict path. Normal gameplay commands never read before writing.
func (a *GameActor) recoverAuthoritativeStateLocked(ctx context.Context) error {
	if a.store == nil {
		return ErrVersionConflict
	}

	// The rolled-back actor state is already a compact authoritative base. The
	// cheapest recovery is therefore the missing durable tail only.
	if recovered, err := a.recoverFromBaseLocked(ctx, a.state.Clone()); err == nil && recovered.Version > a.state.Version {
		*a.state = recovered
		a.eventsSinceSnapshot = 0
		a.lastHeartbeat = time.Now().UTC()
		return nil
	}

	// A compact snapshot is the fallback for an unexpected gap/corrupt local
	// base. This remains exceptional and never enters the normal command path.
	snapshot, ok, err := a.store.LatestSnapshot(ctx, a.gameID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrVersionConflict
	}
	recovered, err := a.recoverFromBaseLocked(ctx, snapshot.State)
	if err != nil {
		return err
	}
	if recovered.Version <= a.state.Version {
		return ErrVersionConflict
	}

	*a.state = recovered
	a.eventsSinceSnapshot = 0
	a.lastHeartbeat = time.Now().UTC()
	return nil
}

func (a *GameActor) recoverFromBaseLocked(ctx context.Context, base state.GameState) (state.GameState, error) {
	state.NormalizeForRecovery(a.gameID, &base)
	events, err := a.store.EventsAfter(ctx, a.gameID, base.Version)
	if err != nil {
		return state.GameState{}, err
	}
	for _, event := range events {
		if event.Version != base.Version+1 {
			return state.GameState{}, ErrVersionConflict
		}
		if actorExternalNoopEvent(event.Type) {
			base.Version = event.Version
			continue
		}
		if err := ReplayEventWithAppliers(&base, eventWithoutRuntimePatchReceipt(event), a.appliersList()); err != nil {
			return state.GameState{}, err
		}
		base.Version = event.Version
	}
	state.RebuildLocIndexForRecoveryOnly(&base)
	if err := state.ValidateInvariants(base); err != nil {
		return state.GameState{}, err
	}
	return base, nil
}

func (a *GameActor) catchUpPersistedEventsLocked(ctx context.Context, targetVersion int64) error {
	if a.store == nil || targetVersion <= a.state.Version {
		return nil
	}
	events, err := a.store.EventsAfter(ctx, a.gameID, a.state.Version)
	if err != nil {
		return err
	}
	for _, event := range events {
		if event.Version > targetVersion {
			break
		}
		if event.Version != a.state.Version+1 {
			return ErrVersionConflict
		}
		if actorExternalNoopEvent(event.Type) {
			a.state.Version = event.Version
			continue
		}
		if err := ReplayEventWithAppliers(a.state, eventWithoutRuntimePatchReceipt(event), a.appliersList()); err != nil {
			return err
		}
		a.state.Version = event.Version
	}
	state.RebuildLocIndexForRecoveryOnly(a.state)
	return nil
}

func (a *GameActor) canAcceptStaleBaseVersionLocked(ctx context.Context, baseVersion int64) (bool, error) {
	if a.store == nil || baseVersion >= a.state.Version {
		return false, nil
	}
	events, err := a.store.EventsAfter(ctx, a.gameID, baseVersion)
	if err != nil {
		return false, err
	}
	expectedVersion := baseVersion + 1
	for _, event := range events {
		if event.Version > a.state.Version {
			break
		}
		if event.Version != expectedVersion {
			return false, nil
		}
		if !actorAllowsStaleBaseOverEvent(event.Type) {
			return false, nil
		}
		expectedVersion = event.Version + 1
	}
	return expectedVersion == a.state.Version+1, nil
}

func (a *GameActor) appliersList() []Applier {
	appliers := make([]Applier, 0, len(a.appliers))
	for _, applier := range a.appliers {
		appliers = append(appliers, applier)
	}
	return appliers
}

func actorExternalNoopEvent(eventType string) bool {
	switch eventType {
	case "chat.message", "chat.reaction.toggled":
		return true
	default:
		return false
	}
}

func actorAllowsStaleBaseOverEvent(eventType string) bool {
	switch eventType {
	case "chat.message", "chat.reaction.toggled", "disconnect.vote.updated":
		return true
	default:
		return false
	}
}

func (a *GameActor) resultFromStoredEvent(event protocol.EventPayloadV2) (CommandResult, error) {
	patches, ok, err := runtimePatchReceiptFromEvent(event)
	if err != nil {
		return CommandResult{}, err
	}
	cleanEvent := eventWithoutRuntimePatchReceipt(event)
	if !ok {
		return CommandResult{}, ErrRuntimePatchReceiptMissing
	}
	if err := validatePatchEnvelopes(patches); err != nil {
		return CommandResult{}, err
	}
	return CommandResult{Event: cleanEvent, Patches: patches}, nil
}

func (a *GameActor) storedDuplicateResult(ctx context.Context, command protocol.CommandEnvelopeV2, actorID string) (CommandResult, bool, error) {
	existing, ok, err := a.store.EventByClientActionID(ctx, command.GameID, command.ClientActionID)
	if err != nil || !ok {
		return CommandResult{}, ok, err
	}
	if !eventCreatedByMatches(existing, actorID) {
		return CommandResult{}, true, ErrActorPermission
	}
	result, err := a.resultFromStoredEvent(existing)
	if err != nil {
		return CommandResult{}, true, err
	}
	a.rememberSeenAction(command.ClientActionID, result)
	return result, true, nil
}

func (a *GameActor) deliverLifecycleHandoffLocked(ctx context.Context, event protocol.EventPayloadV2, fencing uint64) {
	if a.lifecycleSink == nil {
		return
	}
	handoff, ok := lifecycle.FromPersistedEvent(event, fencing, a.lifecycleGeneration)
	if !ok {
		return
	}
	if err := a.lifecycleSink.Deliver(ctx, handoff); err != nil {
		slog.Warn("runtime lifecycle handoff failed after durable event append", "gameId", a.gameID, "version", event.Version, "eventId", handoff.EventID, "type", handoff.Type, "error", err)
		return
	}
	if a.lifecycleConfirmed != nil {
		a.lifecycleConfirmed(handoff)
	}
}

func (a *GameActor) idempotentConcedeResultLocked(command protocol.CommandEnvelopeV2, actorID string, queueWait time.Duration, startedAt time.Time) (CommandResult, bool) {
	if command.Type != "game.concede" {
		return CommandResult{}, false
	}
	playerID, _ := command.Payload["playerId"].(string)
	if playerID == "" {
		return CommandResult{}, false
	}
	player, ok := a.state.Players[playerID]
	if !ok || player["status"] != "conceded" {
		return CommandResult{}, false
	}
	if command.BaseVersion > a.state.Version {
		a.recordVersionConflict()
		return a.rejectedResult(ErrVersionConflict, queueWait, startedAt), true
	}

	emitter := NewPatchEmitter()
	concededAt, _ := player["concededAt"].(string)
	emitter.EmitPublic(protocol.PatchOp{
		Op: "player.status.set",
		Data: map[string]any{
			"playerId":   playerID,
			"status":     "conceded",
			"concededAt": concededAt,
		},
	})
	payload := map[string]any{
		"playerId":   playerID,
		"status":     "conceded",
		"concededAt": concededAt,
		"idempotent": true,
		"metrics":    lifecycleMetrics(startedAt, emitter),
	}
	addCommandMetric(payload, "command.runtime_coverage_percent", a.commandRuntimeCoveragePercent())
	addCommandMetric(payload, "command.unsupported_count", 0)
	addCommandMetric(payload, "command.legacy_fallback_count", 0)
	addCommandMetric(payload, "command.alias_translation_count", 0)

	event := protocol.EventPayloadV2{
		GameID:         a.gameID,
		Version:        a.state.Version,
		Type:           "game.concede",
		Payload:        payload,
		CreatedBy:      actorID,
		ClientActionID: command.ClientActionID,
		CreatedAt:      time.Now().UTC(),
	}
	if err := event.Validate(); err != nil {
		return a.rejectedResult(err, queueWait, startedAt), true
	}
	patches := emitter.Envelopes(a.gameID, a.state.Version, command.ClientActionID)
	if err := validatePatchEnvelopes(patches); err != nil {
		return a.rejectedResult(err, queueWait, startedAt), true
	}

	return CommandResult{Event: event, Patches: patches}, true
}

func (a *GameActor) duplicateDurableErrorResult(err error, clientActionID string, queueWait time.Duration, startedAt time.Time) CommandResult {
	if errors.Is(err, ErrRuntimePatchReceiptMissing) {
		a.recordDuplicateReceiptMissing()
		slog.Warn("runtime duplicate command missing patch receipt", "gameId", a.gameID, "clientActionId", clientActionID, "error", err)
	}
	return a.rejectedResult(err, queueWait, startedAt)
}

func isRecoverableDuplicateAppend(err error) bool {
	return errors.Is(err, persistence.ErrDuplicateClientActionID) || errors.Is(err, persistence.ErrDuplicateVersion)
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

func (a *GameActor) recordDuplicateMemoryAction(queueWait time.Duration, latency time.Duration) {
	a.metricsMu.Lock()
	defer a.metricsMu.Unlock()
	a.metrics.DuplicateActionCount++
	a.metrics.DuplicateMemoryCount++
	a.metrics.QueueWaitMs = durationMs(queueWait)
	a.metrics.CommandLatencyMs = durationMs(latency)
}

func (a *GameActor) recordDuplicateDurableAction(queueWait time.Duration, latency time.Duration) {
	a.metricsMu.Lock()
	defer a.metricsMu.Unlock()
	a.metrics.DuplicateActionCount++
	a.metrics.DuplicateDurableCount++
	a.metrics.QueueWaitMs = durationMs(queueWait)
	a.metrics.CommandLatencyMs = durationMs(latency)
}

func (a *GameActor) recordDuplicateReceiptMissing() {
	a.metricsMu.Lock()
	defer a.metricsMu.Unlock()
	a.metrics.DuplicateReceiptMissingCount++
}

func (a *GameActor) recordVersionConflict() {
	a.metricsMu.Lock()
	defer a.metricsMu.Unlock()
	a.metrics.VersionConflictCount++
}

func (a *GameActor) recordSnapshotPostAppendFailure() {
	a.metricsMu.Lock()
	defer a.metricsMu.Unlock()
	a.metrics.SnapshotPostAppendFailureCount++
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

func validatePatchEnvelopes(patches []protocol.PatchEnvelopeV2) error {
	for _, patch := range patches {
		if err := patch.Validate(); err != nil {
			return err
		}
	}
	return nil
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
