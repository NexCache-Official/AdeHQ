"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { PageContainer, PageHeader } from "@/components/Page";
import { EmptyState } from "@/components/States";
import { Button } from "@/components/ui";
import { fetchCalendarData } from "@/lib/calendar/client";
import type { CalendarListPayload, ContentCampaign, ContentPost } from "@/lib/calendar/types";
import { cn } from "@/lib/utils";
import { CalendarDays, Megaphone, Search } from "lucide-react";

type Tab = "posts" | "campaigns";

export default function CalendarPage() {
  const { state, backend } = useStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = state.workspace.id;

  const [data, setData] = useState<CalendarListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("posts");
  const [query, setQuery] = useState("");

  const selectedCampaignId = searchParams.get("campaign");
  const selectedPostId = searchParams.get("post");

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

  useEffect(() => {
    void load();
  }, [load]);

  const selectedCampaign = useMemo(
    () => data?.campaigns.find((c) => c.id === selectedCampaignId) ?? null,
    [data, selectedCampaignId],
  );
  const selectedPost = useMemo(
    () => data?.posts.find((p) => p.id === selectedPostId) ?? null,
    [data, selectedPostId],
  );

  const openDetail = (params: { campaign?: string; post?: string }) => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("campaign");
    next.delete("post");
    if (params.campaign) next.set("campaign", params.campaign);
    if (params.post) next.set("post", params.post);
    router.push(`/calendar?${next.toString()}`);
  };

  const closeDetail = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("campaign");
    next.delete("post");
    router.push(`/calendar?${next.toString()}`);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Content Calendar"
        subtitle="Campaigns and social drafts created by your marketing team."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm"
            placeholder="Search campaigns and posts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void load()}
          />
        </div>
        <Button variant="secondary" onClick={() => void load()}>
          Search
        </Button>
        <div className="flex rounded-lg border p-1">
          {(["posts", "campaigns"] as Tab[]).map((key) => (
            <button
              key={key}
              type="button"
              className={cn(
                "rounded-md px-3 py-1.5 text-sm capitalize",
                tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
              onClick={() => setTab(key)}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading calendar…</p>}

      {!loading && tab === "posts" && (
        <div className="space-y-2">
          {(data?.posts ?? []).length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No posts yet"
              description="Ask a marketing employee to draft campaign posts — they will appear here."
            />
          ) : (
            data?.posts.map((post) => (
              <PostRow key={post.id} post={post} onOpen={() => openDetail({ post: post.id })} />
            ))
          )}
        </div>
      )}

      {!loading && tab === "campaigns" && (
        <div className="space-y-2">
          {(data?.campaigns ?? []).length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title="No campaigns yet"
              description="Create a campaign from chat with social.createCampaign."
            />
          ) : (
            data?.campaigns.map((campaign) => (
              <CampaignRow
                key={campaign.id}
                campaign={campaign}
                onOpen={() => openDetail({ campaign: campaign.id })}
              />
            ))
          )}
        </div>
      )}

      {(selectedPost || selectedCampaign) && (
        <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md border-l bg-background p-6 shadow-xl">
          <Button variant="ghost" className="mb-4" onClick={closeDetail}>
            Close
          </Button>
          {selectedPost && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">{selectedPost.title}</h2>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {selectedPost.platform} · {selectedPost.status}
              </p>
              {selectedPost.campaignName && (
                <p className="text-sm text-muted-foreground">Campaign: {selectedPost.campaignName}</p>
              )}
              {selectedPost.scheduledAt && (
                <p className="text-sm">Scheduled: {new Date(selectedPost.scheduledAt).toLocaleString()}</p>
              )}
              <div className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-4 text-sm">
                {selectedPost.body}
              </div>
            </div>
          )}
          {selectedCampaign && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">{selectedCampaign.name}</h2>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{selectedCampaign.status}</p>
              {selectedCampaign.description && (
                <p className="text-sm text-muted-foreground">{selectedCampaign.description}</p>
              )}
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}

function PostRow({ post, onOpen }: { post: ContentPost; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start justify-between rounded-xl border bg-card px-4 py-3 text-left hover:bg-muted/40"
    >
      <div>
        <div className="font-medium">{post.title}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {post.platform} · {post.status}
          {post.campaignName ? ` · ${post.campaignName}` : ""}
        </div>
      </div>
      {post.scheduledAt && (
        <span className="text-xs text-muted-foreground">
          {new Date(post.scheduledAt).toLocaleDateString()}
        </span>
      )}
    </button>
  );
}

function CampaignRow({ campaign, onOpen }: { campaign: ContentCampaign; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start justify-between rounded-xl border bg-card px-4 py-3 text-left hover:bg-muted/40"
    >
      <div>
        <div className="font-medium">{campaign.name}</div>
        {campaign.description && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{campaign.description}</p>
        )}
      </div>
      <span className="text-xs uppercase text-muted-foreground">{campaign.status}</span>
    </button>
  );
}
