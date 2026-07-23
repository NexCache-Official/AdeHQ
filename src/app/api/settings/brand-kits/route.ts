import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { isArtifactRuntimeV1Enabled } from "@/lib/artifacts/flags";
import { ADEHQ_DEFAULT_BRAND_KIT } from "@/lib/artifacts/brand-kits/defaults";
import { stableChecksum } from "@/lib/playbooks/checksum";
import { canManageWorkspaceSettings } from "@/lib/workspace/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ ok: false, error: "workspaceId is required." }, { status: 400 });
    }
    await requireWorkspaceMembership(client, workspaceId, user.id);

    const { data, error } = await client
      .from("workspace_brand_kits")
      .select("*, workspace_brand_kit_versions(*)")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false });
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      brandKits: data ?? [],
      defaultKit: ADEHQ_DEFAULT_BRAND_KIT,
      runtimeEnabled: isArtifactRuntimeV1Enabled(),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ brand-kits GET]", error);
    return NextResponse.json({ ok: false, error: "Unable to list brand kits." }, { status: 500 });
  }
}

type CreateBody = {
  workspaceId?: string;
  name?: string;
  isDefault?: boolean;
  colorTokens?: Record<string, unknown>;
  typographyTokens?: Record<string, unknown>;
  footerText?: string;
  documentTokens?: Record<string, unknown>;
  presentationTokens?: Record<string, unknown>;
  spreadsheetTokens?: Record<string, unknown>;
};

export async function POST(request: NextRequest) {
  try {
    if (!isArtifactRuntimeV1Enabled()) {
      return NextResponse.json(
        { ok: false, error: "Artifact runtime is disabled; brand kit writes blocked." },
        { status: 403 },
      );
    }

    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as CreateBody;
    if (!body.workspaceId || !body.name?.trim()) {
      return NextResponse.json(
        { ok: false, error: "workspaceId and name are required." },
        { status: 400 },
      );
    }
    const { role } = await requireWorkspaceMembership(client, body.workspaceId, user.id);
    if (!canManageWorkspaceSettings(role)) {
      return NextResponse.json({ ok: false, error: "Admin role required." }, { status: 403 });
    }

    if (body.isDefault) {
      await client
        .from("workspace_brand_kits")
        .update({ is_default: false })
        .eq("workspace_id", body.workspaceId)
        .eq("is_default", true);
    }

    const { data: kit, error } = await client
      .from("workspace_brand_kits")
      .insert({
        workspace_id: body.workspaceId,
        name: body.name.trim(),
        is_default: Boolean(body.isDefault),
      })
      .select("*")
      .single();
    if (error) throw error;

    const tokens = {
      color_tokens: body.colorTokens ?? ADEHQ_DEFAULT_BRAND_KIT.tokens.colors,
      typography_tokens: body.typographyTokens ?? ADEHQ_DEFAULT_BRAND_KIT.tokens.typography,
      footer_text: body.footerText ?? ADEHQ_DEFAULT_BRAND_KIT.footerText,
      document_tokens: body.documentTokens ?? ADEHQ_DEFAULT_BRAND_KIT.tokens.document,
      presentation_tokens:
        body.presentationTokens ?? ADEHQ_DEFAULT_BRAND_KIT.tokens.presentation,
      spreadsheet_tokens: body.spreadsheetTokens ?? ADEHQ_DEFAULT_BRAND_KIT.tokens.spreadsheet,
    };
    const checksum = stableChecksum(tokens);

    const { data: version, error: verErr } = await client
      .from("workspace_brand_kit_versions")
      .insert({
        brand_kit_id: kit.id,
        version: 1,
        ...tokens,
        checksum,
      })
      .select("*")
      .single();
    if (verErr) throw verErr;

    await client
      .from("workspace_brand_kits")
      .update({ current_version_id: version.id })
      .eq("id", kit.id);

    return NextResponse.json({
      ok: true,
      brandKit: { ...kit, current_version_id: version.id },
      version,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ brand-kits POST]", error);
    return NextResponse.json({ ok: false, error: "Unable to create brand kit." }, { status: 500 });
  }
}
