"use client";

import { useStore } from "@/lib/demo-store";
import { EmployeeAvatar, HumanAvatar } from "./EmployeeAvatar";
import { cn } from "@/lib/utils";

/** Resolves an actor id (employee / human / system) to an avatar + name. */
export function useActor(id: string) {
  const { state } = useStore();
  const emp = state.employees.find((e) => e.id === id);
  if (emp) return { type: "ai" as const, name: emp.name, employee: emp };
  if (id === state.user?.id || id === "user-shubham")
    return { type: "human" as const, name: state.user?.name ?? "Shubham" };
  return { type: "system" as const, name: "AdeHQ" };
}

export function ActorChip({
  id,
  size = "xs",
  className,
}: {
  id: string;
  size?: "xs" | "sm";
  className?: string;
}) {
  const actor = useActor(id);
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {actor.type === "ai" && actor.employee ? (
        <EmployeeAvatar employee={actor.employee} size={size} showStatus={false} />
      ) : (
        <HumanAvatar name={actor.name} size={size} accent={actor.type === "system" ? "#475569" : "#2f6fed"} />
      )}
      <span className="text-sm font-medium text-slate-700">{actor.name}</span>
    </span>
  );
}
