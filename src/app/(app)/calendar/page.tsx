"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { PageContainer, PageHeader } from "@/components/Page";
import { EmptyState } from "@/components/States";
import { Button } from "@/components/ui";
import { fetchCalendarData, patchCalendarPost } from "@/lib/calendar/client";
import type { CalendarListPayload, ContentPlatform, ContentPost, ContentPostStatus } from "@/lib/calendar/types";
import {
  SearchInput,
  SegmentedControl,
  StatGrid,
  StatusPill,
  Toolbar,
  WorkspaceCanvas,
  toneOf,
  type StatDef,
  type Tone,
} from "@/components/workspace/WorkspaceKit";
import { IntegrationsStrip } from "@/components/workspace/IntegrationsStrip";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  FileText,
  Grid3x3,
  ListChecks,
  Megaphone,
  Send,
  X,
} from "lucide-react";

type ViewMode = "month" | "week" | "list";

const PLATFORM_META: Record<ContentPlatform, { label: string; tone: Tone; short: string }> = {
  linkedin: { label: "LinkedIn", tone: "sky", short: "in" },
  instagram: { label: "Instagram", tone: "rose", short: "IG" },
  facebook: { label: "Facebook", tone: "indigo", short: "f" },
  x: { label: "X", tone: "slate", short: "X" },
  blog: { label: "Blog", tone: "violet", short: "B" },
  email: { label: "Email", tone: "amber", short: "@" },
};

