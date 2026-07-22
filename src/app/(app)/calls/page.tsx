import { CallsComingSoon } from "@/components/calls/CallsComingSoon";
import { RealtimeCallsLivePage } from "@/components/calls/RealtimeCallsLivePage";
import { HUMAN_CALLS_ENABLED, LIVE_BRAIN_CALLS_ENABLED } from "@/lib/config/features";

export default function CallsPage() {
  if (!LIVE_BRAIN_CALLS_ENABLED && !HUMAN_CALLS_ENABLED) {
    return <CallsComingSoon />;
  }
  return <RealtimeCallsLivePage />;
}
