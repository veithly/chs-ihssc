// Human-readable, business-facing copy for each price governance issue type.

export interface IssueInfo {
  title: string;
  recommend: string;
  next: string;
  kind: "纠错" | "处置" | "核验" | "通过";
}

export const ISSUE_INFO: Record<string, IssueInfo> = {
  date_anomaly: {
    title: "价格日期异常",
    recommend: "进入异常处置，修正价格日期或确认数据源推送周期后重新监测。",
    next: "修正日期后重跑价序，或要求数据源提交说明。",
    kind: "处置",
  },
  item_catalog_miss: {
    title: "项目未命中价格目录",
    recommend: "进入异常处置，由目录/价格维护员确认标准医保项目编码。",
    next: "确认标准编码后回写并重新监测，当前记录不得落地。",
    kind: "处置",
  },
  item_code_correctable: {
    title: "项目编码可标化",
    recommend: "审核高置信编码纠错提案，确认后按标准编码回写。",
    next: "确认纠错后重跑价格监测，进入可落地或后续核验。",
    kind: "纠错",
  },
  item_name_mismatch: {
    title: "项目名称与目录不一致",
    recommend: "按价格目录标准名称修正，避免同物异名影响价格汇聚。",
    next: "确认名称后重跑监测。",
    kind: "纠错",
  },
  price_invalid: {
    title: "单价格式异常",
    recommend: "进入异常处置，要求数据源补齐合法人民币单价。",
    next: "补齐单价后重跑监测。",
    kind: "处置",
  },
  price_over_ceiling: {
    title: "超过最高有效价",
    recommend: "冻结该价格记录，生成异常处置任务并核对挂网价/执行价来源。",
    next: "要求数据源回传证明材料，确认后降价、撤回或转人工处理。",
    kind: "处置",
  },
  collective_price_overrun: {
    title: "集采价超容忍阈值",
    recommend: "进入集采价格异常处置，核对省平台中选价与机构执行价。",
    next: "确认是否执行不到位，必要时形成闭环整改任务。",
    kind: "处置",
  },
  collective_not_landed: {
    title: "集采价格未落地",
    recommend: "进入需核验，由集采落地专班确认区域执行状态。",
    next: "核验后确认落地、转异常处置，或调整落地区域策略。",
    kind: "核验",
  },
  procurement_channel_unknown: {
    title: "未知采购/价格渠道",
    recommend: "进入需核验，确认渠道是否纳入价格治理策略。",
    next: "补充渠道策略或退回数据源。",
    kind: "核验",
  },
  price_spike: {
    title: "参考价涨幅异常",
    recommend: "进入需核验，判断是否政策调价、规格变更或异常报送。",
    next: "核验后确认落地或转异常处置。",
    kind: "核验",
  },
  schema_field_missing: {
    title: "价格字段缺失",
    recommend: "进入异常处置，补齐项目编码、渠道、地区、单价等必填字段。",
    next: "补齐字段后重新运行价序。",
    kind: "处置",
  },
};

export function infoFor(type: string): IssueInfo {
  return (
    ISSUE_INFO[type] ?? {
      title: type || "未发现阻断性问题",
      recommend: "当前记录符合价格目录、参考价与集采落地规则，可进入落地台账。",
      next: "持续进入动态价格监测。",
      kind: "通过",
    }
  );
}
