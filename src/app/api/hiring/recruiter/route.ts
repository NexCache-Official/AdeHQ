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
  synthesizeBriefFromConversation,
} from "@/lib/hiring/build-brief";
import {
  DEFAULT_CHIPS,
  checklistFromBrief,
  countUserTurns,
  shouldAutoBriefReady,
  shouldOfferDraftNow,
} from "@/lib/hiring/recruiter-checklist";
import type { AiEmployeeJobBrief, RecruiterMessage, RefineMode } from "@/lib/hiring/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RecruiterBody = {
  roleSeed: string;
  departmentId?: string | null;
  messages: RecruiterMessage[];
  currentBrief?: AiEmployeeJobBrief;
  mode?: "chat" | "regenerate" | "refine" | "draft_now";
  refineInstruction?: string;
  refineMode?: RefineMode;
  refineSection?: string;
};

const SCRIPTED_QUESTIONS = [
  {
    ade: "What role do you need — and what domain or industry should they understand?",
    chips: ["Enterprise AI", "SaaS & tech", "Finance & fintech", "Consumer & retail"],
  },
  {
    ade: "What should they focus on day to day? Be specific about the core work.",
    chips: ["Performance optimization", "Media outreach", "Product launches", "Investor relations"],
  },
  {
    ade: "How should they work — speed vs quality, and how proactive should they be?",
    chips: ["Balanced & proactive", "Quality-first", "Fast execution", "Wait for direction"],
  },
] as const;

function normalizeBrief(raw: z.infer<typeof briefSchema>): AiEmployeeJobBrief {
  return {
    ...raw,
    technicalFocus: raw.technicalFocus ?? [],
    businessFocus: raw.businessFocus ?? [],
    personalityTraits: raw.personalityTraits ?? [],
    toolsNeeded: raw.toolsNeeded ?? [],
  };
}

function buildChips(
  messages: RecruiterMessage[],
  roleSeed: string,
  checklist: ReturnType<typeof checklistFromBrief>,
  briefReady: boolean,
  extra: string[] = [],
): string[] {
  if (briefReady) return [DEFAULT_CHIPS.reviewBrief];
  const chips = [...extra];
  if (shouldOfferDraftNow(messages, roleSeed, checklist)) {
    chips.unshift(DEFAULT_CHIPS.draftNow);
  }
  if (countUserTurns(messages) >= 1) {
    chips.push(DEFAULT_CHIPS.refineMore);
  }
  return [...new Set(chips)].slice(0, 6);
}

function scriptedResponse(body: RecruiterBody) {
  const { roleSeed, departmentId, messages } = body;
  const userTurns = countUserTurns(messages);
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.text ?? "";

  if (body.mode === "draft_now" || body.mode === "regenerate") {
    const brief = synthesizeBriefFromConversation(
      roleSeed,
      messages,
      departmentId,
      body.currentBrief,
    );
    const checklist = checklistFromBrief(brief, roleSeed);
    return {
      message:
        "I have enough to draft a strong brief. Review it now, or refine personality and tools if you'd like.",
      chips: buildChips(messages, roleSeed, checklist, true),
      briefReady: true,
      brief,
      briefPartial: brief,
      checklist,
      usedFallback: true,
    };
  }

  if (body.mode === "refine" && body.currentBrief) {
    let brief = { ...body.currentBrief };
    const section = body.refineSection ?? "mission";
    const instruction = body.refineInstruction?.trim() ?? "";

    if (body.refineMode === "improve" && instruction) {
      if (section === "mission") {
        brief = { ...brief, mission: `${brief.mission} (Refined: ${instruction})` };
      } else if (section === "coreResponsibilities") {
        brief = {
          ...brief,
          coreResponsibilities: brief.coreResponsibilities.map((r) =>
            r.includes(instruction) ? r : `${r}`,
          ),
        };
      }
    } else {
      brief = synthesizeBriefFromConversation(roleSeed, messages, departmentId, brief);
    }

    const checklist = checklistFromBrief(brief, roleSeed);
    return {
      message: `Updated the ${section.replace(/([A-Z])/g, " $1").toLowerCase()} section. Review the changes.`,
      chips: buildChips(messages, roleSeed, checklist, true),
      briefReady: true,
      brief,
      briefPartial: brief,
      checklist,
      usedFallback: true,
    };
  }

  if (lastUser === DEFAULT_CHIPS.draftNow) {
    return scriptedResponse({ ...body, mode: "draft_now" });
  }

  if (userTurns === 0) {
    const partial = synthesizeBriefFromConversation(roleSeed, [], departmentId);
    const checklist = checklistFromBrief(partial, roleSeed);
    return {
      message: SCRIPTED_QUESTIONS[0].ade,
      chips: buildChips(messages, roleSeed, checklist, false, [...SCRIPTED_QUESTIONS[0].chips]),
      briefReady: false,
      briefPartial: partial,
      checklist,
      usedFallback: true,
    };
  }

  const partial = synthesizeBriefFromConversation(roleSeed, messages, departmentId);
  const checklist = checklistFromBrief(partial, roleSeed);

  if (shouldAutoBriefReady(messages, checklist) || lastUser === DEFAULT_CHIPS.refineMore) {
    const brief = synthesizeBriefFromConversation(roleSeed, messages, departmentId, partial);
    return {
      message:
        "I have enough to prepare the job brief. Want to review it now or refine personality and tools first?",
      chips: buildChips(messages, roleSeed, checklistFromBrief(brief, roleSeed), true),
      briefReady: true,
      brief,
      briefPartial: brief,
      checklist: checklistFromBrief(brief, roleSeed),
      usedFallback: true,
    };
  }

  const qIndex = Math.min(userTurns, SCRIPTED_QUESTIONS.length - 1);
  const q = SCRIPTED_QUESTIONS[qIndex];
  return {
    message: q.ade,
    chips: buildChips(messages, roleSeed, checklist, false, [...q.chips]),
    briefReady: false,
    briefPartial: partial,
    checklist,
    usedFallback: true,
  };
}

