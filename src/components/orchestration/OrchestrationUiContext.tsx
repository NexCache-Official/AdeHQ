"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { OrchestrationPlan, StoredOrchestrationRecord } from "@/lib/orchestration/types";
import {
  formatOrchestrationChipLabel,
  orchestrationRoleLabel,
  type OrchestrationPhase,
} from "@/lib/orchestration/orchestration-labels";
import { patchOrchestrationEmployeeStatus } from "@/lib/orchestration/orchestration-client";
import type { ConversationPlan } from "@/lib/types";

export type OrchestrationEmployeeStatus = {
  employeeId: string;
  employeeName: string;
  role: string;
  phase: OrchestrationPhase;
  waitingOnEmployeeName?: string;
  detail?: string;
  runId?: string;
};

export type OrchestrationUiSession = {
  orchestrationId: string | null;
  triggerMessageId: string | null;
  orchestrationPlan: OrchestrationPlan | null;
  collaborationPlan: ConversationPlan | null;
  employees: OrchestrationEmployeeStatus[];
  completed: boolean;
};

type OrchestrationUiContextValue = {
  session: OrchestrationUiSession;
  setOrchestrationFromSend: (params: {
    orchestrationId?: string | null;
    triggerMessageId: string;
    orchestrationPlan?: OrchestrationPlan | null;
    collaborationPlan?: ConversationPlan | null;
    employeeNames: Map<string, string>;
  }) => void;
  hydrateFromRecord: (
    record: StoredOrchestrationRecord,
    employeeNames: Map<string, string>,
  ) => void;
  updateEmployeePhase: (
    employeeId: string,
    phase: OrchestrationPhase,
    detail?: string,
    waitingOnEmployeeName?: string,
    runId?: string,
  ) => void;
  markEmployeeCompleted: (employeeId: string) => void;
  markSessionCompleted: () => void;
  clearSession: () => void;
  getChipForMessage: (messageId: string) => string | null;
  retryFailedRun: (employeeId: string) => Promise<void>;
  registerRetryHandler: (handler: (runId: string, employeeId: string, employeeName: string) => void) => void;
};

const EMPTY_SESSION: OrchestrationUiSession = {
  orchestrationId: null,
  triggerMessageId: null,
  orchestrationPlan: null,
  collaborationPlan: null,
  employees: [],
  completed: false,
};

const OrchestrationUiContext = createContext<OrchestrationUiContextValue | null>(null);

function recordToOrchestrationPlan(record: StoredOrchestrationRecord): OrchestrationPlan {
  return {
    intent: record.intent,
    confidence: record.confidence,
    reason: record.reason,
    selectedEmployeeIds: record.selectedEmployeeIds,
    leadEmployeeId: record.leadEmployeeId,
    collaboratorEmployeeIds: record.collaboratorEmployeeIds,
    shouldRespond: record.selectedEmployeeIds.length > 0,
    responseOrder: record.responseOrder,
    suggestedActions: [],
    workLogRequired: record.workLogRequired,
    workLogReason: record.workLogReason,
  };
}

function buildEmployeeStatuses(
  plan: OrchestrationPlan | null | undefined,
  employeeNames: Map<string, string>,
  persisted?: StoredOrchestrationRecord["employeeStatuses"],
): OrchestrationEmployeeStatus[] {
  if (!plan?.responseOrder?.length) return [];
  const panelIndexById = new Map<string, number>();
  if (plan.intent === "panel_response") {
    plan.responseOrder.forEach((r, i) => panelIndexById.set(r.employeeId, i));
  }

  const persistedById = new Map(
    (persisted ?? []).map((entry) => [entry.employeeId, entry]),
  );

  return plan.responseOrder.map((entry) => {
    const saved = persistedById.get(entry.employeeId);
    return {
      employeeId: entry.employeeId,
      employeeName: employeeNames.get(entry.employeeId) ?? "Employee",
      role: orchestrationRoleLabel(
        entry.role,
        plan.intent,
        panelIndexById.get(entry.employeeId),
      ),
      phase: (saved?.phase ?? "planned") as OrchestrationPhase,
      waitingOnEmployeeName: saved?.waitingOnEmployeeName ?? undefined,
      detail: saved?.detail ?? undefined,
      runId: saved?.runId ?? undefined,
    };
  });
}

