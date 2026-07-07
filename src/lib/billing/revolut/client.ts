/**
 * Revolut Merchant API configuration + fetch helper.
 * Secret API keys are server-only and never exposed to the browser.
 */

import { getPublicAppUrl } from "@/lib/site-url";

export type RevolutConfig = {
  apiKey: string;
  baseUrl: string;
  apiVersion: string;
  webhookSecret: string | null;
  appBaseUrl: string;
};

/** Returns config when Revolut is fully configured, otherwise null. */
export function getRevolutConfig(): RevolutConfig | null {
  const apiKey = process.env.REVOLUT_MERCHANT_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl =
    process.env.REVOLUT_API_BASE_URL?.trim() || "https://merchant.revolut.com/api";
  const apiVersion = process.env.REVOLUT_API_VERSION?.trim() || "2024-09-01";
  const appBaseUrl = getPublicAppUrl();
  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiVersion,
    webhookSecret: process.env.REVOLUT_WEBHOOK_SECRET?.trim() || null,
    appBaseUrl: appBaseUrl.replace(/\/$/, ""),
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
