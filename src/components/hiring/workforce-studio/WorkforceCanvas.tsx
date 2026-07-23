"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  type OnConnect,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Users, Building2, User, Trash2 } from "lucide-react";
import { Card, Button, Badge } from "@/components/ui";
import { uid } from "@/lib/utils";
import { SeatCard } from "./RosterEditor";
import type { CollaborationEdgeType, SimulationReport, WorkforceBlueprintPayload } from "@/lib/hiring/workforce-studio/types";

const EDGE_COLOR: Record<CollaborationEdgeType, string> = {
  handoff: "#f59e0b",
  review: "#8b5cf6",
  escalation: "#ef4444",
  collaborates_with: "#2f6fed",
};

type Updater = (updater: (payload: WorkforceBlueprintPayload) => WorkforceBlueprintPayload) => void;

function RoomNode({ data }: NodeProps) {
  const room = data.room as WorkforceBlueprintPayload["rooms"][number];
  return (
    <div className="w-[220px] rounded-2xl border-2 border-dashed border-accent/30 bg-accent-soft/20 px-4 py-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-accent-d">
        <Building2 className="h-4 w-4" />
        <span className="truncate">{room.name}</span>
      </div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-ink-3">
        {room.kind} · {room.visibility}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
    </div>
  );
}

function SeatNode({ data, selected }: NodeProps) {
  const seat = data.seat as WorkforceBlueprintPayload["seats"][number];
  return (
    <div
      className={`w-[190px] rounded-xl border bg-surface px-3 py-2.5 shadow-sm transition ${
        selected ? "border-accent ring-2 ring-accent/30" : "border-border"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-accent" />
      <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <Users className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="truncate">{seat.roleTitle}</span>
      </div>
      {seat.operationalVariant ? <div className="truncate text-[11px] text-ink-3">{seat.operationalVariant}</div> : null}
      <div className="mt-1 flex items-center gap-1 text-[10px] uppercase text-ink-3">
        <span>{seat.seniority}</span>
        <span aria-hidden>·</span>
        <span>Brain auto</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-accent" />
    </div>
  );
}

function HumanNode({ data }: NodeProps) {
  const human = data.human as WorkforceBlueprintPayload["humanReferences"][number];
  return (
    <div className="w-[170px] rounded-xl border border-border bg-muted/50 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
        <User className="h-3.5 w-3.5" />
        <span className="truncate">{human.title}</span>
      </div>
      <div className="text-[10px] text-ink-3">Human — planning only</div>
    </div>
  );
}

function CollabEdge({ id, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps) {
  const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const type = (data?.type as CollaborationEdgeType) ?? "collaborates_with";
  const color = EDGE_COLOR[type];
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ stroke: color, strokeWidth: selected ? 2.5 : 1.5 }}
        markerEnd="url(#wf-arrow)"
      />
      <EdgeLabelRenderer>
        <div
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
          className="pointer-events-none rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide"
        >
          <span
            className="rounded-full px-1.5 py-0.5"
            style={{ backgroundColor: `${color}1a`, color, border: `1px solid ${color}40` }}
          >
            {type.replace("_", " ")}
          </span>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { room: RoomNode, seat: SeatNode, human: HumanNode };
const edgeTypes = { collab: CollabEdge };

function layout(payload: WorkforceBlueprintPayload): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const roomX = new Map<string, number>();
  const ROOM_GAP = 260;
  payload.rooms.forEach((room, i) => {
    const x = i * ROOM_GAP;
    roomX.set(room.id, x);
    nodes.push({
      id: `room:${room.id}`,
      type: "room",
      position: { x, y: 0 },
      data: { room },
      draggable: true,
      ariaLabel: `Room: ${room.name}, ${room.kind}, ${room.visibility}`,
    });
  });

  const seatsByRoom = new Map<string, typeof payload.seats>();
  for (const seat of payload.seats) {
    const key = seat.primaryRoomId ?? "__unassigned__";
    seatsByRoom.set(key, [...(seatsByRoom.get(key) ?? []), seat]);
  }
  let unassignedX = payload.rooms.length * ROOM_GAP;
  for (const [roomId, seats] of seatsByRoom) {
    const baseX = roomId === "__unassigned__" ? unassignedX : roomX.get(roomId) ?? 0;
    seats.forEach((seat, i) => {
      nodes.push({
        id: `seat:${seat.id}`,
        type: "seat",
        position: { x: baseX + (i % 2) * 20, y: 140 + i * 110 },
        data: { seat },
        draggable: true,
        ariaLabel: `Seat: ${seat.roleTitle}${seat.operationalVariant ? ` — ${seat.operationalVariant}` : ""}, ${seat.seniority}`,
      });
    });
    if (roomId === "__unassigned__") unassignedX += ROOM_GAP;
  }

  payload.humanReferences.forEach((human, i) => {
    nodes.push({
      id: `human:${human.id}`,
      type: "human",
      position: { x: -220, y: 140 + i * 100 },
      data: { human },
      draggable: true,
      ariaLabel: `Human reference: ${human.title}, planning only`,
    });
  });

  const seatTitle = new Map(payload.seats.map((s) => [s.id, s.roleTitle]));
  const edges: Edge[] = payload.edges.map((edge) => ({
    id: edge.id,
    type: "collab",
    source: `seat:${edge.fromSeatId}`,
    target: `seat:${edge.toSeatId}`,
    data: { type: edge.type },
    animated: edge.type === "escalation",
    ariaLabel: `${edge.type.replace("_", " ")} edge: ${seatTitle.get(edge.fromSeatId) ?? "seat"} to ${seatTitle.get(edge.toSeatId) ?? "seat"}`,
  }));

  return { nodes, edges };
}

export function WorkforceCanvas({
  payload,
  updatePayload,
  simulationReport = null,
}: {
  payload: WorkforceBlueprintPayload;
  updatePayload: Updater;
  simulationReport?: SimulationReport | null;
}) {
  const { nodes, edges } = useMemo(() => layout(payload), [payload]);
  const [selection, setSelection] = useState<{ kind: "seat" | "room" | "edge"; id: string } | null>(null);

  const onConnect: OnConnect = useCallback(
    (connection) => {
      const fromSeatId = connection.source?.replace(/^seat:/, "");
      const toSeatId = connection.target?.replace(/^seat:/, "");
      if (!fromSeatId || !toSeatId || fromSeatId === toSeatId) return;
      const newEdgeId = uid("edge");
      updatePayload((p) => ({
        ...p,
        edges: [
          ...p.edges,
          { id: newEdgeId, type: "collaborates_with", fromSeatId, toSeatId, contract: { description: "Coordinate on shared work." } },
        ],
      }));
      setSelection({ kind: "edge", id: newEdgeId });
    },
    [updatePayload],
  );

  // Selection is driven by onSelectionChange (fires for both pointer clicks
  // AND keyboard selection — Tab to focus a node, Enter/Space to select it —
  // so the Inspector panel opens the same way regardless of input method.
  // This is what makes every seat/room/edge reachable without a mouse.
  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: { nodes: Node[]; edges: Edge[] }) => {
      const node = selectedNodes[0];
      const edge = selectedEdges[0];
      if (node?.id.startsWith("seat:")) setSelection({ kind: "seat", id: node.id.slice(5) });
      else if (node?.id.startsWith("room:")) setSelection({ kind: "room", id: node.id.slice(5) });
      else if (edge) setSelection({ kind: "edge", id: edge.id });
      else setSelection(null);
    },
    [],
  );

  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    // Positions are session-local (blueprint payload has no layout hints yet);
    // React Flow keeps the drag in its own node state, nothing to persist.
    void node;
  }, []);

  // Backspace/Delete on a focused, selected seat node removes it from the
  // draft — the same outcome as the trash icon in the Inspector, reachable
  // without a mouse.
  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      const seatIds = deleted.filter((n) => n.id.startsWith("seat:")).map((n) => n.id.slice(5));
      if (!seatIds.length) return;
      updatePayload((p) => ({
        ...p,
        seats: p.seats.filter((s) => !seatIds.includes(s.id)),
        edges: p.edges.filter((e) => !seatIds.includes(e.fromSeatId) && !seatIds.includes(e.toSeatId)),
        rooms: p.rooms.map((r) => ({ ...r, memberSeatIds: r.memberSeatIds.filter((id) => !seatIds.includes(id)) })),
      }));
      setSelection(null);
    },
    [updatePayload],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      const ids = new Set(deleted.map((e) => e.id));
      updatePayload((p) => ({ ...p, edges: p.edges.filter((e) => !ids.has(e.id)) }));
      setSelection(null);
    },
    [updatePayload],
  );

  function updateSeat(seatId: string, patch: Partial<WorkforceBlueprintPayload["seats"][number]>) {
    updatePayload((p) => ({ ...p, seats: p.seats.map((s) => (s.id === seatId ? { ...s, ...patch } : s)) }));
  }
  function removeSeat(seatId: string) {
    updatePayload((p) => ({
      ...p,
      seats: p.seats.filter((s) => s.id !== seatId),
      edges: p.edges.filter((e) => e.fromSeatId !== seatId && e.toSeatId !== seatId),
    }));
    setSelection(null);
  }
  function setSeatRoom(seatId: string, roomId: string) {
    updatePayload((p) => ({
      ...p,
      seats: p.seats.map((s) => (s.id === seatId ? { ...s, primaryRoomId: roomId } : s)),
      rooms: p.rooms.map((r) => ({
        ...r,
        memberSeatIds: r.id === roomId ? [...new Set([...r.memberSeatIds, seatId])] : r.memberSeatIds.filter((id) => id !== seatId),
      })),
    }));
  }

  const selectedSeat = selection?.kind === "seat" ? payload.seats.find((s) => s.id === selection.id) : null;
  const selectedRoom = selection?.kind === "room" ? payload.rooms.find((r) => r.id === selection.id) : null;
  const selectedEdge = selection?.kind === "edge" ? payload.edges.find((e) => e.id === selection.id) : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="h-[560px] overflow-hidden p-0">
        <svg width="0" height="0">
          <defs>
            <marker id="wf-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L8,3 L0,6 Z" fill="#94a3b8" />
            </marker>
          </defs>
        </svg>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onConnect={onConnect}
          onSelectionChange={onSelectionChange}
          onNodeDragStop={onNodeDragStop}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          onPaneClick={() => setSelection(null)}
          deleteKeyCode={["Backspace", "Delete"]}
          nodesFocusable
          edgesFocusable
          fitView
          proOptions={{ hideAttribution: true }}
          aria-label="Team workforce canvas — seats, rooms, and collaboration edges"
        >
          <Background gap={20} size={1} color="#e5e7eb" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className="!bg-surface" />
        </ReactFlow>
      </Card>

      <p className="sr-only" role="note">
        Tab to move between seats, rooms, and edges. Press Enter or Space to select and open it in the panel on the
        right. Press Backspace or Delete to remove the selected seat or edge.
      </p>

      <div className="space-y-3">
        {selectedSeat ? (
          <SeatCard
            seat={selectedSeat}
            rooms={payload.rooms}
            defaultExpanded
            worksWith={[
              ...new Set(
                payload.edges
                  .filter((e) => e.fromSeatId === selectedSeat.id || e.toSeatId === selectedSeat.id)
                  .map((e) => {
                    const otherId = e.fromSeatId === selectedSeat.id ? e.toSeatId : e.fromSeatId;
                    return payload.seats.find((s) => s.id === otherId)?.roleTitle;
                  })
                  .filter((t): t is string => Boolean(t)),
              ),
            ].slice(0, 3)}
            capacityBand={simulationReport?.workHoursForecast.find((b) => b.seatId === selectedSeat.id) ?? null}
            onUpdate={(patch) => updateSeat(selectedSeat.id, patch)}
            onRemove={() => removeSeat(selectedSeat.id)}
            onSetRoom={(roomId) => setSeatRoom(selectedSeat.id, roomId)}
          />
        ) : selectedRoom ? (
          <Card className="space-y-2 p-4">
            <div className="text-sm font-semibold text-ink">{selectedRoom.name}</div>
            <Badge className="bg-muted text-ink-3">
              {selectedRoom.memberSeatIds.length} seat{selectedRoom.memberSeatIds.length === 1 ? "" : "s"}
            </Badge>
            <p className="text-[12px] text-ink-2">{selectedRoom.description}</p>
          </Card>
        ) : selectedEdge ? (
          <Card className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-ink">Collaboration edge</div>
              <button
                type="button"
                onClick={() => {
                  updatePayload((p) => ({ ...p, edges: p.edges.filter((e) => e.id !== selectedEdge.id) }));
                  setSelection(null);
                }}
                className="rounded-lg p-1.5 text-ink-3 hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <select
              value={selectedEdge.type}
              onChange={(e) =>
                updatePayload((p) => ({
                  ...p,
                  edges: p.edges.map((edge) => (edge.id === selectedEdge.id ? { ...edge, type: e.target.value as CollaborationEdgeType } : edge)),
                }))
              }
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs"
            >
              {["handoff", "review", "escalation", "collaborates_with"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <textarea
              value={selectedEdge.contract.description}
              onChange={(e) =>
                updatePayload((p) => ({
                  ...p,
                  edges: p.edges.map((edge) =>
                    edge.id === selectedEdge.id ? { ...edge, contract: { ...edge.contract, description: e.target.value } } : edge,
                  ),
                }))
              }
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-accent"
            />
          </Card>
        ) : (
          <Card className="p-4 text-[13px] text-ink-3">
            Click a seat, room, or edge to inspect and edit it. Drag from one seat&apos;s handle to another to create a
            new collaboration edge.
          </Card>
        )}
      </div>
    </div>
  );
}
