package gateway

import "testing"

func TestPersistedActorDisplayNameKeepsTheLabelAtSendTime(t *testing.T) {
	if got := persistedActorDisplayName("player-1", "CommanderZ", true); got != "CommanderZ" {
		t.Fatalf("persisted actor display name = %q, want current visible label", got)
	}
}

func TestPersistedActorDisplayNameFallsBackToActorIDWhenMembershipIsGone(t *testing.T) {
	if got := persistedActorDisplayName("player-1", "", false); got != "player-1" {
		t.Fatalf("persisted actor display name = %q, want actor ID fallback", got)
	}
}
