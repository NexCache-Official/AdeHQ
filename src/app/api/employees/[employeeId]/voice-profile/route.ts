import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { normalizeEmployeeVoiceProfile } from "@/lib/brain/voice";

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
  genderMode: z.enum(["auto", "female", "male"]).optional(),
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
): Promise<{ voice_profile: unknown; name: string | null } | null> {
  const { data, error } = await createSupabaseSecretClient()
    .from("ai_employees")
    .select("voice_profile, name")
    .eq("workspace_id", workspaceId)
    .eq("id", employeeId)
    .maybeSingle();
  if (error) throw error;
  return data
    ? {
        voice_profile: data.voice_profile,
        name: typeof data.name === "string" ? data.name : null,
      }
    : null;
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
      profile: normalizeEmployeeVoiceProfile(employeeId, employee.voice_profile, {
        employeeName: employee.name,
      }),
      employeeName: employee.name,
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
    const existingProfile =
      employee.voice_profile && typeof employee.voice_profile === "object"
        ? (employee.voice_profile as Record<string, unknown>)
        : {};
    const mergedRaw = {
      ...existingProfile,
      ...patch,
      accent:
        patch.accent === null
          ? undefined
          : (patch.accent ?? existingProfile.accent),
      providerBindings:
        patch.providerBindings ?? existingProfile.providerBindings,
    };
    const next = normalizeEmployeeVoiceProfile(employeeId, mergedRaw, {
      employeeName: employee.name,
      // Auto/manual gender changes should re-seat the voice into the right pool.
      realignGender: Boolean(patch.genderMode) || Boolean(patch.providerBindings),
    });
    const { error } = await createSupabaseSecretClient()
      .from("ai_employees")
      .update({ voice_profile: next })
      .eq("workspace_id", workspaceId)
      .eq("id", employeeId);
    if (error) throw error;
    return NextResponse.json({ profile: next, employeeName: employee.name });
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
