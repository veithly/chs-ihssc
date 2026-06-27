import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { WorkspaceClient } from "@/components/WorkspaceClient";
import { getProviderStatus } from "@/lib/env";
import { getWorkspaceSnapshot } from "@/lib/workspace/repo";

export const dynamic = "force-dynamic";

export default function WorkspacePage() {
  const snapshot = getWorkspaceSnapshot();
  const providerStatus = getProviderStatus();
  return (
    <div className="gate-shell">
      <AppHeader active="工作台" />
      <Suspense fallback={null}>
        <WorkspaceClient initialSnapshot={snapshot} providerStatus={providerStatus} />
      </Suspense>
    </div>
  );
}
