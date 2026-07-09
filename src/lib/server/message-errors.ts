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

/** Map internal tool failures to employee-safe chat copy (no schema/API leakage). */
export function toUserFacingToolError(error: unknown): string {
  const internal = serializeUnknownError(error).toLowerCase();

  if (
    internal.includes("schema cache") ||
    internal.includes("could not find") ||
    internal.includes("column") ||
    internal.includes("does not exist") ||
    internal.includes("23503") ||
    internal.includes("23505")
  ) {
    return "I couldn't save the answer to chat just now.";
  }

  if (
    internal.includes("not configured") ||
    internal.includes("api_key") ||
    internal.includes("missing env")
  ) {
    return "Web search isn't available on my side yet.";
  }

  if (
    internal.includes("plan_entitlement_denied") ||
    internal.includes("current plan") ||
    internal.includes("upgrade to enable")
  ) {
    return "Web search isn't included in this workspace's current plan.";
  }

  if (internal.includes("timeout") || internal.includes("timed out") || internal.includes("abort")) {
    return "The search took too long.";
  }

  if (internal.includes("rate limit") || internal.includes("429") || internal.includes("too many")) {
    return "Search is busy right now — try again in a moment.";
  }

  if (internal.includes("cancelled") || internal.includes("canceled")) {
    return "That search was stopped.";
  }

  return "Something went wrong while searching.";
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
