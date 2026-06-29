export type DebugLevel = "info" | "success" | "warn" | "error";

export type DebugEntry = {
  id: string;
  at: number;
  level: DebugLevel;
  category: string;
  message: string;
  data?: unknown;
};

export const DEBUG_STORAGE_KEY = "adehq_debug_mode";
export const MAX_DEBUG_ENTRIES = 500;

export function readDebugMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DEBUG_STORAGE_KEY) === "true";
}

export function writeDebugMode(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEBUG_STORAGE_KEY, enabled ? "true" : "false");
}

export function formatDebugTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

export function serializeDebugData(data: unknown): string {
  if (data === undefined) return "";
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}
