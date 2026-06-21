package main

import "testing"

func TestNormalizeHealthcheckAddr(t *testing.T) {
	tests := map[string]string{
		"":               "127.0.0.1:8091",
		":8091":          "127.0.0.1:8091",
		"0.0.0.0:8091":   "127.0.0.1:8091",
		"127.0.0.1:8091": "127.0.0.1:8091",
	}

	for input, want := range tests {
		if got := normalizeHealthcheckAddr(input); got != want {
			t.Fatalf("normalizeHealthcheckAddr(%q) = %q, want %q", input, got, want)
		}
	}
}
