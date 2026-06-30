import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { siliconFlowChatModel, siliconFlowProviderOptions } from "@/lib/ai/siliconflow-client";
import { resolveModel } from "@/lib/ai/model-catalog";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import { buildBriefFromRoleSeed } from "@/lib/hiring/build-brief";
import type { HiringAnswers, HiringMessage, JobBrief } from "@/lib/hiring/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const briefSchema = z.object({
  title: z.string(),
  roleTitle: z.string(),
  industry: z.string(),
  focus: z.string(),
  tone: z.string(),
  proactivity: z.string(),
  priority: z.string(),
  startLocation: z.string(),
  mission: z.string(),
  responsibilities: z.array(z.string()).min(1).max(8),
  industryContext: z.string(),
  workingStyle: z.string(),
  communicationStyle: z.string(),
  approvalRules: z.array(z.string()).min(1).max(6),
  successCriteria: z.array(z.string()).min(1).max(6),
});

const responseSchema = z.object({
  message: z.string(),
  chips: z.array(z.string()).max(6),
  showLocationPicker: z.boolean(),
  briefReady: z.boolean(),
  answers: z
    .object({
      industry: z.string().optional(),
      focus: z.string().optional(),
      tone: z.string().optional(),
      proactivity: z.string().optional(),
      priority: z.string().optional(),
      startLocation: z.string().optional(),
      roleTitle: z.string().optional(),
    })
    .optional(),
  brief: briefSchema.optional(),
});

type RecruiterBody = {
  roleSeed: string;
  departmentId?: string | null;
  messages: HiringMessage[];
  currentBrief?: JobBrief;
  mode?: "chat" | "regenerate" | "refine";
  refineInstruction?: string;
};

const SCRIPTED = [
  {
    key: "industry",
    ade: "Great — let me help you hire the right person. First, what industry should this employee understand best?",
    chips: ["Finance & fintech", "SaaS & tech", "Healthcare", "Consumer & retail"],
  },
  {
    key: "focus",
    ade: "Got it. What should they focus on day to day?",
    chips: ["Investor relations", "Media outreach", "Product launches", "Crisis communications"],
  },
  {
    key: "tone",
    ade: "Should this employee sound conservative and polished, or bold and growth-focused?",
    chips: ["Polished & credible", "Bold & growth-focused", "Balanced"],
  },
  {
    key: "proactivity",
    ade: "How proactive should they be?",
    chips: ["Highly proactive", "Balanced", "Wait for direction"],
  },
  {
    key: "priority",
    ade: "And should they prioritize speed, quality, or a balance of both?",
    chips: ["Speed", "Quality", "Balanced"],
  },
  {
    key: "startLocation",
    ade: "Last thing — where should they start working? Pick a room or topic, or type your own.",
    chips: [],
    location: true,
  },
] as const;

function countUserTurns(messages: HiringMessage[]) {
  return messages.filter((m) => m.role === "user").length;
}

