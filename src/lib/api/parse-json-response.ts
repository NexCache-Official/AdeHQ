/** Parse a fetch Response as JSON; surface HTML/error pages as readable failures. */
export async function parseJsonResponse<T = Record<string, unknown>>(
  response: Response,
): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const snippet = text.replace(/\s+/g, " ").slice(0, 120);
    if (snippet.includes("<!DOCTYPE") || snippet.includes("<html")) {
      throw new Error(
        response.ok
          ? "Server returned an unexpected HTML page instead of JSON."
          : `Request failed (${response.status}). The server returned an error page instead of JSON.`,
      );
    }
    throw new Error(`Invalid JSON response (${response.status}).`);
  }
}
