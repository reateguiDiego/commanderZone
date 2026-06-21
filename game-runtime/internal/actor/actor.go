package actor

import (
	"context"
	"errors"
	"time"

	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

var (
	ErrQueueFull       = errors.New("game actor queue full")
	ErrVersionConflict = errors.New("baseVersion does not match actor version")
	ErrUnknownCommand  = errors.New("unknown command")
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
	gameID      string
	state       *state.GameState
	store       persistence.EventStore
	appliers    map[string]Applier
	mailbox     chan CommandRequest
	seenActions map[string]CommandResult
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
		gameID:      gameID,
		state:       &initial,
		store:       store,
		appliers:    byType,
		mailbox:     make(chan CommandRequest, queueSize),
		seenActions: map[string]CommandResult{},
	}
}

func (a *GameActor) Enqueue(request CommandRequest) error {
	select {
	case a.mailbox <- request:
		return nil
	default:
		return ErrQueueFull
	}
}

func (a *GameActor) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case request := <-a.mailbox:
			request.Reply <- a.apply(ctx, request)
		}
	}
}

func (a *GameActor) ApplyDirect(ctx context.Context, command protocol.CommandEnvelopeV2, actorID string) CommandResult {
	return a.apply(ctx, CommandRequest{Command: command, ActorID: actorID})
}

func (a *GameActor) apply(ctx context.Context, request CommandRequest) CommandResult {
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
			a.state.Version--
			return CommandResult{Err: err}
		}
	}

	result := CommandResult{
		Event:   event,
		Patches: emitter.Envelopes(a.gameID, nextVersion, command.ClientActionID),
	}
	a.seenActions[command.ClientActionID] = result
	return result
}
