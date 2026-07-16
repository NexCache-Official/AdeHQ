/**
 * GET /api/inbox/threads?workspaceId=&folder=&cursor=&limit=&label=
 *
 * Query-based folders + keyset pagination. List-row preview is folder-aware:
 * Inbox → last inbound; Sent / Awaiting → last outbound.
 * Optional `label` filters to threads carrying that label id.
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
  "ai_working",
  "needs_input",
  "needs_approval",
  "assigned_to_me",
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
    const labelFilter = params.get("label")?.trim() || null;

    let labelThreadIds: string[] | null = null;
    if (labelFilter) {
      const { data: labeled, error: labelError } = await ctx.secret
        .from("email_thread_labels")
        .select("thread_id")
        .eq("workspace_id", ctx.workspaceId)
        .eq("label_id", labelFilter);
      if (labelError) throw labelError;
      labelThreadIds = [...new Set((labeled ?? []).map((r) => String(r.thread_id)))];
      if (labelThreadIds.length === 0) {
        return NextResponse.json({ threads: [], nextCursor: null } satisfies ThreadPageDTO);
      }
    }

    let query = ctx.secret
      .from("email_threads")
      .select(
        "id, subject, status, is_spam, direction_state, latest_direction, has_unread, last_message_at, assigned_human_id, assigned_employee_id, suggested_employee_id, priority, reply_required, triage_status, draft_status, category, steward_meta, latest_draft_id, mission_status, mission_owner_employee_id, last_wake_at, origin_room_id, origin_topic_id",
      )
      .eq("mailbox_id", ctx.mailbox.id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(limit + 1);

    query = applyFolderFilter(query as never, folder) as never;

    if (folder === "assigned_to_me") {
      query = query.eq("assigned_human_id", ctx.user.id) as never;
    }
    if (labelThreadIds) {
      query = query.in("id", labelThreadIds) as never;
    }

    if (cursor && cursor.ts) {
      query = query.or(
        `last_message_at.lt."${cursor.ts}",and(last_message_at.eq."${cursor.ts}",id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = data ?? [];
    let pageSource = rows;

    // Refine needs_approval: AI drafts with pending/requested approval, not stale.
    if (folder === "needs_approval" && rows.length > 0) {
      const draftIds = rows
        .map((r) => r.latest_draft_id)
        .filter(Boolean)
        .map(String);
      const eligible = new Set<string>();
      if (draftIds.length > 0) {
        const { data: draftRows } = await ctx.secret
          .from("email_drafts")
          .select("id, is_stale, status, current_version_id, requires_approval, origin_type")
          .in("id", draftIds);
        const draftById = new Map((draftRows ?? []).map((d) => [String(d.id), d]));

        const { data: approvals } = await ctx.secret
          .from("email_approvals")
          .select("draft_id, draft_version_id, status, expires_at")
          .in("draft_id", draftIds)
          .eq("status", "pending");

        for (const a of approvals ?? []) {
          const draft = draftById.get(String(a.draft_id));
          if (!draft || draft.is_stale) continue;
          if (String(draft.current_version_id) !== String(a.draft_version_id)) continue;
          if (a.expires_at && new Date(String(a.expires_at)).getTime() < Date.now()) continue;
          eligible.add(String(a.draft_id));
        }

        for (const d of draftRows ?? []) {
          if (d.is_stale) continue;
          if (!(d.requires_approval || d.origin_type === "ai_employee")) continue;
          if (
            d.status === "pending_approval" ||
            d.status === "draft" ||
            eligible.has(String(d.id))
          ) {
            eligible.add(String(d.id));
          }
        }
      }
      pageSource = rows.filter((r) =>
        r.latest_draft_id ? eligible.has(String(r.latest_draft_id)) : false,
      );
    }

    const hasMore = pageSource.length > limit;
    const pageRows = hasMore ? pageSource.slice(0, limit) : pageSource;

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

    const labelsByThread = new Map<
      string,
      Array<{ id: string; name: string; color: string | null }>
    >();
    if (threadIds.length > 0) {
      const { data: labelRows } = await ctx.secret
        .from("email_thread_labels")
        .select("thread_id, label_id, email_labels(id, name, color)")
        .eq("workspace_id", ctx.workspaceId)
        .in("thread_id", threadIds);
      for (const row of labelRows ?? []) {
        const tid = String(row.thread_id);
        const label = row.email_labels as unknown as {
          id?: string;
          name?: string;
          color?: string | null;
        } | null;
        const entry = {
          id: String(label?.id ?? row.label_id),
          name: String(label?.name ?? ""),
          color: label?.color ? String(label.color) : null,
        };
        const list = labelsByThread.get(tid) ?? [];
        list.push(entry);
        labelsByThread.set(tid, list);
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
        __labels: labelsByThread.get(String(r.id)) ?? [],
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
