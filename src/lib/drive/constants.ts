export const DRIVE_BUCKETS = {
  files: "adehq-files",
  artifacts: "adehq-artifacts",
  evidence: "adehq-browser-evidence",
  exports: "adehq-exports",
} as const;

/** Legacy bucket — existing uploads may still reference this. */
export const LEGACY_FILE_BUCKET = "workspace-files";

export type DriveSection = "files" | "artifacts" | "evidence" | "exports";

export const DRIVE_SECTIONS: Array<{ id: DriveSection | "all"; label: string }> = [
  { id: "all", label: "All files" },
  { id: "files", label: "Uploads" },
  { id: "exports", label: "Spreadsheets, PDF, Word, PPTX" },
  { id: "artifacts", label: "AI notes (.md)" },
  { id: "evidence", label: "Screenshots / Evidence" },
];

export const FREE_TIER_MAX_WORKSPACE_BYTES = 100 * 1024 * 1024;
export const FREE_TIER_MAX_FILE_BYTES = 10 * 1024 * 1024;

export const PRO_TIER_MAX_WORKSPACE_BYTES = 10 * 1024 * 1024 * 1024;
export const PRO_TIER_MAX_FILE_BYTES = 50 * 1024 * 1024;
