package actor

import (
	"context"
	"os"
	"path/filepath"
	goruntime "runtime"
	"sort"
	"strings"
	"testing"

	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

func TestDefaultAppliersCoverFinalGameplayCommandCatalog(t *testing.T) {
	unsupported := UnsupportedCommandTypes(DefaultAppliers(), FinalGameplayCommandTypes())
	if len(unsupported) > 0 {
		t.Fatalf("final gameplay commands without Go applier: %v", unsupported)
	}
	if coverage := CommandRuntimeCoveragePercent(DefaultAppliers(), FinalGameplayCommandTypes()); coverage != 100 {
		t.Fatalf("command.runtime_coverage_percent = %v, want 100", coverage)
	}
}

func TestEnvAndDockerAllowlistsMatchFinalGameplayCommandCatalog(t *testing.T) {
	root := repoRoot(t)
	expected := sorted(FinalGameplayCommandTypes())
	requiredFiles := []string{".env", "docker-compose.yml"}
	optionalFiles := []string{".env.prod"}
	requiredFileSet := map[string]bool{}
	for _, relative := range requiredFiles {
		requiredFileSet[relative] = true
	}
	for _, relative := range append(requiredFiles, optionalFiles...) {
		required := requiredFileSet[relative]
		allowlists := allowlistsFromFile(t, filepath.Join(root, relative), required)
		if !required && allowlists == nil {
			continue
		}
		if len(allowlists) == 0 {
			t.Fatalf("%s has no GAMEPLAY_V2_COMMANDS_ALLOWLIST", relative)
		}
		for index, allowlist := range allowlists {
			if got := sorted(allowlist); !stringSlicesEqual(got, expected) {
				t.Fatalf("%s allowlist %d mismatch\nmissing: %v\nextra: %v", relative, index, missing(expected, got), missing(got, expected))
			}
			for _, commandType := range allowlist {
				if canonical, translated := CanonicalCommandType(commandType); translated {
					t.Fatalf("%s allowlist %d contains alias %q; use canonical %q", relative, index, commandType, canonical)
				}
			}
		}
	}
}

func TestBackendAndGoFinalRuntimeCatalogsMatch(t *testing.T) {
	root := repoRoot(t)
	backendCatalog := filepath.Join(root, "backend/src/Application/Game/Runtime/GameplayCommandCatalog.php")
	expectedCommands := sorted(FinalGameplayCommandTypes())
	gotCommands := sorted(phpStringListConst(t, backendCatalog, "FINAL_RUNTIME_COMMANDS"))
	if !stringSlicesEqual(gotCommands, expectedCommands) {
		t.Fatalf("backend GameplayCommandCatalog mismatch\nmissing: %v\nextra: %v", missing(expectedCommands, gotCommands), missing(gotCommands, expectedCommands))
	}

	expectedAliases := CommandAliasMap()
	gotAliases := phpStringMapConst(t, backendCatalog, "ALIASES")
	if !stringMapsEqual(gotAliases, expectedAliases) {
		t.Fatalf("backend aliases mismatch\nexpected: %v\ngot: %v", expectedAliases, gotAliases)
	}

	expectedClientCommands := sorted(ClientInvocableRuntimeCommandTypes())
	gotClientCommands := sorted(phpStringListConst(t, backendCatalog, "CLIENT_RUNTIME_COMMANDS"))
	if !stringSlicesEqual(gotClientCommands, expectedClientCommands) {
		t.Fatalf("backend client runtime command classification mismatch\nmissing: %v\nextra: %v", missing(expectedClientCommands, gotClientCommands), missing(gotClientCommands, expectedClientCommands))
	}

	expectedInternalCommands := sorted(InternalOnlyCommandTypes())
	gotInternalCommands := sorted(phpStringListConst(t, backendCatalog, "INTERNAL_RUNTIME_COMMANDS"))
	if !stringSlicesEqual(gotInternalCommands, expectedInternalCommands) {
		t.Fatalf("backend internal runtime command classification mismatch\nmissing: %v\nextra: %v", missing(expectedInternalCommands, gotInternalCommands), missing(gotInternalCommands, expectedInternalCommands))
	}
}

func TestFinalRuntimeCommandCatalogIsExplicitlyClassified(t *testing.T) {
	final := stringSet(FinalGameplayCommandTypes())
	clientInvocable := stringSet(ClientInvocableRuntimeCommandTypes())
	internalOnly := stringSet(InternalOnlyCommandTypes())

	overlap := intersection(clientInvocable, internalOnly)
	if len(overlap) > 0 {
		t.Fatalf("commands classified as both client-invocable and internal-only: %v", overlap)
	}

	classified := map[string]bool{}
	for commandType := range clientInvocable {
		classified[commandType] = true
	}
	for commandType := range internalOnly {
		classified[commandType] = true
	}
	if got := sortedSet(classified); !stringSlicesEqual(got, sortedSet(final)) {
		t.Fatalf("final runtime commands must be classified exactly once\nmissing classification: %v\nunknown classification: %v", missing(sortedSet(final), got), missing(got, sortedSet(final)))
	}
}

func TestFrontendEmittedCommandsAreRuntimeSupportedOrExplicitlyDisabled(t *testing.T) {
	root := repoRoot(t)
	commandTypes := map[string]bool{}
	for _, commandType := range frontendGameCommandTypes(t, filepath.Join(root, "frontend/src/app/core/models/game.model.ts")) {
		commandTypes[commandType] = true
	}
	for _, commandType := range frontendWebSocketCommandTypes(t, filepath.Join(root, "frontend/src/app/features/game/game-table/services/game-table-websocket-gameplay.service.ts")) {
		commandTypes[commandType] = true
	}

	unsupported := []string{}
	supported := SupportedCommandTypeSet(DefaultAppliers())
	for commandType := range commandTypes {
		canonical, _ := CanonicalCommandType(commandType)
		if supported[canonical] || IsExplicitNonRuntimeCommandType(canonical) {
			continue
		}
		unsupported = append(unsupported, commandType)
	}
	sort.Strings(unsupported)
	if len(unsupported) > 0 {
		t.Fatalf("frontend command types not covered by Go runtime or explicit disable list: %v", unsupported)
	}
}

func TestFrontendRuntimePrimaryUICommandsAreWebSocketRouted(t *testing.T) {
	root := repoRoot(t)
	uiCommandTypes := canonicalSet(frontendGameCommandTypes(t, filepath.Join(root, "frontend/src/app/core/models/game.model.ts")))
	websocketCommandTypes := canonicalSet(frontendWebSocketCommandTypes(t, filepath.Join(root, "frontend/src/app/features/game/game-table/services/game-table-websocket-gameplay.service.ts")))
	clientInvocable := stringSet(ClientInvocableRuntimeCommandTypes())
	internalOnly := stringSet(InternalOnlyCommandTypes())

	missingFromWebSocket := []string{}
	for commandType := range uiCommandTypes {
		if IsExplicitNonRuntimeCommandType(commandType) {
			continue
		}
		if internalOnly[commandType] {
			t.Fatalf("frontend UI command %q is classified as internal-only runtime", commandType)
		}
		if !clientInvocable[commandType] {
			t.Fatalf("frontend UI command %q is not classified as client-invocable runtime or explicit non-runtime", commandType)
		}
		if !websocketCommandTypes[commandType] {
			missingFromWebSocket = append(missingFromWebSocket, commandType)
		}
	}
	sort.Strings(missingFromWebSocket)
	if len(missingFromWebSocket) > 0 {
		t.Fatalf("frontend UI runtime-primary commands missing from WEBSOCKET_COMMANDS: %v", missingFromWebSocket)
	}

	for commandType := range websocketCommandTypes {
		if IsExplicitNonRuntimeCommandType(commandType) {
			continue
		}
		if internalOnly[commandType] {
			t.Fatalf("frontend WEBSOCKET_COMMANDS exposes internal-only runtime command %q", commandType)
		}
		if !clientInvocable[commandType] {
			t.Fatalf("frontend WEBSOCKET_COMMANDS contains unclassified runtime command %q", commandType)
		}
	}
}

func TestCommandAliasesTranslateToCanonicalRuntimeEvents(t *testing.T) {
	initial := commandCatalogTestState("game-1")
	gameActor := NewGameActor("game-1", initial, persistence.NewInMemoryEventStore(), 8, DefaultAppliers())

	result := gameActor.ApplyDirect(context.Background(), protocol.CommandEnvelopeV2{
		GameID:         "game-1",
		BaseVersion:    1,
		ClientActionID: "reorder-alias",
		Type:           "zone.changed",
		Payload: map[string]any{
			"playerId":    "p1",
			"zone":        "hand",
			"instanceIds": []string{"h2", "h1"},
		},
	}, "p1")
	if result.Err != nil {
		t.Fatalf("zone.changed alias failed: %v", result.Err)
	}
	if result.Event.Type != "zone.reorderedByIds" {
		t.Fatalf("event type = %q, want zone.reorderedByIds", result.Event.Type)
	}
	if got := metricValue(result.Event.Payload, "command.alias_translation_count"); got != 1 {
		t.Fatalf("command.alias_translation_count = %v, want 1", got)
	}
	if gameActor.Metrics().AliasTranslationCount != 1 {
		t.Fatalf("actor alias count = %d, want 1", gameActor.Metrics().AliasTranslationCount)
	}
}

func TestUnknownCommandFailsClearlyAndRecordsUnsupportedMetric(t *testing.T) {
	gameActor := NewGameActor("game-1", commandCatalogTestState("game-1"), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), protocol.CommandEnvelopeV2{
		GameID:         "game-1",
		BaseVersion:    1,
		ClientActionID: "unknown-1",
		Type:           "not.supported",
		Payload:        map[string]any{},
	}, "p1")
	if result.Err != ErrUnknownCommand {
		t.Fatalf("error = %v, want ErrUnknownCommand", result.Err)
	}
	if gameActor.Metrics().UnsupportedCount != 1 {
		t.Fatalf("command.unsupported_count = %d, want 1", gameActor.Metrics().UnsupportedCount)
	}
}

func repoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := goruntime.Caller(0)
	if !ok {
		t.Fatal("runtime caller unavailable")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "../../.."))
}

func allowlistsFromFile(t *testing.T, path string, required bool) [][]string {
	t.Helper()
	contentBytes, err := os.ReadFile(path)
	if err != nil {
		if !required && os.IsNotExist(err) {
			return nil
		}
		t.Fatal(err)
	}
	lines := strings.Split(string(contentBytes), "\n")
	allowlists := [][]string{}
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if !strings.Contains(line, "GAMEPLAY_V2_COMMANDS_ALLOWLIST") {
			continue
		}
		value := ""
		if strings.Contains(line, ":-") {
			value = strings.TrimSuffix(line[strings.Index(line, ":-")+2:], "}")
		} else if strings.Contains(line, "=") {
			value = line[strings.Index(line, "=")+1:]
		}
		value = strings.Trim(value, " '\"")
		if value == "" {
			continue
		}
		allowlists = append(allowlists, splitCSV(value))
	}
	return allowlists
}

func frontendGameCommandTypes(t *testing.T, path string) []string {
	t.Helper()
	contentBytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	content := string(contentBytes)
	start := strings.Index(content, "export type GameCommandType =")
	if start < 0 {
		t.Fatalf("%s missing GameCommandType", path)
	}
	end := strings.Index(content[start:], ";")
	if end < 0 {
		t.Fatalf("%s has unterminated GameCommandType", path)
	}
	return quotedStrings(content[start : start+end])
}

