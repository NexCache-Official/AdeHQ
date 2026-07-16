export const DRIVE_BUCKETS = {
  files: "adehq-files",
  artifacts: "adehq-artifacts",
  evidence: "adehq-browser-evidence",
  exports: "adehq-exports",
} as const;

/** Legacy bucket — existing uploads may still reference this. */
export const LEGACY_FILE_BUCKET = "workspace-files";

export type DriveSection = "files" | "artifacts" | "evidence" | "exports";

/**
 * Sidebar navigation. "My Drive" (all) is uploads + exports + evidence only —
 * AI artifacts live in their own compact Artifacts section.
 */
export const DRIVE_SECTIONS: Array<{
  id: DriveSection | "all";
  label: string;
  group?: "library" | "ai";
}> = [
  { id: "all", label: "My Drive", group: "library" },
  { id: "files", label: "Uploads", group: "library" },
  { id: "exports", label: "Spreadsheets & docs", group: "library" },
  { id: "evidence", label: "Screenshots", group: "library" },
  { id: "artifacts", label: "Artifacts", group: "ai" },
];

export const DRIVE_PAGE_SIZE = 48;
/** Cap when merging mixed types for My Drive before slicing pages. */
export const DRIVE_MERGE_FETCH_CAP = 400;

export const FREE_TIER_MAX_WORKSPACE_BYTES = 100 * 1024 * 1024;
export const FREE_TIER_MAX_FILE_BYTES = 10 * 1024 * 1024;

export const PRO_TIER_MAX_WORKSPACE_BYTES = 10 * 1024 * 1024 * 1024;
export const PRO_TIER_MAX_FILE_BYTES = 50 * 1024 * 1024;
