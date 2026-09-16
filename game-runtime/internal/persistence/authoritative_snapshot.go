package persistence

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"commanderzone/game-runtime/internal/state"
)

const runtimeSignatureHeader = "X-CommanderZone-Signature"

// AuthoritativeSnapshotSource is intentionally used only after local compact
// snapshot verification fails. It must not be consulted by normal actor loads
// or command application.
type AuthoritativeSnapshotSource interface {
	Load(ctx context.Context, gameID string) (CompactSnapshot, error)
}

type HTTPAuthoritativeSnapshotSource struct {
	baseURL *url.URL
	secret  []byte
	client  *http.Client
}

func NewHTTPAuthoritativeSnapshotSource(baseURL string, secret string, timeout time.Duration) (*HTTPAuthoritativeSnapshotSource, error) {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(baseURL), "/"))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("runtime snapshot URL must be an absolute URL")
	}
	if strings.TrimSpace(secret) == "" {
		return nil, fmt.Errorf("runtime snapshot secret is required")
	}
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	return &HTTPAuthoritativeSnapshotSource{
		baseURL: parsed,
		secret:  []byte(secret),
		client:  &http.Client{Timeout: timeout},
	}, nil
}

func (s *HTTPAuthoritativeSnapshotSource) Load(ctx context.Context, gameID string) (CompactSnapshot, error) {
	if strings.TrimSpace(gameID) == "" {
		return CompactSnapshot{}, fmt.Errorf("game ID is required for runtime snapshot recovery")
	}

	recoveryURL := *s.baseURL
	recoveryURL.Path = strings.TrimRight(recoveryURL.Path, "/") + "/" + url.PathEscape(gameID) + "/compact-snapshot"
	recoveryURL.RawPath = ""
	requestPath := recoveryURL.EscapedPath()
	signedRequest := http.MethodGet + "\n" + requestPath
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, recoveryURL.String(), nil)
	if err != nil {
		return CompactSnapshot{}, err
	}
	req.Header.Set(runtimeSignatureHeader, hmacSHA256(signedRequest, s.secret))

	resp, err := s.client.Do(req)
	if err != nil {
		return CompactSnapshot{}, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return CompactSnapshot{}, err
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return CompactSnapshot{}, fmt.Errorf("runtime snapshot recovery rejected with status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var response struct {
		GameID   string          `json:"gameId"`
		Version  int64           `json:"version"`
		Snapshot json.RawMessage `json:"snapshot"`
		Checksum string          `json:"checksum"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return CompactSnapshot{}, fmt.Errorf("decode runtime snapshot recovery response: %w", err)
	}
	if response.GameID != gameID || response.Version < 1 || len(response.Snapshot) == 0 || response.Checksum == "" {
		return CompactSnapshot{}, fmt.Errorf("invalid runtime snapshot recovery response for %s", gameID)
	}
	sum := sha256.Sum256(response.Snapshot)
	if !strings.EqualFold(hex.EncodeToString(sum[:]), response.Checksum) {
		return CompactSnapshot{}, fmt.Errorf("%w: authoritative %s/%d", ErrSnapshotChecksumMismatch, gameID, response.Version)
	}

	var recovered state.GameState
	if err := json.Unmarshal(response.Snapshot, &recovered); err != nil {
		return CompactSnapshot{}, fmt.Errorf("decode authoritative compact snapshot: %w", err)
	}
	if recovered.GameID != gameID || recovered.Version != response.Version {
		return CompactSnapshot{}, fmt.Errorf("authoritative compact snapshot identity mismatch for %s", gameID)
	}
	if err := AssertNoStaticPayload(recovered); err != nil {
		return CompactSnapshot{}, err
	}
	return CompactSnapshot{
		GameID:   response.GameID,
		Version:  response.Version,
		State:    recovered,
		Checksum: response.Checksum,
	}, nil
}

func hmacSHA256(value string, secret []byte) string {
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}
