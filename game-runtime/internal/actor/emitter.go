package actor

import (
	"sort"

	"commanderzone/game-runtime/internal/protocol"
)

const versionAdvancePatchOp = "version.advance"

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
	envelopes := make([]protocol.PatchEnvelopeV2, 0, len(e.opsByVisibility)+1)
	visibilities := make([]string, 0, len(e.opsByVisibility))
	for visibility := range e.opsByVisibility {
		if visibility == protocol.VisibilityPublic {
			continue
		}
		visibilities = append(visibilities, string(visibility))
	}
	sort.Strings(visibilities)

	for _, rawVisibility := range visibilities {
		visibility := protocol.Visibility(rawVisibility)
		envelopes = append(envelopes, patchEnvelope(gameID, version, visibility, e.opsByVisibility[visibility], ackClientActionID))
	}

	if publicOps, ok := e.opsByVisibility[protocol.VisibilityPublic]; ok {
		envelopes = append(envelopes, patchEnvelope(gameID, version, protocol.VisibilityPublic, publicOps, ackClientActionID))
	} else {
		envelopes = append(envelopes, patchEnvelope(gameID, version, protocol.VisibilityPublic, []protocol.PatchOp{
			{Op: versionAdvancePatchOp},
		}, ackClientActionID))
	}
	return envelopes
}

func patchEnvelope(gameID string, version int64, visibility protocol.Visibility, ops []protocol.PatchOp, ackClientActionID string) protocol.PatchEnvelopeV2 {
	return protocol.PatchEnvelopeV2{
		GameID:            gameID,
		Version:           version,
		Visibility:        visibility,
		Ops:               ops,
		AckClientActionID: ackClientActionID,
	}
}