function systemPrompt(body: RecruiterBody) {
  return `You are Ade Recruiting Manager at AdeHQ — a sharp, warm recruiter helping hire an AI employee.

Role seed: "${body.roleSeed || "unspecified"}"
Department: ${departmentLabel(body.departmentId ?? null)}

RULES:
1. Extract semantics from ALL user messages — NEVER map answers by question order.
2. Technical topics (latency, bandwidth, performance) → technicalFocus and successMetrics — NEVER communicationStyle or proactivityLevel.
3. communicationStyle = how they communicate (e.g. "technical, precise"). proactivityLevel = low|balanced|high. qualityPreference = speed|balanced|quality.
4. Ask at most ONE question per turn. Stop after 3 user answers if you have role, domain, core work, and work style.
5. Set briefReady true when enough context exists OR user says "Draft brief now".
6. Never ask about channels, rooms, or start location.
7. Include briefPartial on every response with whatever you've inferred so far.
8. Always include chips: "Draft brief now" once role+core work are known; "Refine more" after first answer.
9. seniorityLevel: assistant|specialist|manager|director|advisor. autonomyLevel: low|balanced|high.

Mode: ${body.mode ?? "chat"}
${body.refineInstruction ? `Refine (${body.refineMode ?? "improve"}) section ${body.refineSection}: ${body.refineInstruction}` : ""}

Respond ONLY as JSON matching the schema.`;
}

export async function POST(request: NextRequest) {
  try {
    await requireAuthUser(request);
    const body = (await request.json()) as RecruiterBody;

    if (!body.roleSeed?.trim() && !body.departmentId) {
      return NextResponse.json({ error: "roleSeed or departmentId required." }, { status: 400 });
    }

    if (body.mode === "draft_now") {
      return NextResponse.json(scriptedResponse(body));
    }

    if (!isSiliconFlowConfigured()) {
      return NextResponse.json(scriptedResponse(body));
    }

    const modelId = resolveModel("siliconflow", "balanced");
    const model = siliconFlowChatModel(modelId);
    const history = (body.messages ?? [])
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
      let briefPartial = object.briefPartial
        ? mergeBriefPartial(
            synthesizeBriefFromConversation(body.roleSeed, body.messages ?? [], body.departmentId),
            object.briefPartial,
          )
        : brief;

      const checklist =
        object.checklist ??
        checklistFromBrief(briefPartial ?? brief, body.roleSeed);

      let briefReady = object.briefReady;
      if (!briefReady && shouldAutoBriefReady(body.messages ?? [], checklist)) {
        briefReady = true;
      }
      if (briefReady && !brief) {
        brief = synthesizeBriefFromConversation(
          body.roleSeed,
          body.messages ?? [],
          body.departmentId,
          briefPartial,
        );
        briefPartial = brief;
      }

      const chips = buildChips(
        body.messages ?? [],
        body.roleSeed,
        checklist,
        briefReady,
        object.chips,
      );

      return NextResponse.json({
        message: object.message,
        chips,
        briefReady,
        brief,
        briefPartial,
        checklist,
        usedFallback: false,
      });
    } catch {
      return NextResponse.json(scriptedResponse(body));
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[hiring/recruiter]", err);
    return NextResponse.json({ error: "Recruiter request failed." }, { status: 500 });
  }
}
