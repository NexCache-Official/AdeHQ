"use client";

import { useCallback, useRef, useState } from "react";
import { useStore } from "@/lib/demo-store";
import { MAYA_EMPLOYEE_ID, MAYA_EMPLOYEE_NAME } from "@/lib/hiring/maya";
import {
  buildMayaIntentReply,
  classifyMayaWorkforceIntent,
} from "@/lib/hiring/maya-intent-responses";
import {
  buildAdehqGuideMarkdown,
  buildImprovementPlanMarkdown,
  buildWorkforceReviewMarkdown,
  createMayaArtifactClient,
  messageArtifactFromSaved,
  type MayaArtifactKind,
} from "@/lib/hiring/maya-artifacts";
import {
  mayaHiringProposalMessage,
  mayaHiringTopicCancelledReply,
  type MayaHiringProposal,
} from "@/lib/hiring/maya-hiring-proposal";
import { proposeHiringTopic } from "@/lib/hiring/hiring-session-service";
import { getRoleByKey } from "@/lib/hiring/role-library";
import {
  createClientMessageId,
  messageSendFingerprint,
  SendGuard,
} from "@/lib/messaging/idempotency";
import type { TopicSuggestionAction } from "@/components/maya/MayaHiringTopicSuggestionCard";
import type { AIEmployee, MessageArtifact } from "@/lib/types";
import { uid } from "@/lib/utils";

export type MayaResponderPhase = "idle" | "reading" | "thinking" | "typing";

type UseMayaDmResponderOpts = {
  mayaRoomId: string;
  topicId: string;
  workspaceId?: string;
  backend?: string;
  firstName?: string;
  onCreateHiringTopic?: (proposal: MayaHiringProposal) => Promise<void>;
  onContinueHiringHere?: (proposal: MayaHiringProposal) => Promise<void>;
};

const READING_MS = 320;
const THINKING_MS = 480;
const TYPING_MS = 280;

function nonMayaEmployees(employees: AIEmployee[]): AIEmployee[] {
  return employees.filter((e) => e.id !== "emp-maya" && !e.name.toLowerCase().includes("maya"));
}

function matchEmployeeFromText(text: string, employees: AIEmployee[]): AIEmployee | undefined {
  const lower = text.toLowerCase();
  return employees.find(
    (e) =>
      lower.includes(e.name.toLowerCase()) ||
      lower.includes((e.name.split(" ")[0] ?? "").toLowerCase()),
  );
}

