package gateway

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestHMACTicketValidatorAcceptsSignedTicket(t *testing.T) {
	validator, err := NewHMACTicketValidator(testTicketSecret)
	if err != nil {
		t.Fatalf("validator: %v", err)
	}
	ticket, err := SignTicket(testTicketSecret, TicketClaims{UserID: "u1", PlayerID: "p1", GameID: "game-1"}, time.Minute)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	claims, err := validator.ValidateTicket(context.Background(), ticket)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if claims.UserID != "u1" || claims.PlayerID != "p1" || claims.GameID != "game-1" {
		t.Fatalf("claims = %#v", claims)
	}
}

func TestHMACTicketValidatorRejectsTamperedTicket(t *testing.T) {
	validator, err := NewHMACTicketValidator(testTicketSecret)
	if err != nil {
		t.Fatalf("validator: %v", err)
	}
	ticket, err := SignTicket(testTicketSecret, TicketClaims{UserID: "u1", GameID: "game-1"}, time.Minute)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	ticket = strings.Replace(ticket, ".", "x.", 1)
	if _, err := validator.ValidateTicket(context.Background(), ticket); !errors.Is(err, ErrInvalidTicket) {
		t.Fatalf("err = %v, want %v", err, ErrInvalidTicket)
	}
}

func TestHMACTicketValidatorRejectsExpiredTicket(t *testing.T) {
	validator, err := NewHMACTicketValidator(testTicketSecret)
	if err != nil {
		t.Fatalf("validator: %v", err)
	}
	ticket, err := SignTicket(testTicketSecret, TicketClaims{UserID: "u1", GameID: "game-1"}, -time.Minute)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if _, err := validator.ValidateTicket(context.Background(), ticket); !errors.Is(err, ErrExpiredTicket) {
		t.Fatalf("err = %v, want %v", err, ErrExpiredTicket)
	}
}
