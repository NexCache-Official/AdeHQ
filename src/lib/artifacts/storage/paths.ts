/**
 * adehq-artifacts bucket path contract:
 * workspace/{workspaceId}/artifacts/{artifactId}/versions/{versionId}/
 */

export function artifactVersionPrefix(parts: {
  workspaceId: string;
  artifactId: string;
  versionId: string;
}): string {
  const { workspaceId, artifactId, versionId } = parts;
  if (!workspaceId || !artifactId || !versionId) {
    throw new Error("workspaceId, artifactId, and versionId are required");
  }
  return `workspace/${workspaceId}/artifacts/${artifactId}/versions/${versionId}/`;
}

export function artifactCanonicalObjectPath(parts: {
  workspaceId: string;
  artifactId: string;
  versionId: string;
}): string {
  return `${artifactVersionPrefix(parts)}canonical.json`;
}

export function artifactExportObjectPath(parts: {
  workspaceId: string;
  artifactId: string;
  versionId: string;
  format: string;
  filename?: string;
}): string {
  const name = parts.filename ?? `export.${parts.format}`;
  return `${artifactVersionPrefix(parts)}${name}`;
}

export function artifactPreviewObjectPath(parts: {
  workspaceId: string;
  artifactId: string;
  versionId: string;
}): string {
  return `${artifactVersionPrefix(parts)}preview.html`;
}
