package gateway

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrInvalidTicket = errors.New("invalid runtime ticket")
	ErrExpiredTicket = errors.New("runtime ticket expired")
)

type HMACTicketValidator struct {
	secret []byte
	now    func() time.Time
}

type ticketPayload struct {
	UserID     string   `json:"userId"`
	PlayerID   string   `json:"playerId,omitempty"`
	GameID     string   `json:"gameId"`
	Roles      []string `json:"roles,omitempty"`
	ViewerKind string   `json:"viewerKind,omitempty"`
	Protocol   string   `json:"protocol,omitempty"`
	ExpiresAt  int64    `json:"exp"`
}

func NewHMACTicketValidator(secret string) (*HMACTicketValidator, error) {
	if strings.TrimSpace(secret) == "" {
		return nil, errors.New("runtime ticket secret is required")
	}
	return &HMACTicketValidator{secret: []byte(secret), now: time.Now}, nil
}

func (v *HMACTicketValidator) ValidateTicket(_ context.Context, ticket string) (TicketClaims, error) {
	parts := strings.Split(ticket, ".")
	if len(parts) != 2 {
		return TicketClaims{}, ErrInvalidTicket
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return TicketClaims{}, ErrInvalidTicket
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return TicketClaims{}, ErrInvalidTicket
	}
	mac := hmac.New(sha256.New, v.secret)
	_, _ = mac.Write([]byte(parts[0]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return TicketClaims{}, ErrInvalidTicket
	}
	var payload ticketPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return TicketClaims{}, ErrInvalidTicket
	}
	if strings.TrimSpace(payload.UserID) == "" || strings.TrimSpace(payload.GameID) == "" {
		return TicketClaims{}, ErrInvalidTicket
	}
	if payload.ExpiresAt <= 0 || v.now().Unix() > payload.ExpiresAt {
		return TicketClaims{}, ErrExpiredTicket
	}
	return TicketClaims{
		UserID:     payload.UserID,
		PlayerID:   payload.PlayerID,
		GameID:     payload.GameID,
		Roles:      payload.Roles,
		ViewerKind: payload.ViewerKind,
		Protocol:   payload.Protocol,
	}, nil
}

func SignTicket(secret string, claims TicketClaims, ttl time.Duration) (string, error) {
	payload := ticketPayload{
		UserID:     claims.UserID,
		PlayerID:   claims.PlayerID,
		GameID:     claims.GameID,
		Roles:      claims.Roles,
		ViewerKind: claims.ViewerKind,
		Protocol:   claims.Protocol,
		ExpiresAt:  time.Now().Add(ttl).Unix(),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	encodedPayload := base64.RawURLEncoding.EncodeToString(body)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(encodedPayload))
	return fmt.Sprintf("%s.%s", encodedPayload, base64.RawURLEncoding.EncodeToString(mac.Sum(nil))), nil
}
