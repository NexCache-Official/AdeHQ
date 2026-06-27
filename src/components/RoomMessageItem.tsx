"use client";

import { RoomMessage } from "@/lib/types";
import { useStore } from "@/lib/demo-store";
import { EmployeeAvatar, HumanAvatar } from "./EmployeeAvatar";
import { cn, formatTime } from "@/lib/utils";
import {
  BrainCircuit,
  ListChecks,
  ScrollText,
  ShieldAlert,
} from "lucide-react";
import { motion } from "framer-motion";

const ARTIFACT_META = {
  task: { icon: ListChecks, color: "text-sky-700 bg-sky-50", href: "/tasks" },
  memory: { icon: BrainCircuit, color: "text-cyan-700 bg-cyan-50", href: "/memory" },
  approval: { icon: ShieldAlert, color: "text-amber-700 bg-amber-50", href: "/approvals" },
  work_log: { icon: ScrollText, color: "text-violet-700 bg-violet-50", href: "/work-log" },
};

function renderContent(content: string) {
  // Highlight @Mentions
  const parts = content.split(/(@[A-Za-z][A-Za-z ]*?Employee)/g);
  return parts.map((part, i) =>
    /^@[A-Za-z]/.test(part) && part.includes("Employee") ? (
      <span key={i} className="font-medium text-accent-600">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function RoomMessageItem({ message }: { message: RoomMessage }) {
  const { state } = useStore();
  const employee = state.employees.find((e) => e.id === message.senderId);

  if (message.senderType === "system") {
    return (
      <div className="flex justify-center py-2">
        <span className="rounded-full bg-slate-50 px-3 py-1 text-[11px] text-slate-500">
          {message.content}
        </span>
      </div>
    );
  }

  const isHuman = message.senderType === "human";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="flex gap-3 px-1 py-2"
    >
      <div className="shrink-0">
        {isHuman ? (
          <HumanAvatar name={message.senderName} size="md" />
        ) : employee ? (
          <EmployeeAvatar employee={employee} size="md" showStatus={false} />
        ) : (
          <HumanAvatar name={message.senderName} size="md" accent="#475569" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-slate-900">{message.senderName}</span>
          {!isHuman && (
            <span className="rounded-md bg-accent-500/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-700">
              AI
            </span>
          )}
          {!isHuman && employee && (
            <span className="rounded-md bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">
              {employee.role}
            </span>
          )}
          <span className="text-[11px] text-slate-500">{formatTime(message.createdAt)}</span>
          {message.failed && (
            <span className="text-[11px] font-medium text-rose-600">Failed to send</span>
          )}
        </div>

        {message.pending ? (
          <div className="mt-1.5 flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-slate-50 px-3.5 py-3 w-fit">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        ) : (
          <div
            className={cn(
              "mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-slate-700",
            )}
          >
            {renderContent(message.content)}
          </div>
        )}

        {message.artifacts && message.artifacts.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {message.artifacts.map((a) => {
              const meta = ARTIFACT_META[a.type];
              const Icon = meta.icon;
              return (
                <span
                  key={a.id + a.label}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium",
                    meta.color,
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {a.label}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}
