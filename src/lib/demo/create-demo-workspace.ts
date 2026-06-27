import type { DemoState } from "@/lib/types";

/** In-memory demo workspace — only used via loginDemo(), never during real signup. */
export { buildDemoState } from "./demo-data";

export function isDemoWorkspace(state: DemoState): boolean {
  return state.workspace.workspaceMode === "demo" || state.workspace.plan === "Demo";
}
