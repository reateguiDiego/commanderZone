package persistence

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"commanderzone/game-runtime/internal/state"
)

var (
	ErrSnapshotChecksumMismatch = errors.New("compact snapshot checksum mismatch")
	ErrSnapshotContainsStatic   = errors.New("compact snapshot contains static card payload")
)

var forbiddenStaticKeys = map[string]struct{}{
	"imageUris":      {},
	"oracleText":     {},
	"cardFaces":      {},
	"typeLine":       {},
	"manaCost":       {},
	"layoutMetadata": {},
}

func NewCompactSnapshot(game state.GameState) (CompactSnapshot, error) {
	if err := AssertNoStaticPayload(game); err != nil {
		return CompactSnapshot{}, err
	}
	checksum, err := ChecksumState(game)
	if err != nil {
		return CompactSnapshot{}, err
	}
	return CompactSnapshot{
		GameID:   game.GameID,
		Version:  game.Version,
		State:    game.Clone(),
		Checksum: checksum,
	}, nil
}

func VerifySnapshot(snapshot CompactSnapshot) error {
	if err := AssertNoStaticPayload(snapshot.State); err != nil {
		return err
	}
	checksum, err := ChecksumState(snapshot.State)
	if err != nil {
		return err
	}
	if !strings.EqualFold(checksum, snapshot.Checksum) {
		return fmt.Errorf("%w: %s/%d", ErrSnapshotChecksumMismatch, snapshot.GameID, snapshot.Version)
	}
	return nil
}

func ChecksumState(game state.GameState) (string, error) {
	payload, err := json.Marshal(game)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func AssertNoStaticPayload(game state.GameState) error {
	payload, err := json.Marshal(game)
	if err != nil {
		return err
	}
	var decoded any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return err
	}
	return rejectStaticKeys(decoded)
}

func rejectStaticKeys(value any) error {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if _, forbidden := forbiddenStaticKeys[key]; forbidden {
				return fmt.Errorf("%w: %s", ErrSnapshotContainsStatic, key)
			}
			if err := rejectStaticKeys(child); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range typed {
			if err := rejectStaticKeys(child); err != nil {
				return err
			}
		}
	}
	return nil
}