func phpStringListConst(t *testing.T, path string, constName string) []string {
	t.Helper()
	block := phpConstBlock(t, path, constName)
	return quotedStrings(block)
}

func phpStringMapConst(t *testing.T, path string, constName string) map[string]string {
	t.Helper()
	values := quotedStrings(phpConstBlock(t, path, constName))
	if len(values)%2 != 0 {
		t.Fatalf("%s has odd string count for map const %s", path, constName)
	}
	out := map[string]string{}
	for index := 0; index < len(values); index += 2 {
		out[values[index]] = values[index+1]
	}
	return out
}

func phpConstBlock(t *testing.T, path string, constName string) string {
	t.Helper()
	contentBytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	content := string(contentBytes)
	needle := "private const " + constName + " = ["
	start := strings.Index(content, needle)
	if start < 0 {
		t.Fatalf("%s missing const %s", path, constName)
	}
	end := strings.Index(content[start:], "];")
	if end < 0 {
		t.Fatalf("%s has unterminated const %s", path, constName)
	}
	return content[start : start+end]
}

func frontendWebSocketCommandTypes(t *testing.T, path string) []string {
	t.Helper()
	contentBytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	content := string(contentBytes)
	out := []string{}
	if start := strings.Index(content, "const WEBSOCKET_COMMANDS"); start >= 0 {
		if end := strings.Index(content[start:], "]);"); end >= 0 {
			out = append(out, quotedStrings(content[start:start+end])...)
		} else {
			t.Fatalf("%s has unterminated WEBSOCKET_COMMANDS", path)
		}
	} else {
		t.Fatalf("%s missing WEBSOCKET_COMMANDS", path)
	}
	for _, kind := range []string{"mulligan.take", "mulligan.keep", "mulligan.scry.confirm"} {
		if strings.Contains(content, "kind: '"+kind+"'") {
			out = append(out, kind)
		}
	}
	return out
}

