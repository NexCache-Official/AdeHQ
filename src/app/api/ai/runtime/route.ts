import { NextRequest, NextResponse } from "next/server";
import { buildOptimizerPreview, getAiRuntimeSnapshot } from "@/lib/ai/runtime-log";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { listCatalogOffersForAdmin } from "@/lib/supabase/model-catalog";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import type { AiCapability } from "@/lib/ai/runtime/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    if (!["admin","owner"].includes(role)) {
      return NextResponse.json({ error: "Only workspace owners and admins can view AI runtime status." }, { status: 403 });
    }

    const previewCapability = request.nextUrl.searchParams.get("previewCapability");
    const previewMode = request.nextUrl.searchParams.get("previewMode");
    const previewPreference = request.nextUrl.searchParams.get("previewPreference");

    let catalog: Awaited<ReturnType<typeof listCatalogOffersForAdmin>> | null = null;
    try {
      const serviceClient = createSupabaseSecretClient();
      catalog = await listCatalogOffersForAdmin(serviceClient);
    } catch {
      catalog = null;
    }

    const catalogOffers = catalog?.offers ?? undefined;
    const base = getAiRuntimeSnapshot(catalogOffers);

    const snapshot = {
      ...base,
      optimizerPreview:
        previewCapability != null
          ? buildOptimizerPreview(
              {
                capability: previewCapability as AiCapability,
                runtimeMode: previewMode ?? "balanced",
                routingPreference:
                  (previewPreference as "auto" | "cost_saver" | "quality_first" | "fastest") ??
                  "auto",
              },
              catalogOffers,
            )
          : base.optimizerPreview,
      catalog,
    };

    return NextResponse.json(snapshot);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ AI runtime route]", error);
    return NextResponse.json({ error: "Unable to load AI runtime status." }, { status: 500 });
  }
}
