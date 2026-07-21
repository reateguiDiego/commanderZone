package state

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
)

const TokenGroupEffectVersion = 1

const (
	TokenGroupInvariantFailed          = "TOKEN_GROUP_INVARIANT_FAILED"
	TokenGroupMemberMismatch           = "TOKEN_GROUP_MEMBER_MISMATCH"
	TokenGroupDuplicateMember          = "TOKEN_GROUP_DUPLICATE_MEMBER"
	TokenGroupRootInvalid              = "TOKEN_GROUP_ROOT_INVALID"
	TokenGroupRelationConflict         = "TOKEN_GROUP_RELATION_CONFLICT"
	TokenGroupEffectVersionUnsupported = "TOKEN_GROUP_EFFECT_VERSION_UNSUPPORTED"
	TokenGroupProjectionIncomplete     = "TOKEN_GROUP_PROJECTION_INCOMPLETE"
	TokenGroupPatchConflict            = "TOKEN_GROUP_PATCH_CONFLICT"
	TokenGroupNotFound                 = "TOKEN_GROUP_NOT_FOUND"
	TokenGroupStale                    = "TOKEN_GROUP_STALE"
	TokenGroupSplitInvalid             = "TOKEN_GROUP_SPLIT_INVALID"
	TokenGroupMergeInvalid             = "TOKEN_GROUP_MERGE_INVALID"
	TokenGroupQuantityInvalid          = "TOKEN_GROUP_QUANTITY_INVALID"
	TokenGroupMemberRequiresSplit      = "TOKEN_GROUP_MEMBER_REQUIRES_SPLIT"
)

var ErrTokenGroupInvariant = errors.New("token group invariant violation")

type TokenGroupStateError struct {
	Code             string
	Count            int
	InvalidIndex     int
	Operation        string
	Requested        int
	Min              int
	Max              int
	ExpectedRevision int
	ActualRevision   int
}

func (e *TokenGroupStateError) Error() string {
	return fmt.Sprintf("%s: operation=%s count=%d requested=%d revision=%d/%d invalidIndex=%d", e.Code, e.Operation, e.Count, e.Requested, e.ExpectedRevision, e.ActualRevision, e.InvalidIndex)
}

func (e *TokenGroupStateError) Unwrap() error { return ErrTokenGroupInvariant }

func AsTokenGroupStateError(err error) (*TokenGroupStateError, bool) {
	var groupError *TokenGroupStateError
	if !errors.As(err, &groupError) {
		return nil, false
	}
	return groupError, true
}

type TokenGroupRuntime struct {
	GroupID           string   `json:"groupId"`
	RootInstanceID    string   `json:"rootInstanceId"`
	OrderedMemberIDs  []string `json:"orderedMemberIds"`
	Revision          int      `json:"revision"`
	CreatedByPlayerID string   `json:"createdByPlayerId"`
	CreatedAtVersion  int64    `json:"createdAtVersion"`
	EffectVersion     int      `json:"effectVersion"`
}

func (g *TokenGroupRuntime) UnmarshalJSON(data []byte) error {
	type canonicalTokenGroup TokenGroupRuntime
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var decoded canonicalTokenGroup
	if err := decoder.Decode(&decoded); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("token group payload has trailing data")
	}
	*g = TokenGroupRuntime(decoded)
	return nil
}

func (g TokenGroupRuntime) Clone() TokenGroupRuntime {
	g.OrderedMemberIDs = append([]string(nil), g.OrderedMemberIDs...)
	return g
}

func (g TokenGroupRuntime) Quantity() int { return len(g.OrderedMemberIDs) }

func cloneTokenGroupMap(values map[string]TokenGroupRuntime) map[string]TokenGroupRuntime {
	if values == nil {
		return nil
	}
	clone := make(map[string]TokenGroupRuntime, len(values))
	for key, value := range values {
		clone[key] = value.Clone()
	}
	return clone
}

func (r *Relations) RebuildTokenGroupIndex() {
	r.TokenGroupByMember = map[string]string{}
	for groupID, group := range r.TokenGroups {
		for _, memberID := range group.OrderedMemberIDs {
			if _, duplicate := r.TokenGroupByMember[memberID]; !duplicate {
				r.TokenGroupByMember[memberID] = groupID
			}
		}
	}
}

