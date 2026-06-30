import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { siliconFlowChatModel, siliconFlowProviderOptions } from "@/lib/ai/siliconflow-client";
import { resolveModel } from "@/lib/ai/model-catalog";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import { briefSchema, recruiterResponseSchema } from "@/lib/hiring/brief-schema";
import {
  departmentLabel,
  mergeBriefPartial,
  synthesizeBriefForHiringContext,
} from "@/lib/hiring/build-brief";
import { getRoleByKey } from "@/lib/hiring/role-library";
import {
  checklistFromBrief,
} from "@/lib/hiring/recruiter-checklist";
import {
  assessRecruiterReadiness,
  chooseNextRecruiterQuestion,
  finalizeReadinessScore,
  generateSuggestionChips,
  inferDepartmentId,
  isEngineeringBrief,
} from "@/lib/hiring/recruiter-brain";
import {
  MAYA_EMPLOYEE_NAME,
  MAYA_EMPLOYEE_SYSTEM_PROMPT,
  MAYA_EMPLOYEE_TITLE,
} from "@/lib/hiring/maya";
import type {
  AiEmployeeJobBrief,
  RecruiterMessage,
  RecruiterReadiness,
  RecruiterSuggestionChip,
  RefineMode,
} from "@/lib/hiring/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RecruiterBody = {
  conversation?: RecruiterMessage[];
  selectedDepartment?: string | null;
  userMessage?: string;
  action?: "message" | "draft_now" | "refine_section";
  roleSeed: string;
  departmentId?: string | null;
  roleKey?: string | null;
  departmentGroupId?: string | null;
  discoveryMode?: boolean;
  customRoleTitle?: string | null;
  messages: RecruiterMessage[];
  currentBrief?: AiEmployeeJobBrief;
  mode?: "chat" | "regenerate" | "refine" | "draft_now" | "brief_refine";
  refineInstruction?: string;
  refineMode?: RefineMode;
  refineSection?: string;
};

function normalizeBrief(raw: z.infer<typeof briefSchema>): AiEmployeeJobBrief {
  return {
    ...raw,
    technicalFocus: raw.technicalFocus ?? [],
    businessFocus: raw.businessFocus ?? [],
    personalityTraits: raw.personalityTraits ?? [],
    toolsNeeded: raw.toolsNeeded ?? [],
    assumptions: raw.assumptions ?? [],
    openQuestions: raw.openQuestions ?? [],
  };
}

function normalizeBody(body: RecruiterBody) {
  const conversation = body.conversation ?? body.messages ?? [];
  const departmentId = body.selectedDepartment ?? body.departmentId ?? null;
  const roleKey = body.roleKey ?? null;
  const action = body.action ?? (body.mode === "draft_now" ? "draft_now" : "message");
  return { conversation, departmentId, roleKey, action };
}

function applyInstructionToBrief(brief: AiEmployeeJobBrief, instruction: string): AiEmployeeJobBrief {
  const lower = instruction.toLowerCase();
  let next = { ...brief };

  if (lower.includes("senior") || lower.includes("advisor")) {
    next = {
      ...next,
      seniorityLevel: lower.includes("advisor") ? "advisor" : "manager",
      autonomyLevel: "high",
      assumptions: [
        ...new Set([
          ...next.assumptions,
          "The user wants this employee to operate with more senior judgment.",
        ]),
      ],
    };
  }
  if (lower.includes("hands-on") || lower.includes("implementation")) {
    next = {
      ...next,
      autonomyLevel: next.autonomyLevel === "low" ? "balanced" : next.autonomyLevel,
      coreResponsibilities: [
        ...new Set([
          ...next.coreResponsibilities,
          "Work hands-on to turn ideas into clear implementation tasks",
        ]),
      ],
    };
  }
  if (lower.includes("tool")) {
    next = {
      ...next,
      toolsNeeded: [...new Set([...next.toolsNeeded, "Project docs", "Issue tracker", "Relevant workspace tools"])],
    };
  }
  if (lower.includes("approval") || lower.includes("risk")) {
    next = {
      ...next,
      approvalRules: [
        ...new Set([...next.approvalRules, "Ask for approval before high-risk or external-facing actions"]),
      ],
    };
  }

  return next;
}

