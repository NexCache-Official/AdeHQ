import { NextResponse } from "next/server";

export type MessageErrorCode =
  | "missing_topic_id"
  | "topic_not_in_room"
  | "topic_archived"
  | "room_archived"
  | "not_room_member"
  | "room_not_found"
  | "message_required"
  | "attachment_not_found"
  | "send_failed"
  | "ai_runtime_failed_but_message_saved";

export function messageError(
  code: MessageErrorCode,
  message: string,
  status: number,
  extra?: Record<string, unknown>,
) {
  if (process.env.NODE_ENV === "development") {
    console.error("[AdeHQ message error]", { code, message, ...extra });
  }
  return NextResponse.json({ error: message, code, ...extra }, { status });
}

/** Supabase/PostgREST errors are plain objects, not `instanceof Error`. */
export function serializeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const msg = String((error as { message: unknown }).message);
    const code = "code" in error ? String((error as { code: unknown }).code) : "";
    const details = "details" in error ? String((error as { details: unknown }).details) : "";
    return [msg, code && `(${code})`, details].filter(Boolean).join(" ");
  }
  return String(error ?? "Unknown error");
}

export function debugErrorPayload(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack?.split("\n").slice(0, 8),
    };
  }
  if (error && typeof error === "object") {
    return error as Record<string, unknown>;
  }
  return { message: String(error) };
}
