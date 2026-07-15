package actor

import "errors"

const (
	RelationCodeNotFound            = "RELATION_NOT_FOUND"
	RelationCodeAlreadyExists       = "RELATION_ALREADY_EXISTS"
	RelationCodeInvalidType         = "INVALID_RELATION_TYPE"
	RelationCodeSelfReference       = "ATTACHMENT_SELF_REFERENCE"
	RelationCodeCycle               = "RELATION_CYCLE"
	RelationCodeAlreadyStacked      = "INSTANCE_ALREADY_STACKED"
	RelationCodeMemberMissing       = "STACK_MEMBER_MISSING"
	RelationCodeMemberDuplicate     = "STACK_MEMBER_DUPLICATE"
	RelationCodeOrderMismatch       = "STACK_ORDER_MISMATCH"
	RelationCodeMemberMoveAmbiguous = "STACK_MEMBER_MOVE_AMBIGUOUS"
)

type RelationValidationError struct {
	Code        string
	CommandType string
	InstanceID  string
	Index       int
}

func (e *RelationValidationError) Error() string {
	switch e.Code {
	case RelationCodeNotFound:
		return "relation was not found"
	case RelationCodeAlreadyExists:
		return "relation already exists"
	case RelationCodeInvalidType:
		return "relation type is invalid"
	case RelationCodeSelfReference:
		return "an attachment cannot target itself"
	case RelationCodeCycle:
		return "relation would create a cycle"
	case RelationCodeAlreadyStacked:
		return "instance already belongs to a battlefield stack"
	case RelationCodeMemberMissing:
		return "battlefield stack member is missing"
	case RelationCodeMemberDuplicate:
		return "battlefield stack contains a duplicate member"
	case RelationCodeOrderMismatch:
		return "battlefield stack order does not match its members"
	case RelationCodeMemberMoveAmbiguous:
		return "stacked members must be moved through an explicit stack action"
	default:
		return "relation payload is invalid"
	}
}

func AsRelationValidationError(err error) (*RelationValidationError, bool) {
	var relationError *RelationValidationError
	if !errors.As(err, &relationError) {
		return nil, false
	}
	return relationError, true
}
