"use client";

import { useEffect, useState } from "react";
import { Trash2, Plus, ShieldAlert, CheckCircle2, AlertTriangle, Info, LayoutGrid, Waypoints, ChevronDown } from "lucide-react";
import { Button, Card, Badge } from "@/components/ui";
import { getAllRoles } from "@/lib/hiring/role-library";
import { uid, cn } from "@/lib/utils";
import { WorkforceCanvas } from "./WorkforceCanvas";
import { AuthorityMatrixEditor } from "./AuthorityMatrixEditor";
import type { SimulationReport, WorkforceBlueprintPayload, WorkforceSeat } from "@/lib/hiring/workforce-studio/types";

type Updater = (updater: (payload: WorkforceBlueprintPayload) => WorkforceBlueprintPayload) => void;

export function RosterEditor({
  payload,
  updatePayload,
  simulationReport,
}: {
  payload: WorkforceBlueprintPayload;
  updatePayload: Updater;
  simulationReport: SimulationReport | null;
}) {
  const roles = getAllRoles();
  const [view, setView] = useState<"list" | "canvas">("list");

  // The React Flow canvas needs real pointer + trackpad precision to be
  // usable — on mobile/tablet widths we force the accessible list view and
  // hide the Canvas toggle entirely, rather than let the canvas render badly
  // on a touch screen.
  const [canUseCanvas, setCanUseCanvas] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const apply = () => {
      setCanUseCanvas(query.matches);
      if (!query.matches) setView("list");
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  function updateSeat(seatId: string, patch: Partial<WorkforceSeat>) {
    updatePayload((p) => ({ ...p, seats: p.seats.map((s) => (s.id === seatId ? { ...s, ...patch } : s)) }));
  }

  function removeSeat(seatId: string) {
    updatePayload((p) => ({
      ...p,
      seats: p.seats.filter((s) => s.id !== seatId),
      rooms: p.rooms.map((r) => ({ ...r, memberSeatIds: r.memberSeatIds.filter((id) => id !== seatId) })),
      edges: p.edges.filter((e) => e.fromSeatId !== seatId && e.toSeatId !== seatId),
      outcomes: p.outcomes.map((o) => (o.ownerSeatId === seatId ? { ...o, ownerSeatId: undefined } : o)),
    }));
  }

  function addSeat(roleKey: string) {
    const role = roles.find((r) => r.roleKey === roleKey);
    if (!role) return;
    const primaryRoomId = payload.rooms[0]?.id;
    const newSeat: WorkforceSeat = {
      id: uid("seat"),
      roleKey: role.roleKey,
      roleTitle: role.title,
      seniority: "specialist",
      modelMode: role.defaultModelMode,
      communicationStyle: "Clear and professional.",
      personalityTraits: [],
      mission: role.description,
      responsibilities: [...role.defaultResponsibilities],
      successMetrics: [...role.defaultSuccessMetrics],
      toolIds: [],
      authorityPolicy: { room_scope: "act_autonomously", tasks: "act_autonomously" },
      primaryRoomId,
      memberOfRoomIds: [],
      source: "manual",
    };
    updatePayload((p) => ({
      ...p,
      seats: [...p.seats, newSeat],
      rooms: primaryRoomId
        ? p.rooms.map((r) => (r.id === primaryRoomId ? { ...r, memberSeatIds: [...r.memberSeatIds, newSeat.id] } : r))
        : p.rooms,
    }));
  }

  function setSeatRoom(seatId: string, roomId: string) {
    updatePayload((p) => ({
      ...p,
      seats: p.seats.map((s) => (s.id === seatId ? { ...s, primaryRoomId: roomId } : s)),
      rooms: p.rooms.map((r) => ({
        ...r,
        memberSeatIds:
          r.id === roomId
            ? [...new Set([...r.memberSeatIds, seatId])]
            : r.memberSeatIds.filter((id) => id !== seatId),
      })),
    }));
  }

  function addEdge() {
    if (payload.seats.length < 2) return;
    updatePayload((p) => ({
      ...p,
      edges: [
        ...p.edges,
        {
          id: uid("edge"),
          type: "collaborates_with",
          fromSeatId: p.seats[0].id,
          toSeatId: p.seats[1].id,
          contract: { description: "Coordinate on shared work." },
        },
      ],
    }));
  }

  function removeEdge(edgeId: string) {
    updatePayload((p) => ({ ...p, edges: p.edges.filter((e) => e.id !== edgeId) }));
  }

  function addOutcome() {
    updatePayload((p) => ({
      ...p,
      outcomes: [
        ...p.outcomes,
        { id: uid("outcome"), title: "New outcome", metric: "", target: "", checkpointCadence: "weekly" },
      ],
    }));
  }

  function removeOutcome(outcomeId: string) {
    updatePayload((p) => ({ ...p, outcomes: p.outcomes.filter((o) => o.id !== outcomeId) }));
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface p-1">
          <button
            type="button"
            onClick={() => setView("list")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition",
              view === "list" ? "bg-ink text-white" : "text-ink-3 hover:text-ink",
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> List
          </button>
          {canUseCanvas ? (
            <button
              type="button"
              onClick={() => setView("canvas")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition",
                view === "canvas" ? "bg-ink text-white" : "text-ink-3 hover:text-ink",
              )}
            >
              <Waypoints className="h-3.5 w-3.5" /> Canvas
            </button>
          ) : null}
        </div>
        {!canUseCanvas ? (
          <p className="text-[12px] text-ink-3">
            The visual canvas needs a larger screen — showing the accessible list view on this device.
          </p>
        ) : null}

        {view === "canvas" && canUseCanvas ? (
          <WorkforceCanvas payload={payload} updatePayload={updatePayload} />
        ) : (
          <SeatsSection
            payload={payload}
            roles={roles}
            onUpdateSeat={updateSeat}
            onRemoveSeat={removeSeat}
            onAddSeat={addSeat}
            onSetSeatRoom={setSeatRoom}
          />
        )}
        <RoomsSection payload={payload} updatePayload={updatePayload} />
        <EdgesSection payload={payload} onAdd={addEdge} onRemove={removeEdge} updatePayload={updatePayload} />
        <OutcomesSection payload={payload} onAdd={addOutcome} onRemove={removeOutcome} updatePayload={updatePayload} />
      </div>
      <div className="lg:sticky lg:top-4 lg:self-start">
        <SimulationPanel report={simulationReport} />
      </div>
    </div>
  );
}

function SeatsSection({
  payload,
  roles,
  onUpdateSeat,
  onRemoveSeat,
  onAddSeat,
  onSetSeatRoom,
}: {
  payload: WorkforceBlueprintPayload;
  roles: ReturnType<typeof getAllRoles>;
  onUpdateSeat: (seatId: string, patch: Partial<WorkforceSeat>) => void;
  onRemoveSeat: (seatId: string) => void;
  onAddSeat: (roleKey: string) => void;
  onSetSeatRoom: (seatId: string, roomId: string) => void;
}) {
  const [addRoleKey, setAddRoleKey] = useState(roles[0]?.roleKey ?? "");

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-wider text-ink-3">Seats ({payload.seats.length})</h2>
        <div className="flex items-center gap-2">
          <select
            value={addRoleKey}
            onChange={(e) => setAddRoleKey(e.target.value)}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs"
          >
            {roles.map((r) => (
              <option key={r.roleKey} value={r.roleKey}>
                {r.title}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => onAddSeat(addRoleKey)}>
            <Plus className="h-3.5 w-3.5" /> Add seat
          </Button>
        </div>
      </div>
      <div className="space-y-3">
        {payload.seats.map((seat) => (
          <SeatCard
            key={seat.id}
            seat={seat}
            rooms={payload.rooms}
            onUpdate={(patch) => onUpdateSeat(seat.id, patch)}
            onRemove={() => onRemoveSeat(seat.id)}
            onSetRoom={(roomId) => onSetSeatRoom(seat.id, roomId)}
          />
        ))}
      </div>
    </section>
  );
}

export function SeatCard({
  seat,
  rooms,
  onUpdate,
  onRemove,
  onSetRoom,
}: {
  seat: WorkforceSeat;
  rooms: WorkforceBlueprintPayload["rooms"];
  onUpdate: (patch: Partial<WorkforceSeat>) => void;
  onRemove: () => void;
  onSetRoom: (roomId: string) => void;
}) {
  const [authorityOpen, setAuthorityOpen] = useState(false);
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-ink">{seat.roleTitle}</div>
          <input
            value={seat.operationalVariant ?? ""}
            placeholder="Variant (e.g. Frontend)"
            onChange={(e) => onUpdate({ operationalVariant: e.target.value })}
            className="mt-1 w-full max-w-[280px] rounded-md border border-transparent bg-transparent px-0 text-[12px] text-ink-3 outline-none focus:border-border focus:bg-surface focus:px-1.5 focus:py-0.5"
          />
        </div>
        <button type="button" onClick={onRemove} className="rounded-lg p-1.5 text-ink-3 hover:bg-danger/10 hover:text-danger">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <textarea
        value={seat.mission}
        onChange={(e) => onUpdate({ mission: e.target.value })}
        rows={2}
        className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-accent"
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="space-y-1">
          <span className="block text-[10px] uppercase text-ink-3">Seniority</span>
          <select
            value={seat.seniority}
            onChange={(e) => onUpdate({ seniority: e.target.value as WorkforceSeat["seniority"] })}
            className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
          >
            {["assistant", "specialist", "manager", "director", "advisor"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-[10px] uppercase text-ink-3">Model</span>
          <select
            value={seat.modelMode}
            onChange={(e) => onUpdate({ modelMode: e.target.value as WorkforceSeat["modelMode"] })}
            className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
          >
            {["cheap", "balanced", "strong", "long_context", "coding", "creative"].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 space-y-1">
          <span className="block text-[10px] uppercase text-ink-3">Primary room</span>
          <select
            value={seat.primaryRoomId ?? ""}
            onChange={(e) => onSetRoom(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
          >
            <option value="">— none —</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setAuthorityOpen((v) => !v)}
          aria-expanded={authorityOpen}
          className="flex w-full items-center justify-between gap-1 text-[10px] uppercase text-ink-3 hover:text-ink"
        >
          <span className="flex items-center gap-1">
            <ShieldAlert className="h-3 w-3" /> Authority policy
          </span>
          <ChevronDown className={cn("h-3.5 w-3.5 transition", authorityOpen && "rotate-180")} />
        </button>
        {authorityOpen ? (
          <div className="mt-2">
            <AuthorityMatrixEditor
              seatId={seat.id}
              policy={seat.authorityPolicy}
              onChange={(domain, level) => onUpdate({ authorityPolicy: { ...seat.authorityPolicy, [domain]: level } })}
            />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function RoomsSection({ payload, updatePayload }: { payload: WorkforceBlueprintPayload; updatePayload: Updater }) {
  function addRoom() {
    updatePayload((p) => ({
      ...p,
      rooms: [
        ...p.rooms,
        { id: uid("wfroom"), name: "New room", kind: "department", description: "", visibility: "workspace", memberSeatIds: [], humanReferenceRoles: [] },
      ],
    }));
  }
  function removeRoom(roomId: string) {
    updatePayload((p) => ({
      ...p,
      rooms: p.rooms.filter((r) => r.id !== roomId),
      seats: p.seats.map((s) => (s.primaryRoomId === roomId ? { ...s, primaryRoomId: undefined } : s)),
    }));
  }
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-wider text-ink-3">Rooms ({payload.rooms.length})</h2>
        <Button size="sm" variant="outline" onClick={addRoom}>
          <Plus className="h-3.5 w-3.5" /> Add room
        </Button>
      </div>
      <div className="space-y-2">
        {payload.rooms.map((room) => (
          <Card key={room.id} className="flex items-center gap-3 p-3">
            <input
              value={room.name}
              onChange={(e) =>
                updatePayload((p) => ({ ...p, rooms: p.rooms.map((r) => (r.id === room.id ? { ...r, name: e.target.value } : r)) }))
              }
              className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-accent"
            />
            <Badge className="bg-muted text-ink-3">{room.memberSeatIds.length} seat{room.memberSeatIds.length === 1 ? "" : "s"}</Badge>
            <select
              value={room.visibility}
              onChange={(e) =>
                updatePayload((p) => ({
                  ...p,
                  rooms: p.rooms.map((r) => (r.id === room.id ? { ...r, visibility: e.target.value as typeof r.visibility } : r)),
                }))
              }
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
            >
              <option value="workspace">workspace</option>
              <option value="restricted">restricted</option>
              <option value="private">private</option>
            </select>
            <button type="button" onClick={() => removeRoom(room.id)} className="rounded-lg p-1.5 text-ink-3 hover:bg-danger/10 hover:text-danger">
              <Trash2 className="h-4 w-4" />
            </button>
          </Card>
        ))}
      </div>
    </section>
  );
}

function EdgesSection({
  payload,
  onAdd,
  onRemove,
  updatePayload,
}: {
  payload: WorkforceBlueprintPayload;
  onAdd: () => void;
  onRemove: (id: string) => void;
  updatePayload: Updater;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-wider text-ink-3">Collaboration edges ({payload.edges.length})</h2>
        <Button size="sm" variant="outline" onClick={onAdd} disabled={payload.seats.length < 2}>
          <Plus className="h-3.5 w-3.5" /> Add edge
        </Button>
      </div>
      <div className="space-y-2">
        {payload.edges.map((edge) => (
          <Card key={edge.id} className="flex flex-wrap items-center gap-2 p-3">
            <SeatSelect payload={payload} value={edge.fromSeatId} onChange={(v) => updatePayload((p) => ({ ...p, edges: p.edges.map((e) => (e.id === edge.id ? { ...e, fromSeatId: v } : e)) }))} />
            <select
              value={edge.type}
              onChange={(e) => updatePayload((p) => ({ ...p, edges: p.edges.map((x) => (x.id === edge.id ? { ...x, type: e.target.value as typeof x.type } : x)) }))}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
            >
              {["handoff", "review", "escalation", "collaborates_with"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <SeatSelect payload={payload} value={edge.toSeatId} onChange={(v) => updatePayload((p) => ({ ...p, edges: p.edges.map((e) => (e.id === edge.id ? { ...e, toSeatId: v } : e)) }))} />
            <input
              value={edge.contract.description}
              onChange={(e) =>
                updatePayload((p) => ({
                  ...p,
                  edges: p.edges.map((x) => (x.id === edge.id ? { ...x, contract: { ...x.contract, description: e.target.value } } : x)),
                }))
              }
              className="min-w-[160px] flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
            />
            <button type="button" onClick={() => onRemove(edge.id)} className="rounded-lg p-1.5 text-ink-3 hover:bg-danger/10 hover:text-danger">
              <Trash2 className="h-4 w-4" />
            </button>
          </Card>
        ))}
      </div>
    </section>
  );
}

function SeatSelect({ payload, value, onChange }: { payload: WorkforceBlueprintPayload; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-border bg-surface px-2 py-1 text-xs">
      {payload.seats.map((s) => (
        <option key={s.id} value={s.id}>
          {s.roleTitle}
        </option>
      ))}
    </select>
  );
}

function OutcomesSection({
  payload,
  onAdd,
  onRemove,
  updatePayload,
}: {
  payload: WorkforceBlueprintPayload;
  onAdd: () => void;
  onRemove: (id: string) => void;
  updatePayload: Updater;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-wider text-ink-3">Outcomes ({payload.outcomes.length})</h2>
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" /> Add outcome
        </Button>
      </div>
      <div className="space-y-2">
        {payload.outcomes.map((outcome) => (
          <Card key={outcome.id} className="space-y-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={outcome.title}
                onChange={(e) => updatePayload((p) => ({ ...p, outcomes: p.outcomes.map((o) => (o.id === outcome.id ? { ...o, title: e.target.value } : o)) }))}
                className="min-w-[140px] flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
                placeholder="Outcome title (e.g. Ship weekly releases)"
                aria-label="Outcome title"
              />
              <button
                type="button"
                onClick={() => onRemove(outcome.id)}
                aria-label="Remove outcome"
                className="rounded-lg p-1.5 text-ink-3 hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="block text-[10px] uppercase text-ink-3">Metric</span>
                <input
                  value={outcome.metric}
                  onChange={(e) => updatePayload((p) => ({ ...p, outcomes: p.outcomes.map((o) => (o.id === outcome.id ? { ...o, metric: e.target.value } : o)) }))}
                  className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
                  placeholder="e.g. Release lead time"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[10px] uppercase text-ink-3">Target</span>
                <input
                  value={outcome.target}
                  onChange={(e) => updatePayload((p) => ({ ...p, outcomes: p.outcomes.map((o) => (o.id === outcome.id ? { ...o, target: e.target.value } : o)) }))}
                  className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
                  placeholder="e.g. <3 days"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-ink-3">
                Owner
                <SeatSelect
                  payload={payload}
                  value={outcome.ownerSeatId ?? ""}
                  onChange={(v) => updatePayload((p) => ({ ...p, outcomes: p.outcomes.map((o) => (o.id === outcome.id ? { ...o, ownerSeatId: v } : o)) }))}
                />
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-ink-3">
                Checkpoint
                <select
                  value={outcome.checkpointCadence}
                  onChange={(e) =>
                    updatePayload((p) => ({
                      ...p,
                      outcomes: p.outcomes.map((o) => (o.id === outcome.id ? { ...o, checkpointCadence: e.target.value as typeof o.checkpointCadence } : o)),
                    }))
                  }
                  className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                >
                  {["daily", "weekly", "biweekly", "monthly"].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Card>
        ))}
        {payload.outcomes.length === 0 ? (
          <p className="text-[12px] text-ink-3">
            No outcomes yet — outcomes give this team a measurable target and an owner, and Maya checks progress
            against them.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function SimulationPanel({ report }: { report: SimulationReport | null }) {
  if (!report) {
    return (
      <Card className="p-4 text-[13px] text-ink-3">
        Run a simulation to check coverage, permissions, and expected weekly Work Hours before approving.
      </Card>
    );
  }

  const critical = report.findings.filter((f) => f.severity === "critical");
  const warnings = report.findings.filter((f) => f.severity === "warning");
  const info = report.findings.filter((f) => f.severity === "info");

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        {report.passed ? (
          <Badge className="bg-green/15 text-green">
            <CheckCircle2 className="h-3.5 w-3.5" /> Ready
          </Badge>
        ) : (
          <Badge className="bg-danger/15 text-danger">
            <AlertTriangle className="h-3.5 w-3.5" /> Needs attention
          </Badge>
        )}
        <span className="text-[12px] text-ink-3">~{report.totalExpectedWeeklyWh} WH/week</span>
      </div>

      {report.narration ? <p className="text-[13px] leading-relaxed text-ink-2">{report.narration}</p> : null}

      <FindingGroup title="Critical" findings={critical} icon={<AlertTriangle className="h-3.5 w-3.5 text-danger" />} />
      <FindingGroup title="Warnings" findings={warnings} icon={<AlertTriangle className="h-3.5 w-3.5 text-amber" />} />
      <FindingGroup title="Info" findings={info} icon={<Info className="h-3.5 w-3.5 text-ink-3" />} />

      <div>
        <div className="mb-1.5 font-mono text-[10px] uppercase text-ink-3">Work Hours forecast (per seat)</div>
        <div className="space-y-1">
          {report.workHoursForecast.map((band) => (
            <WhBandRow key={band.seatId} band={band} />
          ))}
        </div>
      </div>

      <WhCapabilitySummary bands={report.workHoursForecast} />
    </Card>
  );
}

const DOMAIN_LABEL: Record<string, string> = {
  room_scope: "Rooms",
  tasks: "Tasks",
  crm: "CRM",
  email: "Email",
  drive: "Drive",
  artifact: "Artifacts",
  social: "Social",
  calendar: "Calendar",
  investor: "Investor",
  team: "Team",
  research: "Research",
};

function WhBandRow({ band }: { band: SimulationReport["workHoursForecast"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={band.byCapability.length === 0}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-0.5 text-[11px] text-ink-2 hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="flex items-center gap-1 truncate">
          {band.byCapability.length > 0 ? (
            <ChevronDown className={cn("h-3 w-3 shrink-0 text-ink-3 transition", open && "rotate-180")} />
          ) : (
            <span className="w-3" />
          )}
          <span className="truncate">{band.roleTitle}</span>
        </span>
        <span className="text-ink-3">
          {band.lowWh}–{band.highWh} WH
        </span>
      </button>
      {open && band.byCapability.length > 0 ? (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2">
          {band.byCapability
            .slice()
            .sort((a, b) => b.expectedWh - a.expectedWh)
            .map((slice) => (
              <div key={slice.domain} className="flex items-center justify-between text-[10px] text-ink-3">
                <span>
                  {DOMAIN_LABEL[slice.domain] ?? slice.domain}{" "}
                  <span className="text-ink-3/70">({slice.level.replace(/_/g, " ")})</span>
                </span>
                <span>{slice.expectedWh} WH</span>
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}

function WhCapabilitySummary({ bands }: { bands: SimulationReport["workHoursForecast"] }) {
  const totals = new Map<string, number>();
  for (const band of bands) {
    for (const slice of band.byCapability) {
      totals.set(slice.domain, (totals.get(slice.domain) ?? 0) + slice.expectedWh);
    }
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;
  const max = sorted[0][1];

  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] uppercase text-ink-3">Work Hours by capability (team-wide)</div>
      <div className="space-y-1.5">
        {sorted.map(([domain, wh]) => (
          <div key={domain} className="space-y-0.5">
            <div className="flex items-center justify-between text-[11px] text-ink-2">
              <span>{DOMAIN_LABEL[domain] ?? domain}</span>
              <span className="text-ink-3">{Math.round(wh * 10) / 10} WH</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(4, (wh / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FindingGroup({
  title,
  findings,
  icon,
}: {
  title: string;
  findings: SimulationReport["findings"];
  icon: React.ReactNode;
}) {
  if (findings.length === 0) return null;
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase text-ink-3">
        {icon} {title} ({findings.length})
      </div>
      <ul className="space-y-1">
        {findings.map((f) => (
          <li key={f.id} className="text-[12px] leading-snug text-ink-2">
            {f.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
