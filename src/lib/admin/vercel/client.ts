/**
 * Vercel REST API client for AdeHQ Control (server-only).
 * Uses a platform-scoped API token — never expose to the browser.
 */

export type VercelEnvTarget = "production" | "preview" | "development";

export type VercelConfig = {
  token: string;
  projectIdOrName: string;
  teamId?: string;
  teamSlug?: string;
};

export function getVercelConfig(): VercelConfig | null {
  const token =
    process.env.VERCEL_API_TOKEN?.trim() ||
    process.env.VERCEL_ACCESS_TOKEN?.trim() ||
    null;
  if (!token) return null;

  const projectIdOrName =
    process.env.VERCEL_PROJECT_ID?.trim() ||
    process.env.VERCEL_PROJECT_NAME?.trim() ||
    "ade-hq-eight";

  return {
    token,
    projectIdOrName,
    teamId: process.env.VERCEL_TEAM_ID?.trim() || undefined,
    teamSlug: process.env.VERCEL_TEAM_SLUG?.trim() || undefined,
  };
}

function teamQuery(config: VercelConfig): string {
  if (config.teamId) return `teamId=${encodeURIComponent(config.teamId)}`;
  if (config.teamSlug) return `slug=${encodeURIComponent(config.teamSlug)}`;
  return "";
}

function appendTeamQuery(path: string, config: VercelConfig): string {
  const q = teamQuery(config);
  if (!q) return path;
  return path.includes("?") ? `${path}&${q}` : `${path}?${q}`;
}

export async function vercelApiFetch<T>(
  config: VercelConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `https://api.vercel.com${appendTeamQuery(path, config)}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error?: { message?: string } }).error?.message ?? res.statusText)
        : `Vercel API error (${res.status}).`;
    throw new Error(message);
  }

  return body as T;
}
