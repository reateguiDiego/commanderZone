package actor

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
)

const (
	MinTokenCreateQuantity = 1
	MaxTokenCreateQuantity = 20
	TokenQuantityErrorCode = "INVALID_TOKEN_QUANTITY"
)

type TokenQuantityValidationError struct {
	CommandType string
}

func (e *TokenQuantityValidationError) Error() string {
	return fmt.Sprintf("%s: quantity must be an integer between %d and %d", TokenQuantityErrorCode, MinTokenCreateQuantity, MaxTokenCreateQuantity)
}

func AsTokenQuantityValidationError(err error) (*TokenQuantityValidationError, bool) {
	var quantityError *TokenQuantityValidationError
	if !errors.As(err, &quantityError) {
		return nil, false
	}
	return quantityError, true
}

func strictTokenQuantity(payload map[string]any, commandType string) (int, error) {
	value, exists := payload["quantity"]
	if !exists || value == nil {
		return 0, &TokenQuantityValidationError{CommandType: commandType}
	}
	quantity, ok := strictInteger(value)
	if !ok || quantity < MinTokenCreateQuantity || quantity > MaxTokenCreateQuantity {
		return 0, &TokenQuantityValidationError{CommandType: commandType}
	}
	return quantity, nil
}

func strictInteger(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int8:
		return int(typed), true
	case int16:
		return int(typed), true
	case int32:
		return int(typed), true
	case int64:
		converted := int(typed)
		return converted, int64(converted) == typed
	case uint:
		converted := int(typed)
		return converted, converted >= 0 && uint(converted) == typed
	case uint8:
		return int(typed), true
	case uint16:
		return int(typed), true
	case uint32:
		converted := int(typed)
		return converted, converted >= 0 && uint32(converted) == typed
	case uint64:
		converted := int(typed)
		return converted, converted >= 0 && uint64(converted) == typed
	case float32:
		return strictFloatInteger(float64(typed))
	case float64:
		return strictFloatInteger(typed)
	case json.Number:
		parsed, err := strconv.ParseInt(typed.String(), 10, 64)
		if err != nil {
			return 0, false
		}
		converted := int(parsed)
		return converted, int64(converted) == parsed
	default:
		return 0, false
	}
}

func strictFloatInteger(value float64) (int, bool) {
	if math.IsNaN(value) || math.IsInf(value, 0) || math.Trunc(value) != value {
		return 0, false
	}
	converted := int(value)
	return converted, float64(converted) == value
}
