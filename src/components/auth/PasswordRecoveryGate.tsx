"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isPasswordRecoveryPending } from "@/lib/auth/recovery";

const ALLOWED_DURING_RECOVERY = [
  "/reset-password",
  "/forgot-password",
  "/login",
  "/auth/",
  "/confirm-email",
];

/**
 * While a password-reset link session is active, block workspace access until
 * the user sets a new password on /reset-password.
 */
export function PasswordRecoveryGate() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isPasswordRecoveryPending()) return;

    const allowed = ALLOWED_DURING_RECOVERY.some(
      (path) => pathname === path || pathname.startsWith(path),
    );
    if (!allowed) {
      router.replace("/reset-password");
    }
  }, [pathname, router]);

  return null;
}
