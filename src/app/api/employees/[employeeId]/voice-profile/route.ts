import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import {
  normalizeEmployeeVoiceProfile,
  type EmployeeVoiceProfile,
} from "@/lib/brain/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const profilePatchSchema = z.object({
  locale: z.string().trim().min(2).max(16).optional(),
  accent: z.string().trim().max(60).nullable().optional(),
  tone: z
    .enum(["professional", "warm", "energetic", "calm", "direct", "thoughtful"])
    .optional(),
  pace: z.number().min(0.7).max(1.5).optional(),
  routePreference: z.enum(["auto", "standard", "premium", "local"]).optional(),
  providerBindings: z
    .array(
      z.object({
        provider: z.string().trim().min(1).max(40),
        voiceId: z.string().trim().min(1).max(160),
        qualityTier: z.enum(["standard", "premium", "local"]),
      }),
    )
    .max(12)
    .optional(),
});

async function loadEmployee(
  workspaceId: string,
  employeeId: string,
): Promise<{ voice_profile: unknown } | null> {
  const { data, error } = await createSupabaseSecretClient()
    .from("ai_employees")
    .select("voice_profile")
    .eq("workspace_id", workspaceId)
    .eq("id", employeeId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  try {
    const { employeeId } = await params;
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    }
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const employee = await loadEmployee(workspaceId, employeeId);
    if (!employee) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }
    return NextResponse.json({
      profile: normalizeEmployeeVoiceProfile(employeeId, employee.voice_profile),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not load voice profile." }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  try {
    const { employeeId } = await params;
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    }
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const employee = await loadEmployee(workspaceId, employeeId);
    if (!employee) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }
    const patch = profilePatchSchema.parse(await request.json());
    const current = normalizeEmployeeVoiceProfile(
      employeeId,
      employee.voice_profile,
    );
    const next: EmployeeVoiceProfile = {
      ...current,
      ...patch,
      accent: patch.accent === null ? undefined : (patch.accent ?? current.accent),
      providerBindings: patch.providerBindings ?? current.providerBindings,
    };
    const { error } = await createSupabaseSecretClient()
      .from("ai_employees")
      .update({ voice_profile: next })
      .eq("workspace_id", workspaceId)
      .eq("id", employeeId);
    if (error) throw error;
    return NextResponse.json({ profile: next });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid voice profile.", issues: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Could not update voice profile." }, { status: 500 });
  }
}
