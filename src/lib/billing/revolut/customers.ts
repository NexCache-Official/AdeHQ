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

  return revolutFetch<RevolutCustomer>(config, "/1.0/customers", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      full_name: input.fullName || undefined,
      business_name: undefined,
    }),
    headers: input.externalReference
      ? { "Idempotency-Key": `customer:${input.externalReference}` }
      : {},
  });
}
