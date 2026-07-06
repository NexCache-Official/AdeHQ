import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import {
  assertPlatformAdminCanWrite,
  requirePlatformPermission,
} from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";
import { getAllRoles } from "@/lib/hiring/role-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (_request, { serviceClient }) => {
  const { data: templates, error: templatesError } = await serviceClient
    .from("ai_prompt_templates")
    .select("id, role_key, display_name, is_active, default_intelligence_mode, created_at, updated_at")
    .order("display_name");
  if (templatesError) throw templatesError;

  const { data: versions, error: versionsError } = await serviceClient
    .from("ai_prompt_template_versions")
    .select("id, template_id, version, is_active, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (versionsError) throw versionsError;

  const codeRoles = getAllRoles().map((r) => ({
    roleKey: r.roleKey,
    title: r.title,
    department: r.departmentLabel,
    description: r.description,
    source: "code" as const,
  }));

  return NextResponse.json({
    dbTemplates: templates ?? [],
    versions: versions ?? [],
    codeRoles,
    codeRoleCount: codeRoles.length,
  });
});

export const POST = adminRoute(async (request, ctx) => {
  assertPlatformAdminCanWrite(ctx.admin);
  requirePlatformPermission(ctx, "flags.write");

  const body = await request.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action : "seed";

  if (action !== "seed") {
    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  }

  const roles = getAllRoles();
  let inserted = 0;
  let skipped = 0;

  for (const role of roles) {
    const { data: existing } = await ctx.serviceClient
      .from("ai_prompt_templates")
      .select("id")
      .eq("role_key", role.roleKey)
      .maybeSingle();

    if (existing) {
      skipped += 1;
      continue;
    }

    const systemPrompt = [
      `You are ${role.title} at the customer's company.`,
      role.description,
      "",
      "Default responsibilities:",
      ...role.defaultResponsibilities.map((r) => `- ${r}`),
    ].join("\n");

    const { data: template, error: templateError } = await ctx.serviceClient
      .from("ai_prompt_templates")
      .insert({
        role_key: role.roleKey,
        display_name: role.title,
        is_active: true,
        default_intelligence_mode: role.defaultModelMode,
      })
      .select("id")
      .single();
    if (templateError) throw templateError;

    const { error: versionError } = await ctx.serviceClient
      .from("ai_prompt_template_versions")
      .insert({
        template_id: template.id,
        version: 1,
        system_prompt: systemPrompt,
        policy_notes: `Seeded from role library (${role.departmentLabel})`,
        is_active: true,
        created_by: ctx.admin.userId,
      });
    if (versionError) throw versionError;

    inserted += 1;
  }

  await writeAuditLog(ctx.serviceClient, {
    adminUserId: ctx.admin.userId,
    action: "ai_prompt_templates_seeded",
    targetType: "ai_prompt_templates",
    targetId: "role_library",
    after: { inserted, skipped, total: roles.length },
    request,
  });

  return NextResponse.json({ ok: true, inserted, skipped, total: roles.length });
});
