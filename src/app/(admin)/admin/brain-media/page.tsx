import { redirect } from "next/navigation";

/** Media shelf is now part of the full Brain catalog (PR-11). */
export default function AdminBrainMediaRedirectPage() {
  redirect("/admin/brain-catalog");
}
