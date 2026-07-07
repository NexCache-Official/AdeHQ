/**
 * Revolut Merchant API configuration + fetch helper.
 * Secret API keys are server-only and never exposed to the browser.
 */

import { getPublicAppUrl } from "@/lib/site-url";

export type RevolutEnvironment = "sandbox" | "production";

export type RevolutConfig = {
  apiKey: string;
  baseUrl: string;
  apiVersion: string;
  webhookSecret: string | null;
  appBaseUrl: string;
  environment: RevolutEnvironment;
};

export type RevolutStatus = {
  /** True when a merchant API key is present and payments can be collected. */
  configured: boolean;
  /** Which Revolut environment the platform targets. Defaults to sandbox until made live. */
  environment: RevolutEnvironment;
  /** True when a webhook secret is set (order confirmations are signature-verified). */
  webhookVerified: boolean;
};

/** Base merchant API URLs per environment. Overridable via REVOLUT_API_BASE_URL. */
const REVOLUT_BASE_URLS: Record<RevolutEnvironment, string> = {
  sandbox: "https://sandbox-merchant.revolut.com/api",
  production: "https://merchant.revolut.com/api",
};

/**
 * Resolve the target Revolut environment. Defaults to "sandbox" so the platform is safe to
 * exercise before real credentials are in place; set REVOLUT_ENVIRONMENT=production to go live.
 */
export function getRevolutEnvironment(): RevolutEnvironment {
  const raw = process.env.REVOLUT_ENVIRONMENT?.trim().toLowerCase();
  if (raw === "production" || raw === "prod" || raw === "live") return "production";
  return "sandbox";
}

/**
 * Report Revolut readiness without requiring a key. Used by the admin billing surface so the
 * infrastructure state is visible even before credentials are entered.
 */
export function getRevolutStatus(): RevolutStatus {
  return {
    configured: Boolean(process.env.REVOLUT_MERCHANT_API_KEY?.trim()),
    environment: getRevolutEnvironment(),
    webhookVerified: Boolean(process.env.REVOLUT_WEBHOOK_SECRET?.trim()),
  };
}

/** Returns config when Revolut is fully configured, otherwise null. */
export function getRevolutConfig(): RevolutConfig | null {
  const apiKey = process.env.REVOLUT_MERCHANT_API_KEY?.trim();
  if (!apiKey) return null;
  const environment = getRevolutEnvironment();
  const baseUrl =
    process.env.REVOLUT_API_BASE_URL?.trim() || REVOLUT_BASE_URLS[environment];
  const apiVersion = process.env.REVOLUT_API_VERSION?.trim() || "2024-09-01";
  const appBaseUrl = getPublicAppUrl();
  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiVersion,
    webhookSecret: process.env.REVOLUT_WEBHOOK_SECRET?.trim() || null,
    appBaseUrl: appBaseUrl.replace(/\/$/, ""),
    environment,
  };
}

export async function revolutFetch<T>(
  config: RevolutConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Revolut-Api-Version": config.apiVersion,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String((body as { message?: unknown }).message)
        : `Revolut request failed (${res.status}).`;
    throw new Error(message);
  }
  return body as T;
}
