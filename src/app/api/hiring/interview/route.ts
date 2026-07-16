import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { briefSchema } from "@/lib/hiring/brief-schema";
import { generateCandidateInterviewReply } from "@/lib/hiring/candidate-interview";
import { resolveHiringWorkspaceContext } from "@/lib/server/hiring-workspace-context";
import type { AiEmployeeApplicant, AiEmployeeJobBrief, RecruiterMessage } from "@/lib/hiring/types";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import {
  consumeRateLimit,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const applicantSchema = z.object({
  id: z.string(),
  tier: z.enum(["high_capacity", "recommended", "premium"]),
  name: z.string(),
  first: z.string(),
  title: z.string(),
  modelMode: z.enum(["cheap", "balanced", "strong"]),
  resolvedModelId: z.string(),
  engineLabel: z.string(),
  weeklyWorkHours: z.number(),
  costIntensity: z.enum(["low", "medium", "high"]),
  speed: z.enum(["fast", "standard", "slower"]),
  quality: z.enum(["standard", "high", "premium"]),
  qualityLevel: z.number(),
  speedLevel: z.number(),
  costLevel: z.number(),
  strengths: z.array(z.string()),
  watchOuts: z.array(z.string()),
  bestFor: z.string(),
  whyThisCandidate: z.string(),
  recommended: z.boolean(),
  personalityTags: z.array(z.string()),
  grad: z.string(),
  badge: z.string(),
  badgeKind: z.enum(["rec", "neutral"]),
  cap: z.number(),
  candidatePitch: z.string().optional(),
  howIWork: z.array(z.string()).optional(),
  communicationStyle: z.string().optional(),
  autonomyLevel: z.string().optional(),
  proactivityLevel: z.string().optional(),
  roleKey: z.string().optional(),
  roleTitle: z.string().optional(),
});

const messageSchema = z.object({
  role: z.enum(["ade", "user"]),
  text: z.string(),
});

const bodySchema = z.object({
  applicant: applicantSchema,
  brief: briefSchema,
  conversation: z.array(messageSchema).default([]),
  question: z.string().min(1),
  workspaceId: z.string().optional().nullable(),
  hiringSessionId: z.string().optional().nullable(),
  topicId: z.string().optional().nullable(),
  mayaRoomId: z.string().optional().nullable(),
});

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

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid interview request." }, { status: 400 });
    }

    const body = parsed.data;
    await resolveHiringWorkspaceContext(client, user.id, {
      workspaceId: body.workspaceId,
      hiringSessionId: body.hiringSessionId,
      topicId: body.topicId,
      mayaRoomId: body.mayaRoomId,
    });
    const limit = await consumeRateLimit(createSupabaseSecretClient(), {
      bucket: "hiring.interview.user",
      key: user.id,
      limit: 10,
      windowMs: 60 * 60_000,
    });
    if (!limit.allowed) {
      return rateLimitResponse(limit, "Interview message limit reached. Try again later.");
    }

    const result = await generateCandidateInterviewReply({
      applicant: body.applicant as AiEmployeeApplicant,
      brief: normalizeBrief(body.brief),
      conversation: body.conversation as RecruiterMessage[],
      question: body.question,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ hiring interview]", error);
    return NextResponse.json({ error: "Interview reply failed." }, { status: 500 });
  }
}
