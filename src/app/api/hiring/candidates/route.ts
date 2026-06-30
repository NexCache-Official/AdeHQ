import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { siliconFlowChatModel, siliconFlowProviderOptions } from "@/lib/ai/siliconflow-client";
import { resolveModel } from "@/lib/ai/model-catalog";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import { applicantCopySchema } from "@/lib/hiring/brief-schema";
import {
  generateDeterministicCandidates,
  type ApplicantCopy,
} from "@/lib/hiring/candidate-engine";
import type { AiEmployeeJobBrief, CandidateTier } from "@/lib/hiring/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CandidatesBody = {
  brief: AiEmployeeJobBrief;
  departmentId?: string | null;
  roleKey?: string | null;
};

const copyOnlySchema = z.object({
  copies: applicantCopySchema,
});

export async function POST(request: NextRequest) {
  try {
    await requireAuthUser(request);
    const body = (await request.json()) as CandidatesBody;

    if (!body.brief?.roleTitle) {
      return NextResponse.json({ error: "brief is required." }, { status: 400 });
    }

    let copies: Partial<Record<CandidateTier, ApplicantCopy>> | undefined;

    if (isSiliconFlowConfigured()) {
      const modelId = resolveModel("siliconflow", "cheap");
      const model = siliconFlowChatModel(modelId);
      try {
        const { object } = await generateObject({
          model,
          schema: copyOnlySchema,
          system: `Generate ONLY applicant copy (names, titles, personality tags, strengths, watch-outs, bestFor, whyThisCandidate).
Do NOT change model modes, hours, quality, speed, or cost — those are set by the system.
Create 3 distinct personas for tiers: high_capacity (fast/cheap), recommended (balanced), premium (senior/deep).
Match the job brief domain and role.`,
          prompt: JSON.stringify(body.brief),
          maxOutputTokens: 1500,
          providerOptions: siliconFlowProviderOptions(modelId),
        });
        copies = object.copies as Partial<Record<CandidateTier, ApplicantCopy>>;
      } catch {
        copies = undefined;
      }
    }

    const candidates = generateDeterministicCandidates(
      body.brief,
      body.departmentId ?? null,
      body.roleKey ?? null,
      copies,
    );

    return NextResponse.json({ candidates, usedFallback: !copies });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[hiring/candidates]", err);
    return NextResponse.json({ error: "Candidate generation failed." }, { status: 500 });
  }
}
