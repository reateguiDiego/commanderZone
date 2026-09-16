package persistence

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"commanderzone/game-runtime/internal/state"
)

func TestHTTPAuthoritativeSnapshotSourceLoadsVerifiedSnapshot(t *testing.T) {
	game := state.GameState{
		GameID:    "game-1",
		Version:   2,
		Status:    "playing",
		Players:   map[string]map[string]any{},
		Turn:      map[string]any{},
		Instances: map[string]state.CardInstanceRuntime{},
		Zones:     map[string]state.PlayerZones{},
		Loc:       map[string]state.Location{},
	}
	payload, err := json.Marshal(game)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(payload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/internal/runtime/games/game-1/compact-snapshot" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		wantSignature := hmacSHA256("GET\n"+request.URL.EscapedPath(), []byte("secret"))
		if signature := request.Header.Get(runtimeSignatureHeader); signature != wantSignature {
			t.Fatalf("signature = %q, want %q", signature, wantSignature)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"gameId":   game.GameID,
			"version":  game.Version,
			"snapshot": json.RawMessage(payload),
			"checksum": hex.EncodeToString(sum[:]),
		})
	}))
	defer server.Close()

	source, err := NewHTTPAuthoritativeSnapshotSource(server.URL+"/internal/runtime/games", "secret", time.Second)
	if err != nil {
		t.Fatalf("source: %v", err)
	}
	recovered, err := source.Load(context.Background(), game.GameID)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if recovered.GameID != game.GameID || recovered.Version != game.Version || recovered.State.Status != game.Status {
		t.Fatalf("recovered = %#v", recovered)
	}
}

func TestHTTPAuthoritativeSnapshotSourceRejectsBadChecksum(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"gameId":"game-1","version":1,"snapshot":{"gameId":"game-1","version":1},"checksum":"corrupt"}`))
	}))
	defer server.Close()

	source, err := NewHTTPAuthoritativeSnapshotSource(server.URL, "secret", time.Second)
	if err != nil {
		t.Fatalf("source: %v", err)
	}
	if _, err := source.Load(context.Background(), "game-1"); err == nil {
		t.Fatal("expected checksum error")
	}
}
