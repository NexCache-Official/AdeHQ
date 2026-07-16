"use client";

import { useState } from "react";
import type { WhReceipt } from "@/lib/brain/receipts/load-wh-receipt";

/**
 * Expandable WH receipt under an assistant message.
 * Never shows model ids to members (adminDetail must be stripped server-side).
 */
export function WorkHoursReceipt({
  receipt,
  className = "",
}: {
  receipt: WhReceipt;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (receipt.displayTotalWorkHours <= 0 && receipt.totalWorkHours <= 0) return null;

  return (
    <div className={`mt-1 text-[11px] text-slate-500 ${className}`}>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-100 hover:text-slate-700"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>
          {receipt.displayTotalWorkHours.toFixed(2)} WH used
        </span>
        <span className="text-slate-400">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <ul className="mt-1 space-y-0.5 border-l border-slate-200 pl-2">
          {receipt.lines.map((line, i) => (
            <li key={`${line.capability ?? "x"}-${i}`}>
              <span className="text-slate-600">
                {line.capability ?? line.workType ?? "work"}
              </span>
              <span className="ml-2 tabular-nums">
                {line.displayWorkHours.toFixed(2)} WH
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
