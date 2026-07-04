import "server-only";

// ===== 批次扫描实时进度（内存态） =====
// 「运行价格治理」在服务端是一次同步 run（LLM 规划在关键路径上，内网 235B 可能要几十秒）。
// 这里按 releaseId 记录当前阶段，前端轮询 /api/agent/release-gate/progress 展示真实进度，
// 替代原来只转圈的「监测中」。挂 globalThis 以兼容 dev 下的模块多实例。

export type ScanStepKey = "observe" | "plan" | "scan" | "write" | "verify";

export interface ScanProgress {
  releaseId: string;
  running: boolean;
  step: ScanStepKey;
  detail: string;
  startedAt: number;
  updatedAt: number;
}

const KEY = "__jiaxu_scan_progress__";

function store(): Map<string, ScanProgress> {
  const g = globalThis as Record<string, unknown>;
  if (!g[KEY]) g[KEY] = new Map<string, ScanProgress>();
  return g[KEY] as Map<string, ScanProgress>;
}

export function beginScanProgress(releaseId: string) {
  const now = Date.now();
  store().set(releaseId, {
    releaseId,
    running: true,
    step: "observe",
    detail: "读取价格明细与目录快照",
    startedAt: now,
    updatedAt: now,
  });
}

export function updateScanProgress(releaseId: string, step: ScanStepKey, detail: string) {
  const cur = store().get(releaseId);
  if (!cur) return;
  cur.step = step;
  cur.detail = detail;
  cur.updatedAt = Date.now();
}

export function endScanProgress(releaseId: string) {
  const cur = store().get(releaseId);
  if (!cur) return;
  cur.running = false;
  cur.updatedAt = Date.now();
}

export function getScanProgress(releaseId: string): ScanProgress | null {
  return store().get(releaseId) ?? null;
}
