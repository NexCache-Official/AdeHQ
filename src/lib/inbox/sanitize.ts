/**
 * Inbound HTML sanitisation + remote-image stripping (hostile email content).
 * Dependency-free — avoids ESM/CJS bundling issues with sanitize-html/htmlparser2.
 */

export type SanitizeHtmlResult = {
  html: string;
  flags: string[];
};

const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

const GLOBAL_SAFE_ATTRS = new Set(["class"]);
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "name", "target", "rel"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan"]),
};

function isSafeUrl(value: string): boolean {
  const v = value.trim().toLowerCase();
  return (
    v.startsWith("http://") ||
    v.startsWith("https://") ||
    v.startsWith("mailto:") ||
    v.startsWith("#") ||
    v.startsWith("/")
  );
}

function sanitiseAttributes(tag: string, rawAttrs: string): string {
  const allowed = new Set([...(TAG_ATTRS[tag] ?? []), ...GLOBAL_SAFE_ATTRS]);
  const out: string[] = [];
  const re = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rawAttrs)) !== null) {
    const name = match[1].toLowerCase();
    if (name.startsWith("on")) continue;
    if (!allowed.has(name)) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (name === "href" || name === "src") {
      if (!isSafeUrl(value)) continue;
    }
    if (name === "target") {
      out.push(`target="_blank"`);
      continue;
    }
    out.push(`${name}="${value.replace(/"/g, "&quot;")}"`);
  }
  if (tag === "a") {
    out.push(`rel="noopener noreferrer nofollow"`);
  }
  return out.length ? ` ${out.join(" ")}` : "";
}

function transformTag(full: string, slash: string, name: string, attrs: string): string {
  const tag = name.toLowerCase();
  if (tag === "img") {
    return '<span class="adehq-blocked-image">[image blocked]</span>';
  }
  if (!ALLOWED_TAGS.has(tag)) return "";
  if (slash === "/") return `</${tag}>`;
  const selfClosing = tag === "br" || tag === "hr";
  const cleaned = sanitiseAttributes(tag, attrs ?? "");
  return selfClosing ? `<${tag}${cleaned} />` : `<${tag}${cleaned}>`;
}

export function sanitizeInboundHtml(html: string | null | undefined): SanitizeHtmlResult {
  const flags: string[] = [];
  if (!html) return { html: "", flags };

  if (/<img[\s>]/i.test(html)) flags.push("remote_images_stripped");
  if (/https?:\/\//i.test(html)) flags.push("external_links_present");

  let cleaned = html
    // Drop high-risk blocks entirely (content included).
    .replace(/<(script|style|iframe|object|embed|form|link|meta|base|svg|math)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed|form|link|meta|base|svg|math)\b[^>]*\/?>/gi, "")
    // Strip HTML comments / conditional comments.
    .replace(/<!--[\s\S]*?-->/g, "")
    // Rewrite remaining tags through the allowlist.
    .replace(/<\/?([a-zA-Z][\w:-]*)\b([^>]*)>/g, (full, name: string, attrs: string) => {
      const closing = full.startsWith("</");
      return transformTag(full, closing ? "/" : "", name, attrs);
    });

  // Collapse leftover empty noise from stripped tags.
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

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
