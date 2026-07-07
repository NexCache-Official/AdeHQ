import { SILICONFLOW_API_BASE_URL } from "@/lib/config/features";
import type { ManagedProviderId } from "./types";

export function allowProviderEnvFallback(): boolean {
  return process.env.ALLOW_PROVIDER_ENV_FALLBACK !== "false";
}

export function envKeyForProvider(provider: ManagedProviderId): string | undefined {
  switch (provider) {
    case "siliconflow":
      return process.env.SILICONFLOW_API_KEY?.trim();
    case "vercel_gateway":
      return process.env.AI_GATEWAY_API_KEY?.trim();
    case "tavily":
      return process.env.TAVILY_API_KEY?.trim();
    case "browserbase":
      return process.env.BROWSERBASE_API_KEY?.trim();
  }
}

export function envBaseUrlForProvider(provider: ManagedProviderId): string | undefined {
  return provider === "siliconflow" ? SILICONFLOW_API_BASE_URL : undefined;
}

export function providerConfiguredByEnv(provider: ManagedProviderId): boolean {
  return Boolean(envKeyForProvider(provider));
}
