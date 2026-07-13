/** Gmail-style undo window before the outbox worker actually sends. */
export const UNDO_SEND_MS = 8_000;

export function undoUntilIso(fromMs = Date.now()): string {
  return new Date(fromMs + UNDO_SEND_MS).toISOString();
}

/** Outbox rows newer than this are still in the undo window. */
export function undoEligibleBeforeIso(now = Date.now()): string {
  return new Date(now - UNDO_SEND_MS).toISOString();
}
