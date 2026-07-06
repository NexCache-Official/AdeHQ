/** Workspace filtering for admin metrics — exclude test/internal/demo by default. */
export type WorkspaceFilterOptions = {
  includeInternal?: boolean;
  includeTest?: boolean;
  includeDemo?: boolean;
  includeDisabled?: boolean;
};

export function parseWorkspaceFilters(searchParams: URLSearchParams): WorkspaceFilterOptions {
  return {
    includeInternal: searchParams.get("includeInternal") === "true",
    includeTest: searchParams.get("includeTest") === "true",
    includeDemo: searchParams.get("includeDemo") === "true",
    includeDisabled: searchParams.get("includeDisabled") === "true",
  };
}

export function shouldIncludeWorkspace(
  workspace: {
    workspace_mode?: string | null;
    is_internal?: boolean | null;
    is_test?: boolean | null;
    status?: string | null;
  },
  filters: WorkspaceFilterOptions,
): boolean {
  if (!filters.includeDisabled && workspace.status === "disabled") return false;
  if (!filters.includeInternal && workspace.is_internal) return false;
  if (!filters.includeTest && workspace.is_test) return false;
  if (!filters.includeDemo && workspace.workspace_mode === "demo") return false;
  return true;
}

export function filterWorkspaceIds(
  workspaces: {
    id: string;
    workspace_mode?: string | null;
    is_internal?: boolean | null;
    is_test?: boolean | null;
    status?: string | null;
  }[],
  filters: WorkspaceFilterOptions,
): Set<string> {
  return new Set(
    workspaces.filter((w) => shouldIncludeWorkspace(w, filters)).map((w) => w.id),
  );
}
