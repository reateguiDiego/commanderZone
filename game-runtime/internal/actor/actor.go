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
)

type Applier interface {
	Type() string
	Apply(ctx context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error)
}

type CommandRequest struct {
	Command  protocol.CommandEnvelopeV2
	ActorID  string
	Reply    chan CommandResult
	Deadline time.Time
}

type CommandResult struct {
	Event   protocol.EventPayloadV2
	Patches []protocol.PatchEnvelopeV2
	Err     error
}

type GameActor struct {
	gameID        string
	state         *state.GameState
	store         persistence.EventStore
	appliers      map[string]Applier
	mailbox       chan CommandRequest
	seenActions   map[string]CommandResult
	startedAt     time.Time
	lastHeartbeat time.Time
	stop          chan struct{}
	stopped       chan struct{}
	stopOnce      sync.Once
	stateMu       sync.RWMutex
}

func NewGameActor(gameID string, initial state.GameState, store persistence.EventStore, queueSize int, appliers []Applier) *GameActor {
	byType := make(map[string]Applier, len(appliers))
	for _, applier := range appliers {
		byType[applier.Type()] = applier
	}
	if queueSize < 1 {
		queueSize = 1
	}
	return &GameActor{
		gameID:        gameID,
		state:         &initial,
		store:         store,
		appliers:      byType,
		mailbox:       make(chan CommandRequest, queueSize),
		seenActions:   map[string]CommandResult{},
		startedAt:     time.Now().UTC(),
		lastHeartbeat: time.Now().UTC(),
		stop:          make(chan struct{}),
		stopped:       make(chan struct{}),
	}
}

func (a *GameActor) Enqueue(request CommandRequest) error {
	select {
	case <-a.stopped:
		return ErrActorStopped
	default:
	}

	select {
	case <-a.stopped:
		return ErrActorStopped
	case a.mailbox <- request:
		return nil
	default:
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
		return nil
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

func (a *GameActor) apply(ctx context.Context, request CommandRequest) CommandResult {
	a.stateMu.Lock()
	defer a.stateMu.Unlock()

	command := request.Command
	if err := command.Validate(); err != nil {
		return CommandResult{Err: err}
	}
	if existing, ok := a.seenActions[command.ClientActionID]; ok {
		return existing
	}
	if command.BaseVersion != a.state.Version {
		return CommandResult{Err: ErrVersionConflict}
	}
	applier, ok := a.appliers[command.Type]
	if !ok {
		return CommandResult{Err: ErrUnknownCommand}
	}

	nextVersion := a.state.Version + 1
	emitter := NewPatchEmitter()
	previous := a.state.Clone()
	eventPayload, err := applier.Apply(ctx, a.state, command, emitter)
	if err != nil {
		return CommandResult{Err: err}
	}
	a.state.Version = nextVersion

	event := protocol.EventPayloadV2{
		GameID:         a.gameID,
		Version:        nextVersion,
		Type:           command.Type,
		Payload:        eventPayload,
		CreatedBy:      request.ActorID,
		ClientActionID: command.ClientActionID,
		CreatedAt:      time.Now().UTC(),
	}
	if err := event.Validate(); err != nil {
		return CommandResult{Err: err}
	}
	if a.store != nil {
		if err := a.store.AppendEvent(ctx, event); err != nil {
			*a.state = previous
			return CommandResult{Err: err}
		}
	}

	result := CommandResult{
		Event:   event,
		Patches: emitter.Envelopes(a.gameID, nextVersion, command.ClientActionID),
	}
	a.seenActions[command.ClientActionID] = result
	a.lastHeartbeat = time.Now().UTC()
	return result
}