function recruiterMessageFor(
  readiness: RecruiterReadiness,
  conversation: RecruiterMessage[],
  currentBrief: AiEmployeeJobBrief,
  roleKey?: string | null,
) {
  const lastUser = [...conversation].reverse().find((m) => m.role === "user")?.text.toLowerCase() ?? "";
  if (lastUser.includes("don't know") || lastUser.includes("not sure") || lastUser.includes("help me decide")) {
    const role = getRoleByKey(roleKey ?? undefined);
    if (role?.questionTemplates.coreWorkChips.length) {
      return `No problem. For ${role.title} roles, common starting points are ${role.questionTemplates.coreWorkChips.slice(0, 4).join(", ").toLowerCase()}. Which feels closest?`;
    }
    const deptId = inferDepartmentId(currentBrief);
    if (deptId === "pr") {
      return "No problem. For PR roles, common starting points are press releases, media pitching, internal comms, or crisis response. Which feels closest to what you need?";
    }
    if (deptId === "marketing") {
      return "No problem. For marketing hires, teams often start with content, campaigns, social, or SEO. Which direction fits best?";
    }
    if (deptId === "sales") {
      return "No problem. For sales support, people usually start with lead qualification, outbound outreach, proposals, or pipeline follow-ups. Which sounds right?";
    }
    if (isEngineeringBrief(currentBrief)) {
      return "No problem. For engineering roles, common directions are frontend product work, backend systems, AI infrastructure, or data workflows. Which feels closest?";
    }
    return "No problem. Tell me whether you want someone more strategic, more execution-focused, or a mix — and I'll shape the brief from there.";
  }
  return chooseNextRecruiterQuestion(readiness, currentBrief, roleKey);
}

function openingMessage(body: RecruiterBody, departmentId: string | null, roleKey?: string | null) {
  const role = getRoleByKey(roleKey ?? undefined);
  if (role) {
    return `Great — let's hire a ${role.title}. ${role.questionTemplates.coreWork}`;
  }
  const roleSeed = body.roleSeed?.trim() ?? "";
  const dept = departmentLabel(departmentId);
  if (roleSeed && roleSeed.split(/\s+/).length >= 3) {
    const brief = synthesizeBriefForHiringContext({ roleSeed, departmentId, roleKey });
    return `Got it — I'll treat this as a ${brief.roleTitle} role. What kind of work should this employee focus on day to day?`;
  }
  if (departmentId && departmentId !== "custom") {
    return `Hi — I'm ${MAYA_EMPLOYEE_NAME}, your ${MAYA_EMPLOYEE_TITLE.toLowerCase()}. For ${dept}, what kind of employee do you want to hire, and what should they own first?`;
  }
  return "What kind of employee do you want to hire, and what should they help with first?";
}

function buildResponse(input: {
  body: RecruiterBody;
  brief: AiEmployeeJobBrief;
  conversation: RecruiterMessage[];
  message?: string;
  usedFallback: boolean;
  forceCanReview?: boolean;
}) {
  const baseReadiness = assessRecruiterReadiness(input.conversation, input.brief);
  const canReviewBrief = input.forceCanReview || baseReadiness.ready;
  const readiness = finalizeReadinessScore(baseReadiness, input.brief, canReviewBrief);
  const roleKey = input.body.roleKey ?? null;
  let suggestionChips = generateSuggestionChips(readiness, input.brief, input.conversation, roleKey);
  if (canReviewBrief && !suggestionChips.some((chip) => chip.intent === "review_brief")) {
    suggestionChips = [
      {
        id: "review-brief",
        label: "Review job brief",
        value: "Review job brief",
        intent: "review_brief",
      },
      ...suggestionChips,
    ];
  }
  const userTurns = input.conversation.filter((m) => m.role === "user").length;
  const departmentId = input.body.selectedDepartment ?? input.body.departmentId ?? null;
  const message =
    input.message ??
    (userTurns === 0
      ? openingMessage(input.body, departmentId, roleKey)
      : canReviewBrief
        ? "I have enough to draft a strong job brief. You can review it now, or keep refining the role."
        : recruiterMessageFor(readiness, input.conversation, input.brief, roleKey));
  const checklist = checklistFromBrief(input.brief, input.body.roleSeed, input.conversation);

  return {
    recruiterMessage: message,
    message,
    brief: input.brief,
    briefPartial: input.brief,
    readiness,
    suggestionChips,
    canReviewBrief,
    briefReady: canReviewBrief,
    chips: suggestionChips.map((chip) => chip.label),
    checklist,
    usedFallback: input.usedFallback,
    roleKey,
  };
}

