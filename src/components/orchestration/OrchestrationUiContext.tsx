"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { OrchestrationPlan } from "@/lib/orchestration/types";
import {
  formatOrchestrationChipLabel,
  orchestrationRoleLabel,
  type OrchestrationPhase,
} from "@/lib/orchestration/orchestration-labels";
import type { ConversationPlan } from "@/lib/types";

export type OrchestrationEmployeeStatus = {
  employeeId: string;
  employeeName: string;
  role: string;
  phase: OrchestrationPhase;
  waitingOnEmployeeName?: string;
  detail?: string;
};

export type OrchestrationUiSession = {
  triggerMessageId: string | null;
  orchestrationPlan: OrchestrationPlan | null;
  collaborationPlan: ConversationPlan | null;
  employees: OrchestrationEmployeeStatus[];
  completed: boolean;
};

type OrchestrationUiContextValue = {
  session: OrchestrationUiSession;
  setOrchestrationFromSend: (params: {
    triggerMessageId: string;
    orchestrationPlan?: OrchestrationPlan | null;
    collaborationPlan?: ConversationPlan | null;
    employeeNames: Map<string, string>;
  }) => void;
  updateEmployeePhase: (
    employeeId: string,
    phase: OrchestrationPhase,
    detail?: string,
  ) => void;
  markEmployeeCompleted: (employeeId: string) => void;
  markSessionCompleted: () => void;
  clearSession: () => void;
  getChipForMessage: (messageId: string) => string | null;
};

const EMPTY_SESSION: OrchestrationUiSession = {
  triggerMessageId: null,
  orchestrationPlan: null,
  collaborationPlan: null,
  employees: [],
  completed: false,
};

const OrchestrationUiContext = createContext<OrchestrationUiContextValue | null>(null);

function buildEmployeeStatuses(
  plan: OrchestrationPlan | null | undefined,
  employeeNames: Map<string, string>,
): OrchestrationEmployeeStatus[] {
  if (!plan?.responseOrder?.length) return [];
  const panelIndexById = new Map<string, number>();
  if (plan.intent === "panel_response") {
    plan.responseOrder.forEach((r, i) => panelIndexById.set(r.employeeId, i));
  }

  return plan.responseOrder.map((entry) => ({
    employeeId: entry.employeeId,
    employeeName: employeeNames.get(entry.employeeId) ?? "Employee",
    role: orchestrationRoleLabel(
      entry.role,
      plan.intent,
      panelIndexById.get(entry.employeeId),
    ),
    phase: "planned" as const,
  }));
}

export function OrchestrationUiProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<OrchestrationUiSession>(EMPTY_SESSION);
  const [chipLabel, setChipLabel] = useState<string | null>(null);

  const setOrchestrationFromSend = useCallback(
    (params: {
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

  const updateEmployeePhase = useCallback(
    (employeeId: string, phase: OrchestrationPhase, detail?: string) => {
      setSession((prev) => ({
        ...prev,
        employees: prev.employees.map((e) =>
          e.employeeId === employeeId ? { ...e, phase, detail } : e,
        ),
      }));
    },
    [],
  );

  const markEmployeeCompleted = useCallback((employeeId: string) => {
    setSession((prev) => ({
      ...prev,
      employees: prev.employees.map((e) =>
        e.employeeId === employeeId ? { ...e, phase: "completed" } : e,
      ),
    }));
  }, []);

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

  const value = useMemo(
    () => ({
      session,
      setOrchestrationFromSend,
      updateEmployeePhase,
      markEmployeeCompleted,
      markSessionCompleted,
      clearSession,
      getChipForMessage,
    }),
    [
      session,
      setOrchestrationFromSend,
      updateEmployeePhase,
      markEmployeeCompleted,
      markSessionCompleted,
      clearSession,
      getChipForMessage,
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
      updateEmployeePhase: () => {},
      markEmployeeCompleted: () => {},
      markSessionCompleted: () => {},
      clearSession: () => {},
      getChipForMessage: () => null,
    };
  }
  return ctx;
}
