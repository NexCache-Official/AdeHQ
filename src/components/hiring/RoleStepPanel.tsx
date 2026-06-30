"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  getBrowsableDepartmentGroups,
  getPopularRoles,
  getRoleByKey,
  getRolesByDepartmentGroup,
  searchRoles,
  type DepartmentGroupId,
  type RoleLibraryEntry,
} from "@/lib/hiring/role-library";
import { inferRoleFromText } from "@/lib/hiring/role-inference";
import { WORKFLOW_CARDS, DISCOVERY_OUTCOME_CHIPS } from "@/lib/hiring/workflow-cards";
import { MAYA_EMPLOYEE_NAME } from "@/lib/hiring/maya";
import { HIRE_EXAMPLES } from "@/lib/hiring/data";

export type RoleStepSelection =
  | { type: "role"; roleKey: string; title: string; departmentGroupId: string }
  | { type: "discovery" }
  | { type: "inference"; roleKey?: string; custom?: boolean; title: string };

type RoleStepPanelProps = {
  roleInput: string;
  onRoleInputChange: (value: string) => void;
  onSelect: (selection: RoleStepSelection) => void;
  busy?: boolean;
};

export function RoleStepPanel({
  roleInput,
  onRoleInputChange,
  onSelect,
  busy = false,
}: RoleStepPanelProps) {
  const [activeGroup, setActiveGroup] = useState<DepartmentGroupId | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [showDiscovery, setShowDiscovery] = useState(false);

  const popularRoles = useMemo(() => getPopularRoles(), []);
  const browseGroups = useMemo(() => getBrowsableDepartmentGroups(), []);
  const searchResults = useMemo(() => searchRoles(roleInput, 6), [roleInput]);
  const groupRoles = useMemo(
    () => (activeGroup ? getRolesByDepartmentGroup(activeGroup) : []),
    [activeGroup],
  );
  const workflow = WORKFLOW_CARDS.find((w) => w.id === workflowId);

  const pickRole = (role: RoleLibraryEntry) => {
    onSelect({
      type: "role",
      roleKey: role.roleKey,
      title: role.title,
      departmentGroupId: role.departmentGroupId,
    });
  };

  const handleContinue = () => {
    const trimmed = roleInput.trim();
    if (!trimmed) return;
    const inference = inferRoleFromText(trimmed);
    if (inference.confidence === "high" && inference.matches[0]) {
      onSelect({
        type: "inference",
        roleKey: inference.matches[0].roleKey,
        title: inference.matches[0].title,
      });
      return;
    }
    if (inference.confidence === "medium" && inference.matches.length > 0) {
      onSelect({ type: "inference", title: trimmed });
      return;
    }
    if (inference.matchType === "custom") {
      onSelect({ type: "inference", custom: true, title: trimmed });
      return;
    }
    onSelect({ type: "inference", title: trimmed });
  };

  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-[980px]">
      <div className="mb-8 mt-2 text-center">
        <div className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] text-ink-2 shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-green" />
          Your AI workforce, hired like real teammates
        </div>
        <h1 className="mb-3 text-[42px] font-semibold leading-[1.04] tracking-[-1.6px]">
          Who do you want to hire?
        </h1>
        <p className="mx-auto max-w-[560px] text-[17px] leading-relaxed text-ink-2">
          Describe the role. {MAYA_EMPLOYEE_NAME} will ask what&apos;s missing, draft a job brief, and shortlist three AI employee candidates.
        </p>
      </div>

      <div className="rounded-[18px] border border-border bg-surface p-2 shadow-md">
        <div className="flex flex-wrap items-center gap-2.5 px-4 py-1.5 sm:flex-nowrap">
          <span className="whitespace-nowrap text-base text-ink-3">I need someone who can…</span>
          <input
            value={roleInput}
            onChange={(e) => onRoleInputChange(e.target.value)}
            placeholder="help me test my app and find bugs"
            className="min-w-0 flex-1 border-none bg-transparent py-2.5 text-base outline-none"
            onKeyDown={(e) => e.key === "Enter" && handleContinue()}
          />
          <button
            type="button"
            onClick={handleContinue}
            disabled={!roleInput.trim() || busy}
            className="whitespace-nowrap rounded-xl bg-ink px-5 py-3.5 text-sm font-medium text-white shadow-sm hover:bg-ink/90 disabled:opacity-40"
          >
            Continue with {MAYA_EMPLOYEE_NAME} →
          </button>
        </div>
        {roleInput.trim().length >= 2 && searchResults.length > 0 && (
          <div className="border-t border-border px-3 py-2">
            <div className="mb-1.5 px-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
              Matching roles
            </div>
            <div className="flex flex-wrap gap-2">
              {searchResults.map((role) => (
                <button
                  key={role.roleKey}
                  type="button"
                  onClick={() => pickRole(role)}
                  className="rounded-full border border-border bg-muted/50 px-3 py-1.5 text-[13px] hover:border-ink/30"
                >
                  {role.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {HIRE_EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onRoleInputChange(ex)}
            className="rounded-full border border-border bg-surface px-3.5 py-2 text-[13px] text-ink-2 hover:border-ink/30"
          >
            {ex}
          </button>
        ))}
      </div>

      <div className="my-8">
        <div className="mb-3 font-mono text-xs uppercase tracking-wider text-ink-3">Popular AI employees</div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2.5">
          {popularRoles.map((role) => (
            <RoleCard key={role.roleKey} role={role} onPick={() => pickRole(role)} />
          ))}
        </div>
      </div>

      <div className="mb-8">
        <div className="mb-3 font-mono text-xs uppercase tracking-wider text-ink-3">
          Common things people hire for
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2.5">
          {WORKFLOW_CARDS.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => {
                setWorkflowId(card.id);
                setActiveGroup(null);
                setShowDiscovery(false);
              }}
              className={cn(
                "rounded-[14px] border p-3.5 text-left transition hover:-translate-y-0.5 hover:shadow-md",
                workflowId === card.id ? "border-accent/40 bg-accent-soft/30" : "border-border bg-surface",
              )}
            >
              <div className="text-sm font-semibold">{card.label}</div>
              <div className="mt-1 text-[12px] text-ink-2">{card.description}</div>
            </button>
          ))}
        </div>
        <AnimatePresence>
          {workflow && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 overflow-hidden rounded-[14px] border border-border bg-muted/30 p-4"
            >
              <div className="mb-2 text-sm font-medium">Suggested roles for “{workflow.label}”</div>
              <div className="flex flex-wrap gap-2">
                {workflow.roleKeys.map((key) => {
                  const role = getRoleByKey(key);
                  if (!role) return null;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => pickRole(role)}
                      className="rounded-full border border-border bg-surface px-3.5 py-2 text-[13px] hover:border-accent/40"
                    >
                      {role.title}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setWorkflowId(null)}
                  className="rounded-full px-3.5 py-2 text-[13px] text-ink-3"
                >
                  ← Back
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mb-6">
        <div className="mb-3 font-mono text-xs uppercase tracking-wider text-ink-3">Browse by department</div>
        {!activeGroup ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5">
            {browseGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => {
                  setActiveGroup(group.id);
                  setWorkflowId(null);
                }}
                className="flex flex-col gap-1 rounded-[14px] border border-border bg-surface p-3.5 text-left transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <span className="text-sm font-semibold">{group.label}</span>
                <span className="text-[12px] text-ink-2">{group.description}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-[14px] border border-border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">
                What kind of {browseGroups.find((g) => g.id === activeGroup)?.label.toLowerCase()} employee do you need?
              </div>
              <button
                type="button"
                onClick={() => setActiveGroup(null)}
                className="text-[13px] text-ink-3 hover:text-ink"
              >
                ← Back
              </button>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
              {groupRoles.map((role) => (
                <RoleCard key={role.roleKey} role={role} compact onPick={() => pickRole(role)} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-center pb-4">
        <button
          type="button"
          onClick={() => setShowDiscovery(true)}
          className="rounded-full border border-dashed border-border px-5 py-2.5 text-[13px] text-ink-2 hover:border-ink/30 hover:text-ink"
        >
          Not sure what role I need — ask {MAYA_EMPLOYEE_NAME}
        </button>
      </div>

      {showDiscovery && (
        <div className="mb-6 rounded-[14px] border border-border bg-muted/30 p-4 text-center">
          <p className="mb-3 text-sm text-ink-2">What outcome are you trying to achieve?</p>
          <div className="flex flex-wrap justify-center gap-2">
            {DISCOVERY_OUTCOME_CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => onRoleInputChange(chip.value)}
                className="rounded-full border border-border bg-surface px-3.5 py-2 text-[13px] hover:border-accent/40"
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function RoleCard({
  role,
  onPick,
  compact,
}: {
  role: RoleLibraryEntry;
  onPick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "flex flex-col gap-1 rounded-[14px] border border-border bg-surface text-left transition hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-md",
        compact ? "p-2.5" : "p-3.5",
      )}
    >
      <span className={cn("font-semibold", compact ? "text-[13px]" : "text-sm")}>{role.title}</span>
      {!compact && <span className="text-[12px] text-ink-2">{role.description}</span>}
    </button>
  );
}
