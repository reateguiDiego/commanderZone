package actor

import "commanderzone/game-runtime/internal/protocol"

type PatchEmitter struct {
	opsByVisibility map[protocol.Visibility][]protocol.PatchOp
}

func NewPatchEmitter() *PatchEmitter {
	return &PatchEmitter{opsByVisibility: map[protocol.Visibility][]protocol.PatchOp{}}
}

func (e *PatchEmitter) EmitPublic(op protocol.PatchOp) {
	e.AddOp(protocol.VisibilityPublic, op)
}

func (e *PatchEmitter) EmitPrivate(playerID string, op protocol.PatchOp) {
	e.AddOp(protocol.PlayerVisibility(playerID), op)
}

func (e *PatchEmitter) EmitGroup(mask string, op protocol.PatchOp) {
	e.AddOp(protocol.GroupVisibility(mask), op)
}

func (e *PatchEmitter) AddOp(visibility protocol.Visibility, op protocol.PatchOp) {
	e.opsByVisibility[visibility] = append(e.opsByVisibility[visibility], op)
}

func (e *PatchEmitter) Envelopes(gameID string, version int64, ackClientActionID string) []protocol.PatchEnvelopeV2 {
	envelopes := make([]protocol.PatchEnvelopeV2, 0, len(e.opsByVisibility))
	for visibility, ops := range e.opsByVisibility {
		envelopes = append(envelopes, protocol.PatchEnvelopeV2{
			GameID:            gameID,
			Version:           version,
			Visibility:        visibility,
			Ops:               ops,
			AckClientActionID: ackClientActionID,
		})
	}
	return envelopes
}
