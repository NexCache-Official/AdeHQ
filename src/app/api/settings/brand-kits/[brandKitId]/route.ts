import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { isArtifactRuntimeV1Enabled } from "@/lib/artifacts/flags";
import { canManageWorkspaceSettings } from "@/lib/workspace/permissions";
import { stableChecksum } from "@/lib/playbooks/checksum";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PatchBody = {
  workspaceId?: string;
  name?: string;
  isDefault?: boolean;
  colorTokens?: Record<string, unknown>;
  typographyTokens?: Record<string, unknown>;
  footerText?: string;
  documentTokens?: Record<string, unknown>;
  presentationTokens?: Record<string, unknown>;
  spreadsheetTokens?: Record<string, unknown>;
  publishNewVersion?: boolean;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: { brandKitId: string } },
) {
  try {
    if (!isArtifactRuntimeV1Enabled()) {
      return NextResponse.json(
        { ok: false, error: "Artifact runtime is disabled; brand kit writes blocked." },
        { status: 403 },
      );
    }

    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as PatchBody;
    if (!body.workspaceId) {
      return NextResponse.json({ ok: false, error: "workspaceId is required." }, { status: 400 });
    }
    const { role } = await requireWorkspaceMembership(client, body.workspaceId, user.id);
    if (!canManageWorkspaceSettings(role)) {
      return NextResponse.json({ ok: false, error: "Admin role required." }, { status: 403 });
    }

    const { data: kit, error } = await client
      .from("workspace_brand_kits")
      .select("*")
      .eq("id", params.brandKitId)
      .eq("workspace_id", body.workspaceId)
      .maybeSingle();
    if (error) throw error;
    if (!kit) {
      return NextResponse.json({ ok: false, error: "Brand kit not found." }, { status: 404 });
    }

    if (body.isDefault) {
      await client
        .from("workspace_brand_kits")
        .update({ is_default: false })
        .eq("workspace_id", body.workspaceId)
        .eq("is_default", true);
    }

    const kitPatch: Record<string, unknown> = {};
    if (body.name !== undefined) kitPatch.name = body.name.trim();
    if (body.isDefault !== undefined) kitPatch.is_default = body.isDefault;
    if (Object.keys(kitPatch).length) {
      const { error: updErr } = await client
        .from("workspace_brand_kits")
        .update(kitPatch)
        .eq("id", params.brandKitId);
      if (updErr) throw updErr;
    }

    let version = null;
    const wantsVersion =
      body.publishNewVersion ||
      body.colorTokens ||
      body.typographyTokens ||
      body.footerText !== undefined ||
      body.documentTokens ||
      body.presentationTokens ||
      body.spreadsheetTokens;

    if (wantsVersion) {
      const { data: latest } = await client
        .from("workspace_brand_kit_versions")
        .select("*")
        .eq("brand_kit_id", params.brandKitId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      const tokens = {
        color_tokens: body.colorTokens ?? latest?.color_tokens ?? {},
        typography_tokens: body.typographyTokens ?? latest?.typography_tokens ?? {},
        footer_text: body.footerText ?? latest?.footer_text ?? null,
        document_tokens: body.documentTokens ?? latest?.document_tokens ?? {},
        presentation_tokens: body.presentationTokens ?? latest?.presentation_tokens ?? {},
        spreadsheet_tokens: body.spreadsheetTokens ?? latest?.spreadsheet_tokens ?? {},
      };
      const nextVersion = Number(latest?.version ?? 0) + 1;
      const { data: ver, error: verErr } = await client
        .from("workspace_brand_kit_versions")
        .insert({
          brand_kit_id: params.brandKitId,
          version: nextVersion,
          ...tokens,
          checksum: stableChecksum(tokens),
        })
        .select("*")
        .single();
      if (verErr) throw verErr;
      version = ver;
      await client
        .from("workspace_brand_kits")
        .update({ current_version_id: ver.id })
        .eq("id", params.brandKitId);
    }

    const { data: refreshed } = await client
      .from("workspace_brand_kits")
      .select("*")
      .eq("id", params.brandKitId)
      .single();

    return NextResponse.json({ ok: true, brandKit: refreshed, version });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ brand-kit PATCH]", error);
    return NextResponse.json({ ok: false, error: "Unable to update brand kit." }, { status: 500 });
  }
}
