package actor

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

func runtimeEventLogEntries(game *state.GameState, command protocol.CommandEnvelopeV2, payload map[string]any, actorID string, version int64, createdAt time.Time) []map[string]any {
	if game == nil {
		return nil
	}
	displayName := playerDisplayName(game, actorID)
	message := runtimeLogMessage(game, command, payload, displayName)
	if strings.TrimSpace(message) == "" {
		return nil
	}
	entry := map[string]any{
		"id":          stableRuntimeLogID(command.GameID, command.ClientActionID, command.Type),
		"type":        command.Type,
		"message":     message,
		"version":     version,
		"actorId":     actorID,
		"displayName": displayName,
		"createdAt":   createdAt.UTC().Format(time.RFC3339),
	}
	if instanceID := firstString(payload["instanceId"], command.Payload["instanceId"]); instanceID != "" {
		entry["cardInstanceId"] = instanceID
		if location, ok := game.Loc[instanceID]; ok {
			entry["cardPlayerId"] = location.PlayerID
			entry["cardZone"] = string(location.Zone)
		}
	}
	if cardNames := runtimeLogCardNames(payload); len(cardNames) > 0 {
		entry["cardNames"] = cardNames
	}
	return []map[string]any{entry}
}

func runtimeLogMessage(game *state.GameState, command protocol.CommandEnvelopeV2, payload map[string]any, displayName string) string {
	switch command.Type {
	case "library.draw", "library.draw_many":
		count := intFromPayload(payload, "count", 1)
		if count == 1 {
			return fmt.Sprintf("%s drew a card.", displayName)
		}
		return fmt.Sprintf("%s drew %d cards.", displayName, count)
	case "card.moved", "cards.moved":
		count := len(stringsFromAny(payload["instanceIds"]))
		if count == 0 {
			count = len(stringsFromAny(command.Payload["instanceIds"]))
		}
		if count == 0 {
			count = 1
		}
		fromZone := firstString(payload["fromZone"], command.Payload["fromZone"])
		toZone := firstString(payload["toZone"], command.Payload["toZone"], payload["destination"], command.Payload["destination"])
		if fromZone == "command" && toZone == "battlefield" {
			if casts, ok := commanderCastCountFromPayload(payload); ok {
				return fmt.Sprintf("%s cast their commander from the command zone. Commander cast count is %d.", displayName, casts)
			}
		}
		if count == 1 {
			return fmt.Sprintf("%s moved a card from %s to %s.", displayName, readableZone(fromZone), readableZone(toZone))
		}
		return fmt.Sprintf("%s moved %d cards from %s to %s.", displayName, count, readableZone(fromZone), readableZone(toZone))
	case "card.tapped":
		if firstBool(payload["tapped"], command.Payload["tapped"]) {
			return fmt.Sprintf("%s tapped a permanent.", displayName)
		}
		return fmt.Sprintf("%s untapped a permanent.", displayName)
	case "battlefield.untap_all":
		count := len(stringsFromAny(payload["instanceIds"]))
		return fmt.Sprintf("%s untapped %d permanents.", displayName, count)
	case "card.counter.changed":
		counter := firstString(payload["counter"], command.Payload["counter"])
		value := intFromPayload(payload, "value", 0)
		return fmt.Sprintf("%s set %s counters to %d.", displayName, counterLabel(counter), value)
	case "counter.changed":
		scope := firstString(payload["scope"], command.Payload["scope"])
		key := firstString(payload["key"], command.Payload["key"])
		value := intFromPayload(payload, "value", 0)
		if strings.HasPrefix(scope, "commander:") && key == "casts" {
			return fmt.Sprintf("%s set commander cast count to %d.", displayName, value)
		}
		return fmt.Sprintf("%s set %s to %d.", displayName, counterLabel(key), value)
	case "card.token.created":
		count := intFromPayload(payload, "count", 1)
		name := firstString(payload["name"], command.Payload["name"])
		if name == "" {
			name = "Token"
		}
		if count == 1 {
			return fmt.Sprintf("%s created a %s token.", displayName, name)
		}
		return fmt.Sprintf("%s created %d %s tokens.", displayName, count, name)
	case "card.token_copy.created":
		return fmt.Sprintf("%s created a token copy.", displayName)
	case "library.view":
		count := intFromPayload(payload, "count", 1)
		return fmt.Sprintf("%s looked at the top %d cards of their library.", displayName, count)
	case "library.reveal", "library.reveal_top":
		count := intFromPayload(payload, "count", 1)
		return fmt.Sprintf("%s revealed the top %d cards of their library.", displayName, count)
	case "library.shuffle":
		return fmt.Sprintf("%s shuffled their library.", displayName)
	case "game.concede":
		playerID := firstString(payload["playerId"], command.Payload["playerId"], actorIDFromPayload(command.Payload))
		name := playerDisplayName(game, playerID)
		return fmt.Sprintf("%s conceded.", name)
	case "game.close":
		return fmt.Sprintf("%s closed the game.", displayName)
	}
	return ""
}

