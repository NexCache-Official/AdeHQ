"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEBUG_STORAGE_KEY,
  MAX_DEBUG_ENTRIES,
  readDebugMode,
  type DebugEntry,
  type DebugLevel,
  writeDebugMode,
} from "@/lib/debug-trace";

type DebugContextValue = {
  enabled: boolean;
  panelOpen: boolean;
  entries: DebugEntry[];
  setEnabled: (on: boolean) => void;
  toggleEnabled: () => void;
  setPanelOpen: (open: boolean) => void;
  trace: (category: string, level: DebugLevel, message: string, data?: unknown) => void;
  clear: () => void;
};

const DebugContext = createContext<DebugContextValue | null>(null);

function newEntry(
  category: string,
  level: DebugLevel,
  message: string,
  data?: unknown,
): DebugEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    level,
    category,
    message,
    data,
  };
}

export function DebugProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [entries, setEntries] = useState<DebugEntry[]>([]);

  useEffect(() => {
    const on = readDebugMode();
    setEnabledState(on);
    setPanelOpen(on);
  }, []);

  const trace = useCallback(
    (category: string, level: DebugLevel, message: string, data?: unknown) => {
      if (!readDebugMode()) return;
      const entry = newEntry(category, level, message, data);
      setEntries((prev) => [...prev.slice(-(MAX_DEBUG_ENTRIES - 1)), entry]);
    },
    [],
  );

  const setEnabled = useCallback(
    (on: boolean) => {
      writeDebugMode(on);
      setEnabledState(on);
      setPanelOpen(on);
      if (on) {
        setEntries((prev) => [
          ...prev.slice(-(MAX_DEBUG_ENTRIES - 1)),
          newEntry("system", "info", "Debug mode enabled — tracing client + API flows"),
        ]);
      } else {
        setEntries([]);
      }
    },
    [],
  );

  const toggleEnabled = useCallback(() => {
    setEnabled(!readDebugMode());
  }, [setEnabled]);

  const clear = useCallback(() => setEntries([]), []);

  const value = useMemo<DebugContextValue>(
    () => ({
      enabled,
      panelOpen,
      entries,
      setEnabled,
      toggleEnabled,
      setPanelOpen,
      trace,
      clear,
    }),
    [enabled, panelOpen, entries, setEnabled, toggleEnabled, trace, clear],
  );

  return <DebugContext.Provider value={value}>{children}</DebugContext.Provider>;
}

export function useDebugTrace() {
  const ctx = useContext(DebugContext);
  if (!ctx) {
    return {
      enabled: false,
      panelOpen: false,
      entries: [] as DebugEntry[],
      setEnabled: () => {},
      toggleEnabled: () => {},
      setPanelOpen: () => {},
      trace: () => {},
      clear: () => {},
    };
  }
  return ctx;
}

/** Safe trace that works even outside provider (no-op). */
export function traceDebug(
  category: string,
  level: DebugLevel,
  message: string,
  data?: unknown,
) {
  if (typeof window === "undefined" || !readDebugMode()) return;
  window.dispatchEvent(
    new CustomEvent("adehq-debug-trace", {
      detail: { category, level, message, data },
    }),
  );
}

export function useDebugTraceListener() {
  const { trace } = useDebugTrace();
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        category: string;
        level: DebugLevel;
        message: string;
        data?: unknown;
      };
      trace(detail.category, detail.level, detail.message, detail.data);
    };
    window.addEventListener("adehq-debug-trace", handler);
    return () => window.removeEventListener("adehq-debug-trace", handler);
  }, [trace]);
}
