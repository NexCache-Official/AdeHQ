export type DocumentBlock =
  | { type: "paragraph"; text: string; key?: string }
  | { type: "heading"; level: 1 | 2 | 3; text: string; key?: string }
  | { type: "bullets"; items: string[]; key?: string }
  | { type: "numbered"; items: string[]; key?: string }
  | { type: "callout"; text: string; tone?: "info" | "warning" | "success"; key?: string }
  | { type: "table"; columns: string[]; rows: Array<Array<string | number | null>>; key?: string }
  | { type: "quote"; text: string; attribution?: string; key?: string }
  | { type: "divider"; key?: string };

export type DocumentSection = {
  key: string;
  title: string;
  blocks: DocumentBlock[];
};

/** Canonical document content — models emit this, never OOXML. */
export type DocumentArtifactV1 = {
  schemaKey: "adehq.document.v1";
  schemaVersion: 1;
  kind?: "document" | "report" | "checklist";
  title: string;
  summary?: string;
  sections: DocumentSection[];
  metadata?: Record<string, unknown>;
};
