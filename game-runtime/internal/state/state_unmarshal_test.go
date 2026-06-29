package state

import (
	"encoding/json"
	"testing"
)

func TestCardInstanceRuntimeAcceptsEmptyArrayCountersFromLegacyJSON(t *testing.T) {
	payload := []byte(`{
		"instanceId": "i1",
		"cardKey": "card:plains",
		"ownerId": "p1",
		"controllerId": "p1",
		"zone": "hand",
		"counters": []
	}`)

	var instance CardInstanceRuntime
	if err := json.Unmarshal(payload, &instance); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if instance.Counters == nil {
		t.Fatal("counters should be normalized to an empty map")
	}
	if len(instance.Counters) != 0 {
		t.Fatalf("counters got %#v want empty", instance.Counters)
	}
}

func TestCardInstanceRuntimePreservesObjectCounters(t *testing.T) {
	payload := []byte(`{
		"instanceId": "i1",
		"cardKey": "card:plains",
		"ownerId": "p1",
		"controllerId": "p1",
		"zone": "battlefield",
		"counters": {"charge": 2}
	}`)

	var instance CardInstanceRuntime
	if err := json.Unmarshal(payload, &instance); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if got := instance.Counters["charge"]; got != 2 {
		t.Fatalf("charge counter got %d want 2", got)
	}
}

func TestRelationsAcceptsLegacyEmptyArrayMaps(t *testing.T) {
	payload := []byte(`{
		"attachments": [],
		"arrows": [],
		"helpers": [],
		"indexes": {
			"attachmentsByEquipment": [],
			"attachmentsByTarget": [],
			"arrowsBySource": [],
			"arrowsByTarget": []
		}
	}`)

	var relations Relations
	if err := json.Unmarshal(payload, &relations); err != nil {
		t.Fatalf("expected legacy empty relation arrays to decode: %v", err)
	}
	if len(relations.Attachments) != 0 || len(relations.Arrows) != 0 || len(relations.Helpers) != 0 {
		t.Fatalf("expected empty relation maps, got %#v", relations)
	}
	if relations.Indexes.BySource == nil || relations.Indexes.ByTarget == nil {
		t.Fatalf("expected relation indexes to be initialized, got %#v", relations.Indexes)
	}
}

func TestGameStateAcceptsLegacyGamePhaseAndNormalizesRecoveryMaps(t *testing.T) {
	payload := []byte(`{
		"gameId": "game-1",
		"version": 1,
		"status": "active",
		"gamePhase": "MULLIGAN",
		"players": {},
		"turn": {},
		"instances": {},
		"zones": {},
		"loc": {},
		"visibility": {},
		"relations": {}
	}`)

	var game GameState
	if err := json.Unmarshal(payload, &game); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	NormalizeForRecovery("game-1", &game)
	if game.Phase != PhaseMulligan {
		t.Fatalf("phase got %q want %q", game.Phase, PhaseMulligan)
	}
	if game.Visibility.InstanceMasks == nil || game.Relations.Attachments == nil || game.Mulligan.PlayerStatus == nil {
		t.Fatalf("expected recovery maps to be initialized: %#v", game)
	}
}
