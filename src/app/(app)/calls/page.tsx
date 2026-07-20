import { CallsComingSoon } from "@/components/calls/CallsComingSoon";
import { RealtimeCallsLivePage } from "@/components/calls/RealtimeCallsLivePage";
import { LIVE_BRAIN_CALLS_ENABLED } from "@/lib/config/features";

export default function CallsPage() {
  if (!LIVE_BRAIN_CALLS_ENABLED) {
    return <CallsComingSoon />;
  }
  return <RealtimeCallsLivePage />;
}
