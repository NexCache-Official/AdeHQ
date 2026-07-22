import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import {
  consumeRateLimit,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import { briefSchema } from "@/lib/hiring/brief-schema";
import {
  departmentLabel,
  mergeBriefPartial,
  synthesizeBriefForHiringContext,
} from "@/lib/hiring/build-brief";
import { applyChipMutation, READY_BRIEF_PHRASE, recruiterReadyMessage } from "@/lib/hiring/chip-mutations";
import { buildRecruiterOpeningMessage } from "@/lib/hiring/recruiter-openings";
import { applyRoleFocusAnswer } from "@/lib/hiring/role-focus-answers";
import {
  detectRecruiterUserIntent,
  mayaReplyForRecruiterIntent,
  mayaReplyForHiringFlowMeta,
  isBriefEditInstruction,
  isHiringFlowMetaReply,
  isInstructionShapedBriefLine,
  shouldSkipBriefMutationForMessage,
  shouldSkipBriefUpdateIntent,
} from "@/lib/hiring/recruiter-intents";
import { getRoleByKey } from "@/lib/hiring/role-library";
import {
  checklistFromBrief,
} from "@/lib/hiring/recruiter-checklist";
import {
  assessRecruiterReadiness,
  buildRecruiterTurnMessage,
  chooseNextRecruiterQuestion,
  finalizeReadinessScore,
  inferDepartmentId,
  isEngineeringBrief,
} from "@/lib/hiring/recruiter-brain";
import { generateSuggestionChips, isAssistantVoiceChip } from "@/lib/hiring/suggestion-chips";
import { resolveRecruiterSuggestionChips } from "@/lib/hiring/resolve-suggestion-chips";
import { normalizeRecruiterAnswer } from "@/lib/hiring/normalize-recruiter-answer";
import {
  generateRecruiterResponse,
  getRecruiterRuntimeDispatch,
} from "@/lib/hiring/recruiter-llm";
import { resolveHiringWorkspaceContextForAdmin } from "@/lib/server/hiring-workspace-context";
import {
  MAYA_EMPLOYEE_NAME,
  MAYA_EMPLOYEE_SYSTEM_PROMPT,
  MAYA_EMPLOYEE_TITLE,
  MAYA_HIRE_LANGUAGE_RULE,
} from "@/lib/hiring/maya";
import { isHiringSmallTalk } from "@/lib/hiring/maya-recruiter-state";
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
  workspaceId?: string | null;
  hiringSessionId?: string | null;
  topicId?: string | null;
  mayaRoomId?: string | null;
};

function normalizeBrief(raw: z.infer<typeof briefSchema>): AiEmployeeJobBrief {
  return {
    ...raw,
    technicalFocus: raw.technicalFocus ?? [],
    businessFocus: raw.businessFocus ?? [],
    personalityTraits: raw.personalityTraits ?? [],
    toolsNeeded: raw.toolsNeeded ?? [],
    assumptions: raw.assumptions ?? [],
    openQuestions: [],
  };
}

function sanitizeSuggestionChips(chips: RecruiterSuggestionChip[] = []): RecruiterSuggestionChip[] {
  const seen = new Set<string>();
  const cleaned: RecruiterSuggestionChip[] = [];

  for (const chip of chips) {
    if (chip.intent === "review_brief") continue;
    const label = normalizeRecruiterAnswer(chip.label);
    const value = normalizeRecruiterAnswer(chip.value);
    if (!label || !value) continue;
    if (isAssistantVoiceChip(label) || isAssistantVoiceChip(value)) continue;

    const key = `${chip.intent}:${label.toLowerCase()}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({
      ...chip,
      label,
      value,
      id: chip.id || `${chip.intent}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    });
  }

  return cleaned.slice(0, 5);
}

