package actor

import (
	"strings"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

// sanitizeRuntimePublicLogEntries is the final server-side boundary for
// public GameLog data. If any referenced card is private or face-down, the
// whole public entry becomes generic and contains no stable card identifier.
func sanitizeRuntimePublicLogEntries(game *state.GameState, command protocol.CommandEnvelopeV2, payload map[string]any, entries []map[string]any) []map[string]any {
	for _, entry := range entries {
		if !runtimeLogEntryNeedsRedaction(game, command, payload, entry) {
			continue
		}
		redactRuntimeLogMap(entry, true)
		entry["visibility"] = "public"
		if params, ok := entry["params"].(map[string]any); ok {
			params["faceDown"] = firstBool(payload["faceDown"], command.Payload["faceDown"])
		}
	}
	return entries
}

func runtimeLogEntryNeedsRedaction(game *state.GameState, command protocol.CommandEnvelopeV2, payload map[string]any, entry map[string]any) bool {
	if refs, ok := entry["refs"].(map[string]any); ok {
		if cards, ok := refs["cards"].(map[string]any); ok {
			for _, raw := range cards {
				ref, _ := raw.(map[string]any)
				if firstString(ref["visibility"]) != "public" {
					return true
				}
			}
		}
	}
	ids := append([]string(nil), stringsFromAny(payload["instanceIds"])...)
	ids = append(ids, stringsFromAny(command.Payload["instanceIds"])...)
	for _, candidate := range []string{
		firstString(payload["instanceId"]), firstString(command.Payload["instanceId"]),
		firstString(payload["sourceInstanceId"]), firstString(command.Payload["sourceInstanceId"]),
	} {
		if candidate != "" {
			ids = append(ids, candidate)
		}
	}
	seen := map[string]struct{}{}
	for _, instanceID := range ids {
		if instanceID == "" {
			continue
		}
		if _, duplicate := seen[instanceID]; duplicate {
			continue
		}
		seen[instanceID] = struct{}{}
		instance, hasInstance := game.Instances[instanceID]
		location, hasLocation := game.Loc[instanceID]
		if !hasInstance || !hasLocation || !runtimeLogCardIsPublic(instance, location) {
			return true
		}
	}
	return false
}

func redactRuntimeLogMap(value map[string]any, topLevel bool) {
	for key, raw := range value {
		lower := strings.ToLower(key)
		if runtimeLogSensitiveKey(lower) || (topLevel && (lower == "cardnames" || lower == "cardplayerid" || lower == "cardzone")) {
			delete(value, key)
			continue
		}
		if lower == "refs" {
			refs, ok := raw.(map[string]any)
			if ok {
				delete(refs, "cards")
				redactRuntimeLogMap(refs, false)
				if len(refs) == 0 {
					delete(value, key)
				}
			}
			continue
		}
		switch typed := raw.(type) {
		case map[string]any:
			redactRuntimeLogMap(typed, false)
		case []map[string]any:
			for _, nested := range typed {
				redactRuntimeLogMap(nested, false)
			}
		case []any:
			for _, nested := range typed {
				if object, ok := nested.(map[string]any); ok {
					redactRuntimeLogMap(object, false)
				}
			}
		}
	}
}

func runtimeLogSensitiveKey(key string) bool {
	switch key {
	case "instanceid", "instanceids", "cardinstanceid", "cardinstanceids", "sourceinstanceid", "sourcecardinstanceid", "commanderinstanceid",
		"cardkey", "cardref", "printid", "name", "imageuris", "cardfaces", "loc", "staticbundle":
		return true
	default:
		return false
	}
}
