/**
 * Natural Work Hours notices for live calls.
 * Calls are gated by workspace Work Hours — not chat daily token caps.
 */

export type WorkHoursCallNoticeKind = "low" | "exhausted";

const LOW_NOTICES = [
  "Quick heads-up — we're running a little light on Work Hours. Want to wrap the essentials now, or should we pick this up after you top up?",
  "We're getting close to the Work Hours line. Happy to keep going for the important bits, or we can schedule a longer sit-down once you've got more runway.",
  "Work Hours are looking a bit skinny on this workspace. Shall we keep this short and sweet, or reschedule when you've got more capacity?",
  "Just flagging — Work Hours are running low. I can finish the must-dos now, or we can continue another time after you renew.",
];

const EXHAUSTED_NOTICES = [
  "I'm sorry — my Work Hours just finished for this workspace. Renew capacity and call me back, and I'll pick this right up.",
  "Ah — that's me out of Work Hours for now. Top up or renew the workspace allowance and we can finish this properly.",
  "I've hit the Work Hours ceiling, so I have to step off. Renew capacity whenever you're ready and I'll be here.",
  "Sorry to cut us short — the workspace Work Hours just ran out. Renew and ring me back; I won't lose the thread.",
];

function pickFrom(list: string[], seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return list[hash % list.length] ?? list[0]!;
}

export function pickWorkHoursCallNotice(
  kind: WorkHoursCallNoticeKind,
  seed: string,
): string {
  return pickFrom(kind === "low" ? LOW_NOTICES : EXHAUSTED_NOTICES, seed);
}

export function isWorkHoursCapacityBlockReason(reason: string): boolean {
  return /work hours/i.test(reason);
}
