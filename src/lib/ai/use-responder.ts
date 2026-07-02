"use client";

import { useCallback, useRef } from "react";
import { useStore } from "@/lib/demo-store";
import { sendMessageToEmployee } from "./employee-engine";
import { EmployeeResponse, MessageArtifact, SendMessageInput } from "@/lib/types";
import { nowISO, sleep } from "@/lib/utils";

function truncate(s: string, n = 40) {
  return s.length > n ? s.slice(0, n - 1) + "..." : s;
}

async function requestEmployeeResponse(
  input: SendMessageInput,
  mode: "mock" | "live",
): Promise<EmployeeResponse> {
  try {
    const response = await fetch(`/api/employees/${input.employee.id}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: input.room.id,
        content: input.message,
        mode,
      }),
    });

    if (!response.ok) throw new Error(await response.text());
    return (await response.json()) as EmployeeResponse;
  } catch (error) {
    console.warn("[AdeHQ responder] API route unavailable, using scripted engine.", error);
    return sendMessageToEmployee(input);
  }
}

/**
 * useResponder orchestrates a single AI employee reply:
 * shows a typing indicator, calls the backend route, applies side effects,
 * and attaches artifacts to the employee message.
 */
export function useResponder() {
  const { state, actions } = useStore();
  const stateRef = useRef(state);
  stateRef.current = state;

  const respond = useCallback(
    async (roomId: string, employeeId: string, message: string) => {
      const s = stateRef.current;
      const employee = s.employees.find((e) => e.id === employeeId);
      const room = s.rooms.find((r) => r.id === roomId);
      if (!employee || !room) return;

      const userId = s.user?.id ?? "user-shubham";

      actions.updateEmployee(employeeId, { status: "working", lastActiveAt: nowISO() });
      const pending = actions.addMessage(roomId, {
        senderType: "ai",
        senderId: employee.id,
        senderName: employee.name,
        content: "",
        pending: true,
      });

      await sleep(400 + Math.random() * 450);

      const input: SendMessageInput = {
        employee,
        room,
        message,
        allEmployees: s.employees,
        recentMemory: s.memory.filter((m) => m.roomId === roomId).slice(0, 6),
      };
      const resp = await requestEmployeeResponse(input, s.settings.mode);

      const artifacts: MessageArtifact[] = [];

      const createdMemory = resp.effect.memory.map((m) =>
        actions.createMemory({
          roomId,
          title: m.title ?? "Note",
          content: m.content ?? "",
          type: m.type ?? "general",
          status: m.status ?? "draft",
          createdByType: "ai",
          createdById: employeeId,
        }),
      );
      createdMemory.forEach((m) =>
        artifacts.push({ type: "memory", id: m.id, label: `Saved: ${truncate(m.title, 32)}` }),
      );

      const createdTasks = resp.effect.tasks.map((tk) =>
        actions.createTask({
          roomId,
          title: tk.title ?? "Task",
          description: tk.description,
          status: tk.status ?? "open",
          priority: tk.priority ?? "medium",
          assigneeType: tk.assigneeType ?? "ai",
          assigneeId: tk.assigneeType === "human" ? userId : employeeId,
          createdFrom: tk.createdFrom,
        }),
      );
      if (createdTasks.length) {
        artifacts.push({
          type: "task",
          id: createdTasks[0].id,
          label: `${createdTasks.length} task${createdTasks.length === 1 ? "" : "s"} created`,
        });
      }

      const createdApprovals = resp.effect.approvals.map((a) =>
        actions.createApproval({
          roomId,
          requestedBy: employeeId,
          title: a.title ?? "Approval request",
          description: a.description ?? "",
          risk: a.risk ?? "medium",
          actionType: a.actionType ?? "external_action",
        }),
      );
      createdApprovals.forEach((a) =>
        artifacts.push({ type: "approval", id: a.id, label: `Approval: ${truncate(a.title, 28)}` }),
      );

      resp.effect.workLog.forEach((w) => {
        let relatedEntityId: string | undefined;
        if (w.relatedEntityType === "task") relatedEntityId = createdTasks[0]?.id;
        else if (w.relatedEntityType === "memory") relatedEntityId = createdMemory[0]?.id;
        else if (w.relatedEntityType === "approval") relatedEntityId = createdApprovals[0]?.id;
        else if (w.relatedEntityType === "message") relatedEntityId = pending.id;
        actions.addWorkLog({
          roomId,
          employeeId,
          action: w.action ?? "Worked",
          summary: w.summary ?? "",
          toolUsed: w.toolUsed,
          status: w.status ?? "success",
          relatedEntityType: w.relatedEntityType,
          relatedEntityId,
        });
      });

      actions.updateMessage(roomId, pending.id, {
        content: resp.reply,
        artifacts: artifacts.length ? artifacts : undefined,
        pending: false,
      });

      actions.updateEmployee(employeeId, {
        status: resp.effect.statusChange ?? "online",
        currentTask: resp.effect.currentTask ?? employee.currentTask,
        messagesSent: employee.messagesSent + 1,
        memoryCount: employee.memoryCount + createdMemory.length,
        approvalsRequested: employee.approvalsRequested + createdApprovals.length,
        lastActiveAt: nowISO(),
      });
    },
    [actions],
  );

  return respond;
}
