export const DEMO_SOURCES = [
  {
    id: "demo-price-sheet",
    label: "演示价格表",
    sourceKind: "price_sheet",
    releaseHint: "REL-2026-0623-07",
    description: "含目录别名、执行价偏高、集采落地差异和缺单位项。",
  },
  {
    id: "demo-collective",
    label: "演示集采进度",
    sourceKind: "collective_progress",
    releaseHint: "REL-2026-0623-09",
    description: "按地区和渠道观察中选价落地差异。",
  },
  {
    id: "demo-replies",
    label: "演示机构回函",
    sourceKind: "institution_reply",
    releaseHint: "REL-SAMPLE-01",
    description: "带回函摘要，可用于续办和催办口径。",
  },
] as const;

export type DemoSourceId = (typeof DEMO_SOURCES)[number]["id"];
