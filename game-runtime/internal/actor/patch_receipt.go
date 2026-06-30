package actor

import (
	"encoding/json"
	"fmt"

	"commanderzone/game-runtime/internal/protocol"
)

const runtimePatchReceiptKey = "_runtimePatchReceipt"

type runtimePatchReceipt struct {
	Patches []protocol.PatchEnvelopeV2 `json:"patches"`
}

func eventWithRuntimePatchReceipt(event protocol.EventPayloadV2, patches []protocol.PatchEnvelopeV2) protocol.EventPayloadV2 {
	event.Payload = cloneMap(event.Payload)
	event.Payload[runtimePatchReceiptKey] = runtimePatchReceipt{Patches: clonePatchEnvelopes(patches)}
	return event
}

func eventWithoutRuntimePatchReceipt(event protocol.EventPayloadV2) protocol.EventPayloadV2 {
	if _, ok := event.Payload[runtimePatchReceiptKey]; !ok {
		return event
	}
	event.Payload = cloneMap(event.Payload)
	delete(event.Payload, runtimePatchReceiptKey)
	return event
}

func runtimePatchReceiptFromEvent(event protocol.EventPayloadV2) ([]protocol.PatchEnvelopeV2, bool, error) {
	raw, ok := event.Payload[runtimePatchReceiptKey]
	if !ok {
		return nil, false, nil
	}
	switch typed := raw.(type) {
	case runtimePatchReceipt:
		if len(typed.Patches) == 0 {
			return nil, true, fmt.Errorf("runtime patch receipt has no patches")
		}
		return clonePatchEnvelopes(typed.Patches), true, nil
	case *runtimePatchReceipt:
		if typed == nil || len(typed.Patches) == 0 {
			return nil, true, fmt.Errorf("runtime patch receipt has no patches")
		}
		return clonePatchEnvelopes(typed.Patches), true, nil
	case []protocol.PatchEnvelopeV2:
		if len(typed) == 0 {
			return nil, true, fmt.Errorf("runtime patch receipt has no patches")
		}
		return clonePatchEnvelopes(typed), true, nil
	}
	payload, err := json.Marshal(raw)
	if err != nil {
		return nil, true, fmt.Errorf("runtime patch receipt marshal: %w", err)
	}
	var receipt runtimePatchReceipt
	if err := json.Unmarshal(payload, &receipt); err != nil {
		return nil, true, fmt.Errorf("runtime patch receipt unmarshal: %w", err)
	}
	if len(receipt.Patches) == 0 {
		return nil, true, fmt.Errorf("runtime patch receipt has no patches")
	}
	return clonePatchEnvelopes(receipt.Patches), true, nil
}

func clonePatchEnvelopes(patches []protocol.PatchEnvelopeV2) []protocol.PatchEnvelopeV2 {
	out := make([]protocol.PatchEnvelopeV2, len(patches))
	for i, patch := range patches {
		out[i] = patch
		out[i].Ops = clonePatchOps(patch.Ops)
	}
	return out
}

func clonePatchOps(ops []protocol.PatchOp) []protocol.PatchOp {
	out := make([]protocol.PatchOp, len(ops))
	for i, op := range ops {
		out[i] = op
		if op.Data != nil {
			out[i].Data = cloneMap(op.Data)
		}
	}
	return out
}
