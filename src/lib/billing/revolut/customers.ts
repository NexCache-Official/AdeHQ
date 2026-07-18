import { getRevolutConfig, revolutFetch } from "./client";

export type RevolutCustomer = {
  id: string;
  email?: string;
  full_name?: string;
};

export async function createOrGetRevolutCustomer(input: {
  email: string;
  fullName?: string | null;
  externalReference?: string;
}): Promise<RevolutCustomer> {
  const config = getRevolutConfig();
  if (!config) throw new Error("Revolut is not configured.");

  // Base URL already includes /api — path is /customers (no version segment).
  return revolutFetch<RevolutCustomer>(config, "/customers", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      full_name: input.fullName || undefined,
    }),
    headers: input.externalReference
      ? { "Idempotency-Key": `customer:${input.externalReference}` }
      : {},
  });
}
