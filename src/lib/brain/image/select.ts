import type { ImageIntent, ImageRouteId } from "./types";
import { IMAGE_INTENT_LABEL, IMAGE_INTENT_WH } from "./types";

export function routeIdForImageIntent(intent: ImageIntent): ImageRouteId {
  switch (intent) {
    case "quick":
      return "route_image_z_image_turbo";
    case "business_graphic":
      return "route_image_qwen_image";
    case "premium":
      return "route_image_flux2_flex";
    case "edit":
      return "route_image_qwen_image_edit";
  }
}

export function memberLabelForIntent(intent: ImageIntent): string {
  return IMAGE_INTENT_LABEL[intent];
}

export function estimatedWhForIntent(intent: ImageIntent): number {
  return IMAGE_INTENT_WH[intent];
}

/** Infer intent from natural language when the tool omits it. */
export function inferImageIntent(message: string): ImageIntent | null {
  const text = message.toLowerCase();
  if (/\b(edit|retouch|change|remove|replace|inpaint)\b/.test(text) && /\b(image|photo|picture|graphic)\b/.test(text)) {
    return "edit";
  }
  if (/\b(premium|photoreal|high[- ]end|hero\s+visual|campaign\s+hero)\b/.test(text)) {
    return "premium";
  }
  if (
    /\b(business\s+graphic|infographic|poster|flyer|slide\s+graphic|text[- ]heavy|logo\s+lockup|banner\s+with\s+text)\b/.test(
      text,
    )
  ) {
    return "business_graphic";
  }
  if (/\b(create|make|generate|draft)\b[\w\s-]{0,24}\b(image|visual|graphic|illustration|picture)\b/.test(text)) {
    return "quick";
  }
  return null;
}
