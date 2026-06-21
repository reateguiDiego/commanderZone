package gateway

import (
	"context"
	"errors"

	"commanderzone/game-runtime/internal/actor"
	"commanderzone/game-runtime/internal/protocol"
)

var ErrTicketGameMismatch = errors.New("ticket gameId does not match command gameId")

type TicketClaims struct {
	UserID     string
	GameID     string
	Roles      []string
	ViewerKind string
	Protocol   string
}

type TicketValidator interface {
	ValidateTicket(ctx context.Context, ticket string) (TicketClaims, error)
}

type Router interface {
	Route(ctx context.Context, gameID string, request actor.CommandRequest) error
}

type RuntimeGateway struct {
	validator TicketValidator
	router    Router
}

func NewRuntimeGateway(validator TicketValidator, router Router) *RuntimeGateway {
	return &RuntimeGateway{validator: validator, router: router}
}

func (g *RuntimeGateway) HandleCommand(ctx context.Context, ticket string, command protocol.CommandEnvelopeV2) error {
	claims, err := g.validator.ValidateTicket(ctx, ticket)
	if err != nil {
		return err
	}
	if claims.GameID != command.GameID {
		return ErrTicketGameMismatch
	}
	if err := command.Validate(); err != nil {
		return err
	}
	reply := make(chan actor.CommandResult, 1)
	return g.router.Route(ctx, command.GameID, actor.CommandRequest{
		Command: command,
		ActorID: claims.UserID,
		Reply:   reply,
	})
}
