"use client";

import { Approval } from "@/lib/types";
import { useStore } from "@/lib/demo-store";
import { ActorChip } from "./ActorChip";
import { RISK_META } from "@/lib/icons";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "./ui";
import { Check, ShieldAlert, X } from "lucide-react";
import { motion } from "framer-motion";

const ACTION_LABEL: Record<Approval["actionType"], string> = {
  tool_access: "Tool access",
  memory_pin: "Pin to memory",
  task_creation: "Create tasks",
  external_action: "External action",
};

export function ApprovalCard({ approval }: { approval: Approval }) {
  const { state, actions } = useStore();
  const risk = RISK_META[approval.risk];
  const room = state.rooms.find((r) => r.id === approval.roomId);
  const resolved = approval.status !== "pending";

  return (
    <motion.div
      layout
      className={cn(
        "rounded-2xl border bg-slate-50 p-4",
        resolved ? "border-slate-200 opacity-70" : risk.border,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", risk.bg, risk.color)}>
            <ShieldAlert className="h-4 w-4" />
          </span>
          <div>
            <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-medium", risk.bg, risk.color)}>
              {risk.label}
            </span>
            <span className="ml-1.5 text-[10px] text-slate-500">{ACTION_LABEL[approval.actionType]}</span>
          </div>
        </div>
        {resolved && (
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-[11px] font-medium",
              approval.status === "approved" ? "bg-emerald-500/15 text-emerald-700" : "bg-rose-500/15 text-rose-600",
            )}
          >
            {approval.status === "approved" ? "Approved" : "Rejected"}
          </span>
        )}
      </div>

      <h4 className="mt-2.5 text-sm font-semibold text-slate-900">{approval.title}</h4>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">{approval.description}</p>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <ActorChip id={approval.requestedBy} />
        </div>
        <span className="text-[11px] text-slate-500">{room?.name} · {timeAgo(approval.createdAt)}</span>
      </div>

      {!resolved && (
        <div className="mt-3.5 flex gap-2 border-t border-slate-200 pt-3.5">
          <Button size="sm" className="flex-1" onClick={() => actions.resolveApproval(approval.id, true)}>
            <Check className="h-4 w-4" /> Approve
          </Button>
          <Button size="sm" variant="secondary" className="flex-1" onClick={() => actions.resolveApproval(approval.id, false)}>
            <X className="h-4 w-4" /> Reject
          </Button>
        </div>
      )}
    </motion.div>
  );
}
