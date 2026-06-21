package protocol

import "testing"

func TestCommandEnvelopeV2Validate(t *testing.T) {
	command := CommandEnvelopeV2{
		GameID:         "game-1",
		BaseVersion:   1,
		ClientActionID: "action-1",
		Type:           "card.tapped",
		Payload:        map[string]any{"instanceId": "i1"},
	}
	if err := command.Validate(); err != nil {
		t.Fatalf("expected valid command: %v", err)
	}
}

func TestPatchEnvelopeV2RejectsInvalidVisibility(t *testing.T) {
	patch := PatchEnvelopeV2{
		GameID:     "game-1",
		Version:    2,
		Visibility: "private",
		Ops:        []PatchOp{{Op: "card.field.set"}},
	}
	if err := patch.Validate(); err == nil {
		t.Fatal("expected invalid visibility")
	}
}
