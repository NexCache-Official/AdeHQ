import { uid } from "@/lib/utils";

/** Client-generated message id — also used as the local/remote message row id when provided. */
export function createClientMessageId(prefix = "msg"): string {
  return uid(prefix);
}

export function messageSendFingerprint(
  scope: string,
  content: string,
  senderType: "human" | "ai" | "system" = "human",
): string {
  return `${scope}:${senderType}:${content.trim()}`;
}

type FingerprintEntry = { key: string; at: number };

/**
 * Guards rapid duplicate sends (double-click, Enter spam, retry) within a time window.
 */
export class SendGuard {
  private inFlight = false;
  private last: FingerprintEntry | null = null;

  constructor(private readonly windowMs = 2500) {}

  tryBegin(fingerprintKey: string): boolean {
    const now = Date.now();
    if (this.inFlight) return false;
    if (this.last?.key === fingerprintKey && now - this.last.at < this.windowMs) {
      return false;
    }
    this.inFlight = true;
    this.last = { key: fingerprintKey, at: now };
    return true;
  }

  end(): void {
    this.inFlight = false;
  }

  reset(): void {
    this.inFlight = false;
    this.last = null;
  }
}

/**
 * Ensures an async action runs at most once per key until completed (topic create, generate, etc.).
 */
export class ActionOnceGuard {
  private inFlight: string | null = null;
  private completed = new Set<string>();

  isInFlight(key: string): boolean {
    return this.inFlight === key;
  }

  wasCompleted(key: string): boolean {
    return this.completed.has(key);
  }

  tryBegin(key: string, options?: { allowRetry?: boolean }): boolean {
    if (this.inFlight === key) return false;
    if (!options?.allowRetry && this.completed.has(key)) return false;
    this.inFlight = key;
    return true;
  }

  complete(key: string, remember = true): void {
    if (remember) this.completed.add(key);
    if (this.inFlight === key) this.inFlight = null;
  }

  abort(key: string): void {
    if (this.inFlight === key) this.inFlight = null;
  }

  clear(key: string): void {
    this.completed.delete(key);
    if (this.inFlight === key) this.inFlight = null;
  }
}

export function roomHasMessageId(
  messages: { id: string }[] | undefined,
  messageId: string,
): boolean {
  return Boolean(messages?.some((m) => m.id === messageId));
}