func (r Relations) TokenGroupForMember(instanceID string) (TokenGroupRuntime, bool) {
	groupID, ok := r.TokenGroupByMember[instanceID]
	if !ok {
		return TokenGroupRuntime{}, false
	}
	group, ok := r.TokenGroups[groupID]
	return group.Clone(), ok
}

func AddTokenGroup(game *GameState, group TokenGroupRuntime) error {
	if game.Relations.TokenGroups == nil {
		game.Relations.TokenGroups = map[string]TokenGroupRuntime{}
	}
	if game.Relations.TokenGroupByMember == nil {
		game.Relations.RebuildTokenGroupIndex()
	}
	if _, duplicate := game.Relations.TokenGroups[group.GroupID]; duplicate {
		return &TokenGroupStateError{Code: TokenGroupInvariantFailed, Count: group.Quantity(), InvalidIndex: -1}
	}
	for index, memberID := range group.OrderedMemberIDs {
		if _, duplicate := game.Relations.TokenGroupByMember[memberID]; duplicate {
			return &TokenGroupStateError{Code: TokenGroupDuplicateMember, Count: group.Quantity(), InvalidIndex: index}
		}
	}
	game.Relations.TokenGroups[group.GroupID] = group.Clone()
	for _, memberID := range group.OrderedMemberIDs {
		game.Relations.TokenGroupByMember[memberID] = group.GroupID
	}
	if err := ValidateTokenGroupState(*game); err != nil {
		delete(game.Relations.TokenGroups, group.GroupID)
		game.Relations.RebuildTokenGroupIndex()
		return err
	}
	return nil
}

func RemoveTokenGroup(game *GameState, groupID string) (TokenGroupRuntime, bool) {
	group, ok := game.Relations.TokenGroups[groupID]
	if !ok {
		return TokenGroupRuntime{}, false
	}
	delete(game.Relations.TokenGroups, groupID)
	for _, memberID := range group.OrderedMemberIDs {
		delete(game.Relations.TokenGroupByMember, memberID)
	}
	return group.Clone(), true
}

func TokenGroupingFingerprint(instance CardInstanceRuntime) (string, error) {
	if !instance.IsToken || instance.Zone != ZoneBattlefield {
		return "", &TokenGroupStateError{Code: TokenGroupMemberMismatch, Count: 1, InvalidIndex: 0}
	}
	payload := struct {
		CardKey         string                    `json:"cardKey"`
		PrintID         string                    `json:"printId"`
		CardVersion     string                    `json:"cardVersion"`
		Language        string                    `json:"language"`
		OwnerID         string                    `json:"ownerId"`
		ControllerID    string                    `json:"controllerId"`
		Zone            Zone                      `json:"zone"`
		IsCommander     bool                      `json:"isCommander"`
		IsToken         bool                      `json:"isToken"`
		TokenMeta       map[string]any            `json:"tokenMeta"`
		Tapped          bool                      `json:"tapped"`
		Rotation        int                       `json:"rotation"`
		Counters        map[string]int            `json:"counters"`
		MutableStats    map[string]any            `json:"mutableStats"`
		PrintedStats    map[string]map[string]any `json:"printedStats"`
		ManualOverrides map[string]map[string]any `json:"manualOverrides"`
		FaceDown        bool                      `json:"faceDown"`
		ActiveFace      int                       `json:"activeFace"`
		VisibleToMask   uint64                    `json:"visibleToMask"`
	}{
		instance.CardKey, instance.PrintID, instance.CardVersion, instance.Language,
		instance.OwnerID, instance.ControllerID, instance.Zone, instance.IsCommander, instance.IsToken,
		instance.TokenMeta, instance.Tapped, instance.Rotation, instance.Counters,
		instance.MutableStats, instance.PrintedStats, instance.ManualOverrides,
		instance.FaceDown, instance.ActiveFace, instance.VisibleToMask,
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:]), nil
}

