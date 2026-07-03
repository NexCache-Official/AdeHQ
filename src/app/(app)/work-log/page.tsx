"use client";

import { useState } from "react";
import { useStore } from "@/lib/demo-store";
import { getGroupRooms } from "@/lib/rooms";
import { PageContainer, PageHeader } from "@/components/Page";
import { WorkLogTimeline } from "@/components/WorkLogTimeline";
import { Card } from "@/components/ui";
import { EmptyState } from "@/components/States";
import { shouldShowWorkLogInUserFeed } from "@/lib/work-log-labels";
import { ScrollText } from "lucide-react";

export default function WorkLogPage() {
  const { state } = useStore();
  const [employee, setEmployee] = useState("all");
  const [room, setRoom] = useState("all");
  const [statusF, setStatusF] = useState("all");

  const groupRooms = getGroupRooms(state.rooms);

  const events = state.workLog
    .filter((w) => shouldShowWorkLogInUserFeed(w.action, w.summary))
    .filter((w) => employee === "all" || w.employeeId === employee)
    .filter((w) => room === "all" || w.roomId === room)
    .filter((w) => statusF === "all" || w.status === statusF)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  return (
    <PageContainer>
      <PageHeader
        title="Work Log"
        subtitle="An audit trail of everything your AI employees have done."
        icon={<ScrollText className="h-5 w-5" />}
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <select className="input-field sm:w-52" value={employee} onChange={(e) => setEmployee(e.target.value)}>
          <option value="all">All employees</option>
          {state.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select className="input-field sm:w-52" value={room} onChange={(e) => setRoom(e.target.value)}>
          <option value="all">All rooms</option>
          {groupRooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select className="input-field sm:w-44" value={statusF} onChange={(e) => setStatusF(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="success">Success</option>
          <option value="pending">Pending</option>
          <option value="needs_approval">Needs approval</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {events.length === 0 ? (
        <EmptyState icon={ScrollText} title="No activity yet" description="When your employees work, their actions show up here." />
      ) : (
        <Card className="p-3 sm:p-4">
          <WorkLogTimeline events={events} />
        </Card>
      )}
    </PageContainer>
  );
}
