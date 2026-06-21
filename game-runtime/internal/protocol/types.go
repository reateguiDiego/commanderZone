package protocol

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

type CommandEnvelopeV2 struct {
	GameID         string         `json:"gameId"`
	BaseVersion   int64          `json:"baseVersion"`
	ClientActionID string         `json:"clientActionId"`
	Type          string         `json:"type"`
	Payload       map[string]any `json:"payload"`
	SentAt        *time.Time     `json:"sentAt,omitempty"`
	Client        map[string]any `json:"client,omitempty"`
}

func (c CommandEnvelopeV2) Validate() error {
	if strings.TrimSpace(c.GameID) == "" {
		return errors.New("gameId is required")
	}
	if c.BaseVersion < 1 {
		return errors.New("baseVersion must be >= 1")
	}
	if strings.TrimSpace(c.ClientActionID) == "" {
		return errors.New("clientActionId is required")
	}
	if strings.TrimSpace(c.Type) == "" {
		return errors.New("type is required")
	}
	if c.Payload == nil {
		return errors.New("payload is required")
	}
	return nil
}

type Visibility string

const (
	VisibilityPublic Visibility = "public"
)

func PlayerVisibility(playerID string) Visibility {
	return Visibility("player:" + playerID)
}

func GroupVisibility(mask string) Visibility {
	return Visibility("group:" + mask)
}

func (v Visibility) Validate() error {
	value := string(v)
	if value == string(VisibilityPublic) || strings.HasPrefix(value, "player:") || strings.HasPrefix(value, "group:") {
		return nil
	}
	return fmt.Errorf("invalid visibility %q", value)
}

type PatchOp struct {
	Op   string         `json:"op"`
	Data map[string]any `json:"data,omitempty"`
}

type PatchEnvelopeV2 struct {
	GameID            string     `json:"gameId"`
	Version           int64      `json:"version"`
	Visibility        Visibility `json:"visibility"`
	Ops               []PatchOp  `json:"ops"`
	AckClientActionID string     `json:"ackClientActionId,omitempty"`
}

func (p PatchEnvelopeV2) Validate() error {
	if strings.TrimSpace(p.GameID) == "" {
		return errors.New("gameId is required")
	}
	if p.Version < 1 {
		return errors.New("version must be >= 1")
	}
	if err := p.Visibility.Validate(); err != nil {
		return err
	}
	if len(p.Ops) == 0 {
		return errors.New("ops must not be empty")
	}
	for i, op := range p.Ops {
		if strings.TrimSpace(op.Op) == "" {
			return fmt.Errorf("ops[%d].op is required", i)
		}
	}
	return nil
}

type EventPayloadV2 struct {
	GameID         string         `json:"gameId"`
	Version        int64          `json:"version"`
	Type           string         `json:"type"`
	Payload        map[string]any `json:"payload"`
	CreatedBy      string         `json:"createdBy,omitempty"`
	ClientActionID string         `json:"clientActionId,omitempty"`
	CreatedAt      time.Time      `json:"createdAt"`
}

func (e EventPayloadV2) Validate() error {
	if strings.TrimSpace(e.GameID) == "" {
		return errors.New("gameId is required")
	}
	if e.Version < 1 {
		return errors.New("version must be >= 1")
	}
	if strings.TrimSpace(e.Type) == "" {
		return errors.New("type is required")
	}
	if e.Payload == nil {
		return errors.New("payload is required")
	}
	if e.CreatedAt.IsZero() {
		return errors.New("createdAt is required")
	}
	return nil
}
