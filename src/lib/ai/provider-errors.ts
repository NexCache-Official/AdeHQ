import { APICallError } from "ai";

export function formatProviderError(error: unknown, provider: string, model: string): string {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    const body =
      typeof error.responseBody === "string"
        ? error.responseBody.slice(0, 200)
        : "";
    if (status === 404) {
      return (
        `SiliconFlow returned 404 for model "${model}". ` +
        `The model may be unavailable on your account or misspelled. ` +
        `Try "Balanced" mode (DeepSeek-V4-Flash) or set ADEHQ_SILICONFLOW_CHEAP_MODEL in env.`
      );
    }
    return `${provider} API error (${status ?? "unknown"}): ${error.message}${body ? ` — ${body}` : ""}`;
  }

  if (error instanceof Error) {
    if (error.message.toLowerCase().includes("not found")) {
      return (
        `Model "${model}" was not found on ${provider}. ` +
        `Check ADEHQ_SILICONFLOW_* env vars match SiliconFlow's model list.`
      );
    }
    return error.message;
  }

  return String(error);
}
