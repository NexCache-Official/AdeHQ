/**
 * Inbound HTML sanitisation + remote-image stripping (hostile email content).
 */

import sanitizeHtml from "sanitize-html";

export type SanitizeHtmlResult = {
  html: string;
  flags: string[];
};

export function sanitizeInboundHtml(html: string | null | undefined): SanitizeHtmlResult {
  const flags: string[] = [];
  if (!html) return { html: "", flags };

  if (/<img[\s>]/i.test(html)) flags.push("remote_images_stripped");
  if (/https?:\/\//i.test(html)) flags.push("external_links_present");

  const cleaned = sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img", "h1", "h2", "span", "div", "table", "thead", "tbody", "tr", "th", "td",
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ["href", "name", "target", "rel"],
      img: ["alt", "title", "width", "height"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
      "*": ["style", "class"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      img: () => {
        // Block remote / tracking images by default — replace with placeholder.
        return {
          tagName: "span",
          text: "[image blocked]",
          attribs: { class: "adehq-blocked-image" },
        };
      },
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow" }),
    },
  });

  return { html: cleaned, flags };
}

export function detectPromptInjectionHeuristics(text: string | null | undefined): string[] {
  if (!text) return [];
  const flags: string[] = [];
  const lower = text.toLowerCase();
  const patterns = [
    /ignore (all |any )?(previous|prior|above) instructions/,
    /disregard (your|the) system prompt/,
    /you are now/,
    /exfiltrat/,
    /send (me )?(the )?(customer|user|workspace) (database|data|list)/,
    /download this file and run/,
  ];
  for (const p of patterns) {
    if (p.test(lower)) {
      flags.push("possible_prompt_injection");
      break;
    }
  }
  return flags;
}
