"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Loader2, ExternalLink, AlertTriangle, Link2, Sparkles } from "lucide-react";
import { workAssignableEmployees } from "@/lib/maya-employee";
import { useStore } from "@/lib/demo-store";
import {
  fetchThreadWorkContext,
  inboxAskEmployee,
  inboxAttachDeal,
  inboxCreateProposal,
  inboxCreateTask,
  inboxLinkRoom,
  inboxLinkTopic,
  inboxPrepareProposal,
  inboxSaveDecision,
  inboxSaveMemory,
  inboxStartRoom,
  inboxUnlinkWork,
} from "@/lib/inbox/client";
import { cn } from "@/lib/utils";

type PanelProps = {
  workspaceId: string;
  threadId: string;
  canOrganize: boolean;
  defaultTaskTitle?: string;
};

type MenuAction =
  | "start_room"
  | "link_room"
  | "link_topic"
  | "create_task"
  | "ask_employee"
  | "create_proposal"
  | "prepare_proposal"
  | "save_decision"
  | "save_memory"
  | "attach_deal"
  | null;

export function EmailWorkPanel({
  workspaceId,
  threadId,
  canOrganize,
  defaultTaskTitle,
}: PanelProps) {
  const { state } = useStore();
  const rooms = state.rooms.filter((r) => r.kind === "room" && r.status !== "archived");
  const employees = workAssignableEmployees(state.employees);
  const [deals, setDeals] = useState<Array<{ id: string; name: string }>>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<MenuAction>(null);
  const [lastCard, setLastCard] = useState<{
    title: string;
    subtitle: string;
    href: string | null;
  } | null>(null);

  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof fetchThreadWorkContext>> | null>(
    null,
  );

  // Form fields
  const [roomId, setRoomId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [askTarget, setAskTarget] = useState<"dm" | "room" | "start_room">("dm");
  const [taskTitle, setTaskTitle] = useState("");
  const [topicTitle, setTopicTitle] = useState("");
  const [decision, setDecision] = useState("");
  const [rationale, setRationale] = useState("");
  const [dealId, setDealId] = useState("");
  const [memoryText, setMemoryText] = useState("");

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchThreadWorkContext({ workspaceId, threadId });
      setCtx(data);
      if (!taskTitle) {
        setTaskTitle(defaultTaskTitle || data.workContext.subject || "Follow up");
      }
      if (data.keyPointSuggestions[0] && !memoryText) {
        setMemoryText(data.keyPointSuggestions[0]);
      }
      if (rooms[0] && !roomId) setRoomId(rooms[0].id);
      if (employees[0] && !employeeId) setEmployeeId(employees[0].id);
      try {
        const { authHeaders } = await import("@/lib/api/auth-client");
        const headers = await authHeaders();
        const res = await fetch(
          `/api/inbox/deals?workspaceId=${encodeURIComponent(workspaceId)}`,
          { headers, cache: "no-store" },
        );
        if (res.ok) {
          const body = (await res.json()) as { deals?: Array<{ id: string; name: string }> };
          setDeals(body.deals ?? []);
        }
      } catch {
        /* optional */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load work context");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, threadId]);

  const run = async (fn: () => Promise<unknown>, card?: typeof lastCard) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (card) setLastCard(card);
      setAction(null);
      setMenuOpen(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !ctx) {
    return (
      <div className="flex items-center gap-2 p-5 text-sm text-ink-3">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading linked work…
      </div>
    );
  }

  if (!ctx) {
    return <p className="p-5 text-sm text-rose-700">{error ?? "Unavailable"}</p>;
  }

  return (
    <div className="space-y-4 p-5 text-sm">
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </p>
      )}

      {ctx.recommendedAction.kind !== "none" && canOrganize && (
        <div className="rounded-xl border border-accent/30 bg-accent-soft/50 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-accent-d">
            Suggested next step
          </p>
          <p className="mt-1 text-ink">{ctx.recommendedAction.detail}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (ctx.recommendedAction.kind === "create_task") setAction("create_task");
                else if (ctx.recommendedAction.kind === "start_room") {
                  void run(
                    () => inboxStartRoom({ workspaceId, threadId }),
                    {
                      title: "Room started",
                      subtitle: "Privacy-safe email bridge seeded",
                      href: null,
                    },
                  );
                } else setAction("save_memory");
              }}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {ctx.recommendedAction.label}
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-muted"
            >
              Choose another action
            </button>
          </div>
        </div>
      )}

      {(menuOpen || ctx.recommendedAction.kind === "none") && canOrganize && (
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["start_room", "Start room"],
              ["link_room", "Link to room"],
              ["link_topic", "Move to topic"],
              ["create_task", "Create task"],
              ["ask_employee", "Ask employee"],
              ["create_proposal", "Create proposal workspace"],
              ["prepare_proposal", "Prepare proposal with AI"],
              ["save_decision", "Save decision"],
              ["save_memory", "Save important facts"],
              ["attach_deal", "Attach deal"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setAction(key)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                action === key
                  ? "border-accent bg-accent-soft text-accent-d"
                  : "border-border text-ink-2 hover:bg-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {action === "start_room" && (
        <ActionBox
          busy={busy}
          onCancel={() => setAction(null)}
          onConfirm={() =>
            void run(
              () => inboxStartRoom({ workspaceId, threadId }),
              { title: "Room started", subtitle: "From this email", href: null },
            )
          }
        >
          Creates a new project room and seeds a privacy-safe bridge (excerpt only — not the full
          email).
        </ActionBox>
      )}

      {action === "link_room" && (
        <ActionBox
          busy={busy}
          onCancel={() => setAction(null)}
          onConfirm={() =>
            void run(
              () => inboxLinkRoom({ workspaceId, threadId, roomId }),
              {
                title: "Room linked",
                subtitle: rooms.find((r) => r.id === roomId)?.name ?? roomId,
                href: `/rooms/${roomId}`,
              },
            )
          }
        >
          <label className="block text-xs text-ink-3">
            Room
            <select
              className="mt-1 w-full rounded-lg border border-border bg-canvas px-2 py-1.5 text-ink"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            >
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        </ActionBox>
      )}

      {action === "link_topic" && (
        <ActionBox
          busy={busy}
          onCancel={() => setAction(null)}
          onConfirm={() =>
            void run(
              () =>
                inboxLinkTopic({
                  workspaceId,
                  threadId,
                  roomId,
                  topicTitle: topicTitle.trim() || undefined,
                }),
              {
                title: topicTitle.trim() || "Topic linked",
                subtitle: rooms.find((r) => r.id === roomId)?.name ?? roomId,
                href: `/rooms/${roomId}`,
              },
            )
          }
        >
          <RoomSelect rooms={rooms} roomId={roomId} setRoomId={setRoomId} />
          <label className="mt-2 block text-xs text-ink-3">
            New topic title (optional — uses General if empty)
            <input
              className="mt-1 w-full rounded-lg border border-border bg-canvas px-2 py-1.5 text-ink"
              value={topicTitle}
              onChange={(e) => setTopicTitle(e.target.value)}
              placeholder="e.g. Vendor follow-up"
            />
          </label>
        </ActionBox>
      )}

      {action === "create_task" && (
        <ActionBox
          busy={busy}
          onCancel={() => setAction(null)}
          onConfirm={() =>
            void run(
              () =>
                inboxCreateTask({
                  workspaceId,
                  threadId,
                  roomId,
                  title: taskTitle,
                  assigneeEmployeeId: employeeId || null,
                }),
              {
                title: taskTitle,
                subtitle: `${rooms.find((r) => r.id === roomId)?.name ?? "Room"} · task`,
                href: `/rooms/${roomId}`,
              },
            )
          }
        >
          <label className="block text-xs text-ink-3">
            Title
            <input
              className="mt-1 w-full rounded-lg border border-border bg-canvas px-2 py-1.5 text-ink"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
            />
          </label>
          <label className="mt-2 block text-xs text-ink-3">
            Room
            <select
              className="mt-1 w-full rounded-lg border border-border bg-canvas px-2 py-1.5 text-ink"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            >
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-2 block text-xs text-ink-3">
            Assign AI (optional)
            <select
              className="mt-1 w-full rounded-lg border border-border bg-canvas px-2 py-1.5 text-ink"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
        </ActionBox>
      )}

      {action === "ask_employee" && (
        <ActionBox
          busy={busy}
          onCancel={() => setAction(null)}
          onConfirm={() => {
            void (async () => {
              setBusy(true);
              setError(null);
              try {
                let targetRoomId = roomId;
                if (askTarget === "start_room") {
                  const started = (await inboxStartRoom({
                    workspaceId,
                    threadId,
                  })) as { roomId?: string };
                  if (!started.roomId) throw new Error("Failed to start room");
                  targetRoomId = started.roomId;
                } else if (askTarget === "room") {
                  await inboxLinkRoom({
                    workspaceId,
                    threadId,
                    roomId: targetRoomId,
                    seedBridge: false,
                  }).catch(() => {
                    /* already linked is fine */
                  });
                }
                await inboxAskEmployee({
                  workspaceId,
                  threadId,
                  employeeId,
                  target: askTarget === "dm" ? "dm" : "room",
                  roomId: askTarget === "dm" ? undefined : targetRoomId,
                });
                setLastCard({
                  title: `Asked ${employees.find((e) => e.id === employeeId)?.name ?? "employee"}`,
                  subtitle:
                    askTarget === "dm"
                      ? "Private DM — internal only, no outbound email"
                      : askTarget === "start_room"
                        ? "New room + internal ask"
                        : rooms.find((r) => r.id === targetRoomId)?.name ?? "Room",
                  href: askTarget === "dm" ? "/dm" : `/rooms/${targetRoomId}`,
                });
                setAction(null);
                setMenuOpen(false);
                await reload();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Action failed");
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          <p className="mb-2 text-[11px] text-ink-3">
            Never creates a room silently and never sends external email. Choose where to ask.
          </p>
          <label className="block text-xs text-ink-3">
            Employee
            <select
              className="mt-1 w-full rounded-lg border border-border bg-canvas px-2 py-1.5 text-ink"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-2 flex flex-col gap-1.5 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={askTarget === "dm"}
                onChange={() => setAskTarget("dm")}
              />
              Ask privately in DM
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={askTarget === "start_room"}
                onChange={() => setAskTarget("start_room")}
              />
              Start new room, then ask
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={askTarget === "room"}
                onChange={() => setAskTarget("room")}
              />
              Link existing room, then ask
            </label>
          </div>
          {askTarget === "room" && (
            <select
              className="mt-2 w-full rounded-lg border border-border bg-canvas px-2 py-1.5 text-ink"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            >
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
        </ActionBox>
      )}

      {action === "create_proposal" && (
        <ActionBox
          busy={busy}
          onCancel={() => setAction(null)}
          onConfirm={() =>
            void run(
              () => inboxCreateProposal({ workspaceId, threadId, roomId }),
              {
                title: "Proposal workspace created",
                subtitle: rooms.find((r) => r.id === roomId)?.name ?? "",
                href: `/rooms/${roomId}`,
              },
            )
          }
        >
          <RoomSelect rooms={rooms} roomId={roomId} setRoomId={setRoomId} />
          <p className="mt-2 text-[11px] text-ink-3">
            Cheap sync placeholder — use Prepare with AI to generate content (Work Hours).
          </p>
        </ActionBox>
      )}

      {action === "prepare_proposal" && (
        <ActionBox
          busy={busy}
          onCancel={() => setAction(null)}
          onConfirm={() =>
            void run(
              () =>
                inboxPrepareProposal({
                  workspaceId,
                  threadId,
                  roomId,
                  employeeId,
                }),
              {
                title: "AI proposal queued",
                subtitle: "Async job — consumes Work Hours",
                href: `/rooms/${roomId}`,
              },
            )
          }
        >
          <RoomSelect rooms={rooms} roomId={roomId} setRoomId={setRoomId} />
          <label className="mt-2 block text-xs text-ink-3">
            Employee
            <select
              className="mt-1 w-full rounded-lg border border-border bg-canvas px-2 py-1.5 text-ink"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
        </ActionBox>
      )}

      {action === "save_decision" && (
        <ActionBox
          busy={busy}
          onCancel={() => setAction(null)}
          onConfirm={() =>
            void run(
              () =>
                inboxSaveDecision({
                  workspaceId,
                  threadId,
                  roomId,
                  decisionStatement: decision,
                  rationale,
                }),
              {
                title: "Decision saved",
                subtitle: decision.slice(0, 80),
                href: `/rooms/${roomId}`,
              },
            )
          }
        >
          <RoomSelect rooms={rooms} roomId={roomId} setRoomId={setRoomId} />
          <label className="mt-2 block text-xs text-ink-3">
            Decision
            <textarea
              className="mt-1 w-full rounded-lg border border-border bg-canvas px-2 py-1.5 text-ink"
              rows={2}
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
            />
          </label>
          <label className="mt-2 block text-xs text-ink-3">
            Rationale
            <textarea
              className="mt-1 w-full rounded-lg border border-border bg-canvas px-2 py-1.5 text-ink"
              rows={2}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
          </label>
        </ActionBox>
      )}

      {action === "save_memory" && (
        <ActionBox
          busy={busy}
          onCancel={() => setAction(null)}
          onConfirm={() =>
            void run(
              () =>
                inboxSaveMemory({
                  workspaceId,
                  threadId,
                  title: memoryText.slice(0, 72) || "Email fact",
                  content: memoryText,
                  roomId: roomId || null,
                }),
              {
                title: "Fact saved to memory",
                subtitle: "Message-level provenance retained",
                href: "/memory",
              },
            )
          }
        >
          <p className="mb-2 text-[11px] text-ink-3">
            Confirm to save — full email body is never auto-dumped into memory.
          </p>
          <textarea
            className="w-full rounded-lg border border-border bg-canvas px-2 py-1.5 text-ink"
            rows={3}
            value={memoryText}
            onChange={(e) => setMemoryText(e.target.value)}
          />
          {ctx.keyPointSuggestions.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {ctx.keyPointSuggestions.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setMemoryText(p)}
                  className="rounded-full border border-border px-2 py-0.5 text-[10px] text-ink-2 hover:bg-muted"
                >
                  {p.slice(0, 40)}
                </button>
              ))}
            </div>
          )}
        </ActionBox>
      )}

      {action === "attach_deal" && (
        <ActionBox
          busy={busy}
          onCancel={() => setAction(null)}
          onConfirm={() =>
            void run(
              () => inboxAttachDeal({ workspaceId, threadId, dealId }),
              {
                title: "Deal attached",
                subtitle: deals.find((d) => d.id === dealId)?.name ?? dealId,
                href: "/crm",
              },
            )
          }
        >
          <label className="block text-xs text-ink-3">
            Existing deal
            <select
              className="mt-1 w-full rounded-lg border border-border bg-canvas px-2 py-1.5 text-ink"
              value={dealId}
              onChange={(e) => setDealId(e.target.value)}
            >
              <option value="">Choose…</option>
              {deals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          {deals.length === 0 && (
            <p className="mt-2 text-[11px] text-ink-3">No deals in this workspace yet.</p>
          )}
        </ActionBox>
      )}

      {lastCard && (
        <div className="rounded-xl border border-border bg-surface px-4 py-3 shadow-sm">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 text-accent-d" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">{lastCard.title}</p>
              <p className="text-xs text-ink-3">{lastCard.subtitle}</p>
              {lastCard.href && (
                <a
                  href={lastCard.href}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-d hover:underline"
                >
                  Open <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          <Link2 className="h-3 w-3" /> Linked work
        </p>
        {ctx.linkedWork.length === 0 ? (
          <p className="text-xs text-ink-3">Nothing linked yet.</p>
        ) : (
          <ul className="space-y-2">
            {ctx.linkedWork.map((item) => (
              <li
                key={item.edgeId}
                className="rounded-lg border border-border bg-canvas px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{item.title}</p>
                    <p className="text-[11px] text-ink-3">
                      {item.relationType.replace(/_/g, " ")} · {item.objectType}
                    </p>
                    {item.provenance?.sourceSnapshotAt && (
                      <p className="mt-0.5 text-[10px] text-ink-3">
                        From email state at{" "}
                        {new Date(item.provenance.sourceSnapshotAt).toLocaleString()}
                      </p>
                    )}
                    {item.stale && (
                      <p className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-amber-800">
                        <AlertTriangle className="h-3 w-3" /> Based on older email context
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {item.href && (
                      <a
                        href={item.href}
                        className="text-[11px] font-medium text-accent-d hover:underline"
                      >
                        Open
                      </a>
                    )}
                    {canOrganize && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            inboxUnlinkWork({
                              workspaceId,
                              threadId,
                              edgeId: item.edgeId,
                            }),
                          )
                        }
                        className="text-[10px] text-ink-3 underline hover:text-ink"
                      >
                        Unlink
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RoomSelect({
  rooms,
  roomId,
  setRoomId,
}: {
  rooms: Array<{ id: string; name: string }>;
  roomId: string;
  setRoomId: (id: string) => void;
}) {
  return (
    <label className="block text-xs text-ink-3">
      Room
      <select
        className="mt-1 w-full rounded-lg border border-border bg-canvas px-2 py-1.5 text-ink"
        value={roomId}
        onChange={(e) => setRoomId(e.target.value)}
      >
        {rooms.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ActionBox({
  children,
  busy,
  onCancel,
  onConfirm,
}: {
  children: ReactNode;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/40 px-3 py-3">
      {children}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Working…" : "Confirm"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-xs text-ink-2 hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
