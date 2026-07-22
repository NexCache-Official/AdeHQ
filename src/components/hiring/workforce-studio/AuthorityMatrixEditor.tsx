"use client";

import { cn } from "@/lib/utils";
import type { AuthorityDomain, AuthorityLevel, AuthorityPolicy } from "@/lib/hiring/workforce-studio/types";

const ALL_DOMAINS: { domain: AuthorityDomain; label: string }[] = [
  { domain: "room_scope", label: "Rooms" },
  { domain: "tasks", label: "Tasks" },
  { domain: "crm", label: "CRM" },
  { domain: "email", label: "Email" },
  { domain: "drive", label: "Drive" },
  { domain: "artifact", label: "Artifacts" },
  { domain: "social", label: "Social" },
  { domain: "calendar", label: "Calendar" },
  { domain: "investor", label: "Investor" },
  { domain: "team", label: "Team" },
  { domain: "research", label: "Research" },
];

const LEVELS: { level: AuthorityLevel; label: string; hint: string }[] = [
  { level: "none", label: "None", hint: "No access" },
  { level: "read", label: "Read", hint: "View only" },
  { level: "act_with_approval", label: "Approval", hint: "Acts, needs sign-off" },
  { level: "act_autonomously", label: "Autonomous", hint: "Acts on its own" },
];

/**
 * AuthorityPolicy matrix editor — every capability domain a seat can touch,
 * with a radio group per row so the whole matrix is reachable with Tab +
 * Arrow keys alone (native <input type="radio"> keyboard semantics), no
 * mouse required. Used inside the seat card and reused by the canvas
 * Inspector panel.
 */
export function AuthorityMatrixEditor({
  seatId,
  policy,
  onChange,
  compact = false,
}: {
  seatId: string;
  policy: AuthorityPolicy;
  onChange: (domain: AuthorityDomain, level: AuthorityLevel) => void;
  compact?: boolean;
}) {
  return (
    <div role="group" aria-label="Authority policy matrix" className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[420px] border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th scope="col" className="px-2 py-1.5 text-left font-medium text-ink-3">
              Domain
            </th>
            {LEVELS.map((l) => (
              <th key={l.level} scope="col" className="px-1.5 py-1.5 text-center font-medium text-ink-3" title={l.hint}>
                {l.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(compact ? ALL_DOMAINS.slice(0, 5) : ALL_DOMAINS).map(({ domain, label }) => {
            const current = policy[domain] ?? "none";
            const groupName = `authority-${seatId}-${domain}`;
            return (
              <tr key={domain} className="border-b border-border/60 last:border-0">
                <td className="px-2 py-1 text-ink-2">{label}</td>
                {LEVELS.map((l) => (
                  <td key={l.level} className="px-1.5 py-1 text-center">
                    <label className="inline-flex cursor-pointer items-center justify-center">
                      <input
                        type="radio"
                        name={groupName}
                        value={l.level}
                        checked={current === l.level}
                        onChange={() => onChange(domain, l.level)}
                        aria-label={`${label}: ${l.label}`}
                        className={cn(
                          "h-3.5 w-3.5 accent-accent",
                          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                        )}
                      />
                    </label>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
