package actor

import (
	"errors"
	"math"
)

const (
	PositionContractEffectVersion = 1

	PositionCodeInvalid         = "INVALID_POSITION"
	PositionCodeNotFinite       = "POSITION_NOT_FINITE"
	PositionCodeOutOfRange      = "POSITION_OUT_OF_RANGE"
	PositionCodeUnsupportedUnit = "UNSUPPORTED_POSITION_UNIT"
)

// PositionValidationError is safe to expose to command clients. It contains no
// card identity beyond the instance id already supplied by that client.
type PositionValidationError struct {
	Code        string
	CommandType string
	InstanceID  string
	Index       int
}

func (e *PositionValidationError) Error() string {
	switch e.Code {
	case PositionCodeNotFinite:
		return "position coordinates must be finite numbers"
	case PositionCodeOutOfRange:
		return "position coordinates must be between zero and one"
	case PositionCodeUnsupportedUnit:
		return "position unit must be ratio"
	default:
		return "position must contain numeric x and y coordinates and unit ratio"
	}
}

func AsPositionValidationError(err error) (*PositionValidationError, bool) {
	var positionError *PositionValidationError
	if !errors.As(err, &positionError) {
		return nil, false
	}
	return positionError, true
}

func canonicalRatioPosition(raw any, commandType string, instanceID string, index int) (map[string]any, error) {
	position, ok := raw.(map[string]any)
	if !ok || position == nil {
		return nil, &PositionValidationError{Code: PositionCodeInvalid, CommandType: commandType, InstanceID: instanceID, Index: index}
	}
	if _, ok := position["x"]; !ok {
		return nil, &PositionValidationError{Code: PositionCodeInvalid, CommandType: commandType, InstanceID: instanceID, Index: index}
	}
	if _, ok := position["y"]; !ok {
		return nil, &PositionValidationError{Code: PositionCodeInvalid, CommandType: commandType, InstanceID: instanceID, Index: index}
	}
	for key := range position {
		if key != "x" && key != "y" && key != "unit" {
			return nil, &PositionValidationError{Code: PositionCodeInvalid, CommandType: commandType, InstanceID: instanceID, Index: index}
		}
	}
	if unit, ok := position["unit"].(string); !ok || unit != "ratio" {
		return nil, &PositionValidationError{Code: PositionCodeUnsupportedUnit, CommandType: commandType, InstanceID: instanceID, Index: index}
	}
	x, xOK := finitePositionCoordinate(position["x"])
	y, yOK := finitePositionCoordinate(position["y"])
	if !xOK || !yOK {
		if isNonFiniteNumber(position["x"]) || isNonFiniteNumber(position["y"]) {
			return nil, &PositionValidationError{Code: PositionCodeNotFinite, CommandType: commandType, InstanceID: instanceID, Index: index}
		}
		return nil, &PositionValidationError{Code: PositionCodeInvalid, CommandType: commandType, InstanceID: instanceID, Index: index}
	}
	if x < 0 || x > 1 || y < 0 || y > 1 {
		return nil, &PositionValidationError{Code: PositionCodeOutOfRange, CommandType: commandType, InstanceID: instanceID, Index: index}
	}
	return map[string]any{"x": x, "y": y, "unit": "ratio"}, nil
}

func finitePositionCoordinate(raw any) (float64, bool) {
	value, ok := positionNumber(raw)
	return value, ok && !math.IsNaN(value) && !math.IsInf(value, 0)
}

func isNonFiniteNumber(raw any) bool {
	value, ok := positionNumber(raw)
	return ok && (math.IsNaN(value) || math.IsInf(value, 0))
}

func positionNumber(raw any) (float64, bool) {
	switch value := raw.(type) {
	case float64:
		return value, true
	case float32:
		return float64(value), true
	case int:
		return float64(value), true
	case int8:
		return float64(value), true
	case int16:
		return float64(value), true
	case int32:
		return float64(value), true
	case int64:
		return float64(value), true
	case uint:
		return float64(value), true
	case uint8:
		return float64(value), true
	case uint16:
		return float64(value), true
	case uint32:
		return float64(value), true
	case uint64:
		return float64(value), true
	default:
		return 0, false
	}
}

func duplicatePositionError(commandType string, instanceID string, index int) error {
	return &AuthorizationError{
		Code:        AuthorizationCodeDuplicateInstance,
		CommandType: commandType,
		InstanceID:  instanceID,
		Index:       index,
	}
}

func positionEventPayload(instanceID string, previous map[string]any, position map[string]any) map[string]any {
	return map[string]any{
		"effectVersion":    PositionContractEffectVersion,
		"instanceId":       instanceID,
		"previousPosition": cloneMap(previous),
		"position":         cloneMap(position),
	}
}
