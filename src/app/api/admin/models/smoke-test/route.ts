import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import {
  assertPlatformAdminCanWrite,
  requirePlatformPermission,
} from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";
import { generateText } from "@/lib/ai/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = adminRoute(async (request, ctx) => {
  assertPlatformAdminCanWrite(ctx.admin);
  requirePlatformPermission(ctx, "models.write");

  const body = await request.json().catch(() => null);
  const provider = typeof body?.provider === "string" ? body.provider : "mock";
  const startedAt = Date.now();

  const results: { provider: string; ok: boolean; latencyMs: number; error?: string }[] = [];

  if (provider === "mock" || provider === "all") {
    try {
      const result = await generateText(
        {
          workspaceId: "platform-smoke",
          capability: "quick_reply",
          modelMode: "balanced",
          prompt: "Reply with exactly: smoke-ok",
        },
        { forceMode: "on", forceProviderPref: "mock" },
      );
      results.push({
        provider: "mock",
        ok: Boolean(result.text?.includes("smoke") || result.text),
        latencyMs: Date.now() - startedAt,
      });
    } catch (err) {
      results.push({
        provider: "mock",
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : "Smoke test failed.",
      });
    }
  }

  if (provider === "siliconflow" || provider === "all") {
    const t0 = Date.now();
    if (!process.env.SILICONFLOW_API_KEY?.trim()) {
      results.push({ provider: "siliconflow", ok: false, latencyMs: 0, error: "Not configured" });
    } else {
      try {
        await generateText(
          {
            workspaceId: "platform-smoke",
            capability: "quick_reply",
            modelMode: "balanced",
            prompt: "Reply with: ok",
          },
          { forceMode: "on", forceProviderPref: "siliconflow" },
        );
        results.push({ provider: "siliconflow", ok: true, latencyMs: Date.now() - t0 });
      } catch (err) {
        results.push({
          provider: "siliconflow",
          ok: false,
          latencyMs: Date.now() - t0,
          error: err instanceof Error ? err.message : "Smoke test failed.",
        });
      }
    }
  }

  if (provider === "vercel" || provider === "all") {
    const t0 = Date.now();
    if (!process.env.AI_GATEWAY_API_KEY?.trim()) {
      results.push({ provider: "vercel", ok: false, latencyMs: 0, error: "Not configured" });
    } else {
      try {
        await generateText(
          {
            workspaceId: "platform-smoke",
            capability: "quick_reply",
            modelMode: "balanced",
            prompt: "Reply with: ok",
          },
          { forceMode: "on", forceProviderPref: "vercel" },
        );
        results.push({ provider: "vercel", ok: true, latencyMs: Date.now() - t0 });
      } catch (err) {
        results.push({
          provider: "vercel",
          ok: false,
          latencyMs: Date.now() - t0,
          error: err instanceof Error ? err.message : "Smoke test failed.",
        });
      }
    }
  }

  await writeAuditLog(ctx.serviceClient, {
    adminUserId: ctx.admin.userId,
    action: "model_smoke_test_run",
    targetType: "platform",
    targetId: provider,
    after: { results },
    request,
    severity: "low",
  });

  return NextResponse.json({ ok: true, results });
});
