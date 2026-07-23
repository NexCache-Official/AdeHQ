export type ArtifactSourceRef = {
  sourceType: string;
  sourceId: string;
  sourceLocator?: string | null;
  claimKey?: string | null;
  excerptHash?: string | null;
  confidence?: number | null;
};

export type ProvenanceLink = {
  artifactPath: string;
  source: ArtifactSourceRef;
};

/** Build a stable dotted artifact path for a section/block. */
export function artifactPathFor(
  sectionKey: string,
  blockKey?: string | null,
  field?: string | null,
): string {
  const parts = ["sections", sectionKey];
  if (blockKey) parts.push("blocks", blockKey);
  if (field) parts.push(field);
  return parts.join(".");
}

export function sourceRefToLocator(ref: ArtifactSourceRef): string {
  const base = `${ref.sourceType}:${ref.sourceId}`;
  return ref.sourceLocator ? `${base}#${ref.sourceLocator}` : base;
}

export function mapSourceRefsToProvenance(
  artifactPath: string,
  refs: ArtifactSourceRef[],
): ProvenanceLink[] {
  return refs.map((source) => ({ artifactPath, source }));
}

export function groupProvenanceByPath(
  links: ProvenanceLink[],
): Record<string, ArtifactSourceRef[]> {
  const out: Record<string, ArtifactSourceRef[]> = {};
  for (const link of links) {
    (out[link.artifactPath] ??= []).push(link.source);
  }
  return out;
}

export function flattenProvenance(
  byPath: Record<string, ArtifactSourceRef[]>,
): ProvenanceLink[] {
  const links: ProvenanceLink[] = [];
  for (const [artifactPath, refs] of Object.entries(byPath)) {
    for (const source of refs) {
      links.push({ artifactPath, source });
    }
  }
  return links;
}

/** Parse `sections.{section}.blocks.{block}` style paths. */
export function parseArtifactPath(path: string): {
  sectionKey?: string;
  blockKey?: string;
  field?: string;
} {
  const parts = path.split(".").filter(Boolean);
  const result: { sectionKey?: string; blockKey?: string; field?: string } = {};
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i] === "sections" && parts[i + 1]) {
      result.sectionKey = parts[i + 1];
      i += 1;
    } else if (parts[i] === "blocks" && parts[i + 1]) {
      result.blockKey = parts[i + 1];
      i += 1;
    } else if (i === parts.length - 1 && parts[i] !== "sections" && parts[i] !== "blocks") {
      result.field = parts[i];
    }
  }
  return result;
}
