import { CallsComingSoon } from "@/components/calls/CallsComingSoon";
import { CallsLivePage } from "@/components/calls/CallsLivePage";
import { WORKFORCE_CALLS_ENABLED } from "@/lib/config/features";

export default function CallsPage() {
  if (!WORKFORCE_CALLS_ENABLED) {
    return <CallsComingSoon />;
  }
  return <CallsLivePage />;
}
