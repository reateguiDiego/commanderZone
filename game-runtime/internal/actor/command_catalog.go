package actor

import "sort"

var commandAliases = map[string]string{
	"zone.changed":          "zone.reorderedByIds",
	"mulligan.scry_confirm": "mulligan.scry.confirm",
}

var explicitNonRuntimeCommandTypes = map[string]string{
	"chat.message":          "chat streams are handled outside the gameplay actor",
	"chat.reaction.toggled": "chat streams are handled outside the gameplay actor",
	"disconnect.vote":       "disconnect vote orchestration is handled outside the gameplay actor",
}

var clientInvocableRuntimeCommandTypes = map[string]string{
	"life.changed":                 "runtime websocket gameplay command",
	"turn.changed":                 "runtime websocket gameplay command",
	"dice.rolled":                  "runtime websocket gameplay command",
	"card.tapped":                  "runtime websocket gameplay command",
	"card.face_down.changed":       "runtime websocket gameplay command",
	"card.revealed":                "runtime websocket gameplay command",
	"card.controller.changed":      "runtime websocket gameplay command",
	"cards.position.changed":       "runtime websocket gameplay command",
	"card.counter.changed":         "runtime websocket gameplay command",
	"counter.changed":              "runtime websocket gameplay command",
	"commander.damage.changed":     "runtime websocket gameplay command",
	"card.power_toughness.changed": "runtime websocket gameplay command",
	"card.position.changed":        "runtime websocket gameplay command",
	"library.draw":                 "runtime websocket gameplay command",
	"library.draw_many":            "runtime websocket gameplay command",
	"library.reveal_top":           "runtime websocket gameplay command",
	"library.reveal":               "runtime websocket gameplay command",
	"library.play_top_revealed":    "runtime websocket gameplay command",
	"library.reorder_top":          "runtime websocket gameplay command",
	"library.move_top":             "runtime websocket gameplay command",
	"library.put_top":              "runtime websocket gameplay command",
	"library.put_bottom":           "runtime websocket gameplay command",
	"library.view":                 "runtime websocket gameplay command",
	"library.shuffle":              "runtime websocket gameplay command",
	"card.token.created":           "runtime websocket gameplay command",
	"card.token_copy.created":      "runtime websocket gameplay command",
	"zone.random_card.selected":    "runtime websocket gameplay command",
	"card.dungeon_marker.changed":  "runtime websocket gameplay command",
	"card.face.changed":            "runtime websocket gameplay command",
	"card.moved":                   "runtime websocket gameplay command",
	"cards.moved":                  "runtime websocket gameplay command",
	"zone.reorderedByIds":          "runtime websocket gameplay command",
	"zone.move_all":                "runtime websocket gameplay command",
	"battlefield.untap_all":        "runtime websocket gameplay command",
	"stack.card_added":             "runtime websocket gameplay command",
	"stack.item_removed":           "runtime websocket gameplay command",
	"arrow.created":                "runtime websocket gameplay command",
	"arrow.removed":                "runtime websocket gameplay command",
	"attachment.created":           "runtime websocket gameplay command",
	"attachment.removed":           "runtime websocket gameplay command",
	"helper.created":               "runtime websocket gameplay command",
	"helper.updated":               "runtime websocket gameplay command",
	"helper.removed":               "runtime websocket gameplay command",
	"game.concede":                 "runtime websocket gameplay command",
	"game.close":                   "runtime websocket gameplay command",
	"mulligan.take":                "runtime websocket mulligan command",
	"mulligan.keep":                "runtime websocket mulligan command",
	"mulligan.scry.confirm":        "runtime websocket mulligan command",
}

var internalOnlyCommandTypes = map[string]string{
	"game.phase.set":          "lifecycle phase patches are emitted by runtime internals",
	"mulligan.cards_bottomed": "bottoming is submitted through mulligan.keep with selected cards",
	"mulligan.ready":          "ready state is derived by runtime mulligan flow",
	"mulligan.completed":      "completion is derived by runtime mulligan flow",
}

func CanonicalCommandType(commandType string) (string, bool) {
	if canonical, ok := commandAliases[commandType]; ok {
		return canonical, true
	}
	return commandType, false
}