export function useMayaDmResponder({
  mayaRoomId,
  topicId,
  workspaceId,
  backend,
  firstName = "there",
  onCreateHiringTopic,
  onContinueHiringHere,
}: UseMayaDmResponderOpts) {
  const { state, actions } = useStore();
  const [phase, setPhase] = useState<MayaResponderPhase>("idle");
  const [pendingProposal, setPendingProposal] = useState<MayaHiringProposal | null>(null);
  const [activeProposalAction, setActiveProposalAction] = useState<TopicSuggestionAction | null>(
    null,
  );
  const [employeePickerRoster, setEmployeePickerRoster] = useState<
    Array<{ id: string; name: string; role: string }>
  >([]);
  const sendGuardRef = useRef(new SendGuard());
  const replyInFlightRef = useRef(false);

  const busy = phase !== "idle" || activeProposalAction !== null;

  const replyAsMaya = useCallback(
    (text: string, artifacts?: MessageArtifact[]) => {
      if (!topicId) return;
      actions.addMessage(mayaRoomId, {
        topicId,
        senderType: "ai",
        senderId: MAYA_EMPLOYEE_ID,
        senderName: MAYA_EMPLOYEE_NAME,
        content: text,
        artifacts,
      });
    },
    [actions, mayaRoomId, topicId],
  );

  const createArtifactForIntent = useCallback(
    async (
      kind: MayaArtifactKind,
      title: string,
      contentMarkdown: string,
      messageId: string,
    ): Promise<MessageArtifact | null> => {
      if (backend !== "supabase" || !workspaceId || !topicId) return null;
      try {
        const saved = await createMayaArtifactClient({
          workspaceId,
          roomId: mayaRoomId,
          topicId,
          kind,
          title,
          contentMarkdown,
          messageId,
        });
        return messageArtifactFromSaved(saved, kind, MAYA_EMPLOYEE_NAME);
      } catch {
        return null;
      }
    },
    [backend, mayaRoomId, topicId, workspaceId],
  );

  const runLifecycleReply = useCallback(
    async (text: string, artifacts?: MessageArtifact[]) => {
      if (replyInFlightRef.current) return;
      replyInFlightRef.current = true;
      try {
        setPhase("reading");
        await new Promise((r) => setTimeout(r, READING_MS));
        setPhase("thinking");
        await new Promise((r) => setTimeout(r, THINKING_MS));
        setPhase("typing");
        await new Promise((r) => setTimeout(r, TYPING_MS));
        replyAsMaya(text, artifacts);
      } finally {
        setPhase("idle");
        replyInFlightRef.current = false;
      }
    },
    [replyAsMaya],
  );

  const inferProposal = useCallback((text: string): MayaHiringProposal => {
    return (
      proposeHiringTopic(text) ?? {
        userText: text,
        roleTitle: getRoleByKey("custom")?.title ?? text.trim().slice(0, 48) ?? "AI Employee",
        roleKey: "custom",
      }
    );
  }, []);

  const deliverImprovementPlan = useCallback(
    async (employee: AIEmployee) => {
      setEmployeePickerRoster([]);
      const reply = `Here's a starter improvement plan for **${employee.name}**. Tell me what to change first — role scope, tone, tools, approvals, or memory.`;
      const messageId = uid("msg");
      const artifact = await createArtifactForIntent(
        "improvement_plan",
        `Improvement plan — ${employee.name}`,
        buildImprovementPlanMarkdown(employee),
        messageId,
      );
      await runLifecycleReply(reply, artifact ? [artifact] : undefined);
    },
    [createArtifactForIntent, runLifecycleReply],
  );

  const handleEmployeePick = useCallback(
    async (employeeId: string) => {
      const employee = state.employees.find((e) => e.id === employeeId);
      if (!employee || busy) return;
      await deliverImprovementPlan(employee);
    },
    [busy, deliverImprovementPlan, state.employees],
  );

  const handleUserMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      const fingerprint = messageSendFingerprint(topicId, trimmed, "human");
      if (!sendGuardRef.current.tryBegin(fingerprint)) return;

      try {
        const roster = nonMayaEmployees(state.employees);
        const roomNames = state.rooms.filter((r) => r.kind !== "dm").map((r) => r.name);

        if (employeePickerRoster.length > 0) {
          const picked = matchEmployeeFromText(trimmed, roster);
          if (picked) {
            await deliverImprovementPlan(picked);
            return;
          }
        }

        const intent = classifyMayaWorkforceIntent(trimmed);

        if (intent === "hire_employee") {
          const proposal = inferProposal(trimmed);
          setPendingProposal(proposal);
          setEmployeePickerRoster([]);
          await runLifecycleReply(mayaHiringProposalMessage(proposal.roleTitle));
          return;
        }

        if (intent === "improve_employee") {
          const picked = matchEmployeeFromText(trimmed, roster);
          if (picked) {
            setEmployeePickerRoster([]);
            await deliverImprovementPlan(picked);
            return;
          }
          if (roster.length === 0) {
            await runLifecycleReply(
              buildMayaIntentReply(intent, trimmed, { firstName, employees: state.employees, roomNames }),
            );
            return;
          }
          setEmployeePickerRoster(
            roster.slice(0, 6).map((e) => ({ id: e.id, name: e.name, role: e.role })),
          );
          await runLifecycleReply(
            `Happy to help sharpen an employee, ${firstName}. Pick someone below, or tell me their name and what to improve.`,
          );
          return;
        }

        const reply = buildMayaIntentReply(intent, trimmed, {
          firstName,
          employees: state.employees,
          roomNames,
        });

        let artifacts: MessageArtifact[] | undefined;
        const messageId = uid("msg");

        if (intent === "review_workforce" && roster.length > 0) {
          const artifact = await createArtifactForIntent(
            "workforce_review",
            "Workforce Review",
            buildWorkforceReviewMarkdown(roster, firstName),
            messageId,
          );
          if (artifact) artifacts = [artifact];
        } else if (intent === "explain_adehq") {
          const artifact = await createArtifactForIntent(
            "adehq_guide",
            "AdeHQ — How it works",
            buildAdehqGuideMarkdown(firstName),
            messageId,
          );
          if (artifact) artifacts = [artifact];
        }

        setEmployeePickerRoster([]);
        setPendingProposal(null);
        await runLifecycleReply(reply, artifacts);
      } finally {
        sendGuardRef.current.end();
      }
    },
    [
      busy,
      createArtifactForIntent,
      deliverImprovementPlan,
      employeePickerRoster.length,
      firstName,
      inferProposal,
      runLifecycleReply,
      state.employees,
      state.rooms,
      topicId,
    ],
  );

  const handleProposalAction = useCallback(
    async (action: TopicSuggestionAction) => {
      if (!pendingProposal || activeProposalAction) return;
      setActiveProposalAction(action);
      try {
        if (action === "create_topic" && onCreateHiringTopic) {
          await onCreateHiringTopic(pendingProposal);
          setPendingProposal(null);
        } else if (action === "continue_here" && onContinueHiringHere) {
          await onContinueHiringHere(pendingProposal);
          setPendingProposal(null);
        } else {
          await runLifecycleReply(mayaHiringTopicCancelledReply(firstName));
          setPendingProposal(null);
        }
      } catch {
        replyAsMaya("Something went wrong — try again or choose Continue here to hire in Direct Chat.");
      } finally {
        setActiveProposalAction(null);
      }
    },
    [
      activeProposalAction,
      firstName,
      onContinueHiringHere,
      onCreateHiringTopic,
      pendingProposal,
      replyAsMaya,
      runLifecycleReply,
    ],
  );

  const sendWithUserEcho = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy || !topicId) return;

      const fingerprint = messageSendFingerprint(topicId, trimmed, "human");
      if (!sendGuardRef.current.tryBegin(fingerprint)) return;

      const clientMessageId = createClientMessageId("maya-dm");
      actions.addMessage(mayaRoomId, {
        id: clientMessageId,
        clientMessageId,
        topicId,
        senderType: "human",
        senderId: state.user?.id ?? "user",
        senderName: state.user?.name ?? "You",
        content: trimmed,
      });

      try {
        await handleUserMessage(trimmed);
      } finally {
        sendGuardRef.current.end();
      }
    },
    [actions, busy, handleUserMessage, mayaRoomId, state.user, topicId],
  );

  return {
    phase,
    busy,
    pendingProposal,
    activeProposalAction,
    employeePickerRoster,
    handleUserMessage,
    handleProposalAction,
    handleEmployeePick,
    sendWithUserEcho,
    clearProposal: () => setPendingProposal(null),
  };
}