function normalizeBody(body: RecruiterBody) {
  const conversation = (body.conversation ?? body.messages ?? []).map((message) =>
    message.role === "user"
      ? { ...message, text: normalizeRecruiterAnswer(message.text) }
      : message,
  );
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

function useRecruiterLlm(
  body: RecruiterBody,
  conversation: RecruiterMessage[],
  action: string,
): boolean {
  const mode = body.mode ?? "chat";
  if (mode === "refine" || mode === "brief_refine" || mode === "regenerate") return true;
  if (action === "refine_section") return true;

  const lastUser = [...conversation].reverse().find((m) => m.role === "user")?.text ?? "";
  // Document-style brief edits must always go through the LLM rewrite path —
  // even for library roles — so Maya rewrites the artifact instead of appending
  // the instruction as a responsibility bullet.
  if (isBriefEditInstruction(lastUser)) return true;

  const roleKey = body.roleKey ?? null;
  const knownLibraryRole = Boolean(roleKey && roleKey !== "custom");
  // Popular / library roles already carry structure — keep Maya snappy with the
  // rule-based recruiter brain so intake feels like a sharp human, not a stalled bot.
  if (knownLibraryRole && mode === "chat" && action === "message") {
    return false;
  }

  const userTurns = conversation.filter((m) => m.role === "user").length;
  if (userTurns >= 1 && lastUser.trim().length > 2 && !isHiringSmallTalk(lastUser)) return true;
  if (lastUser.length > 220) return true;
  return false;
}

function openingMessage(body: RecruiterBody, departmentId: string | null, roleKey?: string | null) {
  return buildRecruiterOpeningMessage({
    roleSeed: body.roleSeed,
    roleKey,
    departmentId,
  });
}

function scrubInstructionShapedBrief(brief: AiEmployeeJobBrief): AiEmployeeJobBrief {
  return {
    ...brief,
    businessFocus: brief.businessFocus.filter((line) => !isInstructionShapedBriefLine(line)),
    coreResponsibilities: brief.coreResponsibilities.filter(
      (line) => !isInstructionShapedBriefLine(line),
    ),
    assumptions: brief.assumptions.filter((line) => !isInstructionShapedBriefLine(line)),
  };
}

function buildResponse(input: {
  body: RecruiterBody;
  brief: AiEmployeeJobBrief;
  conversation: RecruiterMessage[];
  message?: string;
  usedFallback: boolean;
  forceCanReview?: boolean;
  suggestionChips?: RecruiterSuggestionChip[];
}) {
  const lastUser = [...input.conversation].reverse().find((m) => m.role === "user")?.text ?? "";
  const userIntent = detectRecruiterUserIntent(lastUser);
  const skipBriefMutation = shouldSkipBriefMutationForMessage(lastUser);
  const cleanedInputBrief = scrubInstructionShapedBrief(input.brief);
  const chipMutation =
    !skipBriefMutation && lastUser ? applyChipMutation(lastUser, cleanedInputBrief) : null;
  let brief = { ...(chipMutation?.brief ?? cleanedInputBrief), openQuestions: [] };
  const roleKey = input.body.roleKey ?? null;
  const roleFocus =
    !skipBriefMutation && lastUser ? applyRoleFocusAnswer(lastUser, brief, roleKey) : null;
  if (roleFocus) {
    brief = { ...roleFocus.brief, openQuestions: [] };
  }
  const changedFields = [...(chipMutation?.changedFields ?? []), ...(roleFocus ? ["businessFocus"] : [])];

  const baseReadiness = assessRecruiterReadiness(input.conversation, brief, roleKey);
  const explicitReviewIntent =
    userIntent === "approve_brief" ||
    userIntent === "generate_candidates" ||
    userIntent === "review_brief";
  let canReviewBrief = input.forceCanReview || baseReadiness.ready || explicitReviewIntent;
  let readiness = finalizeReadinessScore(baseReadiness, brief, canReviewBrief);
  const userTurns = input.conversation.filter((m) => m.role === "user").length;
  const departmentId = input.body.selectedDepartment ?? input.body.departmentId ?? null;
  const lastAde = [...input.conversation].reverse().find((m) => m.role === "ade")?.text ?? "";

  let message = input.message;
  if (userIntent !== "gathering") {
    const intentReply = mayaReplyForRecruiterIntent(userIntent);
    if (intentReply) message = intentReply;
  } else if (isHiringFlowMetaReply(lastUser)) {
    message = mayaReplyForHiringFlowMeta(lastUser) ?? message;
  } else if (!message && chipMutation) {
    message = chipMutation.message;
  } else if (!message) {
    if (userTurns === 0) {
      message = openingMessage(input.body, departmentId, roleKey);
    } else if (canReviewBrief && lastAde.includes(READY_BRIEF_PHRASE)) {
      message =
        "That's already reflected in the brief. Want me to generate candidates or adjust another part?";
    } else if (canReviewBrief) {
      message = recruiterReadyMessage(brief);
    } else {
      message = buildRecruiterTurnMessage(readiness, input.conversation, brief, roleKey);
    }
  }

  // Keep Review available once the brief is actually ready — Maya often ends
  // with a soft follow-up question ("Want me to tweak anything?") which used
  // to hide the CTA even when core fields were complete.
  const messageStillAsksQuestion = /\?\s*$/.test(message ?? "");
  if (
    messageStillAsksQuestion &&
    !input.forceCanReview &&
    !explicitReviewIntent &&
    !baseReadiness.ready
  ) {
    canReviewBrief = false;
    readiness = finalizeReadinessScore(baseReadiness, brief, false);
  }

  const checklist = checklistFromBrief(brief, input.body.roleSeed, input.conversation);
  const suggestionChips =
    sanitizeSuggestionChips(input.suggestionChips).length >= 2
      ? sanitizeSuggestionChips(input.suggestionChips)
      : canReviewBrief
        ? sanitizeSuggestionChips(
            generateSuggestionChips(readiness, brief, input.conversation, roleKey, true),
          )
        : sanitizeSuggestionChips(input.suggestionChips);

  return {
    recruiterMessage: message,
    message,
    brief,
    briefPartial: brief,
    readiness,
    suggestionChips,
    canReviewBrief,
    briefReady: canReviewBrief,
    chips: suggestionChips.map((chip) => chip.label),
    checklist,
    usedFallback: input.usedFallback,
    roleKey,
    changedFields,
  };
}

async function finalizeRecruiterResponse(
  response: ReturnType<typeof buildResponse>,
  input: {
    conversation: RecruiterMessage[];
    roleKey?: string | null;
    lastUser?: string;
  },
) {
  const preferredChips = sanitizeSuggestionChips(response.suggestionChips);
  if (preferredChips.length >= 2) {
    return {
      ...response,
      suggestionChips: preferredChips,
      chips: preferredChips.map((chip) => chip.label),
    };
  }

  const lastUser =
    input.lastUser ??
    [...input.conversation].reverse().find((message) => message.role === "user")?.text ??
    "";
  const suggestionChips = sanitizeSuggestionChips(await resolveRecruiterSuggestionChips({
    readiness: response.readiness,
    brief: response.brief,
    conversation: input.conversation,
    roleKey: input.roleKey ?? response.roleKey,
    lastAdeMessage: response.message ?? "",
    lastUserMessage: lastUser,
    canReviewBrief: response.canReviewBrief,
  }));

  return {
    ...response,
    suggestionChips,
    chips: suggestionChips.map((chip) => chip.label),
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
  return `You are ${MAYA_EMPLOYEE_NAME}, ${MAYA_EMPLOYEE_TITLE} at AdeHQ — a sharp, warm recruiter who talks like a real hiring partner, not a survey bot.

${MAYA_EMPLOYEE_SYSTEM_PROMPT.trim()}

Role seed: "${body.roleSeed || "unspecified"}"
Department: ${departmentLabel(departmentId)}
${roleBlock}

RULES:
1. Sound like a colleague in chat — short sentences, natural rhythm, no corporate filler.
2. Always acknowledge what the user just said before asking anything new.
3. NEVER repeat a question the user already answered. Move the conversation forward.
4. Extract semantics from ALL user messages — NEVER map answers by question order.
5. Ask at most ONE useful question per turn.
6. Keep responses concise. Use bullets only when recommending options. Markdown bold is okay for option names.
7. If enough information exists, say the brief is ready but keep the user free to refine.
8. Always include an updated semantic brief or partial brief that reflects the exact role the user is hiring for — sales, legal, marketing, research, support, finance, design, operations, or any custom role.
9. Mission should be stable after it captures the role. Update responsibilities, focus, tools, and metrics for later details instead of rewriting mission every turn.
10. Never include openQuestions in the brief. Set openQuestions to [].
11. Always include 2–4 suggestionChips that directly answer your latest question. If your message asks a question, do not include a review_brief chip.
12. Never ask about channels, rooms, or start location.
13. ${MAYA_HIRE_LANGUAGE_RULE}
14. NEVER paste the user's exact words into responsibilities or business focus. Interpret intent. Flow-control replies ("okay", "move on", "looks good") mean proceed — do not add them to the brief.
15. The job brief is a living document/artifact. When the user asks to improve, rewrite, deepen, or make it more skilled/complex/analytical, EDIT the existing brief like ChatGPT editing a doc: rewrite mission, responsibilities, business focus, metrics, and approval rules to match the request. Do NOT add the instruction itself as a bullet (never "Own make it more skilled…").
16. When rewriting, remove any prior bullets that look like raw chat instructions pasted into the brief, then replace them with professional role content.

Mode: ${body.mode ?? "chat"}
${body.refineInstruction ? `Refine (${body.refineMode ?? "improve"}) section ${body.refineSection}: ${body.refineInstruction}` : ""}

Respond ONLY as JSON matching the schema.`;
}

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as RecruiterBody;

    // Gate every recruiter turn — including deterministic paths without LLM.
    const hiringContext = await resolveHiringWorkspaceContextForAdmin(client, user.id, {
      workspaceId: body.workspaceId,
      hiringSessionId: body.hiringSessionId,
      topicId: body.topicId,
      mayaRoomId: body.mayaRoomId,
    });

    const mayaHiringLimit = await consumeRateLimit(createSupabaseSecretClient(), {
      bucket: "maya.hiring.user",
      key: `${hiringContext.workspaceId}:${user.id}`,
      limit: 30,
      windowMs: 60 * 60_000,
    });
    if (!mayaHiringLimit.allowed) {
      console.warn("[AdeHQ maya] hiring rate limited", {
        workspaceId: hiringContext.workspaceId,
        userId: user.id,
      });
      return rateLimitResponse(
        mayaHiringLimit,
        "Maya needs a short break from hiring chat — try again in a little while.",
      );
    }

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

    const instruction = [...conversation].reverse().find((m) => m.role === "user")?.text ?? "";
    const refinedBrief =
      body.currentBrief && (body.mode === "brief_refine" || action === "refine_section")
        ? applyInstructionToBrief(baseBrief, instruction)
        : baseBrief;

    if (!useRecruiterLlm(body, conversation, action)) {
      return NextResponse.json(
        await finalizeRecruiterResponse(
          buildResponse({
            body,
            brief: refinedBrief,
            conversation,
            message:
              action === "draft_now"
                ? "I have enough to draft a strong job brief. You can review it now, or keep refining the role."
                : undefined,
            usedFallback: true,
            forceCanReview: action === "draft_now",
          }),
          { conversation, roleKey },
        ),
      );
    }

    if (!isSiliconFlowConfigured() && getRecruiterRuntimeDispatch() === "old") {
      const brief = refinedBrief;
      return NextResponse.json(
        await finalizeRecruiterResponse(
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
          { conversation, roleKey },
        ),
      );
    }

    const history = conversation
      .map((m) => `${m.role === "ade" ? "Ade" : "User"}: ${m.text}`)
      .join("\n");
    const lastUserForPrompt =
      [...conversation].reverse().find((m) => m.role === "user")?.text ?? "";
    const briefEdit = isBriefEditInstruction(lastUserForPrompt);
    const llmPrompt = [
      `Conversation:\n${history || "(starting)"}`,
      body.currentBrief
        ? `Current brief (edit this artifact in place; return the full updated brief):\n${JSON.stringify({ ...body.currentBrief, openQuestions: [] })}`
        : "",
      briefEdit
        ? `BRIEF EDIT REQUEST: "${lastUserForPrompt}"
Treat the current brief as a document. Rewrite the relevant sections so the role is stronger and matches this request. Keep professional hiring language. Never copy the edit request into responsibilities or business focus.`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const hiringContext = await resolveHiringWorkspaceContextForAdmin(client, user.id, {
        workspaceId: body.workspaceId,
        hiringSessionId: body.hiringSessionId,
        topicId: body.topicId,
        mayaRoomId: body.mayaRoomId,
      });

      const object = await generateRecruiterResponse(
        {
          body,
          conversation,
          system: systemPrompt(body),
          prompt: llmPrompt,
        },
        {
          client,
          userId: user.id,
          workspaceId: hiringContext.workspaceId,
          hiringSessionId: hiringContext.hiringSessionId,
        },
      );

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
        await finalizeRecruiterResponse(
          buildResponse({
            body,
            brief,
            conversation,
            message: object.message,
            usedFallback: false,
            forceCanReview: action === "draft_now",
            suggestionChips: object.suggestionChips,
          }),
          { conversation, roleKey },
        ),
      );
    } catch (err) {
      console.error("[hiring/recruiter] LLM failed, using rule-based fallback", err);
      const failedEdit = isBriefEditInstruction(lastUserForPrompt);
      return NextResponse.json(
        await finalizeRecruiterResponse(
          buildResponse({
            body,
            brief: baseBrief,
            conversation,
            message: failedEdit
              ? "I couldn't reshape the brief just now. Try that edit again, or tell me which section to deepen — mission, analysis rigor, or success metrics."
              : undefined,
            usedFallback: true,
          }),
          { conversation, roleKey },
        ),
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