const STATUS_META: Record<ContentPostStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "slate" },
  ready_for_approval: { label: "Needs approval", tone: "amber" },
  approved: { label: "Approved", tone: "emerald" },
  scheduled_later: { label: "Scheduled", tone: "sky" },
  published_later: { label: "Published", tone: "violet" },
  archived: { label: "Archived", tone: "slate" },
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CalendarPage() {
  const { state, backend } = useStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = state.workspace.id;

  const [data, setData] = useState<CalendarListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("month");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(() => new Date());
  const [platformFilter, setPlatformFilter] = useState<"all" | ContentPlatform>("all");
  const [dragPostId, setDragPostId] = useState<string | null>(null);
  const [dropDayKey, setDropDayKey] = useState<string | null>(null);

  const selectedPostId = searchParams.get("post");
  const selectedCampaignId = searchParams.get("campaign");

  const load = useCallback(async () => {
    if (backend !== "supabase" || !workspaceId) {
      setData({ campaigns: [], posts: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await fetchCalendarData({ workspaceId, query: query || undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load calendar.");
    } finally {
      setLoading(false);
    }
  }, [backend, workspaceId, query]);

  useEffect(() => { void load(); }, [load]);

  const posts = useMemo(() => {
    let list = data?.posts ?? [];
    if (platformFilter !== "all") list = list.filter((p) => p.platform === platformFilter);
    return list;
  }, [data, platformFilter]);

  const selectedPost = useMemo(() => data?.posts.find((p) => p.id === selectedPostId) ?? null, [data, selectedPostId]);
  const selectedCampaign = useMemo(() => data?.campaigns.find((c) => c.id === selectedCampaignId) ?? null, [data, selectedCampaignId]);

  const openDetail = (params: { post?: string; campaign?: string }) => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("post"); next.delete("campaign");
    if (params.post) next.set("post", params.post);
    if (params.campaign) next.set("campaign", params.campaign);
    router.replace(`/calendar?${next.toString()}`, { scroll: false });
  };
  const closeDetail = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("post"); next.delete("campaign");
    router.replace(next.toString() ? `/calendar?${next}` : "/calendar", { scroll: false });
  };

  const postsByDay = useMemo(() => {
    const map = new Map<string, ContentPost[]>();
    for (const p of posts) {
      if (!p.scheduledAt) continue;
      const key = dayKey(new Date(p.scheduledAt));
      (map.get(key) ?? map.set(key, []).get(key)!).push(p);
    }
    return map;
  }, [posts]);

  const unscheduled = useMemo(() => posts.filter((p) => !p.scheduledAt), [posts]);

  const stats = useMemo<StatDef[]>(() => {
    const all = data?.posts ?? [];
    const scheduled = all.filter((p) => p.scheduledAt).length;
    const drafts = all.filter((p) => p.status === "draft" || p.status === "ready_for_approval").length;
    return [
      { label: "Posts", value: all.length, icon: FileText, tone: "accent", hint: `${data?.campaigns.length ?? 0} campaigns` },
      { label: "Scheduled", value: scheduled, icon: Send, tone: "sky", hint: "On the calendar" },
      { label: "In draft", value: drafts, icon: FileText, tone: "amber", hint: "Not yet approved" },
      { label: "Campaigns", value: data?.campaigns.length ?? 0, icon: Megaphone, tone: "violet", hint: "Active & planned" },
    ];
  }, [data]);

  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const shift = (dir: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + dir, 1));

  const schedulePostOnDay = async (postId: string, day: Date) => {
    if (backend !== "supabase" || !workspaceId) return;
    const scheduled = new Date(day);
    scheduled.setHours(10, 0, 0, 0);
    const scheduledAt = scheduled.toISOString();
    const prev = data;
    setData((current) => {
      if (!current) return current;
      return {
        ...current,
        posts: current.posts.map((p) =>
          p.id === postId ? { ...p, scheduledAt, status: "scheduled_later" as const } : p,
        ),
      };
    });
    try {
      const { post } = await patchCalendarPost(workspaceId, postId, {
        scheduledAt,
        status: "scheduled_later",
      });
      setData((current) => {
        if (!current) return current;
        return {
          ...current,
          posts: current.posts.map((p) => (p.id === post.id ? post : p)),
        };
      });
    } catch (e) {
      setData(prev);
      setError(e instanceof Error ? e.message : "Could not reschedule post.");
    }
  };

  const isEmpty = !loading && !error && (data?.posts.length ?? 0) === 0 && (data?.campaigns.length ?? 0) === 0;

  return (
    <PageContainer wide>
      <PageHeader
        title="Content Calendar"
        subtitle="Plan, schedule, and approve every post across channels. Your marketing team fills it — you review and ship."
        icon={<CalendarDays className="h-5 w-5" />}
      />

      <WorkspaceCanvas>
        {backend !== "supabase" && (
          <div className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-sm text-amber-800">
            Connect a live workspace to see scheduled content. In demo mode, ask a Marketing employee to draft campaign posts.
          </div>
        )}

        {data && <StatGrid stats={stats} className="mb-5" />}

        <Toolbar>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl<ViewMode>
              value={view}
              onChange={setView}
              options={[
                { id: "month", label: "Month", icon: Grid3x3 },
                { id: "week", label: "Week", icon: CalendarRange },
                { id: "list", label: "List", icon: ListChecks },
              ]}
            />
            <PlatformFilter value={platformFilter} onChange={setPlatformFilter} />
          </div>
          <div className="flex items-center gap-2">
            {view !== "list" && (
              <div className="flex items-center gap-1">
                <button onClick={() => shift(-1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-ink-2 transition-colors hover:bg-muted">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-[140px] text-center text-sm font-semibold text-ink">{monthLabel}</span>
                <button onClick={() => shift(1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-ink-2 transition-colors hover:bg-muted">
                  <ChevronRight className="h-4 w-4" />
                </button>
                <Button size="sm" variant="ghost" onClick={() => setCursor(new Date())}>Today</Button>
              </div>
            )}
            <SearchInput value={query} onChange={setQuery} onSubmit={() => void load()} placeholder="Search posts…" className="w-44" />
          </div>
        </Toolbar>

        {loading && <p className="text-sm text-ink-3">Loading calendar…</p>}
        {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/8 px-4 py-3 text-sm text-rose-700">{error}</div>}

        {isEmpty && (
          <div className="rounded-2xl border border-border bg-surface">
            <EmptyState icon={CalendarDays} title="No content yet" description="Ask a marketing employee to draft campaign posts — they appear on this calendar automatically." />
          </div>
        )}

        {!loading && !isEmpty && view === "month" && (
          <MonthGrid
            cursor={cursor}
            postsByDay={postsByDay}
            dragPostId={dragPostId}
            dropDayKey={dropDayKey}
            onDragStart={setDragPostId}
            onDragEnd={() => {
              setDragPostId(null);
              setDropDayKey(null);
            }}
            onDropDay={(day) => {
              if (dragPostId) void schedulePostOnDay(dragPostId, day);
              setDragPostId(null);
              setDropDayKey(null);
            }}
            onDayDragEnter={setDropDayKey}
            onOpen={(id) => openDetail({ post: id })}
          />
        )}
        {!loading && !isEmpty && view === "week" && (
          <WeekStrip
            cursor={cursor}
            postsByDay={postsByDay}
            dragPostId={dragPostId}
            dropDayKey={dropDayKey}
            onDragStart={setDragPostId}
            onDragEnd={() => {
              setDragPostId(null);
              setDropDayKey(null);
            }}
            onDropDay={(day) => {
              if (dragPostId) void schedulePostOnDay(dragPostId, day);
              setDragPostId(null);
              setDropDayKey(null);
            }}
            onDayDragEnter={setDropDayKey}
            onOpen={(id) => openDetail({ post: id })}
          />
        )}
        {!loading && !isEmpty && view === "list" && (
          <ListView posts={posts} onOpen={(id) => openDetail({ post: id })} />
        )}

        {unscheduled.length > 0 && view !== "list" && (
          <div className="mt-5 rounded-2xl border border-border bg-surface p-4">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="section-title">Unscheduled backlog</span>
              <span className="rounded-md bg-ink/5 px-1.5 py-0.5 text-[10px] font-semibold text-ink-3">{unscheduled.length}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {unscheduled.map((p) => (
                <button
                  key={p.id}
                  draggable={backend === "supabase"}
                  onDragStart={() => setDragPostId(p.id)}
                  onDragEnd={() => setDragPostId(null)}
                  onClick={() => openDetail({ post: p.id })}
                  className="flex cursor-grab items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-left text-xs transition-colors hover:border-accent/40 hover:bg-accent-soft/40 active:cursor-grabbing"
                >
                  <PlatformDot platform={p.platform} />
                  <span className="max-w-[160px] truncate font-medium text-ink">{p.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <PlatformLegend />

        <IntegrationsStrip
          title="Publishing integrations"
          ids={["gcal", "outlook", "linkedin", "meta", "x", "buffer", "mailchimp", "slack", "zapier"]}
          defaultConnected={["linkedin"]}
        />
      </WorkspaceCanvas>

      {(selectedPost || selectedCampaign) && (
        <DetailPanel post={selectedPost} campaignName={selectedCampaign?.name} campaignDescription={selectedCampaign?.description} onClose={closeDetail} />
      )}
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// Month grid
// ---------------------------------------------------------------------------

function MonthGrid({
  cursor,
  postsByDay,
  dragPostId,
  dropDayKey,
  onDragStart,
  onDragEnd,
  onDropDay,
  onDayDragEnter,
  onOpen,
}: {
  cursor: Date;
  postsByDay: Map<string, ContentPost[]>;
  dragPostId: string | null;
  dropDayKey: string | null;
  onDragStart: (postId: string) => void;
  onDragEnd: () => void;
  onDropDay: (day: Date) => void;
  onDayDragEnter: (dayKey: string | null) => void;
  onOpen: (id: string) => void;
}) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const todayKey = dayKey(new Date());

  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="grid grid-cols-7 border-b border-border bg-muted/40">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const key = dayKey(d);
          const inMonth = d.getMonth() === month;
          const isToday = key === todayKey;
          const dayPosts = postsByDay.get(key) ?? [];
          return (
            <div
              key={key}
              className={cn(
                "min-h-[104px] border-b border-r border-border/60 p-1.5 transition-colors",
                i % 7 === 6 && "border-r-0",
                i >= 35 && "border-b-0",
                !inMonth && "bg-muted/30",
                dropDayKey === key && dragPostId && "bg-accent-soft/40 ring-2 ring-inset ring-accent/30",
              )}
              onDragOver={(e) => {
                if (!dragPostId) return;
                e.preventDefault();
                onDayDragEnter(key);
              }}
              onDragLeave={() => onDayDragEnter(null)}
              onDrop={(e) => {
                e.preventDefault();
                onDropDay(d);
              }}
            >
              <div className="mb-1 flex items-center justify-between px-0.5">
                <span
                  className={cn(
                    "flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold",
                    isToday ? "bg-accent text-white" : inMonth ? "text-ink-2" : "text-ink-3",
                  )}
                >
                  {d.getDate()}
                </span>
                {dayPosts.length > 2 && <span className="text-[10px] font-medium text-ink-3">{dayPosts.length}</span>}
              </div>
              <div className="space-y-1">
                {dayPosts.slice(0, 3).map((p) => (
                  <DayChip
                    key={p.id}
                    post={p}
                    draggable
                    onDragStart={() => onDragStart(p.id)}
                    onDragEnd={onDragEnd}
                    onClick={() => onOpen(p.id)}
                  />
                ))}
                {dayPosts.length > 3 && (
                  <div className="px-1 text-[10px] font-medium text-ink-3">+{dayPosts.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayChip({
  post,
  onClick,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  post: ContentPost;
  onClick: () => void;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const meta = PLATFORM_META[post.platform];
  const t = toneOf(meta.tone);
  return (
    <button
      draggable={draggable}
      onDragStart={(e) => {
        onDragStart?.();
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[10.5px] font-medium transition-transform hover:scale-[1.02]",
        draggable && "cursor-grab active:cursor-grabbing",
        t.soft,
        t.text,
      )}
      title={post.title}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", t.bar)} />
      <span className="truncate">{post.title}</span>
    </button>
  );
}

function WeekStrip({
  cursor,
  postsByDay,
  dragPostId,
  dropDayKey,
  onDragStart,
  onDragEnd,
  onDropDay,
  onDayDragEnter,
  onOpen,
}: {
  cursor: Date;
  postsByDay: Map<string, ContentPost[]>;
  dragPostId: string | null;
  dropDayKey: string | null;
  onDragStart: (postId: string) => void;
  onDragEnd: () => void;
  onDropDay: (day: Date) => void;
  onDayDragEnter: (dayKey: string | null) => void;
  onOpen: (id: string) => void;
}) {
  const start = new Date(cursor);
  start.setDate(cursor.getDate() - cursor.getDay());
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const todayKey = dayKey(new Date());
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-7">
      {days.map((d) => {
        const key = dayKey(d);
        const dayPosts = postsByDay.get(key) ?? [];
        const isToday = key === todayKey;
        return (
          <div
            key={key}
            className={cn(
              "rounded-2xl border border-border bg-surface p-2 transition-colors",
              dropDayKey === key && dragPostId && "border-accent/40 bg-accent-soft/30",
            )}
            onDragOver={(e) => {
              if (!dragPostId) return;
              e.preventDefault();
              onDayDragEnter(key);
            }}
            onDragLeave={() => onDayDragEnter(null)}
            onDrop={(e) => {
              e.preventDefault();
              onDropDay(d);
            }}
          >
            <div className={cn("mb-2 flex items-center gap-1.5 px-1", isToday && "text-accent")}>
              <span className="text-[11px] font-semibold uppercase tracking-wide">{WEEKDAYS[d.getDay()]}</span>
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold", isToday ? "bg-accent text-white" : "text-ink-2")}>{d.getDate()}</span>
            </div>
            <div className="space-y-1.5">
              {dayPosts.length === 0 ? (
                <p className="px-1 py-3 text-center text-[10px] text-ink-3">—</p>
              ) : (
                dayPosts.map((p) => (
                  <DayChip
                    key={p.id}
                    post={p}
                    draggable
                    onDragStart={() => onDragStart(p.id)}
                    onDragEnd={onDragEnd}
                    onClick={() => onOpen(p.id)}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListView({ posts, onOpen }: { posts: ContentPost[]; onOpen: (id: string) => void }) {
  const sorted = [...posts].sort((a, b) => {
    const at = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Infinity;
    const bt = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Infinity;
    return at - bt;
  });
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      {sorted.map((p, i) => {
        const meta = PLATFORM_META[p.platform];
        return (
          <button
            key={p.id}
            onClick={() => onOpen(p.id)}
            className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50", i < sorted.length - 1 && "border-b border-border/60")}
          >
            <PlatformDot platform={p.platform} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">{p.title}</div>
              <div className="text-[11px] text-ink-3">{meta.label}{p.campaignName ? ` · ${p.campaignName}` : ""}</div>
            </div>
            <StatusPill tone={STATUS_META[p.status].tone} label={STATUS_META[p.status].label} />
            <span className="hidden w-24 text-right text-xs text-ink-3 sm:inline">
              {p.scheduledAt ? new Date(p.scheduledAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Unscheduled"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PlatformDot({ platform }: { platform: ContentPlatform }) {
  const meta = PLATFORM_META[platform];
  const t = toneOf(meta.tone);
  return (
    <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[9px] font-bold", t.soft, t.text)}>
      {meta.short}
    </span>
  );
}

function PlatformFilter({ value, onChange }: { value: "all" | ContentPlatform; onChange: (v: "all" | ContentPlatform) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as "all" | ContentPlatform)}
      className="h-9 rounded-xl border border-border bg-surface px-3 text-[13px] text-ink-2 outline-none transition-colors hover:border-accent/40 focus:border-accent"
    >
      <option value="all">All channels</option>
      {(Object.keys(PLATFORM_META) as ContentPlatform[]).map((p) => (
        <option key={p} value={p}>{PLATFORM_META[p].label}</option>
      ))}
    </select>
  );
}

function PlatformLegend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 px-1">
      {(Object.keys(PLATFORM_META) as ContentPlatform[]).map((p) => {
        const meta = PLATFORM_META[p];
        return (
          <span key={p} className="inline-flex items-center gap-1.5 text-[11px] text-ink-3">
            <span className={cn("h-2 w-2 rounded-full", toneOf(meta.tone).bar)} />
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}

function DetailPanel({
  post,
  campaignName,
  campaignDescription,
  onClose,
}: {
  post: ContentPost | null;
  campaignName?: string;
  campaignDescription?: string | null;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-border bg-surface shadow-panel">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <span className="text-sm font-semibold text-ink">{post ? "Post details" : "Campaign"}</span>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-muted hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          {post && (
            <>
              <div className="flex items-center gap-2">
                <PlatformDot platform={post.platform} />
                <StatusPill tone={STATUS_META[post.status].tone} label={STATUS_META[post.status].label} />
              </div>
              <h2 className="text-lg font-bold text-ink">{post.title}</h2>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
                {post.campaignName && <span>Campaign: {post.campaignName}</span>}
                {post.scheduledAt && <span>Scheduled: {new Date(post.scheduledAt).toLocaleString()}</span>}
              </div>
              <div className="whitespace-pre-wrap rounded-xl border border-border bg-muted/40 p-4 text-sm leading-relaxed text-ink-2">
                {post.body}
              </div>
            </>
          )}
          {!post && campaignName && (
            <>
              <h2 className="text-lg font-bold text-ink">{campaignName}</h2>
              {campaignDescription && <p className="text-sm text-ink-2">{campaignDescription}</p>}
            </>
          )}
        </div>
      </div>
    </>
  );
}
