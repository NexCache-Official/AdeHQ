export type PresentationSlideV1 = {
  key?: string;
  layout?: "title" | "section" | "bullets" | "two_column" | "kpi";
  title: string;
  subtitle?: string;
  bullets?: string[];
  notes?: string;
  left?: string[];
  right?: string[];
  kpis?: Array<{ label: string; value: string }>;
};

/** Canonical presentation content — models emit this, never OOXML. */
export type PresentationArtifactV1 = {
  schemaKey: "adehq.presentation.v1";
  schemaVersion: 1;
  kind?: "presentation";
  title: string;
  subtitle?: string;
  slides: PresentationSlideV1[];
  metadata?: Record<string, unknown>;
};
