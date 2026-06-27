/** Production demo mode is off unless explicitly enabled at build time. */
export const ENABLE_DEMO_MODE =
  process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true";

export const DEFAULT_OPENAI_MODEL =
  process.env.ADEHQ_OPENAI_MODEL ?? "gpt-5.4-mini";
