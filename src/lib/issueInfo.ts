// Human-readable, business-facing copy for each issue type. Pure data so it can
// be shared by result, replay, queue, and mobile surfaces.

export interface IssueInfo {
  title: string;
  recommend: string;
  next: string;
  kind: "纠错" | "隔离" | "审批" | "通过";
}

export const ISSUE_INFO: Record<string, IssueInfo> = {
  date_anomaly: {
    title: "服务日期异常",
    recommend: "隔离该发布并修正问题。请更正服务日期或重新生成数据后重新提交。",
    next: "修正数据后重新提交，或联系数据提供方确认服务日期的正确性。",
    kind: "隔离",
  },
  code_dictionary_miss: {
    title: "病种编码未命中目录字典",
    recommend: "隔离该行，由目录维护员确认正确编码后再提交。",
    next: "联系目录维护员确认编码，或保留隔离并导出审计包。",
    kind: "隔离",
  },
  code_correctable: {
    title: "病种编码可高置信纠错",
    recommend: "审核纠错提案，确认字典别名映射后纠正编码即可通行。",
    next: "审批人确认纠错提案后，编码将被纠正并可继续发布。",
    kind: "纠错",
  },
  identity_ambiguous: {
    title: "身份 token 模糊匹配",
    recommend: "进入需审批，由数据安全员人工确认身份，Agent 不自动放行。",
    next: "数据安全员确认身份后，决定放行、纠错或隔离。",
    kind: "审批",
  },
  identity_unmatched: {
    title: "身份 token 未命中注册表",
    recommend: "进入需审批，人工核实身份来源后再处理。",
    next: "核实身份来源后批准或隔离。",
    kind: "审批",
  },
  access_policy_denied: {
    title: "访问策略拒绝",
    recommend: "进入需审批，由业务审批人按访问策略审批后再决定是否放行。",
    next: "业务审批人按访问策略审批，审批前不得发布。",
    kind: "审批",
  },
  schema_field_missing: {
    title: "schema 字段缺失",
    recommend: "隔离该行，补齐缺失字段后重新生成数据。",
    next: "补齐字段后重新提交通行检查。",
    kind: "隔离",
  },
};

export function infoFor(type: string): IssueInfo {
  return (
    ISSUE_INFO[type] ?? {
      title: type || "未发现阻断性问题",
      recommend: "当前行符合发布规则与访问策略，可继续发布或导出审计包。",
      next: "继续发布或导出审计包。",
      kind: "通过",
    }
  );
}
