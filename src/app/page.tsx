import { AppHeader } from "@/components/AppHeader";
import { LandingClient } from "@/components/LandingClient";
import { getProviderStatus } from "@/lib/env";
import { getLandingSnapshot } from "@/lib/workspace/landingSnapshot";

export const dynamic = "force-dynamic";

export default function Home() {
  const landing = getLandingSnapshot();
  const providerStatus = getProviderStatus();
  return (
    <div className="gate-shell">
      <AppHeader active="工作台" />
      <LandingClient initial={landing} providerStatus={providerStatus} />
    </div>
  );
}
