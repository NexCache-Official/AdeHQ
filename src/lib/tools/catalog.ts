import type { ToolStatus } from "@/lib/types";

/** Built-in AdeHQ apps — always available inside the workspace. */
export function isInternalTool(toolId: string): boolean {
  return toolId.startsWith("adehq-");
}

/** Normalize catalog / workspace status for display and UI logic. */
export function displayToolStatus(toolId: string, status: ToolStatus): ToolStatus {
  if (isInternalTool(toolId)) return "connected";
  if (status === "mock") return "coming_soon";
  return status;
}

export function isToolConnectable(toolId: string, status: ToolStatus): boolean {
  if (isInternalTool(toolId)) return false;
  const display = displayToolStatus(toolId, status);
  return display === "not_connected";
}
