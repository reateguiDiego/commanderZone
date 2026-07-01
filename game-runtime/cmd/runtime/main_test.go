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

func TestNormalizePostgresURLDisablesSSLByDefault(t *testing.T) {
	got := normalizePostgresURL("postgres://user:pass@database:5432/app")
	want := "postgres://user:pass@database:5432/app?sslmode=disable"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}

	got = normalizePostgresURL("postgres://user:pass@database:5432/app?serverVersion=16")
	want = "postgres://user:pass@database:5432/app?sslmode=disable"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}

	got = normalizePostgresURL("postgres://user:pass@database:5432/app?serverVersion=16&charset=utf8")
	want = "postgres://user:pass@database:5432/app?sslmode=disable"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}
