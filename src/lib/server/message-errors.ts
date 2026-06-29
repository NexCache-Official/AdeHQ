import { NextResponse } from "next/server";

export type MessageErrorCode =
  | "missing_topic_id"
  | "topic_not_in_room"
  | "topic_archived"
  | "not_room_member"
  | "room_not_found"
  | "message_required"
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
