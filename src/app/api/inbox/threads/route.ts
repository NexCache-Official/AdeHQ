/**
 * GET /api/inbox/threads?workspaceId=&folder=&cursor=&limit=
 *
 * Query-based folders + keyset pagination. List-row preview is folder-aware:
 * Inbox → last inbound; Sent / Awaiting → last outbound.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { applyFolderFilter, listPreviewDirection } from "@/lib/inbox/folders";
import { mapThreadRow } from "@/lib/inbox/mailbox";
import type { InboxFolder, ThreadPageDTO, ThreadSummaryDTO } from "@/lib/inbox/types";

export const runtime = "nodejs";

const VALID_FOLDERS: InboxFolder[] = [
  "inbox",
  "awaiting",
  "sent",
  "archived",
  "spam",
];

function decodeCursor(raw: string | null): { ts: string; id: string } | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const sep = decoded.lastIndexOf("|");
    if (sep < 0) return null;
    return { ts: decoded.slice(0, sep), id: decoded.slice(sep + 1) };
  } catch {
    return null;
  }
}

function encodeCursor(ts: string | null, id: string): string {
  return Buffer.from(`${ts ?? ""}|${id}`, "utf8").toString("base64url");
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const ctx = await resolveInboxRoute(request, params.get("workspaceId") ?? undefined, "read");

    const folderParam = (params.get("folder") ?? "inbox") as InboxFolder;
    const folder = VALID_FOLDERS.includes(folderParam) ? folderParam : "inbox";
    const limit = Math.min(Math.max(Number(params.get("limit")) || 30, 1), 50);
    const cursor = decodeCursor(params.get("cursor"));
    const previewDir = listPreviewDirection(folder);

    let query = ctx.secret
      .from("email_threads")
      .select(
        "id, subject, status, is_spam, direction_state, latest_direction, has_unread, last_message_at, assigned_human_id",
      )
      .eq("mailbox_id", ctx.mailbox.id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(limit + 1);

    query = applyFolderFilter(query as never, folder) as never;

    if (cursor && cursor.ts) {
      query = query.or(
        `last_message_at.lt."${cursor.ts}",and(last_message_at.eq."${cursor.ts}",id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const threadIds = pageRows.map((r) => String(r.id));
    const previewByThread = new Map<string, Record<string, unknown>>();
    const attachThreads = new Set<string>();

    if (threadIds.length > 0) {
      let msgQuery = ctx.secret
        .from("email_messages")
        .select(
          "id, thread_id, direction, from_address, from_name, to_addresses, text_body, html_body_sanitised, delivery_status, created_at",
        )
        .in("thread_id", threadIds)
        .order("created_at", { ascending: false });

      if (previewDir === "inbound" || previewDir === "outbound") {
        msgQuery = msgQuery.eq("direction", previewDir);
      }

      const { data: msgs } = await msgQuery;
      for (const m of msgs ?? []) {
        const tid = String(m.thread_id);
        if (!previewByThread.has(tid)) previewByThread.set(tid, m);
      }

      // Fallback: if a Sent thread somehow lacks outbound rows, show any message.
      if (previewDir !== "any") {
        const missing = threadIds.filter((id) => !previewByThread.has(id));
        if (missing.length > 0) {
          const { data: fallback } = await ctx.secret
            .from("email_messages")
            .select(
              "id, thread_id, direction, from_address, from_name, to_addresses, text_body, html_body_sanitised, delivery_status, created_at",
            )
            .in("thread_id", missing)
            .order("created_at", { ascending: false });
          for (const m of fallback ?? []) {
            const tid = String(m.thread_id);
            if (!previewByThread.has(tid)) previewByThread.set(tid, m);
          }
        }
      }

      const messageIds = [...previewByThread.values()].map((m) => String(m.id));
      if (messageIds.length > 0) {
        const { data: atts } = await ctx.secret
          .from("email_attachments")
          .select("message_id")
          .in("message_id", messageIds);
        const msgToThread = new Map(
          [...previewByThread.entries()].map(([tid, m]) => [String(m.id), tid]),
        );
        for (const a of atts ?? []) {
          const tid = msgToThread.get(String(a.message_id));
          if (tid) attachThreads.add(tid);
        }
      }
    }

    const threads: ThreadSummaryDTO[] = pageRows.map((r) => {
      const preview = previewByThread.get(String(r.id)) ?? {};
      const msgDir = String(preview.direction ?? r.latest_direction ?? "inbound");
      const peerKind =
        previewDir === "outbound"
          ? "to"
          : previewDir === "inbound"
            ? "from"
            : msgDir === "outbound"
              ? "to"
              : "from";
      return mapThreadRow({
        ...r,
        __preview_message: preview,
        __peer_kind: peerKind,
        __has_attachments: attachThreads.has(String(r.id)),
      });
    });

    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor((last.last_message_at as string) ?? null, String(last.id))
        : null;

    const body: ThreadPageDTO = { threads, nextCursor };
    return NextResponse.json(body);
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
