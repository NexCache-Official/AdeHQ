/**
 * Email threading helpers — Message-ID / In-Reply-To / References first.
 */

export function normaliseSubject(subject: string): string {
  return subject
    .replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function headerGet(headers: Record<string, string>, name: string): string | null {
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target && v) return v.trim();
  }
  return null;
}

export function parseAddressList(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(",") : value;
  return raw
    .split(",")
    .map((p) => {
      const m = p.match(/<([^>]+)>/);
      return (m ? m[1] : p).trim().toLowerCase();
    })
    .filter(Boolean);
}

export function parseFrom(from: string): { address: string; name: string | null } {
  const m = from.match(/^(.*)<([^>]+)>\s*$/);
  if (m) {
    return { name: m[1].trim().replace(/^"|"$/g, "") || null, address: m[2].trim().toLowerCase() };
  }
  return { name: null, address: from.trim().toLowerCase() };
}

export function buildOutboundMessageId(domain: string, prefix = "adehq"): string {
  const id = crypto.randomUUID();
  return `<${prefix}.${id}@${domain}>`;
}
