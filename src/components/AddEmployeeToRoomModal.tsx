"use client";

import { useMemo, useState } from "react";
import type { AIEmployee } from "@/lib/types";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { Button, Modal, ModalHeader } from "./ui";
import { cn } from "@/lib/utils";
import { STATUS_META } from "@/lib/icons";
import { Search, UserPlus } from "lucide-react";

export function AddEmployeeToRoomModal({
  open,
  onClose,
  roomName,
  topicTitle,
  employees,
  currentEmployeeIds,
  onAdd,
  busyEmployeeId,
}: {
  open: boolean;
  onClose: () => void;
  roomName: string;
  topicTitle?: string;
  employees: AIEmployee[];
  currentEmployeeIds: string[];
  onAdd: (employeeId: string, addToTopic: boolean) => Promise<void> | void;
  busyEmployeeId?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [addToTopic, setAddToTopic] = useState(true);

  const available = useMemo(() => {
    const current = new Set(currentEmployeeIds);
    const q = query.trim().toLowerCase();
    return employees
      .filter((employee) => !current.has(employee.id))
      .filter((employee) => {
        if (!q) return true;
        return (
          employee.name.toLowerCase().includes(q) ||
          employee.role.toLowerCase().includes(q) ||
          employee.roleKey.toLowerCase().includes(q)
        );
      });
  }, [currentEmployeeIds, employees, query]);

  return (
    <Modal open={open} onClose={onClose} size="md">
      <ModalHeader
        title="Add employee to room"
        subtitle={`Bring an existing AI employee into ${roomName}.`}
        onClose={onClose}
        icon={<UserPlus className="h-5 w-5" />}
      />
      <div className="space-y-4 p-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input
            className="input-field pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or role"
            autoFocus
          />
        </div>

        {topicTitle && (
          <label className="flex items-start gap-2 rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={addToTopic}
              onChange={(event) => setAddToTopic(event.target.checked)}
              className="mt-1 h-4 w-4 accent-[var(--accent)]"
            />
            <span>
              Also add them to <span className="font-medium text-ink">{topicTitle}</span>
            </span>
          </label>
        )}

        <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
          {available.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted px-4 py-8 text-center text-sm text-ink-3">
              {query.trim()
                ? "No matching employees found."
                : "Every assignable employee is already in this room."}
            </div>
          ) : (
            available.map((employee) => {
              const busy = busyEmployeeId === employee.id;
              const status = STATUS_META[employee.status];
              return (
                <button
                  key={employee.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void onAdd(employee.id, addToTopic)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-60",
                  )}
                >
                  <EmployeeAvatar employee={employee} size="sm" showStatus={false} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {employee.name}
                    </span>
                    <span className="block truncate text-xs text-ink-3">{employee.role}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-3">
                    <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
                    {status.label}
                  </span>
                  <span className="shrink-0 rounded-lg bg-accent px-2 py-1 text-xs font-semibold text-white">
                    {busy ? "Adding" : "Add"}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
      <div className="flex justify-end border-t border-border-2 px-5 py-4">
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
