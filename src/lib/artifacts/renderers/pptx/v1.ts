import {
  buildPresentationBuffer,
  type PresentationSpec,
} from "@/lib/artifacts/engine/presentation";
import type { PresentationArtifactV1 } from "../../contracts/presentation";
import type { ArtifactRenderer, ArtifactRendererInput, ArtifactRendererResult } from "../types";

type SlideBodyBlock = { type?: string; items?: string[]; text?: string };

function extractSlideBullets(slide: PresentationArtifactV1["slides"][number]): string[] {
  if (slide.bullets?.length) return slide.bullets;
  const extra = slide as PresentationArtifactV1["slides"][number] & {
    bodyBlocks?: SlideBodyBlock[];
  };
  if (Array.isArray(extra.bodyBlocks)) {
    return extra.bodyBlocks.flatMap((b: SlideBodyBlock) =>
      b.type === "bullets" || b.type === "numbered"
        ? (b.items ?? [])
        : b.text
          ? [b.text]
          : [],
    );
  }
  return [
    ...(slide.left ?? []),
    ...(slide.right ?? []),
    ...(slide.kpis ?? []).map((k) => `${k.label}: ${k.value}`),
  ];
}

export function presentationArtifactToSpec(
  artifact: PresentationArtifactV1,
  meta?: { generatedBy?: string; generatedAt?: string },
): PresentationSpec {
  const title =
    artifact?.title?.trim() ||
    (typeof artifact?.metadata?.title === "string" ? artifact.metadata.title : "") ||
    "Untitled presentation";
  const subtitle =
    artifact?.subtitle?.trim() ||
    (typeof artifact?.metadata?.subtitle === "string" ? artifact.metadata.subtitle : undefined);

  return {
    title,
    subtitle,
    generatedBy: meta?.generatedBy,
    generatedAt: meta?.generatedAt,
    slides: (artifact.slides ?? []).map((slide, index) => {
      const speakerNotes = (slide as { speakerNotes?: string }).speakerNotes;
      return {
        title: slide.title?.trim() || `Slide ${index + 1}`,
        bullets: extractSlideBullets(slide),
        notes: slide.notes ?? speakerNotes,
        layout:
          slide.layout === "two_column"
            ? "two_column"
            : slide.layout === "kpi"
              ? "kpi"
              : slide.layout === "section" || slide.layout === "title"
                ? "section"
                : "bullets",
      };
    }),
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
