package actor

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type tokenGroupContractFixture struct {
	CreateScenarios []struct {
		Name              string   `json:"name"`
		GameID            string   `json:"gameId"`
		ClientActionID    string   `json:"clientActionId"`
		Quantity          int      `json:"quantity"`
		ExpectedGroupID   *string  `json:"expectedGroupId"`
		ExpectedMemberIDs []string `json:"expectedMemberIds"`
	} `json:"createScenarios"`
}

func TestTokenGroupCrossRuntimeSharedIDVectors(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "..", "backend", "tests", "Fixtures", "token-group-contract-v1.json")
	data, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	var fixture tokenGroupContractFixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, scenario := range fixture.CreateScenarios {
		t.Run(scenario.Name, func(t *testing.T) {
			memberIDs := make([]string, scenario.Quantity)
			for index := range memberIDs {
				memberIDs[index] = deterministicRuntimeID("token", scenario.ClientActionID, index)
			}
			if !equalStringOrder(memberIDs, scenario.ExpectedMemberIDs) {
				t.Fatalf("member ids = %#v want %#v", memberIDs, scenario.ExpectedMemberIDs)
			}
			if scenario.Quantity == 1 {
				if scenario.ExpectedGroupID != nil {
					t.Fatalf("quantity one fixture unexpectedly has group %q", *scenario.ExpectedGroupID)
				}
				return
			}
			if scenario.ExpectedGroupID == nil {
				t.Fatal("group fixture missing expectedGroupId")
			}
			if got := deterministicOpaqueTokenGroupID(scenario.GameID, scenario.ClientActionID); got != *scenario.ExpectedGroupID {
				t.Fatalf("group id = %q want %q", got, *scenario.ExpectedGroupID)
			}
		})
	}
}
