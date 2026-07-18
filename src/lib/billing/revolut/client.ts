/**
 * Revolut Merchant API configuration + fetch helper.
 * Secret API keys are server-only and never exposed to the browser.
 */

import { getPublicAppUrl } from "@/lib/site-url";

export type RevolutEnvironment = "sandbox" | "production";
export type RevolutKeyKind = "secret" | "public" | "unknown";

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
  /** ISO currency for hosted orders (default USD). */
  currency: string;
  /** Classified shape of REVOLUT_MERCHANT_API_KEY (never the secret itself). */
  keyKind: RevolutKeyKind | "missing";
  /** API host currently targeted. */
  baseUrl: string;
  /** Pinned Revolut-Api-Version header value. */
  apiVersion: string;
};

/** Merchant order currency — must match Revolut account support. */
export function getRevolutCurrency(): string {
  const raw = process.env.REVOLUT_CURRENCY?.trim().toUpperCase();
  if (raw && /^[A-Z]{3}$/.test(raw)) return raw;
  return "USD";
}

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
  const apiKey = normalizeRevolutApiKey(process.env.REVOLUT_MERCHANT_API_KEY);
  const environment = getRevolutEnvironment();
  const apiVersion =
    process.env.REVOLUT_MERCHANT_API_VERSION?.trim() ||
    process.env.REVOLUT_API_VERSION?.trim() ||
    "2026-04-20";
  const baseUrl =
    process.env.REVOLUT_API_BASE_URL?.trim() || REVOLUT_BASE_URLS[environment];
  return {
    configured: Boolean(apiKey),
    environment,
    webhookVerified: Boolean(process.env.REVOLUT_WEBHOOK_SECRET?.trim()),
    currency: getRevolutCurrency(),
    keyKind: apiKey ? classifyRevolutApiKey(apiKey) : "missing",
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiVersion,
  };
}

/**
 * Normalize Merchant API secret key from env.
 * Strips quotes and a duplicated "Bearer " prefix (common copy-paste mistake that
 * produces Revolut "Unauthenticated access").
 */
export function normalizeRevolutApiKey(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let key = raw.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  if (/^bearer\s+/i.test(key)) {
    key = key.replace(/^bearer\s+/i, "").trim();
  }
  return key || null;
}

/** Best-effort classify key shape without logging the secret. */
export function classifyRevolutApiKey(apiKey: string): RevolutKeyKind {
  const k = apiKey.trim();
  if (/^sk[_-]/i.test(k) || /^prod_.*sk/i.test(k) || k.startsWith("sk_")) return "secret";
  // Revolut public/publishable keys are often pk_… — never valid for server Merchant API.
  if (/^pk[_-]/i.test(k) || k.includes("_pk_") || k.startsWith("pk_")) return "public";
  return "unknown";
}

/** Returns config when Revolut is fully configured, otherwise null. */
export function getRevolutConfig(): RevolutConfig | null {
  const apiKey = normalizeRevolutApiKey(process.env.REVOLUT_MERCHANT_API_KEY);
  if (!apiKey) return null;
  const environment = getRevolutEnvironment();
  const baseUrl =
    process.env.REVOLUT_API_BASE_URL?.trim() || REVOLUT_BASE_URLS[environment];
  // Pinned Merchant API version for subscription operations (see revolut-integration-contract.md).
  const apiVersion =
    process.env.REVOLUT_MERCHANT_API_VERSION?.trim() ||
    process.env.REVOLUT_API_VERSION?.trim() ||
    "2026-04-20";
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

function formatRevolutError(
  status: number,
  body: unknown,
  config: RevolutConfig,
): string {
  const rawMessage =
    body && typeof body === "object" && "message" in body
      ? String((body as { message?: unknown }).message)
      : `Revolut request failed (${status}).`;

  if (status === 401 || /unauthenticated/i.test(rawMessage)) {
    const kind = classifyRevolutApiKey(config.apiKey);
    const hints: string[] = [
      `Revolut auth failed (${config.environment} → ${config.baseUrl}).`,
    ];
    if (kind === "public") {
      hints.push(
        "REVOLUT_MERCHANT_API_KEY looks like a Public key — use the Merchant API Secret key (usually starts with sk_).",
      );
    } else if (config.environment === "production") {
      hints.push(
        "Use a Production Merchant API Secret key (not Sandbox). Confirm REVOLUT_ENVIRONMENT matches the key’s environment.",
      );
    } else {
      hints.push(
        "Use a Sandbox Merchant API Secret key, or set REVOLUT_ENVIRONMENT=production with a live secret key.",
      );
    }
    hints.push(rawMessage);
    return hints.join(" ");
  }

  return rawMessage;
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
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { message: text.slice(0, 200) };
    }
  }
  if (!res.ok) {
    throw new Error(formatRevolutError(res.status, body, config));
  }
  return body as T;
}