func IsExplicitNonRuntimeCommandType(commandType string) bool {
	canonical, _ := CanonicalCommandType(commandType)
	_, ok := explicitNonRuntimeCommandTypes[canonical]
	return ok
}

func IsInternalOnlyCommandType(commandType string) bool {
	canonical, _ := CanonicalCommandType(commandType)
	_, ok := internalOnlyCommandTypes[canonical]
	return ok
}

func CommandAliasMap() map[string]string {
	out := make(map[string]string, len(commandAliases))
	for alias, canonical := range commandAliases {
		out[alias] = canonical
	}
	return out
}

func SupportedCommandTypes(appliers []Applier) []string {
	seen := map[string]bool{}
	for _, applier := range appliers {
		canonical, _ := CanonicalCommandType(applier.Type())
		seen[canonical] = true
	}
	out := make([]string, 0, len(seen))
	for commandType := range seen {
		out = append(out, commandType)
	}
	sort.Strings(out)
	return out
}

func SupportedCommandTypeSet(appliers []Applier) map[string]bool {
	out := map[string]bool{}
	for _, commandType := range SupportedCommandTypes(appliers) {
		out[commandType] = true
	}
	return out
}

func FinalGameplayCommandTypes() []string {
	return []string{
		"life.changed",
		"turn.changed",
		"dice.rolled",
		"card.tapped",
		"card.face_down.changed",
		"card.revealed",
		"card.controller.changed",
		"cards.position.changed",
		"card.counter.changed",
		"counter.changed",
		"commander.damage.changed",
		"card.power_toughness.changed",
		"card.position.changed",
		"library.draw",
		"library.draw_many",
		"library.reveal_top",
		"library.reveal",
		"library.play_top_revealed",
		"library.reorder_top",
		"library.move_top",
		"library.put_top",
		"library.put_bottom",
		"library.view",
		"library.shuffle",
		"card.token.created",
		"card.token_copy.created",
		"zone.random_card.selected",
		"card.dungeon_marker.changed",
		"card.face.changed",
		"card.moved",
		"cards.moved",
		"zone.reorderedByIds",
		"zone.move_all",
		"battlefield.untap_all",
		"stack.card_added",
		"stack.item_removed",
		"arrow.created",
		"arrow.removed",
		"attachment.created",
		"attachment.removed",
		"helper.created",
		"helper.updated",
		"helper.removed",
		"game.concede",
		"game.close",
		"mulligan.take",
		"mulligan.keep",
		"mulligan.cards_bottomed",
		"mulligan.scry.confirm",
		"mulligan.ready",
		"mulligan.completed",
		"game.phase.set",
	}
}

func ClientInvocableRuntimeCommandTypes() []string {
	out := make([]string, 0, len(clientInvocableRuntimeCommandTypes))
	for commandType := range clientInvocableRuntimeCommandTypes {
		out = append(out, commandType)
	}
	sort.Strings(out)
	return out
}

func InternalOnlyCommandTypes() []string {
	out := make([]string, 0, len(internalOnlyCommandTypes))
	for commandType := range internalOnlyCommandTypes {
		out = append(out, commandType)
	}
	sort.Strings(out)
	return out
}

func UnsupportedCommandTypes(appliers []Applier, commandTypes []string) []string {
	supported := SupportedCommandTypeSet(appliers)
	unsupported := []string{}
	for _, commandType := range commandTypes {
		canonical, _ := CanonicalCommandType(commandType)
		if supported[canonical] || IsExplicitNonRuntimeCommandType(canonical) {
			continue
		}
		unsupported = append(unsupported, commandType)
	}
	sort.Strings(unsupported)
	return unsupported
}

func CommandRuntimeCoveragePercent(appliers []Applier, commandTypes []string) float64 {
	total := 0
	covered := 0
	supported := SupportedCommandTypeSet(appliers)
	seen := map[string]bool{}
	for _, commandType := range commandTypes {
		canonical, _ := CanonicalCommandType(commandType)
		if IsExplicitNonRuntimeCommandType(canonical) || seen[canonical] {
			continue
		}
		seen[canonical] = true
		total++
		if supported[canonical] {
			covered++
		}
	}
	if total == 0 {
		return 100
	}
	return float64(covered) * 100 / float64(total)
}
