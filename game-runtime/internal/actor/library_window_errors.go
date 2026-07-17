package actor

import "errors"

const (
	LibraryWindowCodeNotFound           = "LIBRARY_WINDOW_NOT_FOUND"
	LibraryWindowCodeStale              = "LIBRARY_WINDOW_STALE"
	LibraryWindowCodeConsumed           = "LIBRARY_WINDOW_CONSUMED"
	LibraryWindowCodeEpochMismatch      = "LIBRARY_EPOCH_MISMATCH"
	LibraryWindowCodeSelectionMismatch  = "LIBRARY_SELECTION_MISMATCH"
	LibraryWindowCodeOrderMismatch      = "LIBRARY_ORDER_MISMATCH"
	LibraryWindowCodeInstanceMissing    = "INSTANCE_NOT_IN_WINDOW"
	LibraryWindowCodeDuplicateInstance  = "DUPLICATE_INSTANCE"
	LibraryWindowCodeInvalidBatch       = "INVALID_LIBRARY_BATCH"
	LibraryWindowCodeInvalidDestination = "INVALID_DESTINATION"
	LibraryWindowCodeInvalidFaceDown    = "INVALID_FACE_DOWN_MOVE"
)

// LibraryWindowError is deliberately identity-free. Window identifiers and
// epochs are safe only for the authenticated owner that submitted the command.
type LibraryWindowError struct {
	Code          string
	CommandType   string
	WindowID      string
	ExpectedEpoch int64
	CurrentEpoch  int64
	Count         int
	Index         int
}

func (e *LibraryWindowError) Error() string {
	switch e.Code {
	case LibraryWindowCodeNotFound:
		return "library window was not found"
	case LibraryWindowCodeStale:
		return "library window is stale"
	case LibraryWindowCodeConsumed:
		return "library window was already consumed"
	case LibraryWindowCodeEpochMismatch:
		return "library epoch does not match the active window"
	case LibraryWindowCodeSelectionMismatch:
		return "library selection does not match the active window"
	case LibraryWindowCodeOrderMismatch:
		return "library order no longer matches the active window"
	case LibraryWindowCodeInstanceMissing:
		return "library selection contains an instance outside the active window"
	case LibraryWindowCodeDuplicateInstance:
		return "library selection contains a duplicate instance"
	case LibraryWindowCodeInvalidDestination:
		return "library batch destination is invalid"
	case LibraryWindowCodeInvalidFaceDown:
		return "face-down movement is only valid for battlefield destinations"
	default:
		return "library batch is invalid"
	}
}

func AsLibraryWindowError(err error) (*LibraryWindowError, bool) {
	var target *LibraryWindowError
	if !errors.As(err, &target) {
		return nil, false
	}
	return target, true
}
