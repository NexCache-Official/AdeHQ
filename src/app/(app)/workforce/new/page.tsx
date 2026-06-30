"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function WorkforceNewPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/hire");
  }, [router]);

  return null;
}
