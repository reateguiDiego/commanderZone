package lifecycle

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const SignatureHeader = "X-CommanderZone-Signature"

type HTTPSink struct {
	url    string
	secret []byte
	client *http.Client
}

func NewHTTPSink(url string, secret string, timeout time.Duration) (*HTTPSink, error) {
	url = strings.TrimSpace(url)
	if url == "" {
		return nil, fmt.Errorf("lifecycle handoff URL is required")
	}
	if strings.TrimSpace(secret) == "" {
		return nil, fmt.Errorf("lifecycle handoff secret is required")
	}
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	return &HTTPSink{url: url, secret: []byte(secret), client: &http.Client{Timeout: timeout}}, nil
}

func (s *HTTPSink) Deliver(ctx context.Context, handoff Handoff) error {
	if err := handoff.Validate(); err != nil {
		return err
	}
	body, err := json.Marshal(handoff)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(SignatureHeader, signature(body, s.secret))
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusOK && resp.StatusCode < http.StatusMultipleChoices {
		return nil
	}
	responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	return fmt.Errorf("lifecycle handoff rejected with status %d: %s", resp.StatusCode, strings.TrimSpace(string(responseBody)))
}

func signature(body []byte, secret []byte) string {
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}
