import {
  buildPresentationBuffer,
  type PresentationSpec,
} from "@/lib/artifacts/engine/presentation";
import type { PresentationArtifactV1 } from "../../contracts/presentation";
import type { ArtifactRenderer, ArtifactRendererInput, ArtifactRendererResult } from "../types";

export function presentationArtifactToSpec(
  artifact: PresentationArtifactV1,
  meta?: { generatedBy?: string; generatedAt?: string },
): PresentationSpec {
  return {
    title: artifact.title,
    subtitle: artifact.subtitle,
    generatedBy: meta?.generatedBy,
    generatedAt: meta?.generatedAt,
    slides: (artifact.slides ?? []).map((slide) => ({
      title: slide.title,
      bullets:
        slide.bullets ??
        [
          ...(slide.left ?? []),
          ...(slide.right ?? []),
          ...(slide.kpis ?? []).map((k) => `${k.label}: ${k.value}`),
        ],
      notes: slide.notes,
      layout:
        slide.layout === "two_column"
          ? "two_column"
          : slide.layout === "kpi"
            ? "kpi"
            : slide.layout === "section" || slide.layout === "title"
              ? "section"
              : "bullets",
    })),
  };
}

export async function renderPptxV1(input: ArtifactRendererInput): Promise<ArtifactRendererResult> {
  const canonical = input.canonical as PresentationArtifactV1;
  const spec = presentationArtifactToSpec(canonical, {
    generatedBy: input.generatedBy,
    generatedAt: input.generatedAt,
  });
  if (input.title) spec.title = input.title;
  const buffer = await buildPresentationBuffer(spec);
  return {
    format: "pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer,
    pageOrSlideCount: (spec.slides?.length ?? 0) + 1,
  };
}

export const pptxRendererV1: ArtifactRenderer = {
  key: "pptx.pptxgenjs.v1",
  version: "1",
  format: "pptx",
  mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  render: renderPptxV1,
};
