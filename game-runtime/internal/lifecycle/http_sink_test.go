package lifecycle

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestHTTPSinkSendsCompactSignedContract(t *testing.T) {
	var received Handoff
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var raw json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
			t.Fatal(err)
		}
		mac := hmac.New(sha256.New, []byte("shared-secret"))
		_, _ = mac.Write(raw)
		if got, want := r.Header.Get(SignatureHeader), hex.EncodeToString(mac.Sum(nil)); got != want {
			t.Fatalf("signature = %q, want %q", got, want)
		}
		if err := json.Unmarshal(raw, &received); err != nil {
			t.Fatal(err)
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	sink, err := NewHTTPSink(server.URL, "shared-secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	handoff := Handoff{
		EventID: "game-1:7", GameID: "game-1", Type: GameFinished,
		WinnerPlayerID: "p1", FinishReason: "last_player_standing",
		Version: 7, Generation: 1, Fencing: 4, OccurredAt: time.Now().UTC(),
	}
	if err := sink.Deliver(context.Background(), handoff); err != nil {
		t.Fatal(err)
	}
	if received.EventID != handoff.EventID || received.WinnerPlayerID != "p1" || received.Version != 7 {
		t.Fatalf("received handoff = %#v", received)
	}
}