func runtimeLogCardNames(payload map[string]any) []string {
	values, ok := payload["cardNames"]
	if !ok {
		return nil
	}
	return stringsFromAny(values)
}

func stableRuntimeLogID(gameID string, clientActionID string, commandType string) string {
	sum := sha1.Sum([]byte(strings.Join([]string{"runtime-log", gameID, clientActionID, commandType}, "\x00")))
	bytes := sum[:16]
	bytes[6] = (bytes[6] & 0x0f) | 0x50
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes)
	return fmt.Sprintf("%s-%s-%s-%s-%s", encoded[0:8], encoded[8:12], encoded[12:16], encoded[16:20], encoded[20:32])
}

func firstString(values ...any) string {
	for _, value := range values {
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text)
		}
	}
	return ""
}

func firstBool(values ...any) bool {
	for _, value := range values {
		if typed, ok := value.(bool); ok {
			return typed
		}
	}
	return false
}

func intFromPayload(payload map[string]any, key string, fallback int) int {
	if value, ok := intFromAny(payload[key]); ok {
		return value
	}
	return fallback
}

func commanderCastCountFromPayload(payload map[string]any) (int, bool) {
	counters := payload["commanderCastCounters"]
	switch typed := counters.(type) {
	case []map[string]any:
		for _, entry := range typed {
			if casts, ok := commanderCastCountFromEntry(entry); ok {
				return casts, true
			}
		}
	case []any:
		for _, raw := range typed {
			entry, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			if casts, ok := commanderCastCountFromEntry(entry); ok {
				return casts, true
			}
		}
	}
	return 0, false
}

func commanderCastCountFromEntry(entry map[string]any) (int, bool) {
	scope := firstString(entry["scope"])
	if !strings.HasPrefix(scope, "commander:") {
		return 0, false
	}
	counters, ok := entry["counters"].(map[string]any)
	if !ok {
		return 0, false
	}
	casts, ok := intFromAny(counters["casts"])
	return casts, ok
}

func stringsFromAny(value any) []string {
	switch typed := value.(type) {
	case []string:
		return append([]string(nil), typed...)
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				result = append(result, strings.TrimSpace(text))
			}
		}
		return result
	default:
		return nil
	}
}

func readableZone(zone string) string {
	switch strings.TrimSpace(zone) {
	case "battlefield":
		return "battlefield"
	case "graveyard":
		return "graveyard"
	case "exile":
		return "exile"
	case "hand":
		return "hand"
	case "library":
		return "library"
	case "command":
		return "command zone"
	default:
		return "zone"
	}
}

func counterLabel(counter string) string {
	if strings.TrimSpace(counter) == "" {
		return "counter"
	}
	return counter
}

func actorIDFromPayload(payload map[string]any) string {
	return firstString(payload["playerId"], payload["targetPlayerId"])
}
