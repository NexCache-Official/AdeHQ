export type ArtifactKind =
  | "document"
  | "presentation"
  | "workbook"
  | "report"
  | "checklist"
  | "dataset";

export type ArtifactVersionStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "published"
  | "superseded";

export type ArtifactOrigin =
  | "playbook"
  | "manual"
  | "import"
  | "procedure"
  | "conversion"
  | "system";

export type ArtifactExportFormat =
  | "docx"
  | "pptx"
  | "xlsx"
  | "pdf"
  | "html"
  | "markdown"
  | "csv";
