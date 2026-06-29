import type { User } from "@supabase/supabase-js";

export function isEmailConfirmed(user: User): boolean {
  return Boolean(user.email_confirmed_at);
}