function systemPrompt(body: RecruiterBody) {
  const departmentId = body.selectedDepartment ?? body.departmentId ?? null;
  const role = getRoleByKey(body.roleKey ?? undefined);
  const roleBlock = role
    ? `Selected role: ${role.title} (${role.roleKey})
Department group: ${role.departmentLabel}
Default responsibilities: ${role.defaultResponsibilities.slice(0, 4).join("; ")}
Ask role-specific follow-ups. Do not ask generic department questions.`
    : "";
  return `You are ${MAYA_EMPLOYEE_NAME}, ${MAYA_EMPLOYEE_TITLE} at AdeHQ — a sharp, warm recruiter helping hire and improve AI employees.

${MAYA_EMPLOYEE_SYSTEM_PROMPT.trim()}

Role seed: "${body.roleSeed || "unspecified"}"
Department: ${departmentLabel(departmentId)}
${roleBlock}

RULES:
1. Do not behave like a form or a fixed wizard.
2. Extract semantics from ALL user messages — NEVER map answers by question order.
3. Infer professional role titles. Do not use raw phrases like "write code, build, and ship" as a title.
4. Technical topics (latency, bandwidth, performance) → technicalFocus and successMetrics — NEVER communicationStyle or proactivityLevel.
5. Ask at most ONE useful question per turn.
6. If enough information exists, say the brief is ready but keep the user free to refine.
7. Always include an updated semantic brief or partial brief.
8. Include assumptions and openQuestions while confidence is low.
9. Never ask about channels, rooms, or start location.

Mode: ${body.mode ?? "chat"}
${body.refineInstruction ? `Refine (${body.refineMode ?? "improve"}) section ${body.refineSection}: ${body.refineInstruction}` : ""}

Respond ONLY as JSON matching the schema.`;
}

export async function POST(request: NextRequest) {
  try {
    await requireAuthUser(request);
    const body = (await request.json()) as RecruiterBody;

    const { conversation, departmentId, roleKey, action } = normalizeBody(body);

    if (!body.roleSeed?.trim() && !departmentId && !roleKey) {
      return NextResponse.json({ error: "roleSeed, roleKey, or departmentId required." }, { status: 400 });
    }

    const baseBrief = synthesizeBriefForHiringContext({
      roleSeed: body.roleSeed,
      messages: conversation,
      departmentId,
      roleKey,
      existing: body.currentBrief,
    });

    if (!isSiliconFlowConfigured()) {
      const instruction = [...conversation].reverse().find((m) => m.role === "user")?.text ?? "";
      const brief = body.currentBrief && (body.mode === "brief_refine" || action === "refine_section")
        ? applyInstructionToBrief(baseBrief, instruction)
        : baseBrief;
      return NextResponse.json(
        buildResponse({
          body,
          brief,
          conversation,
          message:
            action === "draft_now"
              ? "I have enough to draft a strong job brief. You can review it now, or keep refining the role."
              : undefined,
          usedFallback: true,
          forceCanReview: action === "draft_now",
        }),
      );
    }

    const modelId = resolveModel("siliconflow", "balanced");
    const model = siliconFlowChatModel(modelId);
    const history = conversation
      .map((m) => `${m.role === "ade" ? "Ade" : "User"}: ${m.text}`)
      .join("\n");

    try {
      const { object } = await generateObject({
        model,
        schema: recruiterResponseSchema,
        system: systemPrompt(body),
        prompt: [
          `Conversation:\n${history || "(starting)"}`,
          body.currentBrief ? `Current brief:\n${JSON.stringify(body.currentBrief)}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        maxOutputTokens: 2200,
        providerOptions: siliconFlowProviderOptions(modelId),
      });

      let brief = object.brief ? normalizeBrief(object.brief) : undefined;
      const briefPartial = object.briefPartial
        ? mergeBriefPartial(
            baseBrief,
            object.briefPartial,
          )
        : brief;

      brief = brief ?? briefPartial ?? baseBrief;
      if (body.currentBrief && (body.mode === "brief_refine" || action === "refine_section")) {
        const instruction = [...conversation].reverse().find((m) => m.role === "user")?.text ?? "";
        brief = applyInstructionToBrief(brief, instruction);
      }

      return NextResponse.json(
        buildResponse({
          body,
          brief,
          conversation,
          message: object.message,
          usedFallback: false,
          forceCanReview: action === "draft_now",
        }),
      );
    } catch {
      return NextResponse.json(
        buildResponse({
          body,
          brief: baseBrief,
          conversation,
          usedFallback: true,
        }),
      );
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[hiring/recruiter]", err);
    return NextResponse.json({ error: "Recruiter request failed." }, { status: 500 });
  }
}
