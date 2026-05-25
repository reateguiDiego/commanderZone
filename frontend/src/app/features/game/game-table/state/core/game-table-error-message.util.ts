interface ErrorPayloadLike {
  code?: unknown;
  error?: unknown;
  detail?: unknown;
  message?: unknown;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function gameTableErrorMessage(error: unknown): string {
  const payload = (typeof error === 'object' && error !== null && 'error' in error)
    ? (error as { error?: ErrorPayloadLike }).error
    : undefined;
  const code = normalizeText(payload?.code).toUpperCase();
  const message = normalizeText(payload?.error) || normalizeText(payload?.detail);
  const fallback = error instanceof Error ? error.message : '';
  const haystack = `${code} ${message} ${fallback}`.toLowerCase();

  if (code === 'BASE_VERSION_MISMATCH' || haystack.includes('base_version_mismatch')) {
    return 'Sincronizando mesa... reintenta.';
  }

  if (
    code === 'QUEUE_FULL'
    || code === 'CIRCUIT_BLOCKED'
    || haystack.includes('local queue is full')
    || haystack.includes('temporarily blocked after repeated command rejections')
    || haystack.includes('temporarily limited to avoid saturation')
  ) {
    return 'Accion temporalmente limitada para evitar saturacion.';
  }

  if (
    code === 'COMMAND_REJECTED'
    || haystack.includes('command rejected')
    || haystack.includes('invalid action')
    || haystack.includes('not valid in the current state')
    || haystack.includes('action is not valid')
  ) {
    return 'La accion ya no es valida en el estado actual.';
  }

  return message || fallback || 'Action failed.';
}
