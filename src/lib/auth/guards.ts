import type { User } from "@supabase/supabase-js";
import { isEmailConfirmed } from "@/lib/auth/session";
import { supabase } from "@/lib/supabase/client";

export type EmailGateResult =
  | { ok: true; user: User }
  | { ok: false; reason: "signed_out" }
  | { ok: false; reason: "unconfirmed"; email: string };

/** Ensures the current Supabase session belongs to a confirmed user. Signs out if not. */
export async function assertConfirmedSession(): Promise<EmailGateResult> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;

  const user = data.user;
  if (!user) {
    return { ok: false, reason: "signed_out" };
  }

  if (!isEmailConfirmed(user)) {
    await supabase.auth.signOut();
    return { ok: false, reason: "unconfirmed", email: user.email ?? "" };
  }

  return { ok: true, user };
}

export function isRepeatedSignup(user: User): boolean {
  return (user.identities?.length ?? 0) === 0;
}
