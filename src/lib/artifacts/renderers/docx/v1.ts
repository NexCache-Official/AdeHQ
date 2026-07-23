import { buildDocxBuffer, type DocxSpec } from "@/lib/artifacts/engine/docx";
import type { DocumentArtifactV1 } from "../../contracts/document";
import type { ArtifactRenderer, ArtifactRendererInput, ArtifactRendererResult } from "../types";

function blocksToBody(blocks: DocumentArtifactV1["sections"][number]["blocks"]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "paragraph":
      case "callout":
      case "quote":
        parts.push(block.text);
        break;
      case "heading":
        parts.push(block.text);
        break;
      case "bullets":
      case "numbered":
        parts.push(block.items.map((i) => `- ${i}`).join("\n"));
        break;
      case "table":
        parts.push(
          [
            block.columns.join(" | "),
            block.rows.map((r) => r.map((c) => String(c ?? "")).join(" | ")).join("\n"),
          ].join("\n"),
        );
        break;
      case "divider":
        parts.push("---");
        break;
      default:
        break;
    }
  }
  return parts.join("\n\n");
}

export function documentArtifactToDocxSpec(
  artifact: DocumentArtifactV1,
  meta?: { generatedBy?: string; generatedAt?: string },
): DocxSpec {
  return {
    title: artifact.title,
    summary: artifact.summary,
    generatedBy: meta?.generatedBy,
    generatedAt: meta?.generatedAt,
    sections: (artifact.sections ?? []).map((section) => ({
      heading: section.title,
      body: blocksToBody(section.blocks ?? []),
    })),
  };
}

export async function renderDocxV1(input: ArtifactRendererInput): Promise<ArtifactRendererResult> {
  const canonical = input.canonical as DocumentArtifactV1;
  const spec = documentArtifactToDocxSpec(canonical, {
    generatedBy: input.generatedBy,
    generatedAt: input.generatedAt,
  });
  if (input.title) spec.title = input.title;
  const buffer = await buildDocxBuffer(spec);
  return {
    format: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer,
    pageOrSlideCount: spec.sections.length,
  };
}

export const docxRendererV1: ArtifactRenderer = {
  key: "docx.docxjs.v1",
  version: "1",
  format: "docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  render: renderDocxV1,
};