func quotedStrings(content string) []string {
	out := []string{}
	for {
		start := strings.Index(content, "'")
		if start < 0 {
			break
		}
		content = content[start+1:]
		end := strings.Index(content, "'")
		if end < 0 {
			break
		}
		value := content[:end]
		if strings.Contains(value, ".") {
			out = append(out, value)
		}
		content = content[end+1:]
	}
	return out
}

func splitCSV(value string) []string {
	items := strings.Split(value, ",")
	out := make([]string, 0, len(items))
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item != "" {
			out = append(out, item)
		}
	}
	return out
}

func sorted(items []string) []string {
	out := append([]string(nil), items...)
	sort.Strings(out)
	return out
}

func sortedSet(items map[string]bool) []string {
	out := make([]string, 0, len(items))
	for item := range items {
		out = append(out, item)
	}
	sort.Strings(out)
	return out
}

func stringSlicesEqual(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func stringMapsEqual(left map[string]string, right map[string]string) bool {
	if len(left) != len(right) {
		return false
	}
	for key, value := range left {
		if right[key] != value {
			return false
		}
	}
	return true
}

func missing(expected []string, actual []string) []string {
	actualSet := map[string]bool{}
	for _, item := range actual {
		actualSet[item] = true
	}
	out := []string{}
	for _, item := range expected {
		if !actualSet[item] {
			out = append(out, item)
		}
	}
	return out
}

func stringSet(items []string) map[string]bool {
	out := map[string]bool{}
	for _, item := range items {
		out[item] = true
	}
	return out
}

func canonicalSet(items []string) map[string]bool {
	out := map[string]bool{}
	for _, item := range items {
		canonical, _ := CanonicalCommandType(item)
		out[canonical] = true
	}
	return out
}

func intersection(left map[string]bool, right map[string]bool) []string {
	out := []string{}
	for item := range left {
		if right[item] {
			out = append(out, item)
		}
	}
	sort.Strings(out)
	return out
}

func metricValue(payload map[string]any, key string) any {
	metrics, _ := payload["metrics"].(map[string]any)
	return metrics[key]
}

func commandCatalogTestState(gameID string) state.GameState {
	return state.GameState{
		GameID:  gameID,
		Version: 1,
		Status:  "playing",
		Players: map[string]map[string]any{
			"p1": {"life": 40},
		},
		Turn: map[string]any{},
		Instances: map[string]state.CardInstanceRuntime{
			"h1": {OwnerID: "p1", ControllerID: "p1", CardKey: "card:h1"},
			"h2": {OwnerID: "p1", ControllerID: "p1", CardKey: "card:h2"},
		},
		Zones: map[string]state.PlayerZones{
			"p1": {Hand: []string{"h1", "h2"}},
		},
		Loc: map[string]state.Location{
			"h1": {PlayerID: "p1", Zone: state.ZoneHand, Index: 0},
			"h2": {PlayerID: "p1", Zone: state.ZoneHand, Index: 1},
		},
		Visibility: state.VisibilityIndex{
			InstanceMasks:       map[string]uint64{},
			LibraryEpochByOwner: map[string]int64{},
			TopRevealWindows:    map[string]state.TopRevealWindow{},
		},
	}
}
