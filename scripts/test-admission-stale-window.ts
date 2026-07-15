import { CAPACITY_LIMITS } from "@/lib/tasks/work-classes";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(CAPACITY_LIMITS.maxInteractiveRunning >= 1, "need at least 1 interactive slot");
const staleMs = Number(process.env.ADEHQ_STALE_INTERACTIVE_RUN_MS ?? 2 * 60 * 1000);
assert(staleMs >= 30_000 && staleMs <= 15 * 60_000, "stale window should be 30s–15m");

console.log("admission stale window: ok", { staleMs, ...CAPACITY_LIMITS });
