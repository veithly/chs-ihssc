import "server-only";
import type { WorkspaceSnapshot } from "../types";
import {
  createWorkspaceFromDemoSource,
  getWorkspaceSnapshot,
} from "./repo";

export interface LandingStats {
  fieldMappings: number;
  repairPatches: number;
  matchGroups: number;
  workflowTasks: number;
  institutionDrafts: number;
  runEvents: number;
  rowsScanned: number;
  hasLiveRun: boolean;
}

export interface LandingSnapshot {
  snapshot: WorkspaceSnapshot;
  stats: LandingStats;
  latestRunId: string | null;
  promptKey: string | null;
}

function emptyStats(): LandingStats {
  return {
    fieldMappings: 0,
    repairPatches: 0,
    matchGroups: 0,
    workflowTasks: 0,
    institutionDrafts: 0,
    runEvents: 0,
    rowsScanned: 0,
    hasLiveRun: false,
  };
}

function statsFromSnapshot(snapshot: WorkspaceSnapshot, runId: string | null): LandingStats {
  if (!runId) return emptyStats();
  const pick = <T extends { run_id: string }>(items: T[]) => items.filter((i) => i.run_id === runId);
  const dataset = snapshot.dataset;
  return {
    fieldMappings: pick(snapshot.fieldMappings).length,
    repairPatches: pick(snapshot.repairPatches).length,
    matchGroups: pick(snapshot.matchGroups).length,
    workflowTasks: pick(snapshot.workflowTasks).length,
    institutionDrafts: pick(snapshot.institutionDrafts).length,
    runEvents: pick(snapshot.runEvents).length,
    rowsScanned: dataset?.row_count ?? 0,
    hasLiveRun: true,
  };
}

export function getLandingSnapshot(promptKey = "repair_price_batch"): LandingSnapshot {
  let snapshot = getWorkspaceSnapshot();
  if (!snapshot.thread) {
    const fresh = createWorkspaceFromDemoSource("demo-price-sheet");
    snapshot = fresh;
  }
  const latestRunId = snapshot.runEvents.at(-1)?.run_id ?? null;
  const stats = statsFromSnapshot(snapshot, latestRunId);
  return {
    snapshot,
    stats,
    latestRunId,
    promptKey,
  };
}