function scriptedResponse(body: RecruiterBody) {
  const { roleSeed, departmentId, messages } = body;
  const userTurns = countUserTurns(messages);
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.text ?? "";

  if (body.mode === "regenerate" || body.mode === "refine") {
    const brief = buildBriefFromRoleSeed(
      roleSeed,
      body.currentBrief ?? {},
      departmentId,
    );
    if (body.mode === "refine" && body.refineInstruction?.trim()) {
      return {
        message: `Updated the brief based on: "${body.refineInstruction.trim()}". Review the changes on the left.`,
        chips: [],
        showLocationPicker: false,
        briefReady: true,
        brief,
        usedFallback: true,
      };
    }
    return {
      message: "I've refreshed the job brief from your answers. Take a look and edit anything you'd like.",
      chips: [],
      showLocationPicker: false,
      briefReady: true,
      brief,
      usedFallback: true,
    };
  }

  if (userTurns === 0) {
    const q = SCRIPTED[0];
    return {
      message: q.ade,
      chips: [...q.chips],
      showLocationPicker: false,
      briefReady: false,
      usedFallback: true,
    };
  }

  const answers: HiringAnswers = {};
  SCRIPTED.forEach((q, i) => {
    const userMsg = messages.filter((m) => m.role === "user")[i];
    if (userMsg) {
      (answers as Record<string, string>)[q.key] = userMsg.text;
    }
  });

  if (userTurns < SCRIPTED.length) {
    const q = SCRIPTED[userTurns];
    (answers as Record<string, string>)[SCRIPTED[userTurns - 1].key] = lastUser;
    return {
      message: q.ade,
      chips: [...q.chips],
      showLocationPicker: "location" in q,
      briefReady: false,
      answers,
      usedFallback: true,
    };
  }

  (answers as Record<string, string>)[SCRIPTED[SCRIPTED.length - 1].key] = lastUser;
  const brief = buildBriefFromRoleSeed(roleSeed, answers, departmentId);

  return {
    message:
      "Perfect. I've prepared a job brief for your role, then I'll shortlist AI employee candidates with different strengths, capacity, and quality levels.",
    chips: [],
    showLocationPicker: false,
    briefReady: true,
    answers,
    brief,
    usedFallback: true,
  };
}

function systemPrompt(body: RecruiterBody) {
  const rooms = body.currentBrief?.startLocation
    ? `Current start location: ${body.currentBrief.startLocation}`
    : "User may pick a workspace room later.";

  return `You are Ade Recruiting Manager — a sharp, warm recruiting manager at AdeHQ helping a founder hire an AI employee.

Role the user wants to hire: "${body.roleSeed || "unspecified"}"
Department picked: ${body.departmentId ?? "none"}

Your job:
1. Ask ONE focused question at a time to learn: industry, day-to-day focus, tone, proactivity, priority, and optionally start location (room/topic).
2. Offer 3-4 short suggestion chips the user can click.
3. After you have enough context (usually 5-6 answers), set briefReady true and output a complete structured job brief.
4. Keep messages concise (2-4 sentences). Sound like an expert recruiter, not a generic chatbot.
5. startLocation is optional — if user skips it, use "Workspace general channel".
6. Never invent company facts. Use the role seed and answers only.

${rooms}

When mode is refine, update the brief per refineInstruction and keep briefReady true.
When mode is regenerate, rebuild the full brief from conversation history.

Respond ONLY as JSON matching the schema.`;
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as RecruiterBody;
    if (!body.roleSeed?.trim() && !body.departmentId) {
      return NextResponse.json({ error: "roleSeed or departmentId required." }, { status: 400 });
    }

    if (!isSiliconFlowConfigured()) {
      return NextResponse.json(scriptedResponse(body));
    }

    const modelId = resolveModel("siliconflow", "cheap");
    const model = siliconFlowChatModel(modelId);

    const history = (body.messages ?? [])
      .map((m) => `${m.role === "ade" ? "Ade" : "User"}: ${m.text}`)
      .join("\n");

    const prompt = [
      `Mode: ${body.mode ?? "chat"}`,
      body.refineInstruction ? `Refine instruction: ${body.refineInstruction}` : "",
      `Conversation:\n${history || "(starting)"}`,
      body.currentBrief
        ? `Current brief JSON:\n${JSON.stringify(body.currentBrief)}`
        : "",
      countUserTurns(body.messages ?? []) === 0
        ? "This is the start of the conversation. Greet briefly and ask your first recruiting question."
        : "Continue the recruiting conversation based on the latest user message.",
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const { object } = await generateObject({
        model,
        schema: responseSchema,
        system: systemPrompt(body),
        prompt,
        maxOutputTokens: 1800,
        providerOptions: siliconFlowProviderOptions(modelId),
      });

      let brief = object.brief;
      if (object.briefReady && !brief) {
        brief = buildBriefFromRoleSeed(
          body.roleSeed,
          { ...object.answers, ...(body.currentBrief ?? {}) },
          body.departmentId,
        );
      }

      return NextResponse.json({
        ...object,
        brief,
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
