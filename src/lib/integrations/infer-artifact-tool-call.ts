import type { ToolCallEffect } from "@/lib/integrations/types";
import { isDriveArtifactAsk } from "@/lib/ai/detect-drive-artifact-ask";
import {
  detectSowOrRfp,
  detectVendorCompare,
  firstSentence,
} from "@/lib/integrations/artifact-content-from-message";

function titleFromMessage(message: string, fallback: string): string {
  const cleaned = message
    .replace(
      /\b(?:please|create|draft|build|make|save|to|drive|using|createPdfReport|createDocx|createPresentation|createSpreadsheet|artifact\.create\w*)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  const slice = cleaned.slice(0, 90).replace(/[,:;]+$/, "").trim();
  return slice || firstSentence(message).slice(0, 72) || fallback;
}

/**
 * When the model repeatedly omits effects.toolCalls on an explicit Drive artifact
 * ask, synthesize one executable call so the user does not get a no-op
 * "I'll follow up" reply. Sections/rows/slides are filled by hydrate-tool-args.
 */
export function inferRequiredArtifactToolCall(message: string): ToolCallEffect | null {
  const text = message.trim();
  if (!text) return null;
  if (!isDriveArtifactAsk(text) && !/\bcreate(?:PdfReport|Docx|Presentation|Spreadsheet)\b/i.test(text)) {
    return null;
  }

  const wantsDrive = /\b(?:drive|save(?:\s+it)?\s+to|xlsx|docx|pptx|pdf)\b/i.test(text);

  if (
    /\bcreatePdfReport\b/i.test(text) ||
    (/\bpdf\b/i.test(text) &&
      /\b(?:brief|report|briefing|memo)\b/i.test(text) &&
      wantsDrive) ||
    (wantsDrive &&
      /\b(?:brief|briefing|report)\b/i.test(text) &&
      (detectVendorCompare(text) || /\bops\b/i.test(text)))
  ) {
    return {
      tool: "artifact.createPdfReport",
      mode: "execute",
      args: {
        title: titleFromMessage(text, "Ops briefing"),
        template: "market_research_report",
        summary: text.slice(0, 220),
      },
    };
  }

  if (
    /\bcreateDocx\b/i.test(text) ||
    (/\b(?:docx|word)\b/i.test(text) &&
      /\b(?:draft|sow|rfp|proposal|document)\b/i.test(text) &&
      wantsDrive) ||
    (detectSowOrRfp(text) && wantsDrive && !/\b(?:pdf|pptx|xlsx|spreadsheet)\b/i.test(text))
  ) {
    return {
      tool: "artifact.createDocx",
      mode: "execute",
      args: {
        title: titleFromMessage(text, "Document"),
        template: "business_brief",
        summary: text.slice(0, 220),
      },
    };
  }

  if (
    /\bcreatePresentation\b/i.test(text) ||
    (/\b(?:pptx|powerpoint|slides?|deck)\b/i.test(text) && wantsDrive)
  ) {
    return {
      tool: "artifact.createPresentation",
      mode: "execute",
      args: {
        title: titleFromMessage(text, "Presentation"),
        template: "sales_deck",
      },
    };
  }

  if (
    /\bcreateSpreadsheet\b/i.test(text) ||
    (/\b(?:excel|spreadsheet|workbook|xlsx|scorecard)\b/i.test(text) && wantsDrive)
  ) {
    return {
      tool: "artifact.createSpreadsheet",
      mode: "execute",
      args: {
        title: titleFromMessage(text, "Spreadsheet"),
      },
    };
  }

  return null;
}

export function replyForInferredArtifactTool(tool: string): string {
  if (tool.includes("Pdf")) return "Creating the PDF now and saving it to Drive.";
  if (tool.includes("Docx")) return "Drafting the Word document now and saving it to Drive.";
  if (tool.includes("Presentation")) return "Building the presentation now and saving it to Drive.";
  if (tool.includes("Spreadsheet")) return "Creating the spreadsheet now and saving it to Drive.";
  return "Creating the file now and saving it to Drive.";
}