func ResolveTokenGroupingCompatibility(game GameState, memberIDs []string) error {
	if len(memberIDs) < 2 {
		return &TokenGroupStateError{Code: TokenGroupMemberMismatch, Count: len(memberIDs), InvalidIndex: -1}
	}
	var expectedFingerprint string
	for index, memberID := range memberIDs {
		instance, ok := game.Instances[memberID]
		if !ok || !instance.IsToken || instance.Zone != ZoneBattlefield {
			return &TokenGroupStateError{Code: TokenGroupMemberMismatch, Count: len(memberIDs), InvalidIndex: index}
		}
		location, ok := game.Loc[memberID]
		if !ok || location.Zone != ZoneBattlefield {
			return &TokenGroupStateError{Code: TokenGroupMemberMismatch, Count: len(memberIDs), InvalidIndex: index}
		}
		if _, stacked := battlefieldStackMembership(game.Relations.BattlefieldStacks, memberID); stacked || instanceHasAttachment(game.Relations.Attachments, memberID) || instanceHasArrow(game.Relations.Arrows, memberID) {
			return &TokenGroupStateError{Code: TokenGroupRelationConflict, Count: len(memberIDs), InvalidIndex: index}
		}
		fingerprint, err := TokenGroupingFingerprint(instance)
		if err != nil {
			return err
		}
		if index == 0 {
			expectedFingerprint = fingerprint
		} else if fingerprint != expectedFingerprint {
			return &TokenGroupStateError{Code: TokenGroupMemberMismatch, Count: len(memberIDs), InvalidIndex: index}
		}
	}
	return nil
}

func ValidateTokenGroupState(game GameState) error {
	seenMembers := map[string]string{}
	for groupID, group := range game.Relations.TokenGroups {
		count := group.Quantity()
		if groupID == "" || group.GroupID == "" || groupID != group.GroupID || count < 2 || group.Revision < 1 || group.CreatedByPlayerID == "" || group.CreatedAtVersion < 1 {
			return &TokenGroupStateError{Code: TokenGroupInvariantFailed, Count: count, InvalidIndex: -1}
		}
		if group.EffectVersion != TokenGroupEffectVersion {
			return &TokenGroupStateError{Code: TokenGroupEffectVersionUnsupported, Count: count, InvalidIndex: -1}
		}
		rootFound := false
		local := map[string]struct{}{}
		for index, memberID := range group.OrderedMemberIDs {
			if memberID == "" {
				return &TokenGroupStateError{Code: TokenGroupMemberMismatch, Count: count, InvalidIndex: index}
			}
			if _, duplicate := local[memberID]; duplicate {
				return &TokenGroupStateError{Code: TokenGroupDuplicateMember, Count: count, InvalidIndex: index}
			}
			local[memberID] = struct{}{}
			rootFound = rootFound || memberID == group.RootInstanceID
			if _, duplicate := seenMembers[memberID]; duplicate {
				return &TokenGroupStateError{Code: TokenGroupDuplicateMember, Count: count, InvalidIndex: index}
			}
			seenMembers[memberID] = groupID
		}
		if !rootFound {
			return &TokenGroupStateError{Code: TokenGroupRootInvalid, Count: count, InvalidIndex: -1}
		}
		if err := ResolveTokenGroupingCompatibility(game, group.OrderedMemberIDs); err != nil {
			return err
		}
		root := game.Instances[group.RootInstanceID]
		if !validTokenGroupPosition(root.Position) {
			return &TokenGroupStateError{Code: TokenGroupInvariantFailed, Count: count, InvalidIndex: -1}
		}
		for index, memberID := range group.OrderedMemberIDs {
			if !reflect.DeepEqual(root.Position, game.Instances[memberID].Position) {
				return &TokenGroupStateError{Code: TokenGroupMemberMismatch, Count: count, InvalidIndex: index}
			}
		}
	}
	if (len(seenMembers) > 0 || len(game.Relations.TokenGroupByMember) > 0) && !reflect.DeepEqual(seenMembers, game.Relations.TokenGroupByMember) {
		return &TokenGroupStateError{Code: TokenGroupInvariantFailed, Count: len(seenMembers), InvalidIndex: -1}
	}
	return nil
}

func validTokenGroupPosition(position map[string]any) bool {
	if position["unit"] != "ratio" {
		return false
	}
	for _, field := range []string{"x", "y"} {
		value, ok := numericFloat(position[field])
		if !ok || value < 0 || value > 1 {
			return false
		}
	}
	return true
}

func numericFloat(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	default:
		return 0, false
	}
}

func battlefieldStackMembership(stacks map[string]BattlefieldStack, instanceID string) (string, bool) {
	for stackID, stack := range stacks {
		for _, memberID := range stack.OrderedMemberIDs {
			if memberID == instanceID {
				return stackID, true
			}
		}
	}
	return "", false
}

func instanceHasArrow(arrows map[string]Relation, instanceID string) bool {
	for _, relation := range arrows {
		if relation.SourceID == instanceID || relation.TargetID == instanceID {
			return true
		}
	}
	return false
}