export function OrchestrationUiProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<OrchestrationUiSession>(EMPTY_SESSION);
  const [chipLabel, setChipLabel] = useState<string | null>(null);
  const retryHandlerRef = useRef<
    ((runId: string, employeeId: string, employeeName: string) => void) | null
  >(null);

  const syncPhase = useCallback(
    (
      orchestrationId: string | null | undefined,
      employeeId: string,
      phase: OrchestrationPhase,
      detail?: string,
      waitingOnEmployeeName?: string,
      runId?: string,
    ) => {
      if (!orchestrationId) return;
      void patchOrchestrationEmployeeStatus(orchestrationId, employeeId, phase, {
        detail,
        waitingOnEmployeeName,
        runId,
      });
    },
    [],
  );

  const setOrchestrationFromSend = useCallback(
    (params: {
      orchestrationId?: string | null;
      triggerMessageId: string;
      orchestrationPlan?: OrchestrationPlan | null;
      collaborationPlan?: ConversationPlan | null;
      employeeNames: Map<string, string>;
    }) => {
      const plan = params.orchestrationPlan ?? null;
      if (!plan?.shouldRespond) {
        setSession(EMPTY_SESSION);
        setChipLabel(null);
        return;
      }

      setSession({
        orchestrationId: params.orchestrationId ?? null,
        triggerMessageId: params.triggerMessageId,
        orchestrationPlan: plan,
        collaborationPlan: params.collaborationPlan ?? null,
        employees: buildEmployeeStatuses(plan, params.employeeNames),
        completed: false,
      });
      setChipLabel(formatOrchestrationChipLabel(plan, params.employeeNames));
    },
    [],
  );

  const hydrateFromRecord = useCallback(
    (record: StoredOrchestrationRecord, employeeNames: Map<string, string>) => {
      const plan = recordToOrchestrationPlan(record);
      if (!plan.shouldRespond) return;

      const completed =
        record.status === "completed" ||
        record.status === "failed" ||
        record.employeeStatuses.every(
          (s) => s.phase === "completed" || s.phase === "failed",
        );

      setSession({
        orchestrationId: record.id,
        triggerMessageId: record.triggerMessageId,
        orchestrationPlan: plan,
        collaborationPlan: null,
        employees: buildEmployeeStatuses(plan, employeeNames, record.employeeStatuses),
        completed,
      });
      setChipLabel(formatOrchestrationChipLabel(plan, employeeNames));
    },
    [],
  );

  const updateEmployeePhase = useCallback(
    (
      employeeId: string,
      phase: OrchestrationPhase,
      detail?: string,
      waitingOnEmployeeName?: string,
      runId?: string,
    ) => {
      setSession((prev) => {
        syncPhase(
          prev.orchestrationId,
          employeeId,
          phase,
          detail,
          waitingOnEmployeeName,
          runId,
        );
        return {
          ...prev,
          employees: prev.employees.map((e) =>
            e.employeeId === employeeId
              ? { ...e, phase, detail, waitingOnEmployeeName, runId: runId ?? e.runId }
              : e,
          ),
        };
      });
    },
    [syncPhase],
  );

  const markEmployeeCompleted = useCallback(
    (employeeId: string) => {
      updateEmployeePhase(employeeId, "completed");
    },
    [updateEmployeePhase],
  );

  const markSessionCompleted = useCallback(() => {
    setSession((prev) => ({
      ...prev,
      completed: true,
      employees: prev.employees.map((e) =>
        e.phase === "failed" ? e : { ...e, phase: "completed" },
      ),
    }));
  }, []);

  const clearSession = useCallback(() => {
    setSession(EMPTY_SESSION);
    setChipLabel(null);
  }, []);

  const getChipForMessage = useCallback(
    (messageId: string) => {
      if (session.triggerMessageId !== messageId) return null;
      return chipLabel;
    },
    [chipLabel, session.triggerMessageId],
  );

  const registerRetryHandler = useCallback(
    (handler: (runId: string, employeeId: string, employeeName: string) => void) => {
      retryHandlerRef.current = handler;
    },
    [],
  );

  const retryFailedRun = useCallback(
    async (employeeId: string) => {
      const entry = session.employees.find((e) => e.employeeId === employeeId);
      if (!entry?.runId || !retryHandlerRef.current) return;
      updateEmployeePhase(employeeId, "reading", undefined, undefined, entry.runId);
      retryHandlerRef.current(entry.runId, entry.employeeId, entry.employeeName);
    },
    [session.employees, updateEmployeePhase],
  );

  const value = useMemo(
    () => ({
      session,
      setOrchestrationFromSend,
      hydrateFromRecord,
      updateEmployeePhase,
      markEmployeeCompleted,
      markSessionCompleted,
      clearSession,
      getChipForMessage,
      retryFailedRun,
      registerRetryHandler,
    }),
    [
      session,
      setOrchestrationFromSend,
      hydrateFromRecord,
      updateEmployeePhase,
      markEmployeeCompleted,
      markSessionCompleted,
      clearSession,
      getChipForMessage,
      retryFailedRun,
      registerRetryHandler,
    ],
  );

  return (
    <OrchestrationUiContext.Provider value={value}>{children}</OrchestrationUiContext.Provider>
  );
}

export function useOrchestrationUi() {
  const ctx = useContext(OrchestrationUiContext);
  if (!ctx) {
    return {
      session: EMPTY_SESSION,
      setOrchestrationFromSend: () => {},
      hydrateFromRecord: () => {},
      updateEmployeePhase: () => {},
      markEmployeeCompleted: () => {},
      markSessionCompleted: () => {},
      clearSession: () => {},
      getChipForMessage: () => null,
      retryFailedRun: async () => {},
      registerRetryHandler: () => {},
    };
  }
  return ctx;
}
