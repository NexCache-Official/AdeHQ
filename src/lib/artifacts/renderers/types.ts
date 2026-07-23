import type { ArtifactExportFormat } from "../contracts/kinds";

export type ArtifactRendererInput = {
  canonical: unknown;
  title?: string;
  generatedBy?: string;
  generatedAt?: string;
  brandTokens?: Record<string, unknown>;
};

export type ArtifactRendererResult = {
  format: ArtifactExportFormat;
  mimeType: string;
  buffer: Buffer;
  pageOrSlideCount?: number;
};

export type ArtifactRenderer = {
  key: string;
  version: string;
  format: ArtifactExportFormat;
  mimeType: string;
  render: (input: ArtifactRendererInput) => Promise<ArtifactRendererResult>;
};
