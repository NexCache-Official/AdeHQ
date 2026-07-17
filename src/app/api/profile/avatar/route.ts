import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { ensureProfileAvatar } from "@/lib/server/ensure-profile-avatar";
import { AVATAR_BUCKET, AVATAR_MAX_UPLOAD_BYTES, avatarObjectPath } from "@/lib/avatar/constants";
import { publicAvatarUrl } from "@/lib/avatar/render-default-avatar";
import { SUPABASE_PROJECT_URL } from "@/lib/supabase/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Ensure generated default avatar exists (called on workspace load). */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuthUser(request);
    const service = createSupabaseSecretClient();
    const { data: profile } = await service
      .from("profiles")
      .select("name, avatar")
      .eq("id", user.id)
      .maybeSingle();

    const result = await ensureProfileAvatar(service, {
      userId: user.id,
      name: profile?.name || user.email?.split("@")[0] || "User",
    });

    return NextResponse.json({
      ok: true,
      avatarUrl: result.avatarUrl,
      source: result.source,
      created: result.created,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ profile avatar GET]", error);
    return NextResponse.json({ error: "Unable to load avatar." }, { status: 500 });
  }
}

/** Upload a cropped/resized profile picture (PNG/JPEG/WebP). */
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuthUser(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required." }, { status: 400 });
    }
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json({ error: "Use PNG, JPEG, or WebP." }, { status: 400 });
    }
    if (file.size > AVATAR_MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "Image must be under 2MB." }, { status: 400 });
    }

    // Client cropper exports PNG; keep a stable png path for uploads
    const uploadPath = avatarObjectPath(user.id, "png");
    const buffer = Buffer.from(await file.arrayBuffer());
    const service = createSupabaseSecretClient();

    // Remove previous generated SVG / other formats in the user folder
    await service.storage
      .from(AVATAR_BUCKET)
      .remove([
        avatarObjectPath(user.id, "svg"),
        avatarObjectPath(user.id, "webp"),
        avatarObjectPath(user.id, "png"),
      ]);

    const { error: uploadError } = await service.storage.from(AVATAR_BUCKET).upload(uploadPath, buffer, {
      contentType: "image/png",
      upsert: true,
      cacheControl: "3600",
    });
    if (uploadError) throw uploadError;

    const avatarUrl = publicAvatarUrl(SUPABASE_PROJECT_URL, uploadPath, Date.now());
    const now = new Date().toISOString();
    const { error: updateError } = await service
      .from("profiles")
      .update({
        avatar: avatarUrl,
        avatar_source: "upload",
        avatar_updated_at: now,
        updated_at: now,
      })
      .eq("id", user.id);
    if (updateError) throw updateError;

    return NextResponse.json({ ok: true, avatarUrl, source: "upload" });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ profile avatar POST]", error);
    return NextResponse.json({ error: "Unable to upload avatar." }, { status: 500 });
  }
}

/** Reset to generated unique default avatar. */
export async function DELETE(request: NextRequest) {
  try {
    const { user } = await requireAuthUser(request);
    const service = createSupabaseSecretClient();
    const { data: profile } = await service
      .from("profiles")
      .select("name")
      .eq("id", user.id)
      .maybeSingle();

    // Clear uploaded files
    await service.storage
      .from(AVATAR_BUCKET)
      .remove([
        avatarObjectPath(user.id, "png"),
        avatarObjectPath(user.id, "webp"),
        avatarObjectPath(user.id, "svg"),
      ]);

    const result = await ensureProfileAvatar(service, {
      userId: user.id,
      name: profile?.name || user.email?.split("@")[0] || "User",
      forceRegenerate: true,
    });

    return NextResponse.json({
      ok: true,
      avatarUrl: result.avatarUrl,
      source: "generated",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ profile avatar DELETE]", error);
    return NextResponse.json({ error: "Unable to reset avatar." }, { status: 500 });
  }
}
