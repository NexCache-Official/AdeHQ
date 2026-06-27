"use client";

import { useStore } from "@/lib/demo-store";
import { useShellUI } from "@/components/AppShell";
import { PageContainer, PageHeader } from "@/components/Page";
import { ProjectRoomCard } from "@/components/ProjectRoomCard";
import { Button } from "@/components/ui";
import { EmptyState } from "@/components/States";
import { Hash, Plus } from "lucide-react";

export default function RoomsPage() {
  const { state } = useStore();
  const ui = useShellUI();
  const channels = state.rooms.filter((r) => r.kind !== "dm");

  return (
    <PageContainer wide>
      <PageHeader
        title="Channels"
        subtitle="Group spaces where you and your AI employees work together. Mention an employee with @ to give them a task — or DM one directly from the sidebar."
        icon={<Hash className="h-5 w-5" />}
        actions={
          <Button onClick={ui.openCreateRoom}>
            <Plus className="h-4 w-4" /> Create Channel
          </Button>
        }
      />

      {channels.length === 0 ? (
        <EmptyState
          icon={Hash}
          title="No channels yet"
          description="Create a channel and drop your AI employees in to start collaborating."
          action={{ label: "Create your first channel", onClick: ui.openCreateRoom }}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {channels.map((room) => (
            <ProjectRoomCard key={room.id} room={room} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
